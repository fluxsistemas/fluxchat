import { useState, useEffect } from 'react';
import axios from 'axios';
import { Menu, Edit2, X, RefreshCw, Globe, Save, QrCode, Copy, Check, Plus, Power, Link2, Trash2, LogOut } from 'lucide-react';

interface CuentaActiva {
  cuenta_id: string;
  nombre_cuenta: string;
  token_cuenta: string;
  numero_cuenta: string;
  webhook_url?: string;
  estado?: string;
  nombre_interno?: string;
}

interface InstancesManagerProps {
  onOpenSidebar: () => void;
}

export default function InstancesManager({ onOpenSidebar }: InstancesManagerProps) {
  const [cuentas, setCuentas] = useState<CuentaActiva[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCuenta, setEditingCuenta] = useState<CuentaActiva | null>(null);
  
  // Estados para el Modal de Código QR
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [qrCodeText, setQrCodeText] = useState<string | null>(null);
  const [selectedInstanceName, setSelectedInstanceName] = useState<string>('');
  const [loadingQr, setLoadingQr] = useState(false);

  const [webhookUrl, setWebhookUrl] = useState('');
  const [nombreInterno, setNombreInterno] = useState('');
  const [currentUserProfile, setCurrentUserProfile] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filterEstado, setFilterEstado] = useState<string>('todos');

  // Estados para la creación de nueva instancia
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newInstanceName, setNewInstanceName] = useState('');
  const [newInstanceNumber, setNewInstanceNumber] = useState('');
  const [creating, setCreating] = useState(false);

  const openCreateModal = () => {
    setNewInstanceName('');
    setNewInstanceNumber('');
    setIsCreateModalOpen(true);
  };

  const handleCreateInstance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newInstanceName.trim()) {
      alert("Por favor ingresa un nombre para la instancia");
      return;
    }

    setCreating(true);
    try {
      const response = await axios.post('/api/evolution/create-instance', {
        instanceName: newInstanceName.trim(),
        number: newInstanceNumber.trim() || null
      });

      alert(response.data.message || "Instancia creada con éxito");
      setIsCreateModalOpen(false);
      fetchCuentas();

      // Abrir QR para conectar la instancia creada
      const newCuenta: CuentaActiva = {
        cuenta_id: '',
        nombre_cuenta: newInstanceName.trim(),
        token_cuenta: '',
        numero_cuenta: newInstanceNumber.trim() || '',
        estado: 'Desconectado'
      };
      
      setTimeout(() => {
        handleShowQr(newCuenta);
      }, 500);

    } catch (error: any) {
      console.error("Error al crear la instancia:", error);
      alert(error.response?.data?.detail || "Ocurrió un error al crear la instancia de Evolution.");
    } finally {
      setCreating(false);
    }
  };

  const handleCopyWebhook = async (cuentaId: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(cuentaId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Error al copiar URL:", err);
    }
  };

  const fetchCuentas = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/cuentas/');
      setCuentas(response.data);
    } catch (error) {
      console.error("Error fetching active accounts:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const userLocal = localStorage.getItem('usuario');
    if (userLocal) {
      const p = JSON.parse(userLocal);
      setCurrentUserProfile(p.perfil);
    }
    fetchCuentas();
  }, []);

  const handleShowQr = async (cuenta: CuentaActiva) => {
    setSelectedInstanceName(cuenta.nombre_cuenta);
    setQrCodeData(null);
    setQrCodeText(null);
    setLoadingQr(true);
    setIsQrModalOpen(true);
    try {
      const response = await axios.get(`/api/evolution/connect/${cuenta.nombre_cuenta}`);
      const data = response.data;
      if (data && data.base64) {
        setQrCodeData(data.base64);
      } else if (data && data.qrcode && data.qrcode.base64) {
        setQrCodeData(data.qrcode.base64);
      } else if (data && data.message) {
        setQrCodeText(data.message);
      } else if (data && typeof data === 'object') {
        // En caso de que contenga un objeto de error o ya esté conectada
        if (data.error || data.status === 'CONNECTED') {
          setQrCodeText(data.error || "La instancia ya está conectada.");
        } else {
          setQrCodeText(JSON.stringify(data));
        }
      } else {
        setQrCodeText(String(data));
      }
    } catch (error: any) {
      console.error("Error al obtener el código QR:", error);
      setQrCodeText(error.response?.data?.detail || "Ocurrió un error al obtener el código QR de la instancia.");
    } finally {
      setLoadingQr(false);
    }
  };

  const handleSyncInstances = async () => {
    setSyncing(true);
    try {
      const response = await axios.post('/api/evolution/sync-instances');
      const { summary } = response.data;
      alert(`Sincronización completada con éxito.\nTotal de instancias obtenidas: ${summary.total_instances_fetched}\nAgregadas: ${summary.added}\nActualizadas: ${summary.updated}`);
      fetchCuentas();
    } catch (error: any) {
      console.error("Error al sincronizar instancias:", error);
      alert(error.response?.data?.detail || "Ocurrió un error al sincronizar las cuentas de Evolution API.");
    } finally {
      setSyncing(false);
    }
  };

  const handleRestartInstances = async () => {
    // El Boton de Reiniciar debe aplicar a las instancias Desconectadas y en estado "Conectando..."
    const disconnected = cuentas.filter((c: CuentaActiva) => c.estado !== 'Conectado');
    if (disconnected.length === 0) {
      alert("No hay instancias desconectadas o conectando para reiniciar.");
      return;
    }

    if (!confirm(`¿Estás seguro de que deseas reiniciar las ${disconnected.length} instancia(s) seleccionada(s)?`)) {
      return;
    }

    setRestarting(true);
    let successCount = 0;
    let failCount = 0;

    for (const cuenta of disconnected) {
      try {
        await axios.post(`/api/evolution/restart/${cuenta.nombre_cuenta}`);
        successCount++;
      } catch (error) {
        console.error(`Error al reiniciar la instancia ${cuenta.nombre_cuenta}:`, error);
        failCount++;
      }
    }

    alert(`Proceso de reinicio completado.\nÉxito: ${successCount}\nFallidos: ${failCount}`);
    fetchCuentas();
    setRestarting(false);
  };

  const handleReconnectInstances = async () => {
    // El Boton de Reconectar debe aplicar a las instancias Desconectadas y en estado "Conectando..."
    const disconnected = cuentas.filter((c: CuentaActiva) => c.estado !== 'Conectado');
    if (disconnected.length === 0) {
      alert("No hay instancias desconectadas o conectando para reconectar.");
      return;
    }

    if (!confirm(`¿Estás seguro de que deseas intentar reconectar las ${disconnected.length} instancia(s) seleccionada(s)?`)) {
      return;
    }

    setReconnecting(true);
    let successCount = 0;
    let failCount = 0;

    for (const cuenta of disconnected) {
      try {
        await axios.get(`/api/evolution/connect/${cuenta.nombre_cuenta}`);
        successCount++;
      } catch (error) {
        console.error(`Error al reconectar la instancia ${cuenta.nombre_cuenta}:`, error);
        failCount++;
      }
    }

    alert(`Proceso de reconexión completado.\nÉxito: ${successCount}\nFallidos: ${failCount}`);
    fetchCuentas();
    setReconnecting(false);
  };

  const handleDeleteInstance = async (cuenta: CuentaActiva) => {
    if (cuenta.estado === 'Conectado') {
      alert("No se puede eliminar una instancia conectada. Desconéctela primero.");
      return;
    }

    if (!confirm(`¿Estás seguro de que deseas eliminar permanentemente la instancia "${cuenta.nombre_interno || cuenta.nombre_cuenta}" de la base de datos y de Evolution API?`)) {
      return;
    }

    try {
      setLoading(true);
      const response = await axios.delete(`/api/evolution/delete/${cuenta.nombre_cuenta}`);
      alert(response.data.message || "Instancia eliminada con éxito.");
      fetchCuentas();
    } catch (error: any) {
      console.error("Error al eliminar la instancia:", error);
      alert(error.response?.data?.detail || "Ocurrió un error al eliminar la instancia.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogoutInstance = async (cuenta: CuentaActiva) => {
    if (!confirm(`¿Estás seguro de que deseas cerrar la sesión (Logout) de la instancia "${cuenta.nombre_interno || cuenta.nombre_cuenta}"? Esto detendrá los intentos de conexión.`)) {
      return;
    }

    try {
      setLoading(true);
      const response = await axios.post(`/api/evolution/logout/${cuenta.nombre_cuenta}`);
      alert(response.data.message || "Sesión cerrada con éxito.");
      fetchCuentas();
    } catch (error: any) {
      console.error("Error al cerrar sesión de la instancia:", error);
      alert(error.response?.data?.detail || "Ocurrió un error al cerrar la sesión de la instancia.");
    } finally {
      setLoading(false);
    }
  };

  const openEditModal = (cuenta: CuentaActiva) => {
    setEditingCuenta(cuenta);
    setWebhookUrl(cuenta.webhook_url || '');
    setNombreInterno(cuenta.nombre_interno || '');
    setIsModalOpen(true);
  };

  const handleSaveWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCuenta) return;

    setSaving(true);
    try {
      // Send PUT to update webhook_url and nombre_interno
      await axios.put(`/api/cuentas/${editingCuenta.cuenta_id}`, {
        webhook_url: webhookUrl.trim() || null,
        nombre_interno: nombreInterno.trim() || null
      });
      setIsModalOpen(false);
      fetchCuentas();
    } catch (error: any) {
      console.error("Error saving config:", error);
      alert(error.response?.data?.detail || "Ocurrió un error al actualizar la configuración de la instancia.");
    } finally {
      setSaving(false);
    }
  };

  const filteredCuentas = cuentas.filter((c: CuentaActiva) => {
    if (filterEstado === 'todos') return true;
    if (filterEstado === 'conectado') return c.estado === 'Conectado';
    if (filterEstado === 'conectando') return c.estado === 'Conectando...';
    if (filterEstado === 'desconectado') return c.estado !== 'Conectado' && c.estado !== 'Conectando...';
    return true;
  });

  if (currentUserProfile !== 'admin') {
    return (
      <div className="flex flex-col h-full w-full bg-[#f4f7f6]">
        <header className="bg-white border-b border-gray-200 px-4 py-4 flex items-center shrink-0">
          <button className="lg:hidden p-2 mr-3 text-gray-500 hover:bg-gray-100 rounded-md" onClick={onOpenSidebar}>
            <Menu size={20} />
          </button>
          <div>
            <h2 className="text-xl font-bold text-gray-800">Instancias de Evolution</h2>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-500">No tienes permisos para acceder a este módulo.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-[#f4f7f6]">
      <header className="bg-white border-b border-gray-200 px-4 py-4 flex items-center justify-between shrink-0 shadow-sm">
        <div className="flex items-center">
          <button className="lg:hidden p-2 mr-3 text-gray-500 hover:bg-gray-100 rounded-md" onClick={onOpenSidebar}>
            <Menu size={20} />
          </button>
          <div>
            <h2 className="text-xl font-bold text-gray-800">Instancias de Evolution</h2>
            <p className="text-sm text-gray-500">Configuración de canales de WhatsApp y Webhooks</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button 
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm font-medium cursor-pointer"
          >
            <Plus size={18} />
            <span>Crear Instancia</span>
          </button>
          <button 
            onClick={handleSyncInstances}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm font-medium disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw size={18} className={syncing ? "animate-spin" : ""} />
            <span>{syncing ? 'Sincronizando...' : 'Sincronizar Instancias'}</span>
          </button>
          <button 
            onClick={handleRestartInstances}
            disabled={restarting}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors shadow-sm font-medium disabled:opacity-50 cursor-pointer"
            title="Reinicia todas las instancias que no estén conectadas"
          >
            <Power size={18} className={restarting ? "animate-spin" : ""} />
            <span>{restarting ? 'Reiniciando...' : 'Reiniciar Instancias'}</span>
          </button>
          <button 
            onClick={handleReconnectInstances}
            disabled={reconnecting}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm font-medium disabled:opacity-50 cursor-pointer"
            title="Intenta conectar todas las instancias que estén desconectadas"
          >
            <Link2 size={18} className={reconnecting ? "animate-spin" : ""} />
            <span>{reconnecting ? 'Reconectando...' : 'Reconectar Instancias'}</span>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-7xl mx-auto">
          {loading ? (
            <div className="flex justify-center p-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : cuentas.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-12 text-center border border-gray-100">
              <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <Globe size={32} />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-1">No hay instancias registradas</h3>
              <p className="text-gray-500 max-w-sm mx-auto mb-4">
                Comienza sincronizando las instancias activas de tu Evolution API con tu base de datos local.
              </p>
              <button 
                onClick={handleSyncInstances}
                disabled={syncing}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
              >
                <RefreshCw size={18} className={syncing ? "animate-spin" : ""} />
                Sincronizar Ahora
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Filtros por Estado */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                <div className="text-sm font-medium text-gray-700">
                  Filtrar por estado:
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setFilterEstado('todos')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                      filterEstado === 'todos'
                        ? 'bg-blue-600 text-white font-semibold'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    Todos ({cuentas.length})
                  </button>
                  <button
                    onClick={() => setFilterEstado('conectado')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                      filterEstado === 'conectado'
                        ? 'bg-green-600 text-white font-semibold'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    Conectados ({cuentas.filter(c => c.estado === 'Conectado').length})
                  </button>
                  <button
                    onClick={() => setFilterEstado('conectando')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                      filterEstado === 'conectando'
                        ? 'bg-amber-600 text-white font-semibold'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    Conectando ({cuentas.filter(c => c.estado === 'Conectando...').length})
                  </button>
                  <button
                    onClick={() => setFilterEstado('desconectado')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                      filterEstado === 'desconectado'
                        ? 'bg-red-600 text-white font-semibold'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    Desconectados ({cuentas.filter(c => c.estado !== 'Conectado' && c.estado !== 'Conectando...').length})
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500 tracking-wider">
                        <th className="px-4 py-3.5 font-medium">Instancia / Nombre Interno</th>
                        <th className="px-4 py-3.5 font-medium">Número de Cuenta</th>
                        <th className="px-4 py-3.5 font-medium">Estado</th>
                        <th className="px-4 py-3.5 font-medium">Webhook de Reenvío (Bot)</th>
                        <th className="px-4 py-3.5 font-medium text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {filteredCuentas.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-gray-500 text-sm">
                            No se encontraron instancias con el estado seleccionado.
                          </td>
                        </tr>
                      ) : (
                        filteredCuentas.map((c) => (
                      <tr key={c.cuenta_id} className="hover:bg-blue-50/50 transition-colors group">
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm shrink-0">
                              {(c.nombre_interno || c.nombre_cuenta).substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <span className="font-semibold text-gray-900">{c.nombre_interno || c.nombre_cuenta}</span>
                              {c.nombre_interno && (
                                <div className="text-xs text-gray-400">
                                  Evolution: <span className="font-mono">{c.nombre_cuenta}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-gray-600 font-mono text-sm">{c.numero_cuenta}</td>
                        <td className="px-4 py-3.5">
                          {c.estado === 'Conectado' ? (
                            <div className="flex flex-col xl:flex-row xl:items-center gap-1.5">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 shrink-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                                Conectado
                              </span>
                              <button
                                onClick={() => handleShowQr(c)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded border border-gray-200 hover:border-blue-200 transition-colors cursor-pointer shrink-0"
                                title="Volver a escanear QR (Si hay problemas de conexión o 'Connection Closed')"
                              >
                                <QrCode size={13} />
                                <span>Volver a Escanear</span>
                              </button>
                              <button
                                onClick={() => handleLogoutInstance(c)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 hover:text-red-800 hover:bg-red-50 rounded border border-red-200 transition-colors shrink-0 cursor-pointer"
                                title="Cerrar sesión (Logout) de la cuenta"
                              >
                                <LogOut size={13} />
                                <span>Cerrar Sesión</span>
                              </button>
                            </div>
                          ) : c.estado === 'Conectando...' ? (
                            <div className="flex flex-col xl:flex-row xl:items-center gap-1.5">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 shrink-0 animate-pulse">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping"></span>
                                Conectando...
                              </span>
                              <button
                                onClick={() => handleShowQr(c)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded border border-amber-200 transition-colors shrink-0"
                                title="Escanear Código QR"
                              >
                                <QrCode size={13} />
                                <span>Escanear QR</span>
                              </button>
                              <button
                                onClick={() => handleLogoutInstance(c)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 hover:text-red-800 hover:bg-red-50 rounded border border-red-200 transition-colors shrink-0 cursor-pointer"
                                title="Cerrar sesión (Logout) para detener el bucle de conexión"
                              >
                                <LogOut size={13} />
                                <span>Cerrar Sesión</span>
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-col xl:flex-row xl:items-center gap-1.5">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800 shrink-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                                Desconectado
                              </span>
                              <button
                                onClick={() => handleShowQr(c)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded border border-blue-200 transition-colors shrink-0"
                                title="Escanear Código QR"
                              >
                                <QrCode size={13} />
                                <span>Escanear QR</span>
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3.5 max-w-[280px]">
                          {c.webhook_url ? (
                            <div className="flex items-center gap-1.5 w-fit max-w-full">
                              <div className="flex items-center gap-1.5 bg-green-50/50 border border-green-100 px-2.5 py-1 rounded-md text-xs text-green-700 font-medium overflow-hidden">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"></span>
                                <span className="font-mono text-right direction-rtl truncate" title={c.webhook_url} style={{ direction: 'rtl', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.webhook_url}</span>
                              </div>
                              <button
                                onClick={() => handleCopyWebhook(c.cuenta_id, c.webhook_url!)}
                                className={`p-1.5 rounded border transition-all shrink-0 cursor-pointer ${
                                  copiedId === c.cuenta_id
                                    ? "bg-green-100 border-green-300 text-green-700"
                                    : "bg-white hover:bg-gray-50 border-gray-200 text-gray-500 hover:text-gray-700"
                                }`}
                                title={copiedId === c.cuenta_id ? "¡Copiado!" : "Copiar Webhook"}
                              >
                                {copiedId === c.cuenta_id ? <Check size={12} /> : <Copy size={12} />}
                              </button>
                            </div>
                          ) : (
                            <span className="text-gray-400 italic text-xs">Sin reenvío configurado</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button 
                              onClick={() => openEditModal(c)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700 rounded-lg border border-blue-100/30 transition-colors cursor-pointer"
                              title="Editar Configuración"
                            >
                              <Edit2 size={13} />
                              <span>Editar</span>
                            </button>
                            {c.estado !== 'Conectado' && (
                              <button 
                                onClick={() => handleDeleteInstance(c)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 rounded-lg border border-red-100/30 transition-colors cursor-pointer"
                                title="Eliminar Instancia permanentemente"
                              >
                                <Trash2 size={13} />
                                <span>Eliminar</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          )}
        </div>
      </div>

      {isModalOpen && editingCuenta && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">
                Editar Configuración de Instancia
              </h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-2 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleSaveWebhook} className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Instancia Seleccionada (Evolution)
                  </label>
                  <div className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-700 font-medium">
                    {editingCuenta.nombre_cuenta} ({editingCuenta.numero_cuenta || 'Sin número'})
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Nombre Interno (Personalizado)
                  </label>
                  <input
                    type="text"
                    value={nombreInterno}
                    onChange={(e) => setNombreInterno(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm font-medium"
                    placeholder="ej: Canal Soporte, Ventas, Línea Directa"
                  />
                  <p className="mt-1.5 text-xs text-gray-400">
                    Establecé un nombre amigable independiente de Evolution para identificar esta línea en todo el sistema.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    URL de Webhook <span className="text-gray-400 font-normal text-xs">(Bot Externo)</span>
                  </label>
                  <input
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm"
                    placeholder="https://ejemplo.com/webhook-bot"
                  />
                  <p className="mt-1.5 text-xs text-gray-400">
                    Dejar en blanco para desactivar el reenvío para esta instancia.
                  </p>
                </div>

                <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 text-sm text-blue-700">
                  <p className="font-semibold mb-1">¿Cómo funciona el reenvío de webhooks?</p>
                  <p className="text-blue-600 text-xs leading-relaxed">
                    Cuando tu backend reciba un mensaje entrante (evento <span className="font-mono">messages.upsert</span>) perteneciente a esta instancia, guardará el mensaje localmente para que lo veas en el chat y, simultáneamente, enviará una copia idéntica del payload al Webhook de Reenvío de forma asíncrona.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm transition-colors disabled:opacity-50"
                >
                  {saving ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  ) : (
                    <Save size={18} />
                  )}
                  <span>Guardar</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal para Crear Nueva Instancia */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">
                Crear Nueva Instancia
              </h3>
              <button 
                onClick={() => setIsCreateModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-2 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleCreateInstance} className="p-6">
              <div className="space-y-4">
                <div className="bg-green-50/50 border border-green-100 rounded-xl p-4 text-sm text-green-700">
                  <p className="font-semibold mb-1">Especificaciones Automáticas:</p>
                  <ul className="list-disc pl-5 text-green-600 text-xs space-y-1 leading-relaxed">
                    <li>Webhook URL configurado automáticamente a <strong className="font-mono">http://evolution_backend_api:8000/webhook/evolution</strong></li>
                    <li>Eventos habilitados: <strong className="font-mono">CONNECTION_UPDATE, MESSAGES_UPDATE, MESSAGES_UPSERT</strong></li>
                    <li>Webhook by Events: <strong className="font-mono">Desactivado</strong></li>
                    <li>Webhook Base64: <strong className="font-mono">Habilitado</strong></li>
                  </ul>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Nombre de la Instancia <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newInstanceName}
                    onChange={(e) => setNewInstanceName(e.target.value.replace(/\s+/g, '-'))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm font-medium"
                    placeholder="ej: mi-nueva-instancia"
                  />
                  <p className="mt-1.5 text-xs text-gray-400">
                    Se recomienda usar letras minúsculas, números y guiones, sin espacios.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Número de la Instancia (Opcional)
                  </label>
                  <input
                    type="text"
                    value={newInstanceNumber}
                    onChange={(e) => setNewInstanceNumber(e.target.value.replace(/\D/g, ''))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm font-medium"
                    placeholder="ej: 595981123456"
                  />
                  <p className="mt-1.5 text-xs text-gray-400">
                    Ingresar sólo números con el código de país (ej. 595 para Paraguay), sin el signo +.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg font-medium transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {creating ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  ) : (
                    <Plus size={18} />
                  )}
                  <span>Crear Instancia</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal para mostrar el Código QR */}
      {isQrModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">
                Conectar Instancia: {selectedInstanceName}
              </h3>
              <button 
                onClick={() => {
                  setIsQrModalOpen(false);
                  fetchCuentas(); // Volver a consultar cuentas por si se conectó
                }}
                className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-2 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 flex flex-col items-center justify-center text-center">
              {loadingQr ? (
                <div className="py-12 flex flex-col items-center gap-3">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
                  <p className="text-sm text-gray-500 font-medium">Generando o cargando código QR de Evolution...</p>
                </div>
              ) : qrCodeData ? (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    Escanea este código QR desde la sección de **Dispositivos vinculados** en tu WhatsApp.
                  </p>
                  <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-inner inline-block">
                    <img 
                      src={qrCodeData.startsWith('data:') ? qrCodeData : `data:image/png;base64,${qrCodeData}`} 
                      alt="WhatsApp QR Code"
                      className="w-64 h-64 mx-auto"
                    />
                  </div>
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg p-2.5 font-medium leading-relaxed">
                    ⚠️ Una vez escaneado con éxito, cierra esta ventana y haz clic en **Sincronizar Instancias** para actualizar el estado.
                  </p>
                </div>
              ) : (
                <div className="py-8 space-y-3">
                  <div className="w-12 h-12 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto">
                    <X size={24} />
                  </div>
                  <h4 className="text-base font-semibold text-gray-900">No se pudo cargar el QR</h4>
                  <p className="text-xs text-gray-500 font-mono bg-gray-50 border border-gray-200 rounded-lg p-3 max-w-sm overflow-x-auto">
                    {qrCodeText || "La Evolution API no retornó datos válidos de QR o el canal ya se encuentra conectado."}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end w-full gap-3 mt-6 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => {
                    setIsQrModalOpen(false);
                    fetchCuentas();
                  }}
                  className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
