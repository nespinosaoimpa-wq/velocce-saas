import React, { useState } from 'react';
import { supabase } from './lib/supabase';
import { useApp } from './context/AppContext';
import { useAuth } from './context/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { Icon, Modal, FormField, CameraScanner, PitScreensaver, MembershipRegistrationModal } from './components/ui';
import { useBarcodeScanner } from './hooks/useBarcodeScanner';
import { formatCurrency } from './data/data';
import { DashboardPage } from './pages/DashboardPage';
import { WorkOrdersPage } from './pages/WorkOrdersPage';
import { DailyWorkPage } from './pages/DailyWorkPage';
import { ClientsPage } from './pages/ClientsPage';
import { InventoryPage } from './pages/InventoryPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { CashRegisterPage } from './pages/CashRegisterPage';
import { CalendarPage } from './pages/CalendarPage';
import { PromotionsPage } from './pages/PromotionsPage';
import { ReportsPage } from './pages/ReportsPage';
import { UsersPage } from './pages/UsersPage';
import { SalesPage } from './pages/SalesPage';
import { AdminSettingsPage } from './pages/AdminSettingsPage';
import { ProgrammerAuditPage } from './pages/ProgrammerAuditPage';
import { HelpPage } from './pages/HelpPage';
import { HouseCreditPage } from './pages/HouseCreditPage';
import { MembershipPage } from './pages/MembershipPage';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { useNavigation } from './hooks/useNavigation';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { LockScreen } from './components/LockScreen';
import { InvalidLinkScreen } from './components/InvalidLinkScreen';
import { currentCompanyId, rawSupabaseClient } from './lib/supabase';

const PAGES = {
    dashboard: DashboardPage,
    work_orders: WorkOrdersPage,
    daily_work: DailyWorkPage,
    clients: ClientsPage,
    inventory: InventoryPage,
    suppliers: SuppliersPage,
    sales: SalesPage,
    cash: CashRegisterPage,
    calendar: CalendarPage,
    promotions: PromotionsPage,
    reports: ReportsPage,
    users: UsersPage,
    settings: AdminSettingsPage,
    house_credit: HouseCreditPage,
    audit: ProgrammerAuditPage,
    help: HelpPage,
    membership: MembershipPage,
};

