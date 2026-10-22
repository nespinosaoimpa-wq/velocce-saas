import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://oanurhkxqdxtqoauiizy.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_DlDSyq8nUsw5D-SkGd6dyw_9rULN-gE';

// Resilient fetch wrapper with automatic retries for transient network drops (e.g. Wi-Fi drops in workshops)
const resilientFetch = async (input, init, retries = 2, delay = 600) => {
    try {
        return await fetch(input, init);
    } catch (err) {
        const isNetworkErr = err?.name === 'TypeError' || 
                             err?.message?.includes('fetch') || 
                             err?.message?.includes('network') ||
                             err?.message?.includes('NetworkError');
        if (retries > 0 && isNetworkErr) {
            console.warn(`[Network Retry] Reconectando con el servidor tras micro-corte de red (${retries} reintentos restantes)...`);
            await new Promise(r => setTimeout(r, delay));
            return resilientFetch(input, init, retries - 1, delay * 1.5);
        }
        throw err;
    }
};

export const formatNetworkErrorMessage = (error, defaultMsg = 'Ocurrió un error inesperado') => {
    if (!error) return defaultMsg;
    const msg = error.message || String(error);
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('network') || error.name === 'TypeError') {
        return '⚠️ Error de conexión a internet o micro-corte de red en este dispositivo.\n\nPor favor verificá la señal Wi-Fi de esta notebook e intentá nuevamente.';
    }
    return msg;
};

const rawSupabase = supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        global: {
            fetch: resilientFetch
        }
    })
    : null;

export const rawSupabaseClient = rawSupabase;

// Helper to resolve company ID from URL or Subdomain
const getCompanyFromURL = () => {
    if (typeof window === 'undefined') return 'piripi';
    
    // 1. Check for query parameter
    const urlParams = new URLSearchParams(window.location.search);
    const paramCompany = urlParams.get('company') || urlParams.get('empresa');
    if (paramCompany) return paramCompany;

    // 2. Check for subdomain (excluding localhost and vercel base domains)
    const hostname = window.location.hostname;
    const parts = hostname.split('.');
    if (parts.length > 2 && !hostname.includes('vercel.app') && !hostname.includes('localhost')) {
        return parts[0];
    }
    
    // 3. Fallback default
    return 'piripi';
};

export const currentCompanyId = getCompanyFromURL();

// Tables that should be isolated per tenant
const TENANT_TABLES = [
    'employees',
    'clients',
    'vehicles',
    'vehicle_health',
    'boxes',
    'suppliers',
    'brands',
    'inventory',
    'inventory_items',
    'stock_movements',
    'work_orders',
    'work_order_items',
    'work_order_checklist',
    'payments',
    'cash_closings',
    'cash_register_closings',
    'appointments',
    'promotions',
    'daily_work_log',
    'daily_quick_services',
    'service_history',
    'employee_earnings',
    'work_order_assignments',
    'attendance_logs',
    'daily_quick_service_assignments',
    'client_credits',
    'vehicle_notes',
    'audit_logs'
];

// Proxied supabase client to transparently intercept queries and inject tenant isolation
export const supabase = rawSupabase ? new Proxy(rawSupabase, {
    get(target, prop) {
        if (prop === 'from') {
            return (tableName) => {
                const originalBuilder = target.from(tableName);
                
                // If table is not isolated, return normal builder
                if (!TENANT_TABLES.includes(tableName)) {
                    return originalBuilder;
                }

                // Proxy PostgREST queries for tenant filtering & auto-association
                return new Proxy(originalBuilder, {
                    get(builderTarget, builderProp) {
                        const originalMethod = builderTarget[builderProp];
                        if (typeof originalMethod === 'function') {
                            return (...args) => {
                                // A. Intercept SELECT: automatically append company_id filter
                                if (builderProp === 'select') {
                                    const selectBuilder = originalMethod.apply(builderTarget, args);
                                    return selectBuilder.eq('company_id', currentCompanyId);
                                }
                                
                                // B. Intercept INSERT / UPSERT: automatically inject company_id
                                if (builderProp === 'insert' || builderProp === 'upsert') {
                                    const data = args[0];
                                    if (Array.isArray(data)) {
                                        args[0] = data.map(item => ({
                                            company_id: currentCompanyId,
                                            ...item
                                        }));
                                    } else if (typeof data === 'object' && data !== null) {
                                        args[0] = {
                                            company_id: currentCompanyId,
                                            ...data
                                        };
                                    }
                                }

                                // C. Intercept UPDATE / DELETE: automatically restrict scope to company_id
                                if (builderProp === 'update' || builderProp === 'delete') {
                                    const filterBuilder = originalMethod.apply(builderTarget, args);
                                    return filterBuilder.eq('company_id', currentCompanyId);
                                }

                                return originalMethod.apply(builderTarget, args);
                            };
                        }
                        return originalMethod;
                    }
                });
            };
        }
        return target[prop];
    }
}) : null;

if (!supabase) {
    console.warn('Faltan credenciales de Supabase. El sistema usará localStorage.');
}
