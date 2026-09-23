import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase, currentCompanyId } from '../lib/supabase';
import { MOCK } from '../data/data';
import * as XLSX from 'xlsx';
import { useAuth } from './AuthContext';

const AppContext = createContext();

export const DEFAULT_QUICK_ACTIONS = [
    { id: 'qa1', label: 'Parche Moto', icon: 'tire_repair', price: 2500, color: 'var(--primary)' },
    { id: 'qa2', label: 'Parche Auto', icon: 'tire_repair', price: 3500, color: 'var(--primary)' },
    { id: 'qa3', label: 'Inflado / Aire', icon: 'air', price: 0, color: 'var(--success)' },
    { id: 'qa4', label: 'Ajuste Cadena', icon: 'settings_suggest', price: 1500, color: 'var(--warning)' },
    { id: 'qa5', label: 'Lubric. Cadena', icon: 'oil_barrel', price: 1000, color: 'var(--accent)' },
    { id: 'qa6', label: 'Repar. Cámara', icon: 'build', price: 2800, color: 'var(--danger)' },
];


export const AppProvider = ({ children }) => {
    const { user } = useAuth();

    const logAudit = async (action, details = null) => {
        if (!user) return;
        const logEntry = {
            employee_id: user.id,
            action: action || 'Acceso',
            details: details,
            path: window.location?.pathname || '/',
            created_at: new Date().toISOString()
        };

        try {
            await supabase.from('audit_logs').insert([logEntry]);
        } catch (e) {
            console.warn('Error de auditoría (offline?), guardando en cola local:', e.message);
            // Guardar en cola local si falla (probablemente falta de internet)
            const queue = JSON.parse(localStorage.getItem('velocce_audit_queue') || '[]');
            queue.push({ ...logEntry, offline: true });
            localStorage.setItem('velocce_audit_queue', JSON.stringify(queue));
        }
    };

    // Sincronizar logs offline cuando vuelva el internet
    useEffect(() => {
        const syncOfflineLogs = async () => {
            const queue = JSON.parse(localStorage.getItem('velocce_audit_queue') || '[]');
            if (queue.length === 0) return;

            console.log(`Sincronizando ${queue.length} logs de auditoría offline...`);
            const { error } = await supabase.from('audit_logs').insert(queue);
            if (!error) {
                localStorage.removeItem('velocce_audit_queue');
                console.log('Logs offline sincronizados correctamente.');
            }
        };

        window.addEventListener('online', syncOfflineLogs);
        // Intentar sincronizar al cargar si ya estamos online
        if (navigator.onLine) syncOfflineLogs();

        return () => window.removeEventListener('online', syncOfflineLogs);
    }, []);

    // Latido de actividad (Detección de "computadora encendida") cada 10 minutos
    useEffect(() => {
        if (!user) return;
        const interval = setInterval(() => {
            if (navigator.onLine) {
                logAudit('Heartbeat', { status: 'System Active & Online' });
            }
        }, 600000); // 10 min
        return () => clearInterval(interval);
    }, [user]);

    const [data, setData] = useState({
        clients: [],
        vehicles: [],
        workOrders: [],
        inventory: [],
        suppliers: [],
        boxes: MOCK.boxes,
        vehicleNotes: [],
        payments: [],
        cashClosings: [],
        appointments: [],
        promotions: [],
        assignments: [],
        vehicleHealth: [],
        brands: [],
        dailyWorkLog: [],
        dailyQuickServices: [],
        employees: [],
        activityLog: [],
        workOrderItems: [],
        clientCredits: []
    });
    const [companyStatus, setCompanyStatus] = useState({ 
        is_active: true, 
        contract_accepted: false 
    });
    const [loading, setLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);

    // ==========================================
    // Fichaje Personal (Time Tracking)
    // ==========================================
    const [timeTrackingLogs, setTimeTrackingLogs] = useState([]);

    // ==========================================
    // Carrito de Ventas & Cola de Trabajo
    // ==========================================
    const [posCart, setPosCart] = useState(() => {
        const saved = localStorage.getItem('velocce_pos_cart');
        return saved ? JSON.parse(saved) : [];
    });
    
    const [gomeriaQueue, setGomeriaQueue] = useState(() => {
        const saved = localStorage.getItem('velocce_gomeria_queue');
        return saved ? JSON.parse(saved) : [];
    });

    // ==========================================
    // Botones Rápidos de Gomería Express (Sincronizados)
    // ==========================================
    const [quickActions, setQuickActionsState] = useState(() => {
        try {
            const saved = localStorage.getItem('piripi_quick_actions');
            return saved ? JSON.parse(saved) : DEFAULT_QUICK_ACTIONS;
        } catch {
            return DEFAULT_QUICK_ACTIONS;
        }
    });

    const updateQuickActions = async (newActions) => {
        setQuickActionsState(newActions);
        try {
            localStorage.setItem('piripi_quick_actions', JSON.stringify(newActions));
        } catch (e) {
            console.warn('Error guardando quickActions en localStorage:', e);
        }

        if (supabase) {
            try {
                const { data: existing } = await supabase
                    .from('promotions')
                    .select('id')
                    .eq('name', '_QUICK_ACTIONS_SETTINGS_')
                    .maybeSingle();

                const payload = {
                    name: '_QUICK_ACTIONS_SETTINGS_',
                    description: JSON.stringify(newActions),
                    discount_type: 'FIXED',
                    discount_value: 0,
                    is_active: false,
                    company_id: currentCompanyId
                };

                if (existing?.id) {
                    await supabase.from('promotions').update(payload).eq('id', existing.id);
                } else {
                    await supabase.from('promotions').insert([payload]);
                }
            } catch (err) {
                console.warn("⚠️ No se pudieron sincronizar los precios de gomería en Supabase:", err.message);
            }
        }
    };

    useEffect(() => {
        localStorage.setItem('velocce_pos_cart', JSON.stringify(posCart));
    }, [posCart]);

    useEffect(() => {
        localStorage.setItem('velocce_gomeria_queue', JSON.stringify(gomeriaQueue));
    }, [gomeriaQueue]);

    const addToPosCart = (item) => {
        setPosCart(prev => {
            const existing = prev.findIndex(i => i.id === item.id && !item.isCustom);
            if (existing !== -1) {
                return prev.map((i, idx) => idx === existing ? { ...i, qty: (i.qty || 1) + (item.qty || 1), currentPrice: i.price * ((i.qty || 1) + (item.qty || 1)) } : i);
            }
            return [...prev, { ...item, qty: item.qty || 1, currentPrice: item.price * (item.qty || 1) }];
        });
    };

    const removeFromPosCart = (idx) => {
        setPosCart(prev => prev.filter((_, i) => i !== idx));
    };

    const clearPosCart = () => setPosCart([]);

    const addToQueue = (name) => {
        const newItem = { id: Date.now(), name, services: [], created_at: new Date().toISOString() };
        setGomeriaQueue(prev => [...prev, newItem]);
        return newItem;
    };

    const removeFromQueue = (id) => {
        setGomeriaQueue(prev => prev.filter(q => q.id !== id));
    };

    const addTimeLog = async (pin, type) => {
        if (!pin) throw new Error('Debe ingresar un PIN');
        
        const allEmployees = data.employees || [];
        const emp = (allEmployees || []).find(e => String(e.pin) === String(pin));
        
        if (!emp) {
            throw new Error('PIN incorrecto. Empleado no encontrado.');
        }

        // VALIDACIÓN ESTRICTA DE SECUENCIA
        const lastLog = (timeTrackingLogs || [])
            .filter(l => l.employee_id === emp.id)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

        if (type === 'IN' && lastLog && lastLog.type === 'IN') {
            const lastDate = new Date(lastLog.timestamp).toLocaleDateString();
            const nowDate = new Date().toLocaleDateString();
            if (lastDate === nowDate) {
                throw new Error(`Ya tenés una ENTRADA registrada hoy a las ${lastLog.time_display}. Debes marcar SALIDA antes de entrar de nuevo.`);
            }
            // Si es otro día, permitimos la entrada (la lógica de cálculo cerrará la sesión anterior automáticamente)
        }

        if (type === 'OUT' && (!lastLog || lastLog.type === 'OUT')) {
            throw new Error(`No podés marcar SALIDA porque no tenés una ENTRADA activa.`);
        }

        // Anti-duplicate cooldown: bloquear si el mismo empleado fichó hace menos de 30 segundos (reducido de 60)
        if (lastLog && lastLog.type === type) {
            const elapsed = (Date.now() - new Date(lastLog.timestamp).getTime()) / 1000;
            if (elapsed < 30) {
                throw new Error(`Ya se registró ${type === 'IN' ? 'ENTRADA' : 'SALIDA'} para ${emp.name} hace ${Math.round(elapsed)} segundos.`);
            }
        }

        const now = new Date();
        const newLogData = {
            employee_id: emp.id,
            employee_name: emp.name || 'Empleado',
            type: type, // 'IN' or 'OUT'
            timestamp: now.toISOString(),
            time_display: now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
        };

        // Persistir en Supabase (tabla attendance_logs)
        const { data: inserted, error } = await supabase
            .from('attendance_logs')
            .insert([newLogData])
            .select()
            .single();

        if (error) {
            console.error("Error saving attendance log", error);
            throw new Error('Error al registrar en la base de datos: ' + error.message);
        }

        // Update local state
        const updatedLog = inserted || { ...newLogData, id: Date.now().toString() };
        setTimeTrackingLogs(prev => [updatedLog, ...prev]);

        return { 
            log: updatedLog, 
            emp: emp, 
            time: updatedLog.time_display,
            name: emp.name || 'Empleado'
        };
    };

    const deleteTimeLog = async (id) => {
        try {
            const { error } = await supabase.from('attendance_logs').delete().eq('id', id);
            if (error) throw error;
            
            setTimeTrackingLogs(prev => prev.filter(l => l.id !== id));
            logAudit('Eliminar Fichaje', { log_id: id });
            return true;
        } catch (e) {
            console.error("Error deleting attendance log", e);
            throw e;
        }
    };

    const acceptCompanyContract = async (firmanteName) => {
        try {
            const timestamp = new Date().toISOString();

            // Save acceptance locally first for seamless user experience
            localStorage.setItem(`contract_accepted_${currentCompanyId}`, 'true');
            localStorage.setItem(`contract_accepted_by_${currentCompanyId}`, firmanteName);
            localStorage.setItem(`contract_accepted_at_${currentCompanyId}`, timestamp);

            if (supabase) {
                const { error } = await supabase
                    .from('companies')
                    .update({
                        contract_accepted: true,
                        contract_accepted_by: firmanteName,
                        contract_accepted_at: timestamp
                    })
                    .eq('id', currentCompanyId);

                if (error) {
                    console.warn('No se pudo actualizar el contrato en Supabase debido a políticas de RLS, guardando localmente:', error.message);
                }
            }

            setCompanyStatus(prev => ({
                ...prev,
                contract_accepted: true,
                contract_accepted_by: firmanteName,
                contract_accepted_at: timestamp
            }));
            
            return true;
        } catch (err) {
            console.warn('Error al guardar firma en la empresa:', err);
            localStorage.setItem(`contract_accepted_${currentCompanyId}`, 'true');
            setCompanyStatus(prev => ({
                ...prev,
                contract_accepted: true,
                contract_accepted_by: firmanteName
            }));
            return true;
        }
    };

    const getActiveEmployees = () => {
        const active = [];
        const employees = (data.employees || []).filter(emp => emp.is_active !== false);

        employees.forEach(emp => {
            const lastLog = timeTrackingLogs.find(l => l.employee_id === emp.id);
            if (lastLog && lastLog.type === 'IN') {
                active.push({
                    ...emp,
                    since: new Date(lastLog.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
                    since_raw: lastLog.timestamp,
                    logged_at: lastLog.timestamp
                });
            }
        });
        return active.sort((a, b) => new Date(b.logged_at) - new Date(a.logged_at));
    };


    const loadData = async () => {
        if (!supabase) return;
        setLoading(true);

        const fetchTable = async (table, select = '*') => {
            try {
                const { data, error } = await supabase.from(table).select(select);
                if (error) throw error;
                return data || [];
            } catch (e) {
                console.warn(`⚠️ Error cargando tabla [${table}]:`, e.message);
                return null;
            }
        };

        const fetchAllPaginated = async (table, orderCol = 'created_at', ascending = false) => {
            try {
                let allData = [];
                let from = 0;
                const pageSize = 1000;
                while (true) {
                    const { data, error } = await supabase
                        .from(table)
                        .select('*')
                        .order(orderCol, { ascending })
                        .range(from, from + pageSize - 1);
                    if (error) throw error;
                    if (!data || data.length === 0) break;
                    allData.push(...data);
                    if (data.length < pageSize) break;
                    from += pageSize;
                }
                return allData;
            } catch (e) {
                console.warn(`⚠️ Error cargando tabla paginada [${table}]:`, e.message);
                return null;
            }
        };

        try {
            const [
                clients, vehicles, workOrders, inventory, suppliers, boxes,
                vehicleNotes, payments, cashClosings, appointments, promotions,
                assignments, employees, workOrderItems, dailyQuickServices, attendance_logs, 
                quickServiceAssignments, employeeEarnings, clientCredits
            ] = await Promise.all([
                fetchTable('clients'),
                fetchTable('vehicles'),
                supabase.from('work_orders').select('*, clients(*), vehicles(*)').order('created_at', { ascending: false }).then(r => r.error ? null : (r.data || [])),
                fetchTable('inventory'),
                fetchTable('suppliers'),
                fetchTable('boxes'),
                supabase.from('vehicle_notes').select('*').order('created_at', { ascending: false }).then(r => r.error ? null : (r.data || [])),
                fetchAllPaginated('payments', 'created_at', false),
                supabase.from('cash_closings').select('*').order('created_at', { ascending: false }).then(r => r.error ? null : (r.data || [])),
                supabase.from('appointments').select('*').order('date', { ascending: true }).then(r => r.error ? null : (r.data || [])),
                supabase.from('promotions').select('*').order('created_at', { ascending: false }).then(r => r.error ? null : (r.data || [])),
                fetchTable('work_order_assignments'),
                fetchTable('employees'),
                fetchTable('work_order_items'),
                fetchTable('daily_quick_services'),
                supabase.from('attendance_logs').select('*').order('timestamp', { ascending: false }).then(r => r.error ? null : (r.data || [])),
                fetchTable('employee_earnings'),
                fetchTable('daily_quick_service_assignments'),
                fetchTable('client_credits')
            ]);


            setData({
                clients: (clients !== null) ? clients : MOCK.clients,
                vehicles: (vehicles !== null) ? vehicles : MOCK.vehicles,
                workOrders: (workOrders !== null) ? workOrders : MOCK.workOrders,
                inventory: (inventory !== null) ? inventory : MOCK.inventory,
                suppliers: (suppliers !== null) ? suppliers : MOCK.suppliers,
                boxes: (boxes !== null) ? boxes : MOCK.boxes,
                vehicleNotes: vehicleNotes || [],
                payments: payments || [],
                cashClosings: cashClosings || [],
                appointments: appointments || [],
                promotions: promotions || [],
                assignments: assignments || [],
                employees: (employees !== null) ? employees : MOCK.employees || [],
                workOrderItems: workOrderItems || [],
                dailyQuickServices: dailyQuickServices || [],
                employeeEarnings: employeeEarnings || [],
                quickServiceAssignments: quickServiceAssignments || [],
                clientCredits: clientCredits || [],
                // Tablas opcionales (pueden no existir)
                vehicleHealth: [], brands: [],
                dailyWorkLog: [], serviceHistory: [], 
                activityLog: []
            });

            // Cargar configuración sincronizada de botones de Gomería Express si existe en Supabase
            const quickActionsConfig = (promotions || []).find(p => p.name === '_QUICK_ACTIONS_SETTINGS_');
            if (quickActionsConfig?.description) {
                try {
                    const parsed = JSON.parse(quickActionsConfig.description);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        setQuickActionsState(parsed);
                        localStorage.setItem('piripi_quick_actions', JSON.stringify(parsed));
                    }
                } catch (err) {
                    console.warn('⚠️ Error al parsear quick_actions de Supabase:', err);
                }
            }
            // Consultar metadata de la empresa (Sujeto a no aislamiento)
            const localAccepted = localStorage.getItem(`contract_accepted_${currentCompanyId}`) === 'true';

            let companyInfo = { 
                is_active: true, 
                contract_accepted: localAccepted,
                contract_accepted_by: localStorage.getItem(`contract_accepted_by_${currentCompanyId}`) || null,
                contract_accepted_at: localStorage.getItem(`contract_accepted_at_${currentCompanyId}`) || null
            };
            try {
                const { data: compData, error: compErr } = await supabase
                    .from('companies')
                    .select('*')
                    .eq('id', currentCompanyId)
                    .maybeSingle();
                
                if (compErr) throw compErr;
                
                if (compData) {
                    companyInfo = {
                        is_active: compData.is_active !== false,
                        contract_accepted: compData.contract_accepted || localAccepted,
                        contract_accepted_by: compData.contract_accepted_by || companyInfo.contract_accepted_by,
                        contract_accepted_at: compData.contract_accepted_at || companyInfo.contract_accepted_at
                    };
                }
            } catch (err) {
                console.warn('⚠️ Error al consultar metadata de la empresa:', err.message);
            }
            if (localAccepted) {
                companyInfo.contract_accepted = true;
            }
            setCompanyStatus(companyInfo);

            setTimeTrackingLogs(attendance_logs);
        } catch (e) {
            console.error('CRITICAL: Error in bulk load', e);
        }
        setLoading(false);
    };

    useEffect(() => {
        loadData();

        // =========================================
        // Configuración de Realtime (Live Updates)
        // =========================================
        if (!supabase) return;

        let channel;
        try {
            channel = supabase
                .channel('db-changes')
                .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
                    console.log('🔔 Cambio detectado en DB:', payload.table);
                    
                    // Solo activar Syncing si no estamos ya cargando
                    setIsSyncing(true);
                    
                    if (window._realtimeDebounce) clearTimeout(window._realtimeDebounce);
                    window._realtimeDebounce = setTimeout(async () => {
                        await loadData();
                        setIsSyncing(false);
                        console.log('✅ Datos sincronizados proactivamente.');
                    }, 1500); // 1.5s de debounce
                })
                .subscribe((status) => {
                    if (status === 'SUBSCRIBED') {
                        console.log('📡 Conexión Realtime establecida.');
                    }
                    if (status === 'CHANNEL_ERROR') {
                        console.error('❌ Error en canal Realtime. El sistema puede requerir F5.');
                    }
                });
        } catch (e) {
            console.warn('⚠️ No se pudo iniciar Realtime:', e.message);
        }

        return () => {
            if (channel) supabase.removeChannel(channel);
        };
    }, []);

    // ==========================================
    // Helpers
    // ==========================================
    const getClient = (id) => (data.clients || []).find(c => c.id === id);
    const getVehicle = (id) => (data.vehicles || []).find(v => v.id === id);
    const getClientVehicles = (clientId) => (data.vehicles || []).filter(v => v && v.client_id === clientId);
    const getLowStockItems = () => (data.inventory || []).filter(i =>
        (i && i.stock_type === 'UNIT' && i.stock_quantity <= i.stock_min) ||
        (i && i.stock_type === 'VOLUME' && i.stock_ml <= i.stock_min_ml)
    );

    const addQuickService = async (itemsOrAction, mechanicIds = [], clientId = null, vehicleId = null, paymentOptions = { method: 'EFECTIVO', combinedAmounts: null }, overrideTotal = null) => {
        const items = Array.isArray(itemsOrAction) ? itemsOrAction : [itemsOrAction];
        const labels = items.map(i => i.label).join(', ');
        
        // Convertir mechanicIds a array si viene como un solo ID (compatibilidad)
        const assignedMechanicIds = Array.isArray(mechanicIds) ? mechanicIds : (mechanicIds ? [mechanicIds] : []);
        const primaryMechanicId = assignedMechanicIds.length > 0 ? assignedMechanicIds[0] : null;

        const subtotal = items.reduce((sum, i) => sum + (i.price || i.currentPrice || 0), 0);
        const finalPrice = overrideTotal !== null ? overrideTotal : subtotal;

        // Calcular base de mano de obra (items que no son de inventario)
        const laborItems = items.filter(item => !item.inventory_item && !(data.inventory || []).find(i => i.id === item.id));
        const laborTotal = laborItems.reduce((sum, i) => sum + (i.price || i.currentPrice || 0), 0);
        
        // Si se pasó un solo ID (compatibilidad), convertirlo a array
        const finalMechanicIds = assignedMechanicIds;

        try {
            // 1. Intentar persistir en tabla de servicios rápidos
            let newService = null;
            try {
                const { data: qData, error } = await supabase.from('daily_quick_services').insert([{
                    service_type: labels,
                    price: finalPrice,
                    mechanic_id: primaryMechanicId, // Guardamos el primero como principal
                    client_id: clientId,
                    vehicle_id: vehicleId
                }]).select().single();

                if (!error && qData) {
                    newService = qData;
                    // 1.1 Registrar asignaciones múltiples y comisiones
                    if (finalMechanicIds.length > 0) {
                        const dividedLabor = laborTotal / finalMechanicIds.length;
                        
                        // Tabla intermedia de asignaciones
                        const assignments = finalMechanicIds.map(mId => ({
                            quick_service_id: qData.id,
                            employee_id: mId
                        }));
                        await supabase.from('daily_quick_service_assignments').insert(assignments);

                        // Historial de ganancias
                        for (const mId of finalMechanicIds) {
                            const emp = (data.employees || []).find(e => e.id === mId);
                            const rate = emp ? (parseFloat(emp.commission_rate) || 0) : 0;
                            const amountEarned = dividedLabor * (rate / 100);

                            if (amountEarned > 0) {
                                await supabase.from('employee_earnings').insert([{
                                    employee_id: mId,
                                    quick_service_id: qData.id,
                                    amount_earned: amountEarned,
                                    description: `Comisión Gomería (${finalMechanicIds.length} operarios): ${labels}`
                                }]);
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('Tabla daily_quick_services no disponible o error en asignaciones, continuando...', e.message);
            }

            // 2. Registrar pago automático en caja
            if (finalPrice > 0) {
                const cashierId = primaryMechanicId || null;
                if (paymentOptions.method === 'COMBINADO' && paymentOptions.combinedAmounts) {
                    for (const [method, amount] of Object.entries(paymentOptions.combinedAmounts)) {
                        const amt = parseFloat(amount);
                        if (amt > 0) {
                            await addPayment({
                                amount: amt,
                                method: method,
                                description: `Gomería Express (${method}): ${labels}`,
                                type: 'INGRESO',
                                reference: 'DIRECTO',
                                employee_id: cashierId
                            });
                        }
                    }
                } else {
                    await addPayment({
                        amount: finalPrice,
                        method: paymentOptions.method,
                        description: `Gomería Express: ${labels}`,
                        type: 'INGRESO',
                        reference: 'DIRECTO',
                        employee_id: cashierId
                    });
                }
            }

            // 3. DESCONTAR STOCK (Atómico)
            for (const item of items) {
                const invItem = item.inventory_item || (data.inventory || []).find(i => i.id === item.id);
                if (invItem) {
                    const qty = item.qty || 1;
                    const adjustment = -qty;
                    const useMl = invItem.stock_type === 'VOLUME';
                    
                    const { error: rpcError } = await supabase.rpc('adjust_inventory_stock', {
                        item_id: invItem.id,
                        adjustment: useMl ? Math.round(adjustment * 1000) : adjustment,
                        use_ml: useMl
                    });
                    if (rpcError) {
                        console.error("Error adjusting stock:", rpcError);
                        throw rpcError;
                    }
                }
            }

            // 4. Actualizar estado local
            setData(prev => ({
                ...prev,
                dailyQuickServices: [newService || { id: Date.now().toString(), service_type: labels, price: finalPrice, mechanic_id: primaryMechanicId, created_at: new Date().toISOString() }, ...(prev.dailyQuickServices || [])],
                activityLog: [{ label: labels, price: finalPrice, timestamp: new Date().toISOString(), mechanic_id: primaryMechanicId }, ...(prev.activityLog || [])]
            }));

            await loadData(); // Reload inventory
            logAudit('Gomería Express', { service: labels, total: finalPrice, mechanics_count: finalMechanicIds.length });
        } catch (e) {
            console.error("Error registering express service", e);
            alert("Error al registrar servicio rápido: " + e.message);
        }
    };


    const exportToExcel = (dataType, customData = null) => {
        let rows = [];
        let filename = 'export.xlsx';
        const todayStr = new Date().toLocaleDateString('en-CA');

        if (dataType === 'payments') {
            rows = (data.payments || []).map(p => ({
                Fecha: p.date ? new Date(p.date).toLocaleString('es-AR') : '',
                Monto: p.amount,
                Metodo: p.method || p.payment_method || 'EFECTIVO',
                Tipo: p.type || (p.amount < 0 ? 'EGRESO' : 'INGRESO'),
                Descripcion: p.description || ''
            }));
            filename = `movimientos_caja_${todayStr}.xlsx`;
        } else if (dataType === 'inventory') {
            rows = (data.inventory || []).map(i => ({
                Producto: i.name || '',
                Marca: i.brand || '',
                Precio_Venta: i.sell_price || 0,
                Stock: i.stock_type === 'UNIT' ? (i.stock_quantity || 0) : (i.stock_ml || 0),
                Tipo: i.stock_type || 'UNIT'
            }));
            filename = `inventario_${todayStr}.xlsx`;
        } else if (dataType === 'sales') {
            rows = (data.payments || []).filter(p => p.type === 'INGRESO' && p.description?.includes('Venta')).map(s => ({
                Fecha: s.date ? new Date(s.date).toLocaleString('es-AR') : '',
                Monto_Total: s.amount,
                Metodo_Pago: s.method || s.payment_method || '',
                Cajero: s.cashier_id || 'LOCAL',
                Detalle: s.description || ''
            }));
            filename = `punto_de_venta_${todayStr}.xlsx`;
        } else if (dataType === 'work_orders') {
            rows = (data.workOrders || []).map(wo => {
                const client = wo.clients || data.clients?.find(c => c.id === wo.client_id);
                const vehicle = wo.vehicles || data.vehicles?.find(v => v.id === wo.vehicle_id);
                return {
                    Nro_Orden: wo.order_number || '',
                    Fecha_Ingreso: wo.created_at ? new Date(wo.created_at).toLocaleDateString('es-AR') : '',
                    Cliente: client ? `${client.first_name} ${client.last_name}` : 'N/A',
                    Vehiculo: vehicle ? `${vehicle.brand} ${vehicle.model} (${vehicle.license_plate})` : 'N/A',
                    Descripcion: wo.description || '',
                    Estado: wo.status || '',
                    Total: wo.total_price || 0
                };
            });
            filename = `ordenes_trabajo_${todayStr}.xlsx`;
        } else if (dataType === 'appointments') {
            rows = (data.appointments || []).map(a => ({
                Fecha: a.date || '',
                Hora: a.time || '',
                Motivo: a.title || '',
                Cliente: a.client || '',
                Vehiculo: a.vehicle || '',
                Box: a.box || '',
                Estado: a.status || ''
            }));
            filename = `turnos_${todayStr}.xlsx`;
        } else if (dataType === 'attendance') {
            rows = (timeTrackingLogs || []).map(l => {
                const emp = (data.employees || []).find(e => e.id === l.employee_id);
                return {
                    Empleado: l.employee_name || emp?.name || 'Desconocido',
                    Fecha: new Date(l.timestamp).toLocaleDateString('es-AR'),
                    Hora: new Date(l.timestamp).toLocaleTimeString('es-AR'),
                    Evento: l.type === 'IN' ? 'ENTRADA' : 'SALIDA',
                    Timestamp: l.timestamp
                };
            }).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));
            filename = `asistencia_detallada_${todayStr}.xlsx`;
        } else if (dataType === 'audit') {
            const auditData = customData || [];
            rows = auditData.map(l => ({
                Fecha: new Date(l.created_at).toLocaleString('es-AR'),
                Usuario: l.employees?.name || 'Local/Sistema',
                Accion: l.action || '',
                Detalles: l.details ? JSON.stringify(l.details) : ''
            }));
            filename = `auditoria_sistema_${todayStr}.xlsx`;
        } else if (dataType === 'payroll' || dataType === 'performance') {
            const filters = (customData && !Array.isArray(customData)) ? customData : {};
            rows = (data.employees || []).map(emp => {
                const stats = getDetailedEmployeeStats(emp.id, filters);
                const commissions = getCommissions(emp.id, filters);
                return {
                    ID: emp.id,
                    Empleado: emp.name || '',
                    Rol: emp.role || '',
                    Horas_Trabajadas: parseFloat(stats.totalHours || 0).toFixed(2),
                    Monto_Generado_OT: stats.productionList.filter(p => p.type === 'OT').reduce((s, p) => s + p.amount, 0),
                    Monto_Generado_Gomeria: stats.productionList.filter(p => p.type === 'GOMERÍA').reduce((s, p) => s + p.amount, 0),
                    Monto_Ventas_POS: stats.productionList.filter(p => p.type === 'PUNTO DE VENTA').reduce((s, p) => s + p.amount, 0),
                    Produccion_Total: stats.totalProductionAmount,
                    Comision_Total_Pesos: commissions,
                    Total_a_Pagar: commissions 
                };
            });
            filename = `planilla_sueldos_detallada_${todayStr}.xlsx`;
        }

        if (rows.length === 0) return alert('No hay datos para exportar');

        // Create workbook and worksheet
        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Datos");

        // Set column widths automatically
        const colWidths = Object.keys(rows[0]).map(key => ({
            wch: Math.max(key.length, ...rows.map(row => row[key] ? row[key].toString().length : 0)) + 2
        }));
        worksheet['!cols'] = colWidths;

        // Export to file
        XLSX.writeFile(workbook, filename);
    };

    // Historial unificado: OTs finalizadas + notas manuales
    const getVehicleHistory = (vehicleId) => {
        const otEntries = (data.workOrders || [])
            .filter(wo => wo && wo.vehicle_id === vehicleId && (wo.status === 'Finalizado' || wo.status === 'Cobrado'))
            .map(wo => ({
                id: wo.id,
                date: wo.completed_at || wo.created_at,
                description: wo.description,
                km: wo.km_at_entry || 0,
                price: wo.total_price || 0,
                technician: wo.mechanic_id || 'N/A',
                source: 'OT',
                order_number: wo.order_number
            }));

        const noteEntries = (data.vehicleNotes || [])
            .filter(n => n && n.vehicle_id === vehicleId)
            .map(n => ({
                id: n.id,
                date: n.created_at,
                description: n.description,
                km: n.km || 0,
                price: n.cost || 0,
                technician: n.technician || '',
                source: 'NOTA'
            }));

        return [...otEntries, ...noteEntries].sort((a, b) => new Date(b.date) - new Date(a.date));
    };

    // ==========================================
    // CRUD — Clientes
    // ==========================================
    const addClient = async (clientData) => {
        const { data: newClient, error } = await supabase
            .from('clients')
            .insert([{
                first_name: clientData.first_name,
                last_name: clientData.last_name,
                phone: clientData.phone,
                dni: clientData.dni,
                email: clientData.email || null,
                is_frequent: clientData.is_frequent || false
            }])
            .select()
            .single();

        if (error) { console.error("Error creating client", error); throw error; }

        logAudit('Crear Cliente', { client_name: clientData.first_name + ' ' + clientData.last_name, dni: clientData.dni });

        setData(prev => ({ ...prev, clients: [...prev.clients, newClient] }));
        return newClient;
    };

    const updateClient = async (id, updates) => {
        const { data: updated, error } = await supabase
            .from('clients').update(updates).eq('id', id).select().single();
        if (error) { console.error("Error updating client", error); throw error; }
        
        logAudit('Actualizar Cliente', { client_id: id, updates });
        
        setData(prev => ({ ...prev, clients: prev.clients.map(c => c.id === id ? { ...c, ...updated } : c) }));
        return updated;
    };

    const deleteClient = async (id) => {
        const { error } = await supabase
            .from('clients').delete().eq('id', id);
        if (error) { console.error("Error deleting client", error); throw error; }
        
        logAudit('Borrar Cliente', { client_id: id });
        
        setData(prev => ({ ...prev, clients: prev.clients.filter(c => c.id !== id) }));
        return true;
    };

    // ==========================================
    // CRUD — Vehículos
    // ==========================================
    const addVehicle = async (vehicleData) => {
        const { data: newVehicle, error } = await supabase
            .from('vehicles')
            .insert([{
                client_id: vehicleData.client_id,
                license_plate: vehicleData.license_plate,
                brand: vehicleData.brand,
                model: vehicleData.model,
                year: parseInt(vehicleData.year) || null,
                km: parseInt(vehicleData.km) || 0,
                color: vehicleData.color || 'N/A',
                health_score: 100,
                difficulty_factor: 1.0
            }])
            .select()
            .single();

        if (error) { console.error("Error creating vehicle", error); throw error; }
        logAudit('Crear Vehículo', { license_plate: vehicleData.license_plate, brand: vehicleData.brand });
        setData(prev => ({ ...prev, vehicles: [...prev.vehicles, newVehicle] }));
        return newVehicle;
    };

    const updateVehicle = async (id, updates) => {
        const { data: updated, error } = await supabase
            .from('vehicles').update(updates).eq('id', id).select().single();
        if (error) { console.error("Error updating vehicle", error); throw error; }
        logAudit('Actualizar Vehículo', { vehicle_id: id, updates });
        setData(prev => ({ ...prev, vehicles: prev.vehicles.map(v => v.id === id ? { ...v, ...updated } : v) }));
        return updated;
    };

    // ==========================================
    // CRUD — Notas de Vehículo
    // ==========================================
    const addVehicleNote = async (noteData) => {
        const { data: newNote, error } = await supabase
            .from('vehicle_notes')
            .insert([{
                vehicle_id: noteData.vehicle_id,
                description: noteData.description,
                km: parseInt(noteData.km) || null,
                cost: parseFloat(noteData.cost) || 0,
                technician: noteData.technician || null,
                note_type: noteData.note_type || 'MANUAL'
            }])
            .select()
            .single();

        if (error) { console.error("Error creating vehicle note", error); throw error; }
        setData(prev => ({ ...prev, vehicleNotes: [newNote, ...prev.vehicleNotes] }));
        return newNote;
    };

    // ==========================================
    // CRUD — Proveedores
    // ==========================================
    const addSupplier = async (supplierData) => {
        const { data: newSupplier, error } = await supabase
            .from('suppliers')
            .insert([{
                name: supplierData.name,
                contact: supplierData.contact || '',
                phone: supplierData.phone || '',
                cuit: supplierData.cuit || '',
                category: supplierData.category || ''
            }])
            .select()
            .single();

        if (error) { console.error("Error creating supplier", error); throw error; }
        logAudit('Crear Proveedor', { supplier_name: supplierData.name });
        setData(prev => ({ ...prev, suppliers: [...prev.suppliers, newSupplier] }));
        return newSupplier;
    };

    const updateSupplier = async (id, updates) => {
        const { data: updated, error } = await supabase
            .from('suppliers')
            .update({
                name: updates.name,
                contact: updates.contact || '',
                phone: updates.phone || '',
                cuit: updates.cuit || '',
                category: updates.category || ''
            })
            .eq('id', id)
            .select()
            .single();

        if (error) { console.error("Error updating supplier", error); throw error; }
        logAudit('Actualizar Proveedor', { supplier_id: id, updates });
        setData(prev => ({ ...prev, suppliers: prev.suppliers.map(s => s.id === id ? { ...s, ...updated } : s) }));
        return updated;
    };

    const deleteSupplier = async (id) => {
        const supplier = (data.suppliers || []).find(s => s.id === id);
        // Desvincular productos asociados en inventario para evitar errores de clave foránea
        await supabase.from('inventory').update({ supplier_id: null }).eq('supplier_id', id);

        const { error } = await supabase.from('suppliers').delete().eq('id', id);
        if (error) { console.error("Error deleting supplier", error); throw error; }
        logAudit('Borrar Proveedor', { supplier_id: id, supplier_name: supplier?.name });

        setData(prev => ({
            ...prev,
            suppliers: (prev.suppliers || []).filter(s => s.id !== id),
            inventory: (prev.inventory || []).map(i => i.supplier_id === id ? { ...i, supplier_id: null } : i)
        }));
    };

    // ==========================================
    // CRUD — Inventario
    // ==========================================
    const addInventoryItem = async (itemData) => {
        const itemToInsert = {
            stock_type: 'UNIT',
            ...itemData
        };
        const { data: newItem, error } = await supabase.from('inventory').insert([itemToInsert]).select().single();
        if (error) { console.error("Error creating inventory item", error); throw error; }
        logAudit('Crear Item de Inventario', { product: itemToInsert.name, barcode: itemToInsert.barcode });

        setData(prev => ({ ...prev, inventory: [...prev.inventory, newItem] }));
        return newItem;
    };

    const updateInventoryItem = async (id, updates) => {
        const { data, error } = await supabase.from('inventory').update(updates).eq('id', id).select();
        if (error) { console.error("Error updating inventory item", error); throw error; }

        if (!data || data.length === 0) {
            console.error("No item returned after update.");
            return updates; // Return the updates as fallback
        }

        const updated = data[0];
        logAudit('Actualizar Item de Inventario', { product_id: id, updates });

        setData(prev => ({ ...prev, inventory: prev.inventory.map(i => i.id === id ? { ...i, ...updated } : i) }));
        return updated;
    };

    const deleteInventoryItem = async (id) => {
        const item = (data.inventory || []).find(i => i.id === id);
        const { error } = await supabase.from('inventory').delete().eq('id', id);
        if (error) { console.error("Error deleting inventory item", error); throw error; }
        logAudit('Borrar Item de Inventario', { product_id: id, product_name: item?.name });

        setData(prev => ({ ...prev, inventory: prev.inventory.filter(i => i.id !== id) }));
    };

    // ==========================================
    // Órdenes de Trabajo
    // ==========================================
    const addWorkOrder = async (woData) => {
        const { data: newWo, error } = await supabase.from('work_orders').insert([{
            client_id: woData.client_id,
            vehicle_id: woData.vehicle_id,
            box_id: woData.box_id || null,
            description: woData.description,
            km_at_entry: woData.km_at_entry || 0,
            labor_cost: woData.labor_cost,
            parts_cost: woData.parts_cost,
            total_price: woData.total_price,
            status: woData.status || (woData.box_id ? 'En Box' : 'Pendiente'),
            created_at: woData.date || new Date().toISOString(),
            completed_at: (woData.status === 'Finalizado' || woData.status === 'Cobrado') ? (woData.date || new Date().toISOString()) : null,
            labor_profit_percent: woData.labor_profit_percent || 100
        }]).select('*, clients(*), vehicles(*)').single();

        if (!error && newWo) {
            // 1. Asignar mecánicos si existen
            if (woData.mechanic_ids && woData.mechanic_ids.length > 0) {
                const assignments = woData.mechanic_ids.map(mid => ({
                    work_order_id: newWo.id,
                    mechanic_id: mid,
                    labor_commission_percent: woData.applied_commission_rate
                }));
                await supabase.from('work_order_assignments').insert(assignments);
            }

            // 2. Asignar productos si existen
            if (woData.products && woData.products.length > 0) {
                const items = woData.products.map(p => ({
                    work_order_id: newWo.id,
                    inventory_item_id: p.is_custom ? null : p.id,
                    description: p.name,
                    quantity: p.qty,
                    unit_price: p.sell_price,
                    total_price: p.sell_price * p.qty,
                    is_labor: p.is_custom ? true : false
                }));
                await supabase.from('work_order_items').insert(items);

                // Descontar stock (Atómico)
                for (const p of woData.products) {
                    if (p.is_custom) continue; // No stock for custom service
                    const useMl = p.stock_type === 'VOLUME';
                    const adjustment = -p.qty;
                    
                    const { error: rpcError } = await supabase.rpc('adjust_inventory_stock', {
                        item_id: p.id,
                        adjustment: useMl ? Math.round(adjustment * 1000) : adjustment,
                        use_ml: useMl
                    });
                    if (rpcError) {
                        console.error("Error adjusting inventory stock:", rpcError);
                        throw rpcError;
                    }
                }
            }


            logAudit('Crear Orden de Trabajo', { order_number: newWo.order_number, total_price: woData.total_price });

            await loadData();
            return newWo;
        }
        if (error) { console.error("Error creating WO", error); throw error; }
    };
    
    const addItemsToWorkOrder = async (woId, products) => {
        if (!products || products.length === 0) return;
        
        try {
            const items = products.map(p => ({
                work_order_id: woId,
                inventory_item_id: p.is_custom ? null : p.id,
                description: p.name,
                quantity: p.qty,
                unit_price: p.sell_price,
                total_price: p.sell_price * p.qty,
                is_labor: p.is_custom ? true : false
            }));
            
            const { error: itemsError } = await supabase.from('work_order_items').insert(items);
            if (itemsError) throw itemsError;

            // Descontar stock (Atómico)
            for (const p of products) {
                if (p.is_custom) continue; // No stock for custom service
                const useMl = p.stock_type === 'VOLUME';
                const adjustment = -p.qty;
                
                const { error: rpcError } = await supabase.rpc('adjust_inventory_stock', {
                    item_id: p.id,
                    adjustment: useMl ? Math.round(adjustment * 1000) : adjustment,
                    use_ml: useMl
                });
                if (rpcError) {
                    console.error("Error adjusting inventory stock:", rpcError);
                    throw rpcError;
                }
            }

            // Actualizar precio total de la OT
            const wo = (data.workOrders || []).find(w => w.id === woId);
            if (wo) {
                const addedLabor = products.filter(p => p.is_custom).reduce((sum, p) => sum + (p.sell_price * p.qty), 0);
                const addedParts = products.filter(p => !p.is_custom).reduce((sum, p) => sum + (p.sell_price * p.qty), 0);
                const totalAdded = addedLabor + addedParts;

                const newLaborCost = (wo.labor_cost || 0) + addedLabor;
                const newPartsCost = (wo.parts_cost || 0) + addedParts;
                const newTotal = (wo.total_price || 0) + totalAdded;
                
                await supabase.from('work_orders').update({
                    labor_cost: newLaborCost,
                    parts_cost: newPartsCost,
                    total_price: newTotal
                }).eq('id', woId);
            }

            await loadData();
            logAudit('Agregar Productos a OT', { work_order_id: woId, products_count: products.length });
            return true;
        } catch (error) {
            console.error("Error adding items to WO", error);
            throw error;
        }
    };

    const updateWorkOrder = async (id, updates, paymentInfo = null, afipData = null, mechanicIds = null, creditOptions = null) => {
        let payload = { ...updates };
        let { error } = await supabase.from('work_orders').update(payload).eq('id', id);

        // Si falla por columna inexistente (PGRST204), hacer fallback seguro
        if (error && (error.code === 'PGRST204' || error.message?.includes('column'))) {
            const wo = (data.workOrders || []).find(w => w.id === id);
            const notesToSave = payload.mechanic_notes || payload.observations;
            delete payload.mechanic_notes;
            delete payload.observations;

            if (notesToSave && wo) {
                const baseDesc = wo.description?.split('\n\n[OBSERVACIONES]:')[0] || wo.description || '';
                payload.description = `${baseDesc}\n\n[OBSERVACIONES]: ${notesToSave}`.trim();
            }
            const res = await supabase.from('work_orders').update(payload).eq('id', id);
            error = res.error;
        }

        if (!error) {
            // Actualizar estado local inmediatamente
            setData(prev => ({
                ...prev,
                workOrders: (prev.workOrders || []).map(w => w.id === id ? { ...w, ...updates, ...(payload.description ? { description: payload.description } : {}) } : w)
            }));
            let freshAssignmentsList = null;
            // Update assignments if mechanicIds provided
            if (mechanicIds) {
                try {
                    // 1. Obtener asignaciones actuales para preservar porcentajes manuales
                    const currentAssignments = data.assignments?.filter(a => a.work_order_id === id) || [];
                    
                    // 2. Eliminar antiguas
                    await supabase.from('work_order_assignments').delete().eq('work_order_id', id);
                    
                    // 3. Insertar nuevas usando la nueva tasa si se especificó, sino preservar la previa si el mecánico es el mismo
                    const assignments = mechanicIds.map(mid => {
                        const existing = (currentAssignments || []).find(ca => ca.mechanic_id === mid);
                        const hasPrevious = existing?.labor_commission_percent !== undefined && existing?.labor_commission_percent !== null;
                        const preservedRate = (updates.applied_commission_rate !== undefined && updates.applied_commission_rate !== null)
                            ? updates.applied_commission_rate
                            : (hasPrevious ? existing.labor_commission_percent : 0);
                        
                        return {
                            work_order_id: id,
                            mechanic_id: mid,
                            labor_commission_percent: preservedRate
                        };
                    });
                    
                    if (assignments.length > 0) {
                        await supabase.from('work_order_assignments').insert(assignments);
                    }
                    freshAssignmentsList = assignments;
                } catch (e) {
                    console.error('Error updating WO assignments', e);
                }
            }

            // Si la orden se finaliza o cobra, intentar crear el pago automáticamente en caja y REGISTRAR GANANCIAS
            if (updates.status === 'Finalizado' || updates.status === 'Cobrado') {
                const wo = data.workOrders?.find(w => w.id === id);
                // Usar el precio actualizado si viene en 'updates', sino el actual de la OT
                const finalPrice = updates.total_price !== undefined ? updates.total_price : (wo?.total_price || 0);
                const laborCost = updates.labor_cost !== undefined ? updates.labor_cost : (wo?.labor_cost || 0);
                
                if (wo && finalPrice > 0) {
                    // REGISTRO DE GANANCIAS (Locking comisiones)
                    try {
                        const activeAssignments = freshAssignmentsList || data.assignments?.filter(a => a.work_order_id === id) || [];
                        
                        // Limpiar ganancias previas para esta OT para reconstruirlas de forma limpia y evitar duplicados/desactualizaciones
                        await supabase.from('employee_earnings').delete().eq('work_order_id', id);

                        if (activeAssignments.length > 0) {
                            const laborShare = laborCost / activeAssignments.length;
                            
                            for (const a of activeAssignments) {
                                const emp = data.employees?.find(e => e.id === a.mechanic_id);
                                // Prioridad: % individual en asignación > % en perfil
                                const rate = (a.labor_commission_percent !== undefined && a.labor_commission_percent !== null) 
                                    ? parseFloat(a.labor_commission_percent) 
                                    : (emp ? parseFloat(emp.commission_rate) : 0);
                                
                                const amountEarned = laborShare * (rate / 100);

                                if (amountEarned > 0) {
                                    await supabase.from('employee_earnings').insert([{
                                        employee_id: a.mechanic_id,
                                        work_order_id: id,
                                        amount_earned: amountEarned,
                                        description: `Comisión OT #${wo.order_number} (${activeAssignments.length} operarios): ${wo.description?.substring(0, 30)}...`
                                    }]);
                                }
                            }
                        }
                    } catch (e) {
                        console.error('Error locking OT commissions', e);
                    }

                    try {
                        // --- LÓGICA INTELIGENTE DE CAJA Y SALDOS ---
                        // 1. Calcular cuánto se ha pagado ya por esta OT (Adelantos/Señas)
                        const totalPaidSoFar = (data.payments || [])
                            .filter(p => p.work_order_id === id && p.type === 'INGRESO')
                            .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
                        
                        const pendingToPay = finalPrice - totalPaidSoFar;
                        
                        // Solo registramos si falta pagar algo (o si es crédito de la casa con entrega inicial)
                        if (pendingToPay > 0 || (paymentInfo?.method === 'CREDITO_CASA' && parseFloat(creditOptions?.initial_payment) > 0)) {
                            const method = paymentInfo?.method || 'EFECTIVO';
                            const combined = paymentInfo?.combinedAmounts;
                            const mainMechanicId = (mechanicIds && mechanicIds.length > 0) ? mechanicIds[0] : (wo.mechanic_id || null);

                            if (method === 'COMBINADO' && combined) {
                                // En combinado se respeta lo ingresado manualmente
                                for (const [m, amount] of Object.entries(combined)) {
                                    const amt = parseFloat(amount);
                                    if (amt > 0) {
                                        await addPayment({
                                            amount: amt,
                                            method: m,
                                            description: `Pago OT #${wo.order_number} (${m})`,
                                            type: 'INGRESO',
                                            reference: 'OT',
                                            work_order_id: wo.id,
                                            employee_id: mainMechanicId,
                                            cae: afipData ? afipData.cae : null,
                                            cae_due_date: afipData ? afipData.caeDueDate : null,
                                            receipt_number: afipData ? afipData.receiptText : null
                                        });
                                    }
                                }
                            } else if (method === 'CREDITO_CASA' && creditOptions) {
                                // CRÉDITO DE LA CASA: Solo la entrega inicial impacta en caja
                                const initialPay = parseFloat(creditOptions.initial_payment || 0);
                                const interest = parseFloat(creditOptions.interest_rate || 0);
                                const totalWithInterest = finalPrice * (1 + interest / 100);

                                const creditRecord = await addClientCredit({
                                    client_id: creditOptions.client_id,
                                    work_order_id: wo.id,
                                    total_amount: totalWithInterest,
                                    initial_payment: initialPay,
                                    current_balance: totalWithInterest - initialPay,
                                    interest_rate: interest,
                                    payment_frequency: creditOptions.payment_frequency,
                                    next_payment_date: creditOptions.next_payment_date,
                                    notes: `OT #${wo.order_number}`
                                });

                                // Impacto en caja: Solo lo que entregó hoy
                                if (initialPay > 0) {
                                    await addPayment({
                                        amount: initialPay,
                                        method: 'CREDITO_CASA',
                                        description: `Crédito OT #${wo.order_number} (Entrega Inicial)`,
                                        type: 'INGRESO',
                                        reference: 'OT',
                                        work_order_id: wo.id,
                                        employee_id: mainMechanicId,
                                        client_credit_id: creditRecord.id
                                    });
                                }
                            } else {
                                // PAGO TOTAL / RESTANTE
                                // Si ya había señas, solo registramos el excedente para no duplicar en caja
                                await addPayment({
                                    amount: pendingToPay,
                                    method: method,
                                    description: totalPaidSoFar > 0 
                                        ? `Pago Final OT #${wo.order_number} (Saldo Restante)` 
                                        : `Pago OT #${wo.order_number}`,
                                    type: 'INGRESO',
                                    reference: 'OT',
                                    work_order_id: wo.id,
                                    employee_id: mainMechanicId,
                                    cae: afipData ? afipData.cae : null,
                                    cae_due_date: afipData ? afipData.caeDueDate : null,
                                    receipt_number: afipData ? afipData.receiptText : null
                                });
                            }
                        }
                    } catch (e) {
                        console.error('No se pudo automatizar el pago de la OT', e);
                        alert('⚠️ Error crítico al registrar el pago: ' + e.message + '\n\nSi estás usando "Crédito de la Casa", asegúrate de haber ejecutado el script SQL de habilitación.');
                        throw e; // Re-lanzamos para que la UI no cierre el modal y el usuario sepa que falló
                    }
                }
            } else if (updates.status === 'Pendiente' || updates.status === 'En Box' || updates.status === 'Cancelado') {
                // Si la orden pasa a un estado no finalizado, eliminar cualquier ganancia registrada
                try {
                    await supabase.from('employee_earnings').delete().eq('work_order_id', id);
                } catch (e) {
                    console.error('Error deleting OT commissions for unfinalized OT', e);
                }
            }

            logAudit('Actualizar Orden de Trabajo', { work_order_id: id, status: updates.status, ...updates });

            setData(prev => ({
                ...prev,
                workOrders: prev.workOrders.map(wo => wo.id === id ? { ...wo, ...updates } : wo)
            }));
        }
    };

    // ==========================================
    // Promociones
    // ==========================================
    const addPromotion = async (promoData) => {
        const { data: newPromo, error } = await supabase.from('promotions').insert([promoData]).select().single();
        if (error) { console.error("Error creating promotion", error); throw error; }
        logAudit('Crear Promoción', { coupon: promoData.coupon_code || promoData.title });
        setData(prev => ({ ...prev, promotions: [newPromo, ...prev.promotions] }));
        return newPromo;
    };

    const deletePromotion = async (id) => {
        const { error } = await supabase.from('promotions').delete().eq('id', id);
        if (error) { console.error("Error deleting promotion", error); throw error; }
        logAudit('Borrar Promoción', { promo_id: id });
        setData(prev => ({ ...prev, promotions: prev.promotions.filter(p => p.id !== id) }));
    };

    const addAppointment = async (aptData) => {
        const { data: newApt, error } = await supabase.from('appointments').insert([aptData]).select().single();
        if (error) { console.error("Error creating appointment", error); throw error; }
        logAudit('Crear Turno', { date: aptData.date, client: aptData.client_name });
        setData(prev => ({ ...prev, appointments: [...prev.appointments, newApt].sort((a, b) => a.date.localeCompare(b.date)) }));
        return newApt;
    };

    const deleteAppointment = async (id) => {
        const apt = (data.appointments || []).find(a => a.id === id);
        const { error } = await supabase.from('appointments').delete().eq('id', id);
        if (error) { console.error("Error deleting appointment", error); throw error; }
        logAudit('Borrar Turno', { appointment_id: id, client: apt?.client, date: apt?.date });
        setData(prev => ({ ...prev, appointments: prev.appointments.filter(a => a.id !== id) }));
    };

    const deleteWorkOrder = async (id) => {
        try {
            console.log("Iniciando borrado de OT:", id);
            
            const { error: err1 } = await supabase.from('payments').delete().eq('work_order_id', id);
            if (err1) throw new Error("Pagos: " + err1.message);

            const { error: err2 } = await supabase.from('work_order_assignments').delete().eq('work_order_id', id);
            if (err2) throw new Error("Asignaciones: " + err2.message);

            const { error: err3 } = await supabase.from('work_order_items').delete().eq('work_order_id', id);
            if (err3) throw new Error("Items: " + err3.message);

            const { data, error: err4 } = await supabase.from('work_orders').delete().eq('id', id).select();
            if (err4) throw new Error("OT: " + err4.message);
            
            if (!data || data.length === 0) {
                 throw new Error("No se pudo borrar. Es posible que no tengas permisos (RLS) o el ID (" + id + ") no exista.");
            }

            const woToDelete = (data || []).find(w => w.id === id);
            setData(prev => ({
                ...prev,
                workOrders: prev.workOrders.filter(wo => wo.id !== id),
                assignments: (prev.assignments || []).filter(a => a.work_order_id !== id),
                payments: (prev.payments || []).filter(p => p.work_order_id !== id)
            }));
            
            logAudit('Borrar Orden de Trabajo', { work_order_id: id, order_number: woToDelete?.order_number });
            
            alert('OT eliminada exitosamente.');
            return true;
        } catch (e) {
            console.error("Error deleting work order", e);
            alert("No se pudo eliminar la OT: " + e.message);
            throw e;
        }
    };

    // ==========================================
    // Facturación AFIP
    // ==========================================
    const generateAFIPInvoice = async (invoiceData) => {
        try {
            const baseUrl = window.location.hostname === 'localhost' ? 'http://localhost:5173' : '';
            const res = await fetch(`${baseUrl}/api/afip`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(invoiceData)
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            return data;
        } catch (error) {
            console.error('Error generando Factura AFIP:', error);
            throw error;
        }
    };

    // ==========================================
    // Créditos de la Casa (Cuentas Corrientes)
    // ==========================================
    const addClientCredit = async (creditData) => {
        const { data: newCredit, error } = await supabase
            .from('client_credits')
            .insert([{
                client_id: creditData.client_id,
                work_order_id: creditData.work_order_id || null,
                total_amount: parseFloat(creditData.total_amount),
                initial_payment: parseFloat(creditData.initial_payment || 0),
                current_balance: parseFloat(creditData.current_balance),
                interest_rate: parseFloat(creditData.interest_rate || 0),
                payment_frequency: creditData.payment_frequency || 'LIBRE',
                next_payment_date: creditData.next_payment_date || null,
                notes: creditData.notes || ''
            }])
            .select()
            .single();

        if (error) { console.error("Error adding client credit", error); throw error; }
        
        setData(prev => ({ 
            ...prev, 
            clientCredits: [newCredit, ...prev.clientCredits] 
        }));
        
        logAudit('Crear Crédito de la Casa', { client_id: creditData.client_id, amount: creditData.total_amount });
        return newCredit;
    };

    const recordCreditPayment = async (targetId, paymentData, isClient = false) => {
        let creditsToPay = [];
        let totalAmount = parseFloat(paymentData.amount);

        if (isClient) {
            creditsToPay = (data.clientCredits || [])
                .filter(c => c.client_id === targetId && c.status === 'ACTIVO')
                .sort((a, b) => new Date(a.created_at || a.next_payment_date) - new Date(b.created_at || b.next_payment_date));
        } else {
            const credit = (data.clientCredits || []).find(c => c.id === targetId);
            if (credit) creditsToPay = [credit];
        }

        if (creditsToPay.length === 0) {
            return await addPayment({ ...paymentData, type: 'INGRESO' });
        }

        // 1. Registrar el pago central
        const newPayment = await addPayment({
            ...paymentData,
            client_credit_id: isClient ? null : targetId,
            type: 'INGRESO',
            description: paymentData.description || (isClient ? 'Pago acumulado de cuenta corriente' : 'Cobro de Cuota/Crédito')
        });

        // 2. Distribuir el pago entre los créditos (FIFO)
        let remaining = totalAmount;
        const updatedCredits = [...(data.clientCredits || [])];

        for (const credit of creditsToPay) {
            if (remaining <= 0) break;

            const currentBalance = parseFloat(credit.current_balance);
            const paymentForThis = Math.min(remaining, currentBalance);
            const newBalance = Math.max(0, currentBalance - paymentForThis);
            const status = newBalance <= 0 ? 'PAGADO' : 'ACTIVO';

            await supabase
                .from('client_credits')
                .update({ 
                    current_balance: newBalance,
                    status: status
                })
                .eq('id', credit.id);

            const idx = updatedCredits.findIndex(c => c.id === credit.id);
            if (idx !== -1) {
                updatedCredits[idx] = { ...updatedCredits[idx], current_balance: newBalance, status };
            }

            remaining -= paymentForThis;
        }

        setData(prev => ({
            ...prev,
            clientCredits: updatedCredits
        }));

        logAudit('Registrar Pago de Crédito', { target_id: targetId, is_client: isClient, amount: totalAmount });
        return newPayment;
    };

    // ==========================================
    // Pagos y Caja
    // ==========================================
    const addPayment = async (paymentData) => {
        const today = new Date().toISOString().split('T')[0];
        const { data: newPayment, error } = await supabase
            .from('payments')
            .insert([{
                amount: parseFloat(paymentData.amount),
                method: paymentData.method || 'EFECTIVO',
                date: today,
                reference: paymentData.reference || null,
                work_order_id: paymentData.work_order_id || null,
                description: paymentData.description || 'Ingreso',
                type: paymentData.type || 'INGRESO',
                employee_id: paymentData.employee_id || null,
                cae: paymentData.cae || null,
                cae_due_date: paymentData.cae_due_date || null,
                receipt_number: paymentData.receipt_number || null,
                client_credit_id: paymentData.client_credit_id || null
            }])
            .select()
            .single();

        if (error) { console.error("Error adding payment", error); throw error; }


        setData(prev => ({ ...prev, payments: [newPayment, ...prev.payments] }));
        
        logAudit('Registrar Pago/Ingreso', { amount: paymentData.amount, method: paymentData.method, description: paymentData.description });
        
        return newPayment;
    };

    const addWithdrawal = async (withdrawalData) => {
        const today = new Date().toLocaleDateString('en-CA');
        const { data: newWithdrawal, error } = await supabase
            .from('payments')
            .insert([{
                amount: -Math.abs(parseFloat(withdrawalData.amount)),
                method: 'EFECTIVO',
                date: today,
                reference: null,
                description: withdrawalData.description || 'Retiro de caja',
                type: 'EGRESO',
                employee_id: withdrawalData.employee_id || null
            }])
            .select()
            .single();

        if (error) { console.error("Error adding withdrawal", error); throw error; }

        setData(prev => ({ ...prev, payments: [newWithdrawal, ...prev.payments] }));
        logAudit('Retiro de Efectivo', { amount: Math.abs(parseFloat(withdrawalData.amount)), description: withdrawalData.description });
        return newWithdrawal;
    };

    const updatePayment = async (id, updates) => {
        const { data: updated, error } = await supabase
            .from('payments')
            .update(updates)
            .eq('id', id)
            .select();

        if (error) { console.error("Error updating payment", error); throw error; }

        const paymentReturned = updated && updated.length > 0 ? updated[0] : updates;

        setData(prev => ({
            ...prev,
            payments: prev.payments.map(p => p.id === id ? { ...p, ...paymentReturned } : p)
        }));

        return paymentReturned;
    };

    const deletePayment = async (id) => {
        const { error } = await supabase.from('payments').delete().eq('id', id);
        if (error) { console.error("Error deleting payment", error); throw error; }

        setData(prev => ({ ...prev, payments: prev.payments.filter(p => p.id !== id) }));
        
        logAudit('Eliminar Pago/Movimiento', { payment_id: id });
    };

    const performCashClose = async (closeData, withdrawAll = false) => {
        const today = new Date().toLocaleDateString('en-CA');

        // Find previous closing balance
        const sortedClosings = (data.cashClosings || []).sort((a, b) => new Date(b.created_at || b.date) - new Date(a.created_at || a.date));
        const lastClosing = sortedClosings.length > 0 ? sortedClosings[0] : null;
        const startingBalance = lastClosing ? (lastClosing.actual_cash || 0) : 0;

        const { data: closingResult, error } = await supabase
            .from('cash_closings')
            .insert([{
                date: today,
                starting_balance: startingBalance,
                cash_income: closeData.cash_expected || 0,
                transfer_income: closeData.transfer_total || 0,
                card_income: closeData.card_total || 0,
                expected_cash: (closeData.cash_expected || 0) + startingBalance,
                actual_cash: closeData.cash_real || 0,
                difference: closeData.difference || 0,
                employee_id: closeData.employee_id || null
            }])
            .select();

        if (error) { console.error("Error performing cash close", error); throw error; }

        const closing = closingResult && closingResult.length > 0 ? closingResult[0] : null;

        // Mark all unclosed payments with this closing ID
        const unclosedPayments = data.payments.filter(p => !p.cash_closing_id).map(p => p.id);

        if (unclosedPayments.length > 0 && closing?.id) {
            const { error: updateError } = await supabase
                .from('payments')
                .update({ cash_closing_id: closing.id })
                .in('id', unclosedPayments);
            
            if (updateError) {
                console.error("Error updating payments with closing ID", updateError);
            } else {
                // Optimistic local update to clear UI immediately
                setData(prev => ({
                    ...prev,
                    payments: prev.payments.map(p => 
                        unclosedPayments.includes(p.id) ? { ...p, cash_closing_id: closing.id } : p
                    )
                }));
            }
        }

        // Reload all data so the view refreshes with the marked payments from source of truth
        await loadData();
        
        // Optionally record a full withdrawal if requested (to start next shift at $0)
        if (withdrawAll && closeData.cash_real > 0) {
            await addWithdrawal({
                amount: closeData.cash_real,
                description: `Retiro automático post-cierre (Fecha: ${today})`,
                employee_id: closeData.employee_id
            });
        }

        logAudit('Cierre de Caja Realizado', { date: today, actual_cash: closeData.actual_cash, difference: closeData.difference });
        
        return closing;
    };

    // ==========================================
    // Punto de Venta — processSale
    // ==========================================
    const processSale = async (cart, payMethod, afipData = null, employeeId = null, cashierProfit = 0, creditOptions = null) => {
        const total = cart.reduce((sum, ci) => sum + (ci.sell_price * ci.qty), 0);
        const today = new Date().toLocaleDateString('en-CA');
        
        let clientId = creditOptions?.client_id || null;

        // 1. Registrar el pago
        const { data: payment, error: payError } = await supabase
            .from('payments')
            .insert([{
                amount: total,
                method: payMethod,
                date: today,
                description: `Venta POS: ${cart.map(ci => `${ci.qty}x ${ci.name}`).join(', ')}`,
                type: 'VENTA',
                reference: null,
                employee_id: employeeId || null,
                cashier_profit_amount: cashierProfit,
                cae: afipData?.cae || null,
                cae_due_date: afipData?.cae_due_date || null,
                receipt_number: afipData?.receipt_number || null,
                client_credit_id: null // Se actualizará si es crédito
            }])
            .select()
            .single();

        if (payError) { console.error("Error registering sale", payError); throw payError; }

        let creditRecord = null;
        if (payMethod === 'CREDITO_CASA' && clientId) {
            const initialPay = parseFloat(creditOptions.initial_payment || 0);
            const interest = parseFloat(creditOptions.interest_rate || 0);
            const totalWithInterest = total * (1 + interest / 100);
            
            creditRecord = await addClientCredit({
                client_id: clientId,
                total_amount: totalWithInterest,
                initial_payment: initialPay,
                current_balance: totalWithInterest - initialPay,
                interest_rate: interest,
                payment_frequency: creditOptions.payment_frequency,
                next_payment_date: creditOptions.next_payment_date,
                notes: `Venta POS #${payment.id}`
            });

            // Vincular el pago original al crédito
            if (creditRecord) {
                await supabase.from('payments').update({ client_credit_id: creditRecord.id }).eq('id', payment.id);
                // Si hubo pago inicial, el registro de 'payment' debe reflejar solo ese monto
                if (initialPay > 0) {
                    await supabase.from('payments').update({ amount: initialPay }).eq('id', payment.id);
                } else {
                    // Si no hubo pago inicial, el monto del 'payment' técnico es 0 (pero registra la venta)
                    await supabase.from('payments').update({ amount: 0 }).eq('id', payment.id);
                }
            }
        }
        // 3. Descontar Stock (Atómico)
        for (const ci of cart) {
            if (ci.is_manual) continue;
            
            const useMl = ci.stock_type === 'VOLUME';
            const adjustment = -ci.qty;

            const { error: rpcError } = await supabase.rpc('adjust_inventory_stock', {
                item_id: ci.id,
                adjustment: useMl ? Math.round(adjustment * 1000) : adjustment,
                use_ml: useMl
            });
            if (rpcError) {
                console.error("Error adjusting stock for sale item:", rpcError);
                throw rpcError;
            }
        }

        // 3. Informar
        await loadData();
        
        logAudit('Procesar Venta POS', { total, payMethod, items_count: cart.length });
        
        return total;
    };

    const updateAssignmentCommission = async (assignmentId, updates) => {
        const { error } = await supabase
            .from('work_order_assignments')
            .update(updates)
            .eq('id', assignmentId);

        if (error) { console.error("Error updating commission", error); throw error; }
        logAudit('Actualizar Comisión de Mecánico', { assignment_id: assignmentId, updates });
        
        // RECALCULAR GANANCIAS DE LA OT ASOCIADA
        try {
            const { data: assignment } = await supabase
                .from('work_order_assignments')
                .select('work_order_id')
                .eq('id', assignmentId)
                .single();
                
            if (assignment && assignment.work_order_id) {
                const woId = assignment.work_order_id;
                const wo = (data.workOrders || []).find(w => w.id === woId);
                if (wo && (wo.status === 'Finalizado' || wo.status === 'Cobrado')) {
                    // Obtener asignaciones frescas de la base de datos para estar seguros
                    const { data: freshAssignments } = await supabase
                        .from('work_order_assignments')
                        .select('*')
                        .eq('work_order_id', woId);
                        
                    if (freshAssignments && freshAssignments.length > 0) {
                        const laborCost = parseFloat(wo.labor_cost) || 0;
                        const laborShare = laborCost / freshAssignments.length;
                        
                        // Limpiar anteriores
                        await supabase.from('employee_earnings').delete().eq('work_order_id', woId);
                        
                        for (const a of freshAssignments) {
                            const emp = (data.employees || []).find(e => e.id === a.mechanic_id);
                            const rate = (a.labor_commission_percent !== undefined && a.labor_commission_percent !== null)
                                ? parseFloat(a.labor_commission_percent)
                                : (emp ? parseFloat(emp.commission_rate) : 0);
                                
                            const amountEarned = laborShare * (rate / 100);
                            
                            if (amountEarned > 0) {
                                await supabase.from('employee_earnings').insert([{
                                    employee_id: a.mechanic_id,
                                    work_order_id: woId,
                                    amount_earned: amountEarned,
                                    description: `Comisión OT #${wo.order_number} (${freshAssignments.length} operarios): ${wo.description?.substring(0, 30)}...`
                                }]);
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Error updating earnings from assignment commission update', e);
        }

        await loadData();
    };

    // ==========================================
    // Comisiones
    // ==========================================
    const getCommissions = (employeeId, filters = {}) => {
        const { startDate, endDate } = filters;
        const emp = (data.employees || []).find(e => e.id === employeeId);
        const defaultRate = emp ? parseFloat(emp.commission_rate) || 0 : 0;

        // 1. Comisiones por Órdenes de Trabajo (OT)
        // Usamos 'employee_earnings' que ya tiene el split y el rate bloqueado (locking)
        const otEarnings = (data.employeeEarnings || [])
            .filter(e => {
                if (e.employee_id !== employeeId || !e.work_order_id) return false;
                
                // Filtro de fecha
                if (startDate || endDate) {
                    const eDate = new Date(e.created_at);
                    if (startDate && eDate < new Date(startDate)) return false;
                    if (endDate) {
                        const end = new Date(endDate);
                        end.setHours(23, 59, 59, 999);
                        if (eDate > end) return false;
                    }
                }
                return true;
            })
            .reduce((sum, e) => sum + (parseFloat(e.amount_earned) || 0), 0);

        // 2. Comisiones por Servicios Rápidos (Gomería)
        const quickEarnings = (data.employeeEarnings || [])
            .filter(e => {
                if (e.employee_id !== employeeId || !e.quick_service_id) return false;
                
                // Filtro de fecha
                if (startDate || endDate) {
                    const eDate = new Date(e.created_at);
                    if (startDate && eDate < new Date(startDate)) return false;
                    if (endDate) {
                        const end = new Date(endDate);
                        end.setHours(23, 59, 59, 999);
                        if (eDate > end) return false;
                    }
                }
                return true;
            })
            .reduce((sum, e) => sum + (parseFloat(e.amount_earned) || 0), 0);
        
        // 3. Comisiones de Cajero (Ventas POS)
        const cashierCommissions = (data.payments || [])
            .filter(p => {
                if (p.employee_id !== employeeId || p.type !== 'VENTA') return false;
                
                // Filtro de fecha
                if (startDate || endDate) {
                    const pDate = new Date(p.date || p.created_at);
                    if (startDate && pDate < new Date(startDate)) return false;
                    if (endDate) {
                        const end = new Date(endDate);
                        end.setHours(23, 59, 59, 999);
                        if (pDate > end) return false;
                    }
                }
                return true;
            })
            .reduce((sum, p) => sum + (parseFloat(p.cashier_profit_amount) || 0), 0);

        return otEarnings + quickEarnings + cashierCommissions;
    };

    const getDetailedEmployeeStats = (employeeId, filters = {}) => {
        const { startDate, endDate } = filters;
        
        let logs = (timeTrackingLogs || []).filter(l => l.employee_id === employeeId);
        
        // Aplicar filtros de fecha si existen
        if (startDate || endDate) {
            logs = logs.filter(l => {
                const logDate = new Date(l.timestamp);
                if (startDate && logDate < new Date(startDate)) return false;
                if (endDate) {
                    const end = new Date(endDate);
                    end.setHours(23, 59, 59, 999);
                    if (logDate > end) return false;
                }
                return true;
            });
        }

        // Calcular horas trabajadas (Opción A: 0 si olvidan marcar salida)
        let totalMs = 0;
        const sortedLogs = [...logs].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        let lastIn = null;
        
        sortedLogs.forEach(log => {
            if (log.type === 'IN') {
                if (lastIn) {
                    // Si ya había un IN sin OUT previo, cerramos el anterior con un tope de 8 horas (jornada estándar) 
                    // para no perder esas horas, pero marcando la anomalía.
                    totalMs += (8 * 60 * 60 * 1000);
                }
                lastIn = new Date(log.timestamp);
            } else if (log.type === 'OUT' && lastIn) {
                const diff = new Date(log.timestamp) - lastIn;
                const hours = diff / (1000 * 60 * 60);
                
                if (hours < 16) { // Aumentado a 16h por si hacen horas extra
                    totalMs += diff;
                } else {
                    // Si la sesión dura más de 16 horas, probablemente se olvidaron de marcar. 
                    // Capeamos a 12h como medida de seguridad.
                    totalMs += (12 * 60 * 60 * 1000);
                }
                lastIn = null;
            }
        });
        
        if (lastIn) {
            const diff = new Date() - lastIn;
            const hours = diff / (1000 * 60 * 60);
            if (hours < 16) {
                totalMs += diff;
            } else {
                totalMs += (12 * 60 * 60 * 1000);
            }
        }
        
        const totalHours = totalMs / (1000 * 60 * 60);

        // Producción en OTs
        const assignments = (data.assignments || []).filter(a => a.mechanic_id === employeeId);
        const otProduction = assignments.map(a => {
            const wo = data.workOrders?.find(w => w.id === a.work_order_id);
            const date = wo?.completed_at || wo?.created_at;
            
            // Filtro de fecha para OTs
            if (startDate || endDate) {
                const itemDate = new Date(date);
                if (startDate && itemDate < new Date(startDate)) return null;
                if (endDate) {
                    const end = new Date(endDate);
                    end.setHours(23, 59, 59, 999);
                    if (itemDate > end) return null;
                }
            }

            return {
                id: a.id,
                date,
                type: 'OT',
                description: wo?.description || 'Órden de Trabajo',
                order_number: wo?.order_number,
                amount: parseFloat(wo?.labor_cost) || 0,
                status: wo?.status
            };
        }).filter(item => item && (item.status === 'Finalizado' || item.status === 'Cobrado'));

        // Producción en Gomería
        const quickAssignments = (data.quickServiceAssignments || []).filter(a => a.employee_id === employeeId);
        const quickProduction = quickAssignments.map(a => {
            const s = (data.dailyQuickServices || []).find(qs => qs.id === a.quick_service_id);
            if (!s) return null;

            const date = s.created_at;
            
            // Filtro de fecha para Gomería
            if (startDate || endDate) {
                const itemDate = new Date(date);
                if (startDate && itemDate < new Date(startDate)) return null;
                if (endDate) {
                    const end = new Date(endDate);
                    end.setHours(23, 59, 59, 999);
                    if (itemDate > end) return null;
                }
            }

            // Cálculo proporcional: si hay N mecánicos en el servicio, este recibe 1/N del monto
            const siblingAssignments = (data.quickServiceAssignments || []).filter(sa => sa.quick_service_id === s.id);
            const mechanicsCount = Math.max(1, siblingAssignments.length);
            const share = (parseFloat(s.price) || 0) / mechanicsCount;

            return {
                id: s.id,
                date,
                type: 'GOMERÍA',
                description: s.service_type || 'Servicio Rápido',
                amount: share,
                status: 'Finalizado',
                isShared: mechanicsCount > 1
            };
        }).filter(item => item !== null);

        // Producción de Cajeros (Ventas POS)
        const posProduction = (data.payments || [])
            .filter(p => p.employee_id === employeeId && p.type === 'VENTA')
            .map(p => {
                const date = p.date || p.created_at;
                
                // Filtro de fecha para POS
                if (startDate || endDate) {
                    const itemDate = new Date(date);
                    if (startDate && itemDate < new Date(startDate)) return null;
                    if (endDate) {
                        const end = new Date(endDate);
                        end.setHours(23, 59, 59, 999);
                        if (itemDate > end) return null;
                    }
                }

                return {
                    id: p.id,
                    date,
                    type: 'PUNTO DE VENTA',
                    description: p.description || 'Venta de Mostrador',
                    amount: parseFloat(p.amount) || 0,
                    status: 'Finalizado'
                };
            }).filter(item => item !== null);

        const combinedProduction = [...otProduction, ...quickProduction, ...posProduction].sort((a, b) => new Date(b.date) - new Date(a.date));
        const totalProductionAmount = combinedProduction.reduce((sum, item) => sum + item.amount, 0);

        return {
            totalHours: totalHours,
            attendanceLogs: logs,
            productionList: combinedProduction,
            totalProductionAmount,
            productionCount: combinedProduction.length
        };
    };

    const getInventoryBySupplier = (supplierId) => {
        if (!supplierId) return data.inventory || [];
        return (data.inventory || []).filter(item => item.supplier_id === supplierId);
    };

    const getEmployeeProductivity = (employeeId, filters = {}) => {
        const stats = getDetailedEmployeeStats(employeeId, filters);
        return {
            count: stats.productionCount,
            total_labor: stats.totalProductionAmount,
            commission: getCommissions(employeeId, filters)
        };
    };

    return (
        <AppContext.Provider value={{
            data,
            timeTrackingLogs,
            loading,
            refreshData: loadData,
            addTimeLog,
            deleteTimeLog,
            getClient,
            getVehicle,
            getClientVehicles,
            getLowStockItems,
            getVehicleHistory,
            addClient,
            updateClient,
            deleteClient,
            addVehicle,
            updateVehicle,
            addVehicleNote,
            addInventoryItem,
            updateInventoryItem,
            deleteInventoryItem,
            addSupplier,
            updateSupplier,
            deleteSupplier,
            addWorkOrder,
            deleteWorkOrder,
            addItemsToWorkOrder,
            updateWorkOrder,
            addPayment,
            updatePayment,
            deletePayment,
            addWithdrawal,
            performCashClose,
            processSale,
            updateAssignmentCommission,
            getCommissions,
            getInventoryBySupplier,
            getEmployeeProductivity,
            getDetailedEmployeeStats,
            addQuickService,
            getActiveEmployees,
            exportToExcel,
            addPromotion,
            deletePromotion,
            addAppointment,
            deleteAppointment,
            addClientCredit,
            recordCreditPayment,
            generateAFIPInvoice,
            // POS Global
            posCart,
            setPosCart,
            addToPosCart,
            removeFromPosCart,
            clearPosCart,
            gomeriaQueue,
            setGomeriaQueue,
            addToQueue,
            removeFromQueue,
            quickActions,
            updateQuickActions,
            isSyncing,
            setIsSyncing,
            logAudit,
            companyStatus,
            setCompanyStatus,
            acceptCompanyContract
        }}>
            {children}
        </AppContext.Provider>
    );
};

export const useApp = () => useContext(AppContext);
