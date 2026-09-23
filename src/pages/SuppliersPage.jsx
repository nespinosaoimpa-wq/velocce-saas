import React, { useState, Fragment } from 'react';
import { useApp } from '../context/AppContext';
import {
    SectionHeader,
    DataTable,
    Modal,
    FormField,
    FormRow,
    Icon,
    EmptyState
} from '../components/ui';

export const SuppliersPage = () => {
    const { data: MOCK, addSupplier, updateSupplier, deleteSupplier } = useApp();
    const [search, setSearch] = useState('');
    const [showNew, setShowNew] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState(null);
    const [saving, setSaving] = useState(false);
    const [newSupplier, setNewSupplier] = useState({ name: '', contact: '', phone: '', cuit: '', category: '' });

    // Extraer categorías únicas de los proveedores existentes
    const categories = [...new Set((MOCK.suppliers || []).map(s => s.category).filter(Boolean))];

    const filtered = (MOCK.suppliers || []).filter(s =>
        (s.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (s.contact || '').toLowerCase().includes(search.toLowerCase())
    );

    const handleSave = async () => {
        if (!newSupplier.name) {
            alert('El nombre es obligatorio');
            return;
        }
        setSaving(true);
        try {
            if (editingSupplier) {
                await updateSupplier(editingSupplier.id, newSupplier);
            } else {
                await addSupplier(newSupplier);
            }
            setShowNew(false);
            setEditingSupplier(null);
            setNewSupplier({ name: '', contact: '', phone: '', cuit: '', category: '' });
        } catch (err) {
            alert('Error al guardar proveedor: ' + (err.message || ''));
        }
        setSaving(false);
    };

    const handleEdit = (supplier) => {
        setEditingSupplier(supplier);
        setNewSupplier({
            name: supplier.name,
            contact: supplier.contact || '',
            phone: supplier.phone || '',
            cuit: supplier.cuit || '',
            category: supplier.category || ''
        });
        setShowNew(true);
    };

    const handleDelete = async (supplier) => {
        if (!supplier) return;
        if (window.confirm(`¿Estás seguro de que deseas eliminar al proveedor "${supplier.name}"? Esta acción no se puede deshacer.`)) {
            setSaving(true);
            try {
                await deleteSupplier(supplier.id);
                setShowNew(false);
                setEditingSupplier(null);
                setNewSupplier({ name: '', contact: '', phone: '', cuit: '', category: '' });
            } catch (err) {
                console.error(err);
                alert('Error al eliminar proveedor: ' + (err.message || ''));
            } finally {
                setSaving(false);
            }
        }
    };

    return (
        <div className="page-content">
            <div className="page-grid" style={{ gridTemplateColumns: '1fr' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 250 }}>
                        <div className="search-bar">
                            <Icon name="search" size={18} />
                            <input type="text" placeholder="Buscar proveedores..." value={search} onChange={e => setSearch(e.target.value)} />
                        </div>
                    </div>
                    <button className="btn btn-primary" onClick={() => { setEditingSupplier(null); setNewSupplier({ name: '', contact: '', phone: '', cuit: '', category: '' }); setShowNew(true); }}>
                        <Icon name="add" size={18} /> Nuevo Proveedor
                    </button>
                </div>

                <DataTable
                    columns={[
                        { key: 'name', label: 'Proveedor', render: r => <strong>{r.name}</strong> },
                        { key: 'category', label: 'Categoría', render: r => r.category ? <span className="badge badge-outline">{r.category}</span> : '—' },
                        { key: 'contact', label: 'Contacto' },
                        { key: 'phone', label: 'Teléfono' },
                        { key: 'cuit', label: 'CUIT', render: r => r.cuit || '—' },
                        {
                            key: 'actions',
                            label: '',
                            render: r => (
                                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                    <button className="btn btn-ghost btn-sm" title="Editar" onClick={() => handleEdit(r)}>
                                        <Icon name="edit" size={16} />
                                    </button>
                                    <button className="btn btn-ghost btn-sm" title="Eliminar" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(r)}>
                                        <Icon name="delete" size={16} />
                                    </button>
                                </div>
                            )
                        }
                    ]}
                    data={filtered}
                />

                {filtered.length === 0 && <EmptyState icon="business" title="No se encontraron proveedores" sub="Probá con otro término de búsqueda o agregá uno nuevo." />}

                {showNew && (
                    <Modal
                        title={editingSupplier ? "Editar Proveedor" : "Nuevo Proveedor"}
                        onClose={() => { setShowNew(false); setEditingSupplier(null); }}
                        footer={
                            <Fragment>
                                {editingSupplier && (
                                    <button
                                        type="button"
                                        className="btn btn-danger"
                                        disabled={saving}
                                        style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}
                                        onClick={() => handleDelete(editingSupplier)}
                                    >
                                        <Icon name="delete" size={16} /> Eliminar
                                    </button>
                                )}
                                <button className="btn btn-ghost" disabled={saving} onClick={() => { setShowNew(false); setEditingSupplier(null); }}>Cancelar</button>
                                <button className="btn btn-primary" disabled={saving} onClick={handleSave}>{saving ? 'Guardando...' : 'Guardar'}</button>
                            </Fragment>
                        }
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <FormField label="Nombre de la Empresa *">
                                <input className="form-input" value={newSupplier.name} onChange={e => setNewSupplier({ ...newSupplier, name: e.target.value })} placeholder="Ej: Distribuidora Lubricantes S.A." />
                            </FormField>
                            <FormRow>
                                <FormField label="Contacto Responsable">
                                    <input className="form-input" value={newSupplier.contact} onChange={e => setNewSupplier({ ...newSupplier, contact: e.target.value })} placeholder="Nombre de la persona" />
                                </FormField>
                                <FormField label="CUIT">
                                    <input className="form-input" value={newSupplier.cuit} onChange={e => setNewSupplier({ ...newSupplier, cuit: e.target.value })} placeholder="XX-XXXXXXXX-X" />
                                </FormField>
                            </FormRow>
                            <FormRow>
                                <FormField label="Teléfono">
                                    <input className="form-input" value={newSupplier.phone} onChange={e => setNewSupplier({ ...newSupplier, phone: e.target.value })} placeholder="+54 223 ..." />
                                </FormField>
                                <FormField label="Categoría (Rubro)">
                                    <input className="form-input" list="supplier-category-list" value={newSupplier.category} onChange={e => setNewSupplier({ ...newSupplier, category: e.target.value })} placeholder="Ej: Lubricantes, Filtros..." />
                                    <datalist id="supplier-category-list">
                                        {categories.map(c => <option key={c} value={c} />)}
                                    </datalist>
                                </FormField>
                            </FormRow>
                        </div>
                    </Modal>
                )}
            </div>
        </div>
    );
};
