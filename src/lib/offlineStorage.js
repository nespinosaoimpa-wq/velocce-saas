// ============================================================================
// VELOCCE PRO — Intelligent Offline Storage Engine (IndexedDB + LocalStorage)
// Ultra-resilient local cache and offline mutation queue
// ============================================================================

const DB_NAME = 'velocce_offline_v2';
const DB_VERSION = 1;

let dbPromise = null;

const getDB = () => {
    if (typeof window === 'undefined' || !window.indexedDB) return null;
    if (!dbPromise) {
        dbPromise = new Promise((resolve) => {
            try {
                const req = window.indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('cache')) {
                        db.createObjectStore('cache');
                    }
                    if (!db.objectStoreNames.contains('sync_queue')) {
                        db.createObjectStore('sync_queue', { keyPath: 'id' });
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = (err) => {
                    console.warn('[OfflineStorage] Error opening IndexedDB, falling back to localStorage', err);
                    resolve(null);
                };
            } catch (err) {
                console.warn('[OfflineStorage] IndexedDB not available, falling back to localStorage', err);
                resolve(null);
            }
        });
    }
    return dbPromise;
};

// ---------------------------------------------------------------------------
// 1. INTELLIGENT DATA CACHE (READ CACHE)
// ---------------------------------------------------------------------------

export const saveOfflineCache = async (companyId, data) => {
    if (!companyId || !data) return false;
    try {
        const db = await getDB();
        if (db) {
            await new Promise((resolve) => {
                const tx = db.transaction('cache', 'readwrite');
                const store = tx.objectStore('cache');
                store.put({ data, timestamp: Date.now() }, companyId);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
            return true;
        }
    } catch (e) {
        console.warn('[OfflineStorage] IndexedDB saveCache error:', e);
    }

    // Fallback: localStorage
    try {
        const cachePayload = {
            data: {
                clients: data.clients || [],
                vehicles: data.vehicles || [],
                workOrders: (data.workOrders || []).slice(0, 400),
                inventory: data.inventory || [],
                suppliers: data.suppliers || [],
                boxes: data.boxes || [],
                employees: data.employees || [],
                workOrderItems: (data.workOrderItems || []).slice(0, 500),
                payments: (data.payments || []).slice(0, 400),
                dailyQuickServices: data.dailyQuickServices || [],
                promotions: data.promotions || [],
                appointments: data.appointments || []
            },
            timestamp: Date.now()
        };
        localStorage.setItem(`velocce_offline_cache_${companyId}`, JSON.stringify(cachePayload));
        return true;
    } catch (lsErr) {
        console.warn('[OfflineStorage] localStorage saveCache error:', lsErr);
        return false;
    }
};

export const getOfflineCache = async (companyId) => {
    if (!companyId) return null;
    try {
        const db = await getDB();
        if (db) {
            const cached = await new Promise((resolve) => {
                const tx = db.transaction('cache', 'readonly');
                const store = tx.objectStore('cache');
                const req = store.get(companyId);
                req.onsuccess = () => resolve(req.result ? req.result.data : null);
                req.onerror = () => resolve(null);
            });
            if (cached) return cached;
        }
    } catch (e) {
        console.warn('[OfflineStorage] IndexedDB getCache error:', e);
    }

    // Fallback: localStorage
    try {
        const raw = localStorage.getItem(`velocce_offline_cache_${companyId}`);
        if (raw) {
            const parsed = JSON.parse(raw);
            return parsed.data || parsed;
        }
    } catch (lsErr) {
        console.warn('[OfflineStorage] localStorage getCache error:', lsErr);
    }
    return null;
};

// ---------------------------------------------------------------------------
// 2. MUTATION QUEUE (OFFLINE WRITE QUEUE)
// ---------------------------------------------------------------------------

export const enqueueOfflineAction = async (companyId, action) => {
    const queueItem = {
        id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        companyId,
        timestamp: Date.now(),
        retryCount: 0,
        ...action
    };

    try {
        const db = await getDB();
        if (db) {
            await new Promise((resolve) => {
                const tx = db.transaction('sync_queue', 'readwrite');
                const store = tx.objectStore('sync_queue');
                store.put(queueItem);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
        }
    } catch (e) {
        console.warn('[OfflineStorage] IndexedDB enqueue error:', e);
    }

    // Backup in localStorage
    try {
        const queueKey = `velocce_sync_queue_${companyId}`;
        const existing = JSON.parse(localStorage.getItem(queueKey) || '[]');
        existing.push(queueItem);
        localStorage.setItem(queueKey, JSON.stringify(existing));
    } catch (lsErr) {
        console.warn('[OfflineStorage] localStorage enqueue error:', lsErr);
    }

    return queueItem;
};

export const getOfflineQueue = async (companyId) => {
    try {
        const db = await getDB();
        if (db) {
            const items = await new Promise((resolve) => {
                const tx = db.transaction('sync_queue', 'readonly');
                const store = tx.objectStore('sync_queue');
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => resolve([]);
            });
            if (items && items.length > 0) {
                return items.filter(i => !i.companyId || i.companyId === companyId);
            }
        }
    } catch (e) {
        console.warn('[OfflineStorage] IndexedDB getQueue error:', e);
    }

    // Fallback: localStorage
    try {
        const raw = localStorage.getItem(`velocce_sync_queue_${companyId}`);
        return raw ? JSON.parse(raw) : [];
    } catch (lsErr) {
        return [];
    }
};

export const removeOfflineAction = async (companyId, actionId) => {
    try {
        const db = await getDB();
        if (db) {
            await new Promise((resolve) => {
                const tx = db.transaction('sync_queue', 'readwrite');
                const store = tx.objectStore('sync_queue');
                store.delete(actionId);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
        }
    } catch (e) {}

    try {
        const queueKey = `velocce_sync_queue_${companyId}`;
        const existing = JSON.parse(localStorage.getItem(queueKey) || '[]');
        const filtered = existing.filter(i => i.id !== actionId);
        localStorage.setItem(queueKey, JSON.stringify(filtered));
    } catch (lsErr) {}
};

export const clearOfflineQueue = async (companyId) => {
    try {
        const db = await getDB();
        if (db) {
            await new Promise((resolve) => {
                const tx = db.transaction('sync_queue', 'readwrite');
                const store = tx.objectStore('sync_queue');
                store.clear();
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
        }
    } catch (e) {}

    try {
        localStorage.removeItem(`velocce_sync_queue_${companyId}`);
    } catch (lsErr) {}
};
