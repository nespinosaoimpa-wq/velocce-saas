// ============================================================================
// VELOCCE PRO — Intelligent Offline Synchronization Manager
// Reconciles local queued mutations with Supabase in background
// ============================================================================

import { getOfflineQueue, removeOfflineAction } from './offlineStorage';

export const isNetworkError = (error) => {
    if (!error) return false;
    const msg = error.message || String(error);
    return error.name === 'TypeError' ||
           msg.includes('fetch') ||
           msg.includes('network') ||
           msg.includes('NetworkError') ||
           msg.includes('timeout') ||
           (typeof navigator !== 'undefined' && !navigator.onLine);
};

export const processSyncQueue = async (supabase, companyId, onProgress = null) => {
    if (!supabase || !companyId) return { syncedCount: 0, errors: [] };
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return { syncedCount: 0, errors: ['Offline'] };
    }

    const queue = await getOfflineQueue(companyId);
    if (!queue || queue.length === 0) return { syncedCount: 0, errors: [] };

    console.log(`[OfflineSyncManager] Iniciando sincronización de ${queue.length} acciones pendientes...`);

    let syncedCount = 0;
    const errors = [];
    const resolvedIdMap = {}; // Maps tempId -> real UUID

    for (let i = 0; i < queue.length; i++) {
        const action = queue[i];
        if (onProgress) {
            onProgress({ current: i + 1, total: queue.length, action });
        }

        try {
            switch (action.type) {
                // -------------------------------------------------------------
                // 1. ADD WORK ORDER
                // -------------------------------------------------------------
                case 'ADD_WORK_ORDER': {
                    const woData = action.payload;
                    const resolvedClientId = resolvedIdMap[woData.client_id] || woData.client_id;
                    const resolvedVehicleId = resolvedIdMap[woData.vehicle_id] || woData.vehicle_id;

                    const { data: newWo, error: woError } = await supabase.from('work_orders').insert([{
                        client_id: resolvedClientId,
                        vehicle_id: resolvedVehicleId,
                        box_id: woData.box_id || null,
                        description: woData.description,
                        km_at_entry: woData.km_at_entry || 0,
                        labor_cost: woData.labor_cost,
                        parts_cost: woData.parts_cost,
                        total_price: woData.total_price,
                        status: woData.status || (woData.box_id ? 'En Box' : 'Pendiente'),
                        created_at: woData.date || new Date(action.timestamp).toISOString(),
                        completed_at: (woData.status === 'Finalizado' || woData.status === 'Cobrado') ? (woData.date || new Date().toISOString()) : null,
                        labor_profit_percent: woData.labor_profit_percent || 100
                    }]).select('*, clients(*), vehicles(*)').single();

                    if (woError) throw woError;

                    if (newWo) {
                        if (action.tempId) {
                            resolvedIdMap[action.tempId] = newWo.id;
                        }

                        // Asignar mecánicos
                        if (woData.mechanic_ids && woData.mechanic_ids.length > 0) {
                            const assignments = woData.mechanic_ids.map(mid => ({
                                work_order_id: newWo.id,
                                mechanic_id: mid,
                                labor_commission_percent: woData.applied_commission_rate
                            }));
                            await supabase.from('work_order_assignments').insert(assignments);
                        }

                        // Asignar productos y descontar stock
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

                            for (const p of woData.products) {
                                if (p.is_custom) continue;
                                const useMl = p.stock_type === 'VOLUME';
                                const adjustment = -p.qty;
                                await supabase.rpc('adjust_inventory_stock', {
                                    item_id: p.id,
                                    adjustment: useMl ? Math.round(adjustment * 1000) : adjustment,
                                    use_ml: useMl
                                });
                            }
                        }
                    }
                    break;
                }

                // -------------------------------------------------------------
                // 2. ADD ITEMS TO WORK ORDER
                // -------------------------------------------------------------
                case 'ADD_ITEMS_TO_WO': {
                    const { woId, products } = action.payload;
                    const resolvedWoId = resolvedIdMap[woId] || woId;

                    if (products && products.length > 0) {
                        const items = products.map(p => ({
                            work_order_id: resolvedWoId,
                            inventory_item_id: p.is_custom ? null : p.id,
                            description: p.name,
                            quantity: p.qty,
                            unit_price: p.sell_price,
                            total_price: p.sell_price * p.qty,
                            is_labor: p.is_custom ? true : false
                        }));
                        const { error: itemsError } = await supabase.from('work_order_items').insert(items);
                        if (itemsError) throw itemsError;

                        // Recalcular total real en base a work_order_items
                        const { data: allItems } = await supabase.from('work_order_items').select('*').eq('work_order_id', resolvedWoId);
                        if (allItems && allItems.length > 0) {
                            const sumParts = allItems.filter(i => !i.is_labor).reduce((sum, i) => sum + Number(i.total_price), 0);
                            const sumLabor = allItems.filter(i => i.is_labor).reduce((sum, i) => sum + Number(i.total_price), 0);
                            await supabase.from('work_orders').update({
                                parts_cost: sumParts,
                                labor_cost: sumLabor,
                                total_price: sumParts + sumLabor
                            }).eq('id', resolvedWoId);
                        }

                        // Descontar stock
                        const stockPromises = products.filter(p => !p.is_custom).map(p => {
                            const useMl = p.stock_type === 'VOLUME';
                            const adjustment = -p.qty;
                            return supabase.rpc('adjust_inventory_stock', {
                                item_id: p.id,
                                adjustment: useMl ? Math.round(adjustment * 1000) : adjustment,
                                use_ml: useMl
                            });
                        });
                        await Promise.allSettled(stockPromises);
                    }
                    break;
                }

                // -------------------------------------------------------------
                // 3. UPDATE WORK ORDER
                // -------------------------------------------------------------
                case 'UPDATE_WORK_ORDER': {
                    const { id, updates } = action.payload;
                    const resolvedWoId = resolvedIdMap[id] || id;
                    await supabase.from('work_orders').update(updates).eq('id', resolvedWoId);
                    break;
                }

                // -------------------------------------------------------------
                // 4. DELETE WORK ORDER
                // -------------------------------------------------------------
                case 'DELETE_WORK_ORDER': {
                    const { id } = action.payload;
                    const resolvedWoId = resolvedIdMap[id] || id;
                    await supabase.from('work_order_items').delete().eq('work_order_id', resolvedWoId);
                    await supabase.from('work_orders').delete().eq('id', resolvedWoId);
                    break;
                }

                // -------------------------------------------------------------
                // 5. PROCESS SALE (POS)
                // -------------------------------------------------------------
                case 'PROCESS_SALE': {
                    const { paymentPayload, cart } = action.payload;
                    const { error: payErr } = await supabase.from('payments').insert([paymentPayload]);
                    if (payErr) throw payErr;

                    // Descontar stock
                    if (cart && cart.length > 0) {
                        for (const item of cart) {
                            if (item.isCustom) continue;
                            const useMl = item.stock_type === 'VOLUME';
                            const adjustment = -item.qty;
                            await supabase.rpc('adjust_inventory_stock', {
                                item_id: item.id,
                                adjustment: useMl ? Math.round(adjustment * 1000) : adjustment,
                                use_ml: useMl
                            });
                        }
                    }
                    break;
                }

                // -------------------------------------------------------------
                // 6. ADD QUICK SERVICE (GOMERÍA EXPRESS)
                // -------------------------------------------------------------
                case 'ADD_QUICK_SERVICE': {
                    const { serviceData, paymentData } = action.payload;
                    if (serviceData) {
                        await supabase.from('daily_quick_services').insert([serviceData]);
                    }
                    if (paymentData) {
                        await supabase.from('payments').insert([paymentData]);
                    }
                    break;
                }

                // -------------------------------------------------------------
                // 7. ADD PAYMENT
                // -------------------------------------------------------------
                case 'ADD_PAYMENT': {
                    await supabase.from('payments').insert([action.payload]);
                    break;
                }

                // -------------------------------------------------------------
                // 8. ADD CLIENT
                // -------------------------------------------------------------
                case 'ADD_CLIENT': {
                    const { data: newClient, error: clientErr } = await supabase
                        .from('clients')
                        .insert([action.payload.clientData])
                        .select()
                        .single();
                    if (clientErr) throw clientErr;
                    if (newClient && action.tempId) {
                        resolvedIdMap[action.tempId] = newClient.id;
                    }
                    break;
                }

                // -------------------------------------------------------------
                // 9. ADD VEHICLE
                // -------------------------------------------------------------
                case 'ADD_VEHICLE': {
                    const vData = { ...action.payload.vehicleData };
                    if (vData.client_id && resolvedIdMap[vData.client_id]) {
                        vData.client_id = resolvedIdMap[vData.client_id];
                    }
                    const { data: newVehicle, error: vehErr } = await supabase
                        .from('vehicles')
                        .insert([vData])
                        .select()
                        .single();
                    if (vehErr) throw vehErr;
                    if (newVehicle && action.tempId) {
                        resolvedIdMap[action.tempId] = newVehicle.id;
                    }
                    break;
                }

                default:
                    console.warn(`[OfflineSyncManager] Tipo de acción no reconocida: ${action.type}`);
            }

            // Remoción exitosa de la cola
            await removeOfflineAction(companyId, action.id);
            syncedCount++;
            console.log(`[OfflineSyncManager] Sincronizada con éxito acción: ${action.type} (${action.id})`);

        } catch (err) {
            console.error(`[OfflineSyncManager] Error al sincronizar acción [${action.type}]:`, err);
            // Si el error es de conexión de red, abortamos para reintentar cuando haya señal estable
            if (isNetworkError(err)) {
                console.warn('[OfflineSyncManager] Corte de red detectado durante sincronización. Pausando cola para próximo intento...');
                break;
            }
            // Si es un error de validación/datos irrecuperable, lo registramos para no frenar la cola eternamente
            errors.push({ actionId: action.id, type: action.type, error: err.message });
            action.retryCount = (action.retryCount || 0) + 1;
            if (action.retryCount >= 5) {
                console.warn(`[OfflineSyncManager] Descartando acción ${action.id} tras 5 intentos fallidos`);
                await removeOfflineAction(companyId, action.id);
            }
        }
    }

    console.log(`[OfflineSyncManager] Fin de ciclo: ${syncedCount} acciones sincronizadas, ${errors.length} con error.`);
    return { syncedCount, errors };
};