function App() {
    const isOnline = useNetworkStatus();
    const { data: MOCK, timeTrackingLogs, addTimeLog, isSyncing, pendingSyncCount, triggerSync, companyStatus, logAudit } = useApp();
    const { user } = useAuth();

    // 1. Verificación de Dominio Autorizado (El único enlace válido de producción es velocce-saas.vercel.app)
    const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');
    const isOfficialDomain = hostname === 'velocce-saas.vercel.app';
    const isDomainValid = !hostname || isLocalhost || isOfficialDomain;

    if (!isDomainValid) {
        return <InvalidLinkScreen currentHost={hostname} />;
    }

    // 2. Control de Bloqueo por Estado de Empresa
    const isMasterAdmin = user && user.id === 'saas-master';
    const isSuspended = companyStatus && companyStatus.is_active === false;

    if (isSuspended && !isMasterAdmin) {
        return (
            <LockScreen
                companyId={currentCompanyId}
                message="El acceso a la plataforma se encuentra suspendido. Comuníquese con la administración."
                onUnlock={() => window.location.reload()}
            />
        );
    }
    
    // Custom Navigation Hook
    const {
        page,
        effectivePage,
        pageInfo,
        sidebarOpen,
        setSidebarOpen,
        navItems,
        handleNavigate,
        isVisible
    } = useNavigation();

    // UI States
    const [scannedItem, setScannedItem] = useState(null);
    const [scannedQuantity, setScannedQuantity] = useState(1);
    const [showCameraScanner, setShowCameraScanner] = useState(false);
    const [scannedUnknownCode, setScannedUnknownCode] = useState(null);
    const [showTimeModal, setShowTimeModal] = useState(false);
    const [timePin, setTimePin] = useState('');
    const [isClockingIn, setIsClockingIn] = useState(false);
    const [isClockingOut, setIsClockingOut] = useState(false);
    
    const isContractAccepted = companyStatus && companyStatus.contract_accepted === true;
    const isAdmin = user && (user.role === 'admin' || user.role === 'Administrador' || isMasterAdmin);

    // --- ESTADO PARA BANNER INFORMATIVO DE BIENVENIDA ---
    const [showWelcomeBanner, setShowWelcomeBanner] = useState(() => {
        return !isContractAccepted && localStorage.getItem('velocce_welcome_dismissed') !== 'true';
    });

    // --- SALVAPANTALLAS / MODO BOX DE CARRERA (Inactividad 90 seg o botón manual) ---
    const [isScreensaverOpen, setIsScreensaverOpen] = useState(false);

    React.useEffect(() => {
        let idleTimer;
        const resetIdleTimer = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
                setIsScreensaverOpen(true);
            }, 90000); // 90 segundos (1.5 minutos) de inactividad
        };

        const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
        activityEvents.forEach(evt => window.addEventListener(evt, resetIdleTimer, { passive: true }));
        resetIdleTimer();

        return () => {
            clearTimeout(idleTimer);
            activityEvents.forEach(evt => window.removeEventListener(evt, resetIdleTimer));
        };
    }, []);

    // --- CANAL REALTIME PARA FORZAR ACTUALIZACIÓN REMOTA EN TODAS LAS COMPUTADORAS ---
    React.useEffect(() => {
        if (!rawSupabaseClient) return;
        const channel = rawSupabaseClient.channel('velocce-system-updates')
            .on('broadcast', { event: 'force-reload' }, async (payload) => {
                console.log('⚡ Recibida orden de recarga remota del sistema:', payload);
                try {
                    if ('serviceWorker' in navigator) {
                        const registrations = await navigator.serviceWorker.getRegistrations();
                        for (let reg of registrations) {
                            await reg.update();
                        }
                    }
                    if ('caches' in window) {
                        const keys = await caches.keys();
                        for (let key of keys) {
                            await caches.delete(key);
                        }
                    }
                } catch (e) {
                    console.error('Error limpiando caché:', e);
                }
                window.location.reload(true);
            })
            .subscribe();

        return () => {
            rawSupabaseClient.removeChannel(channel);
        };
    }, []);

    const isPiripiAdmin = false;
    const [isMembershipCompleted, setIsMembershipCompleted] = useState(() => {
        return localStorage.getItem(`velocce_membership_completed_${currentCompanyId}`) === 'true';
    });
    const [showMembershipModal, setShowMembershipModal] = useState(false);

    // Verificación inmediata contra base de datos Supabase
    React.useEffect(() => {
        if (!isPiripiAdmin) {
            setShowMembershipModal(false);
            return;
        }

        let isMounted = true;

        const checkMembershipStatus = async () => {
            try {
                if (rawSupabaseClient) {
                    const { data, error } = await rawSupabaseClient
                        .from('audit_logs')
                        .select('id, details, created_at')
                        .eq('company_id', currentCompanyId)
                        .eq('action', 'MEMBERSHIP_INSCRIPTION')
                        .limit(1);

                    if (!error && data && data.length > 0) {
                        if (isMounted) {
                            setIsMembershipCompleted(true);
                            setShowMembershipModal(false);
                            localStorage.setItem(`velocce_membership_completed_${currentCompanyId}`, 'true');
                        }
                    } else {
                        // Si no está registrado en la base de datos, saltar el modal de inmediato sin esperar refresh
                        if (isMounted) {
                            setIsMembershipCompleted(false);
                            setShowMembershipModal(true);
                        }
                    }
                } else {
                    const localDone = localStorage.getItem(`velocce_membership_completed_${currentCompanyId}`) === 'true';
                    if (!localDone && isMounted) {
                        setShowMembershipModal(true);
                    }
                }
            } catch (err) {
                console.warn('Error al verificar estado de membresía:', err);
            }
        };

        checkMembershipStatus();

        return () => {
            isMounted = false;
        };
    }, [user, isPiripiAdmin]);

    // Sincronización Realtime: Si un admin lo llena en otra PC, se cierra al instante sin refresh
    React.useEffect(() => {
        if (!rawSupabaseClient) return;
        const channel = rawSupabaseClient.channel('membership-realtime-sync')
            .on('broadcast', { event: 'membership-registered' }, (payload) => {
                console.log('🔔 Membresía completada por otro administrador en tiempo real:', payload);
                setIsMembershipCompleted(true);
                setShowMembershipModal(false);
                localStorage.setItem(`velocce_membership_completed_${currentCompanyId}`, 'true');
            })
            .subscribe();

        return () => {
            rawSupabaseClient.removeChannel(channel);
        };
    }, []);

    // --- ESTADO PARA ANUNCIO DE CONTRATO Y ABONO (SOLO ADMIN PENDIENTE) ---
    const [showContractNotification, setShowContractNotification] = useState(() => {
        const sessionDismiss = sessionStorage.getItem('velocce_contract_modal_dismissed_session');
        if (sessionDismiss === 'true') {
            return false;
        }
        return true;
    });

    // --- TRACKING GLOBAL DEL MAPA DE CALOR ---
    React.useEffect(() => {
        const handleClick = async (e) => {
            if (!user) return;
            const target = e.target.closest('button, a, [role="button"], .nav-item, .card, .quick-action-card');
            if (target) {
                let btnId = target.id || target.getAttribute('aria-label') || target.textContent?.trim()?.substring(0, 30) || target.className || 'Botón Desconocido';
                if (!btnId || btnId.trim() === '') return;
                
                try {
                    const currentPageName = pageInfo.title || page;
                    const { data, error: selectError } = await supabase
                        .from('button_clicks')
                        .select('id, count')
                        .eq('button_id', btnId)
                        .eq('page', currentPageName)
                        .maybeSingle();
                    
                    if (selectError) throw selectError;

                    if (data) {
                        await supabase.from('button_clicks').update({ count: (data.count || 0) + 1 }).eq('id', data.id);
                    } else {
                        await supabase.from('button_clicks').insert([{
                            button_id: btnId,
                            page: currentPageName,
                            employee_id: user.id,
                            count: 1
                        }]);
                    }
                } catch (err) {
                    console.error('Error de Auditoría (Tracking):', err.message);
                }
            }
        };

        document.addEventListener('click', handleClick, true);
        return () => document.removeEventListener('click', handleClick, true);
    }, [user, page, pageInfo.title]);

    const handleBarcodeScan = (code) => {
        if (!user) return;
        const item = (MOCK.inventory || []).find(i =>
            (i.barcode && i.barcode === code) ||
            (i.name && i.name.toLowerCase().includes(code.toLowerCase()))
        );

        if (item) {
            setScannedItem(item);
            setScannedQuantity(1);
            setShowCameraScanner(false);
            setScannedUnknownCode(null);
        } else {
            if (window.confirm(`Código ${code} no encontrado. ¿Deseas agregarlo?`)) {
                setScannedUnknownCode(code);
                setPage('inventory');
            }
            setShowCameraScanner(false);
        }
    };

    useBarcodeScanner(handleBarcodeScan);

    if (!user) {
        return (
            <React.Fragment>
                <LoginPage />
                <PitScreensaver 
                    isOpen={isScreensaverOpen} 
                    onClose={() => setIsScreensaverOpen(false)} 
                />
            </React.Fragment>
        );
    }

    const PageComponent = PAGES[effectivePage] || DashboardPage;

    return (
        <div className="app-layout">
            {/* --- BANNER INFORMATIVO DE BIENVENIDA (TOAST FIJO CON CIERRE MANUAL Y PERSISTENCIA) --- */}
            {showWelcomeBanner && user && (
                <div style={{
                    position: 'fixed',
                    top: '24px',
                    right: '24px',
                    backgroundColor: 'var(--bg-card, #1e293b)',
                    color: 'var(--text-primary, #f1f5f9)',
                    padding: '22px 26px',
                    borderRadius: '16px',
                    boxShadow: '0 20px 40px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.05)',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '16px',
                    zIndex: 999999,
                    maxWidth: '420px',
                    border: '1px solid var(--border)',
                    borderLeft: '5px solid var(--primary)',
                    animation: 'slideInRight 0.3s ease-out'
                }}>
                    <Icon name="rocket_launch" size={28} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: '2px' }} />
                    <div style={{ flex: 1 }}>
                        <h4 style={{ margin: '0 0 8px 0', fontSize: '15px', fontWeight: 'bold', color: 'var(--primary)', letterSpacing: '0.5px' }}>
                            VELOCCE PRO
                        </h4>
                        <p style={{ margin: '0 0 12px 0', fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                            Sistema Integral de Gestión de Taller, Lubricentro y Gomería.
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                                <span style={{ color: 'var(--primary)' }}>🛠️</span> <span><strong>Órdenes de Trabajo (OT)</strong> y boxes en tiempo real.</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                                <span style={{ color: 'var(--primary)' }}>📦</span> <span><strong>Control de Stock</strong> y alerta de fluidos sueltos.</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                                <span style={{ color: 'var(--primary)' }}>💵</span> <span><strong>Caja y POS</strong> con cobros y comisiones de operarios.</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                                <span style={{ color: 'var(--primary)' }}>📱</span> <span><strong>Modo Offline</strong> y base de datos Supabase en la nube.</span>
                            </div>
                        </div>
                        <div style={{ 
                            fontSize: '11px', 
                            background: 'rgba(var(--primary-rgb), 0.08)', 
                            padding: '8px 12px', 
                            borderRadius: '6px', 
                            border: '1px dashed rgba(var(--primary-rgb), 0.3)',
                            color: 'var(--primary)',
                            fontWeight: '600',
                            textAlign: 'center'
                        }}>
                            Para guías detalladas, visita el Centro de Ayuda
                        </div>
                    </div>
                    <button 
                        onClick={() => {
                            setShowWelcomeBanner(false);
                            localStorage.setItem('velocce_welcome_dismissed', 'true');
                        }}
                        style={{ background: 'var(--bg-hover)', border: 'none', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}
                        title="Entendido"
                    >
                        <Icon name="close" size={16} />
                    </button>
                </div>
            )}
            
            {sidebarOpen && <div className="sidebar-overlay show" onClick={() => setSidebarOpen(false)} />}

            <Sidebar 
                navItems={navItems}
                currentPage={page}
                onNavigate={handleNavigate}
                sidebarOpen={sidebarOpen}
                setSidebarOpen={setSidebarOpen}
            />

            <div className="main-area">
                {!isOnline && (
                    <div className="offline-notice">
                        <Icon name="wifi_off" size={20} />
                        MODO SIN CONEXIÓN ACTIVO: Tu trabajo se guarda de forma segura en este equipo y se sincronizará automáticamente al volver internet.
                    </div>
                )}


                <Header 
                    pageInfo={pageInfo}
                    isOnline={isOnline}
                    isSyncing={isSyncing}
                    pendingSyncCount={pendingSyncCount}
                    onSyncClick={triggerSync}
                    onMenuClick={() => setSidebarOpen(!sidebarOpen)}
                    showTimeModal={() => setShowTimeModal(true)}
                    showCameraScanner={() => setShowCameraScanner(true)}
                    onNewWorkOrder={() => handleNavigate('work_orders')}
                    showNewWOButton={isVisible('work_orders')}
                    onOpenScreensaver={() => setIsScreensaverOpen(true)}
                />

                <PageComponent
                    onNavigate={handleNavigate}
                    initialScannedCode={page === 'inventory' ? scannedUnknownCode : null}
                />
            </div>

            {/* Modal Lector de Código de Barras */}
            {scannedItem && (
                <Modal
                    title="Producto Escaneado"
                    onClose={() => setScannedItem(null)}
                    footer={
                        <React.Fragment>
                            <button className="btn btn-ghost" onClick={() => setScannedItem(null)}>Cancelar</button>
                            <button className="btn btn-primary" onClick={() => {
                                alert(`Registrando ${scannedQuantity}x ${scannedItem.name}`);
                                setScannedItem(null);
                            }}>
                                <Icon name="shopping_cart_checkout" size={18} /> Vender / Usar
                            </button>
                        </React.Fragment>
                    }
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, textAlign: 'center' }}>
                        <Icon name="check_circle" size={48} style={{ color: 'var(--success)', margin: '0 auto' }} />
                        <div>
                            <h3 style={{ fontSize: 20, margin: 0 }}>{scannedItem.name}</h3>
                            <p style={{ color: 'var(--text-muted)', margin: '4px 0 0 0' }}>Categoría: {scannedItem.category}</p>
                        </div>

                        <div style={{ padding: 16, background: 'var(--bg-hover)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Precio Sugerido</div>
                            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--primary)' }}>{formatCurrency(scannedItem.sell_price)}</div>
                            <div style={{ fontSize: 12, marginTop: 4, color: (scannedItem.stock_type === 'UNIT' ? (scannedItem.stock_quantity || 0) : (scannedItem.stock_ml || 0)) > 5 ? 'var(--success)' : 'var(--danger)' }}>
                                {scannedItem.stock_type === 'UNIT' ? `${scannedItem.stock_quantity || 0} unidades` : `${((scannedItem.stock_ml || 0) / 1000).toFixed(1)}L`} disponibles
                            </div>
                        </div>

                        <FormField label="Cantidad a descontar">
                            <input
                                type="number"
                                className="form-input"
                                value={scannedQuantity}
                                onChange={(e) => setScannedQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                                min="1"
                                style={{ textAlign: 'center', fontSize: 18 }}
                            />
                        </FormField>
                    </div>
                </Modal>
            )}

            {/* Modal Fichaje (Reloj) */}
            {showTimeModal && (
                <Modal title="Fichaje de Personal" onClose={() => { setShowTimeModal(false); setTimePin(''); }} footer={
                    <React.Fragment>
                        <button className="btn btn-ghost" onClick={() => { setShowTimeModal(false); setTimePin(''); }}>Cancelar</button>
                    </React.Fragment>
                }>
                    <div style={{ padding: '0 20px', textAlign: 'center' }}>
                        <Icon name="alarm_on" size={56} style={{ color: 'var(--primary)', marginBottom: 16 }} />
                        <h3 style={{ margin: '0 0 8px 0', fontSize: 20 }}>Reloj de Asistencia</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>Ingresá tu PIN numérico personal para registrar tu entrada o salida.</p>

                        <div style={{ maxWidth: 300, margin: '0 auto' }}>
                            {timePin.length === 4 && (MOCK.employees || []).find(e => String(e.pin) === String(timePin)) && (() => {
                                const emp = MOCK.employees.find(e => String(e.pin) === String(timePin));
                                const last = (timeTrackingLogs || []).filter(l => l.employee_id === emp.id)[0];
                                return (
                                    <div style={{ 
                                        padding: '8px 12px', 
                                        borderRadius: 8, 
                                        background: last?.type === 'IN' ? 'var(--success-light)' : 'var(--bg-hover)',
                                        marginBottom: 16,
                                        fontSize: 12,
                                        fontWeight: 600,
                                        color: last?.type === 'IN' ? 'var(--success-dark)' : 'var(--text-muted)'
                                    }}>
                                        <Icon name={last?.type === 'IN' ? 'check_circle' : 'history'} size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                                        {last?.type === 'IN' ? `ACTUALMENTE: DENTRO (desde ${last.time_display})` : 'ACTUALMENTE: FUERA'}
                                    </div>
                                );
                            })()}
                            <FormField label="PIN de Acceso (4 dígitos)">
                                <input
                                    type="password"
                                    className="form-input"
                                    maxLength={4}
                                    style={{ textAlign: 'center', fontSize: 24, letterSpacing: 8, padding: 16 }}
                                    value={timePin}
                                    onChange={e => setTimePin(e.target.value.replace(/\D/g, ''))}
                                    autoFocus
                                />
                            </FormField>
                            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                                <button className="btn btn-success" disabled={isClockingIn || isClockingOut} style={{ flex: 1, padding: '16px 0', fontSize: 16, fontWeight: 700 }} onClick={async () => {
                                    if (timePin.length < 4) return alert('El PIN debe tener 4 dígitos');
                                    setIsClockingIn(true);
                                    try {
                                        const res = await addTimeLog(timePin, 'IN');
                                        const empName = res?.emp?.name || res?.name || 'Empleado';
                                        alert(`✅ ¡ENTRADA REGISTRADA!\nEmpleado: ${empName}\nHora: ${res.time}\n\nPuede seguir trabajando normalmente.`);
                                        setShowTimeModal(false);
                                        setTimePin('');
                                    } catch (e) { alert(e.message); } finally { setIsClockingIn(false); }
                                }}>
                                    {isClockingIn ? 'Procesando...' : 'ENTRADA'}
                                </button>
                                <button className="btn btn-danger" disabled={isClockingIn || isClockingOut} style={{ flex: 1, padding: '16px 0', fontSize: 16, fontWeight: 700 }} onClick={async () => {
                                    if (timePin.length < 4) return alert('El PIN debe tener 4 dígitos');
                                    setIsClockingOut(true);
                                    try {
                                        const res = await addTimeLog(timePin, 'OUT');
                                        const empName = res?.emp?.name || res?.name || 'Empleado';
                                        alert(`👋 ¡SALIDA REGISTRADA!\nEmpleado: ${empName}\nHora: ${res.time}\n\n¡Hasta pronto!`);
                                        setShowTimeModal(false);
                                        setTimePin('');
                                    } catch (e) { alert(e.message); } finally { setIsClockingOut(false); }
                                }}>
                                    {isClockingOut ? 'Procesando...' : 'SALIDA'}
                                </button>
                            </div>
                        </div>
                    </div>
                </Modal>
            )}

            {/* Modal Lector de Cámara del Celular/PC */}
            {showCameraScanner && (
                <CameraScanner
                    onScan={handleBarcodeScan}
                    onClose={() => setShowCameraScanner(false)}
                />
            )}

            {/* Modal Alerta de Políticas y Abono Pendiente (SOLO PARA ADMINISTRADOR HASTA QUE ACEPTE) */}
            {showContractNotification && isAdmin && !isContractAccepted && (
                <Modal 
                    title="⚠️ Recordatorio de Saldo Pendiente y Términos de Licencia" 
                    onClose={async () => {
                        sessionStorage.setItem('velocce_contract_modal_dismissed_session', 'true');
                        await logAudit('Visto Alerta de Pago Admin', { status: 'NOTIFICADO_PENDIENTE', source: 'Modal_Cerrar_X' });
                        setShowContractNotification(false);
                    }}
                    footer={
                        <div style={{ display: 'flex', gap: 12, width: '100%' }}>
                            <button 
                                className="btn btn-ghost" 
                                style={{ flex: 1, justifyContent: 'center' }} 
                                onClick={async () => {
                                    sessionStorage.setItem('velocce_contract_modal_dismissed_session', 'true');
                                    await logAudit('Visto Alerta de Pago Admin', { status: 'NOTIFICADO_PENDIENTE', source: 'Boton_Recordar_Luego' });
                                    setShowContractNotification(false);
                                }}
                            >
                                Recordar Más Tarde
                            </button>
                            <button 
                                className="btn btn-primary" 
                                style={{ 
                                    flex: 1.5, 
                                    justifyContent: 'center', 
                                    background: 'var(--warning)', 
                                    borderColor: 'var(--warning)', 
                                    color: '#000', 
                                    fontWeight: 800 
                                }}
                                onClick={async () => {
                                    handleNavigate('membership');
                                    await logAudit('Acceso a Licencia y Firma', { status: 'REVISANDO_CONTRATO', source: 'Boton_Ver_Licencia' });
                                    setShowContractNotification(false);
                                }}
                            >
                                <Icon name="gavel" size={16} /> Ver Licencia y Regularizar
                            </button>
                        </div>
                    }
                >
                    <div style={{ padding: '10px 0', textAlign: 'center' }}>
                        <div style={{ 
                            width: 64, height: 64, borderRadius: '50%', 
                            background: 'rgba(245, 158, 11, 0.15)', 
                            display: 'flex', alignItems: 'center', justifyContent: 'center', 
                            color: 'var(--warning)', margin: '0 auto 16px auto',
                            border: '1px solid rgba(245, 158, 11, 0.3)'
                        }}>
                            <Icon name="warning" size={34} />
                        </div>
                        <h3 style={{ margin: '0 0 12px 0', fontSize: 19, fontWeight: 800, color: 'var(--warning)' }}>
                            Aviso Importante para la Administración
                        </h3>
                        <p style={{ color: 'var(--text-primary)', fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
                            Hola, <strong>{user.name}</strong>. Les recordamos que deben terminar de abonar el dinero pendiente de la plataforma antes de la fecha límite: <strong style={{ color: 'var(--warning)', textDecoration: 'underline' }}>5 de Septiembre a las 00:00 hs</strong>.
                        </p>
                        <div style={{ 
                            background: 'rgba(245, 158, 11, 0.08)', 
                            border: '1px solid rgba(245, 158, 11, 0.3)', 
                            borderRadius: 'var(--radius)', 
                            padding: '16px', 
                            fontSize: 13.5, 
                            textAlign: 'left', 
                            lineHeight: 1.6,
                            marginBottom: 16,
                            color: 'var(--text-primary)'
                        }}>
                            <strong style={{ color: 'var(--warning)', display: 'block', marginBottom: 6, fontSize: 14 }}>
                                ⚠️ FECHA LÍMITE Y REDISEÑO DE ACUERDO:
                            </strong>
                            La fecha límite para completar el abono es el <strong>5 de Septiembre a las 00:00 hs</strong>. En caso de no abonar el saldo pendiente antes de dicho vencimiento, el acuerdo promocional previo vencerá automáticamente y la licencia se rediseñará al <strong>Plan Mensual de 100 USD mensuales</strong>, fijando indefectiblemente como fecha límite de pago del <strong>1 al 5 de cada mes</strong>.
                        </div>
                        <p style={{ color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic' }}>
                            Ingresá a la sección de membresía para revisar el acuerdo vinculante o resguardar tu información en Excel.
                        </p>
                    </div>
                </Modal>
            )}

            {/* Modal Obligatorio de Inscripción a Membresía para Administradores de Piripi */}
            {showMembershipModal && isPiripiAdmin && !isMembershipCompleted && (
                <MembershipRegistrationModal 
                    isOpen={true}
                    user={user}
                    onCompleted={(details) => {
                        console.log('✅ Inscripción de membresía guardada exitosamente:', details);
                        setIsMembershipCompleted(true);
                        setShowMembershipModal(false);
                        localStorage.setItem(`velocce_membership_completed_${currentCompanyId}`, 'true');
                    }}
                />
            )}

            {/* Salvapantallas / Telemetría de Boxes en Inactividad */}
            <PitScreensaver 
                isOpen={isScreensaverOpen} 
                onClose={() => setIsScreensaverOpen(false)} 
            />
        </div>
    );
}

export default App;
