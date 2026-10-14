import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { 
  Menu, 
  FileSpreadsheet, 
  UploadCloud, 
  Play, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Trash2, 
  Eye, 
  Plus, 
  AlertCircle, 
  RefreshCw, 
  FileText,
  Clock,
  Download,
  Pause,
  PlayCircle,
  Check,
  CheckCheck,
  Search,
  X,
  Paperclip,
  Image,
  Video
} from 'lucide-react';
import { getFriendlyError } from '../utils/errorFormatter';

interface CsvManagerProps {
  onOpenSidebar: () => void;
}

interface GrupoAtencion {
  id: number;
  nombre_grupo: string;
}

interface CuentaActiva {
  cuenta_id: string;
  nombre_cuenta: string;
  numero_cuenta: string;
  estado?: string;
  nombre_interno?: string;
}

interface LoteDestinatario {
  id: number;
  id_lote: number;
  numero: string;
  variable: string | null;
  mensaje_personalizado: string;
  estado: string;
  error: string | null;
  fecha_envio: string | null;
}

interface LoteEnvio {
  id: number;
  nombre_lote: string;
  cuenta_id: string;
  plantilla: string;
  total_mensajes: number;
  enviados: number;
  fallidos: number;
  estado: 'pendiente' | 'en_progreso' | 'completado' | 'fallido' | 'programado' | 'pausado' | 'revisado';
  fecha_programada: string | null;
  id_grupo_atencion?: number | null;
  grupo_atencion?: GrupoAtencion | null;
  media_path?: string | null;
  media_mimetype?: string | null;
  media_filename?: string | null;
  created_at: string;
  updated_at: string | null;
  cuenta: CuentaActiva | null;
}

export default function CsvManager({ onOpenSidebar }: CsvManagerProps) {
  // Navigation tabs
  const [activeTab, setActiveTab] = useState<'nuevo' | 'historial'>('nuevo');
  
  // Accounts
  const [cuentas, setCuentas] = useState<CuentaActiva[]>([]);
  const [nuevaCuentaId, setNuevaCuentaId] = useState('');
  
  // Support Groups
  const [grupos, setGrupos] = useState<GrupoAtencion[]>([]);
  
  // New send form
  const [nombreLote, setNombreLote] = useState('');
  const [cuentaId, setCuentaId] = useState('');
  const [grupoAtencionId, setGrupoAtencionId] = useState('');
  const [plantilla, setPlantilla] = useState('Hola {{1}}! Este es un mensaje personalizado.');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [tipoEnvio, setTipoEnvio] = useState<'inmediato' | 'programado'>('inmediato');
  const [fechaProgramada, setFechaProgramada] = useState('');
  
  // States for optional media attachment
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const mediaFileInputRef = useRef<HTMLInputElement>(null);
  
  // UI States
  const [loading, setLoading] = useState(false);
  const [fetchingLotes, setFetchingLotes] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  
  // History list
  const [lotes, setLotes] = useState<LoteEnvio[]>([]);
  const [selectedLoteId, setSelectedLoteId] = useState<number | null>(null);
  const [loteDetail, setLoteDetail] = useState<LoteEnvio & { destinatarios: LoteDestinatario[] } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [filtroTelefono, setFiltroTelefono] = useState('');
  const [filtroEstado, setFiltroEstado] = useState<string>('todos');

  // Live clock state for current time
  const [currentDateTime, setCurrentDateTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDateTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch accounts, groups and batches on mount
  useEffect(() => {
    fetchCuentas();
    fetchLotes();
    fetchGrupos();
  }, []);

  // Debounce filter search
  useEffect(() => {
    if (activeTab === 'historial') {
      const delayDebounceFn = setTimeout(() => {
        fetchLotes(false, filtroTelefono);
      }, 500);

      return () => clearTimeout(delayDebounceFn);
    }
  }, [filtroTelefono, activeTab]);

  // Poll batches progress (even completed ones to catch webhook updates)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchLotes(false, filtroTelefono); // fetch without global loading spinner
      if (selectedLoteId) {
        fetchLoteDetail(selectedLoteId, false);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [selectedLoteId, filtroTelefono]);

  // Auto-select first connected account if current batch account is disconnected and batch is paused, pending or scheduled
  // Only set it if nuevaCuentaId is not yet selected/set, to prevent resetting user selection when polling.
  useEffect(() => {
    if (loteDetail && ['pausado', 'pendiente', 'programado'].includes(loteDetail.estado)) {
      const currentCuenta = cuentas.find((c: CuentaActiva) => c.cuenta_id === loteDetail.cuenta_id) || loteDetail.cuenta;
      const isCuentaActiva = currentCuenta?.estado === 'Conectado';
      if (!isCuentaActiva && !nuevaCuentaId) {
        const firstConnected = cuentas.find((c: CuentaActiva) => c.estado === 'Conectado');
        if (firstConnected) {
          setNuevaCuentaId(firstConnected.cuenta_id);
        }
      }
    }
  }, [loteDetail, cuentas, nuevaCuentaId]);

  const fetchCuentas = async () => {
    try {
      // Realizar la sincronización de las instancias primero
      await axios.post('/api/evolution/sync-instances').catch(err => {
        console.error("Error sincronizando instancias de forma transparente en CSV:", err);
      });

      const response = await axios.get('/api/cuentas/');
      setCuentas(response.data);
      
      const cuentasConectadas = response.data.filter((c: CuentaActiva) => c.estado === 'Conectado');
      if (cuentasConectadas.length > 0) {
        // Set default to first or agent-associated instance
        let defaultCuenta = cuentasConectadas[0].cuenta_id;
        const userLocal = localStorage.getItem('usuario');
        if (userLocal) {
          const user = JSON.parse(userLocal);
          if (user.id_agente) {
             const agentResponse = await axios.get(`/api/agentes-atencion/${user.id_agente}`);
             if (agentResponse.data.canal) {
                 defaultCuenta = agentResponse.data.canal.cuenta_id;
             }
          }
        }
        setCuentaId(defaultCuenta);
      }
    } catch (error) {
      console.error("Error al cargar cuentas:", error);
    }
  };

  const fetchGrupos = async () => {
    try {
      const response = await axios.get('/api/grupos-atencion/');
      setGrupos(response.data);
    } catch (error) {
      console.error("Error al cargar grupos de atención:", error);
    }
  };

  const fetchLotes = async (showLoading = true, telefonoSearch?: string) => {
    if (showLoading) setFetchingLotes(true);
    try {
      const telQuery = telefonoSearch !== undefined ? telefonoSearch : filtroTelefono;
      const response = await axios.get('/api/lotes-envio/', {
        params: telQuery.trim() ? { telefono: telQuery.trim() } : {}
      });
      setLotes(response.data);
    } catch (error) {
      console.error("Error al cargar historial de lotes:", error);
    } finally {
      if (showLoading) setFetchingLotes(false);
    }
  };

  const fetchLoteDetail = async (id: number, showLoading = true) => {
    if (showLoading) setLoadingDetail(true);
    try {
      const response = await axios.get(`/api/lotes-envio/${id}`);
      setLoteDetail(response.data);
    } catch (error) {
      console.error("Error al cargar detalle del lote:", error);
      setErrorMsg("No se pudo obtener el detalle del lote.");
    } finally {
      if (showLoading) setLoadingDetail(false);
    }
  };

  const handlePauseLote = async (id: number) => {
    try {
      await axios.post(`/api/lotes-envio/${id}/pause`);
      fetchLotes(false);
      fetchLoteDetail(id, false);
    } catch (error: any) {
      alert(error.response?.data?.detail || "No se pudo pausar el lote.");
    }
  };

  const handleResumeLote = async (id: number) => {
    try {
      await axios.post(`/api/lotes-envio/${id}/resume`);
      fetchLotes(false);
      fetchLoteDetail(id, false);
    } catch (error: any) {
      alert(error.response?.data?.detail || "No se pudo reanudar el lote.");
    }
  };

  const handleChangeInstanceAndResume = async (id: number, newCuentaId: string) => {
    try {
      await axios.post(`/api/lotes-envio/${id}/change-instance-and-resume`, null, {
        params: { nueva_cuenta_id: newCuentaId }
      });
      fetchLotes(false);
      fetchLoteDetail(id, false);
    } catch (error: any) {
      alert(error.response?.data?.detail || "No se pudo cambiar de instancia y reanudar el lote.");
    }
  };

  const handleRetryFailedLote = async (id: number) => {
    try {
      const response = await axios.post(`/api/lotes-envio/${id}/retry-failed`);
      alert(response.data.message || "Reintento de mensajes fallidos encolado.");
      fetchLotes(false);
      fetchLoteDetail(id, false);
    } catch (error: any) {
      alert(error.response?.data?.detail || "No se pudieron reintentar los mensajes fallidos.");
    }
  };

  const handleMarkReviewedLote = async (id: number) => {
    try {
      await axios.post(`/api/lotes-envio/${id}/mark-reviewed`);
      fetchLotes(false);
      fetchLoteDetail(id, false);
    } catch (error: any) {
      alert(error.response?.data?.detail || "No se pudo marcar el lote como revisado.");
    }
  };

  const handleLoteClick = (id: number) => {
    setSelectedLoteId(id);
    setNuevaCuentaId(''); // Reset selected new instance so auto-selection can run for the new batch
    fetchLoteDetail(id);
  };

  const handleDeleteLote = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("¿Estás seguro de eliminar este lote y todo su registro de envíos?")) return;

    try {
      await axios.delete(`/api/lotes-envio/${id}`);
      if (selectedLoteId === id) {
        setSelectedLoteId(null);
        setLoteDetail(null);
        setNuevaCuentaId('');
      }
      fetchLotes();
    } catch (error) {
      console.error("Error al eliminar lote:", error);
      alert("Error al eliminar el lote.");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (!file.name.endsWith('.csv')) {
        setErrorMsg("El archivo debe tener formato CSV.");
        setSelectedFile(null);
        return;
      }
      setSelectedFile(file);
      setErrorMsg('');
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleMediaFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const fileType = file.type;
      const isImage = fileType.startsWith('image/');
      const isPdf = fileType === 'application/pdf';
      const isVideo = fileType.startsWith('video/');

      if (!isImage && !isPdf && !isVideo) {
        setErrorMsg("Formato de adjunto no soportado. Debe ser imagen, PDF o video.");
        setMediaFile(null);
        return;
      }

      if (isVideo) {
        if (file.size > 100 * 1024 * 1024) {
          setErrorMsg("El video supera el límite de 100 MB.");
          setMediaFile(null);
          return;
        }
      } else {
        if (file.size > 16 * 1024 * 1024) {
          setErrorMsg("El archivo adjunto supera el límite de 16 MB.");
          setMediaFile(null);
          return;
        }
      }

      setMediaFile(file);
      setErrorMsg('');
    }
  };

  const clearMediaFile = () => {
    setMediaFile(null);
    if (mediaFileInputRef.current) {
      mediaFileInputRef.current.value = '';
    }
  };

  const handleNewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombreLote.trim()) {
      setErrorMsg("Por favor, introduce un nombre para el lote.");
      return;
    }
    if (!cuentaId) {
      setErrorMsg("Selecciona una línea de envío.");
      return;
    }
    if (!selectedFile) {
      setErrorMsg("Por favor, sube un archivo CSV.");
      return;
    }
    if (!plantilla.trim()) {
      setErrorMsg("Escribe una plantilla para el mensaje.");
      return;
    }
    if (tipoEnvio === 'programado' && !fechaProgramada) {
      setErrorMsg("Por favor, selecciona la fecha y hora de programación.");
      return;
    }

    setLoading(true);
    setSuccessMsg('');
    setErrorMsg('');

    const formData = new FormData();
    formData.append('nombre_lote', nombreLote.trim());
    formData.append('cuenta_id', cuentaId);
    if (grupoAtencionId) {
      formData.append('id_grupo_atencion', grupoAtencionId);
    }
    formData.append('plantilla', plantilla.trim());
    formData.append('csv_file', selectedFile);
    if (mediaFile) {
      formData.append('media_file', mediaFile);
    }
    if (tipoEnvio === 'programado' && fechaProgramada) {
      const dateObj = new Date(fechaProgramada);
      formData.append('fecha_programada', dateObj.toISOString());
    }

    try {
      const response = await axios.post('/api/lotes-envio/', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      setSuccessMsg(response.data.message || 'Lote creado con éxito.');
      setNombreLote('');
      setGrupoAtencionId('');
      setTipoEnvio('inmediato');
      setFechaProgramada('');
      clearFile();
      clearMediaFile();
      fetchLotes();
      setActiveTab('historial');
    } catch (error: any) {
      console.error("Error al crear lote:", error);
      setErrorMsg(error.response?.data?.detail || "Ocurrió un error al subir y procesar el lote.");
    } finally {
      setLoading(false);
    }
  };

  const exportarCSV = () => {
    if (!loteDetail || !loteDetail.destinatarios) return;

    // Cabeceras del CSV
    const headers = ["Destinatario", "Variable", "Mensaje Personalizado", "Estado", "Fecha Envio", "Error"];
    
    // Mapeo de destinatarios
    const rows = loteDetail.destinatarios.map(d => [
      `+${d.numero}`,
      d.variable || "",
      d.mensaje_personalizado,
      d.estado,
      d.fecha_envio ? new Date(d.fecha_envio).toLocaleString() : "",
      d.error ? getFriendlyError(d.error) : ""
    ]);

    // Función para escapar campos CSV de forma segura
    const escapeCsvField = (field: string) => {
      const stringified = String(field);
      if (stringified.includes('"') || stringified.includes(',') || stringified.includes(';') || stringified.includes('\n')) {
        return `"${stringified.replace(/"/g, '""')}"`;
      }
      return stringified;
    };

    const csvContent = [
      headers.map(escapeCsvField).join(','),
      ...rows.map(row => row.map(escapeCsvField).join(','))
    ].join('\n');

    // Añadir BOM de UTF-8 para compatibilidad con Excel
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    // Nombre del archivo limpio
    const safeName = loteDetail.nombre_lote.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    link.setAttribute('download', `reporte_lote_${loteDetail.id}_${safeName}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Helper to get status pill styling
  const getStatusPill = (estado: string) => {
    switch (estado) {
      case 'pendiente':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200">Pendiente</span>;
      case 'programado':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-purple-50 text-purple-700 border border-purple-200 flex items-center gap-1 inline-flex">
            <Clock size={12} /> Programado
          </span>
        );
      case 'en_progreso':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1 inline-flex">
            <Loader2 size={12} className="animate-spin" /> En Progreso
          </span>
        );
      case 'pausado':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-orange-50 text-orange-700 border border-orange-200">Pausado</span>;
      case 'completado':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-green-50 text-green-700 border border-green-200">Completado</span>;
      case 'revisado':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 flex items-center gap-1 inline-flex">
            <CheckCheck size={12} /> Revisado
          </span>
        );
      case 'fallido':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-red-50 text-red-700 border border-red-200">Fallido</span>;
      default:
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-gray-50 text-gray-700 border border-gray-200">{estado}</span>;
    }
  };

  const conteoEstados = {
    todos: lotes.length,
    en_progreso: lotes.filter((l: LoteEnvio) => l.estado === 'en_progreso').length,
    completado: lotes.filter((l: LoteEnvio) => l.estado === 'completado').length,
    pendiente: lotes.filter((l: LoteEnvio) => l.estado === 'pendiente').length,
    programado: lotes.filter((l: LoteEnvio) => l.estado === 'programado').length,
    pausado: lotes.filter((l: LoteEnvio) => l.estado === 'pausado').length,
    fallido: lotes.filter((l: LoteEnvio) => l.estado === 'fallido').length,
    revisado: lotes.filter((l: LoteEnvio) => l.estado === 'revisado').length,
  };

  const lotesFiltrados = lotes
    .filter((l: LoteEnvio) => {
      if (filtroEstado === 'todos') return true;
      return l.estado === filtroEstado;
    })
    .sort((a: LoteEnvio, b: LoteEnvio) => b.id - a.id);

  return (
    <div className="flex-1 flex flex-col h-full bg-white relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <button 
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-md lg:hidden"
            onClick={onOpenSidebar}
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={24} className="text-green-600" />
            <h2 className="text-xl font-semibold text-gray-800">Envíos masivos por CSV</h2>
          </div>
        </div>

        {/* Horario actual */}
        <div className="hidden md:flex items-center gap-1.5 px-3 py-1 bg-gray-50 border border-gray-200 text-gray-600 rounded-lg text-xs font-medium">
          <Clock size={13} className="text-blue-500 animate-pulse" />
          <span>Hora del Sistema: {currentDateTime.toLocaleDateString('es-PY')} {currentDateTime.toLocaleTimeString('es-PY')}</span>
        </div>
        
        {/* Toggle tabs */}
        <div className="flex bg-gray-100 rounded-lg p-0.5 border border-gray-200/50">
          <button
            onClick={() => { setActiveTab('nuevo'); setSelectedLoteId(null); setLoteDetail(null); setNuevaCuentaId(''); }}
            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${
              activeTab === 'nuevo' && !selectedLoteId ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Nuevo Lote
          </button>
          <button
            onClick={() => { setActiveTab('historial'); }}
            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${
              activeTab === 'historial' || selectedLoteId ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Historial ({lotes.length})
          </button>
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#f4f7f6]">
        {activeTab === 'nuevo' && !selectedLoteId ? (
          <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-5 gap-6">
            {/* Form */}
            <div className="md:col-span-3 bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
              <div className="border-b border-gray-100 pb-3">
                <h3 className="text-base font-semibold text-gray-800">Configuración del Envío</h3>
                <p className="text-xs text-gray-500 mt-1">Sube un CSV, diseña el mensaje y lánzalo de inmediato.</p>
              </div>

              <form onSubmit={handleNewSubmit} className="space-y-4">
                {successMsg && (
                  <div className="bg-green-50 text-green-700 p-2.5 rounded-lg text-sm border border-green-100 font-medium">
                    {successMsg}
                  </div>
                )}
                {errorMsg && (
                  <div className="bg-red-50 text-red-700 p-2.5 rounded-lg text-sm border border-red-100 font-medium flex items-center gap-2">
                    <AlertCircle size={16} /> {errorMsg}
                  </div>
                )}

                <div>
                  <label className="block text-[13px] font-bold text-gray-700 mb-1">
                    Nombre del Lote
                  </label>
                  <input
                    type="text"
                    value={nombreLote}
                    onChange={(e) => setNombreLote(e.target.value)}
                    placeholder="Ej. Cobranzas Septiembre 2026"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow bg-white"
                    required
                    disabled={loading}
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-bold text-gray-700 mb-1">
                    Línea de Envío (WhatsApp)
                  </label>
                  <select
                    value={cuentaId}
                    onChange={(e) => setCuentaId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow bg-white"
                    required
                    disabled={loading}
                  >
                    {cuentas.filter(c => c.estado === 'Conectado').length === 0 && (
                      <option value="">No hay canales activos o conectados</option>
                    )}
                    {cuentas.filter(c => c.estado === 'Conectado').map(cuenta => (
                      <option key={cuenta.cuenta_id} value={cuenta.cuenta_id}>
                        {cuenta.nombre_interno ? `${cuenta.nombre_interno} (${cuenta.nombre_cuenta})` : cuenta.nombre_cuenta} (+{cuenta.numero_cuenta})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[13px] font-bold text-gray-700 mb-1">
                    Asociar a un Grupo de Atención (Opcional)
                  </label>
                  <select
                    value={grupoAtencionId}
                    onChange={(e) => setGrupoAtencionId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow bg-white"
                    disabled={loading}
                  >
                    <option value="">No asociar a ningún grupo</option>
                    {grupos.map(grupo => (
                      <option key={grupo.id} value={grupo.id}>
                        {grupo.nombre_grupo}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-gray-400 mt-1">
                    Las conversaciones generadas por este lote se asociarán automáticamente al grupo seleccionado para que sus agentes puedan atenderlas.
                  </p>
                </div>

                <div>
                  <label className="block text-[13px] font-bold text-gray-700 mb-1">
                    Archivo CSV
                  </label>
                  {!selectedFile ? (
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-green-500 hover:bg-green-50/20 cursor-pointer transition-all flex flex-col items-center"
                    >
                      <UploadCloud size={32} className="text-gray-400 mb-2" />
                      <span className="text-xs font-semibold text-gray-700">Subir archivo .csv</span>
                      <span className="text-[10px] text-gray-400 mt-1">Haz clic para buscar en tu dispositivo</span>
                      <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleFileChange} 
                        accept=".csv" 
                        className="hidden" 
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-between border border-gray-200 rounded-lg p-3 bg-gray-50">
                      <div className="flex items-center gap-2">
                        <FileText size={20} className="text-green-600" />
                        <div className="text-left">
                          <p className="text-xs font-semibold text-gray-800 max-w-[200px] truncate">{selectedFile.name}</p>
                          <p className="text-[10px] text-gray-400">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                        </div>
                      </div>
                      <button 
                        type="button" 
                        onClick={clearFile}
                        className="text-gray-400 hover:text-red-500 p-1 rounded-md hover:bg-gray-100"
                      >
                        <XCircle size={16} />
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-[13px] font-bold text-gray-700">
                      Archivo Adjunto (Opcional)
                    </label>
                    <span className="text-[10px] text-gray-400 font-medium">
                      Img/PDF (Máx 16MB) o Video (Máx 100MB)
                    </span>
                  </div>
                  {!mediaFile ? (
                    <div 
                      onClick={() => mediaFileInputRef.current?.click()}
                      className="border border-dashed border-gray-300 rounded-lg p-3.5 text-center hover:border-blue-500 hover:bg-blue-50/10 cursor-pointer transition-all flex items-center justify-center gap-2 bg-gray-50/50"
                    >
                      <Paperclip size={16} className="text-gray-400" />
                      <span className="text-xs font-semibold text-gray-600">Adjuntar Imagen, PDF o Video</span>
                      <input 
                        type="file" 
                        ref={mediaFileInputRef} 
                        onChange={handleMediaFileChange} 
                        accept="image/*,application/pdf,video/*" 
                        className="hidden" 
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-between border border-gray-200 rounded-lg p-3 bg-blue-50/20">
                      <div className="flex items-center gap-2">
                        {mediaFile.type.startsWith('image/') && <Image size={20} className="text-blue-600" />}
                        {mediaFile.type === 'application/pdf' && <FileText size={20} className="text-red-500" />}
                        {mediaFile.type.startsWith('video/') && <Video size={20} className="text-purple-600" />}
                        <div className="text-left">
                          <p className="text-xs font-semibold text-gray-800 max-w-[200px] truncate">{mediaFile.name}</p>
                          <p className="text-[10px] text-gray-400">{(mediaFile.size / 1024 / 1024).toFixed(2)} MB</p>
                        </div>
                      </div>
                      <button 
                        type="button" 
                        onClick={clearMediaFile}
                        className="text-gray-400 hover:text-red-500 p-1 rounded-md hover:bg-gray-100"
                      >
                        <XCircle size={16} />
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-[13px] font-bold text-gray-700">
                      Plantilla del Mensaje
                    </label>
                    <span className="text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                      Variable: {'{{1}}'}
                    </span>
                  </div>
                  <textarea
                    value={plantilla}
                    onChange={(e) => setPlantilla(e.target.value)}
                    rows={4}
                    placeholder="Escribe el mensaje aquí..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow bg-white font-sans"
                    required
                    disabled={loading}
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    Usa <code className="bg-gray-100 text-gray-600 px-1 rounded">{"{{1}}"}</code> para insertar el valor de la segunda columna del CSV para cada destinatario.
                  </p>
                </div>

                <div className="space-y-3 border-t border-gray-100 pt-3">
                  <label className="block text-[13px] font-bold text-gray-700">
                    Método de Envío
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-all ${
                      tipoEnvio === 'inmediato' 
                        ? 'border-green-500 bg-green-50/20 text-green-700 font-bold' 
                        : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                    }`}>
                      <input 
                        type="radio" 
                        name="tipoEnvio" 
                        value="inmediato"
                        checked={tipoEnvio === 'inmediato'}
                        onChange={() => setTipoEnvio('inmediato')}
                        className="text-green-600 focus:ring-green-500"
                        disabled={loading}
                      />
                      <span className="text-xs">Enviar Ahora</span>
                    </label>

                    <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-all ${
                      tipoEnvio === 'programado' 
                        ? 'border-blue-500 bg-blue-50/20 text-blue-700 font-bold' 
                        : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                    }`}>
                      <input 
                        type="radio" 
                        name="tipoEnvio" 
                        value="programado"
                        checked={tipoEnvio === 'programado'}
                        onChange={() => setTipoEnvio('programado')}
                        className="text-blue-600 focus:ring-blue-500"
                        disabled={loading}
                      />
                      <span className="text-xs">Envío Programado</span>
                    </label>
                  </div>
                </div>

                {tipoEnvio === 'programado' && (
                  <div className="space-y-1">
                    <label className="block text-[13px] font-bold text-gray-700">
                      Fecha y Hora de Inicio
                    </label>
                    <input
                      type="datetime-local"
                      value={fechaProgramada}
                      onChange={(e) => setFechaProgramada(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow bg-white text-gray-800"
                      required={tipoEnvio === 'programado'}
                      disabled={loading}
                      min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                    />
                    <p className="text-[10px] text-gray-400 mt-1">
                      El lote se programará para iniciar automáticamente en la fecha y hora indicadas.
                    </p>
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-lg text-sm transition-colors shadow-sm cursor-pointer"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Procesando...
                    </>
                  ) : (
                    <>
                      <Play size={16} /> Lanzar Envío Masivo
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* Instruction / Guide panel */}
            <div className="md:col-span-2 space-y-4">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <h4 className="text-sm font-bold text-gray-800 border-b border-gray-100 pb-2 mb-3">Requisitos del Archivo CSV</h4>
                <ul className="text-xs text-gray-600 space-y-2.5 list-disc pl-4">
                  <li><strong>Primera Columna:</strong> Debe ser el número telefónico del destinatario. Se limpiará de caracteres como +, - o espacios y se enviará sólo los dígitos (con código de país, ej. <code className="bg-gray-100 px-1 text-gray-600 rounded">595981123456</code>).</li>
                  <li><strong>Segunda Columna:</strong> El valor de la variable a reemplazar. Puede ser un nombre, saldo, referencia, etc.</li>
                  <li><strong>Cabeceras:</strong> Si la primera línea tiene texto no numérico, el sistema la descartará automáticamente como cabecera.</li>
                  <li><strong>Formatos admitidos:</strong> Codificación UTF-8 o Latin-1. Separador de comas (,) o punto y coma (;).</li>
                </ul>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <h4 className="text-sm font-bold text-gray-800 border-b border-gray-100 pb-2 mb-3">Procesamiento Inteligente</h4>
                <div className="text-xs text-gray-600 space-y-2">
                  <p><strong>Cola en Segundo Plano:</strong> El envío se ejecuta en segundo plano por el servidor de tareas (Celery), lo que te permite seguir chateando o cerrar la pestaña sin interrumpir el proceso.</p>
                  <p><strong>Anti-Ban / Retardo Variable:</strong> Se introduce una pausa aleatoria variable de <strong>entre 2 minutos y 8 minutos</strong> entre cada mensaje y un simulador de "escribiendo..." (presencia) para proteger tu número de suspensiones de WhatsApp.</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* History / Detail View */
          <div className="max-w-6xl mx-auto flex flex-col gap-6">
            {/* Reporte de Lotes interactivo */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 text-left">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <div>
                  <h3 className="text-sm font-bold text-gray-800">Reporte de Envíos por Lote</h3>
                  <p className="text-[11px] text-gray-500">Hacé click en cualquier estado para filtrar los lotes registrados.</p>
                </div>
                {filtroEstado !== 'todos' && (
                  <button
                    onClick={() => setFiltroEstado('todos')}
                    className="text-[11px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded transition-colors self-start sm:self-center cursor-pointer"
                  >
                    Limpiar Filtro
                  </button>
                )}
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                {/* Todos */}
                <button
                  onClick={() => setFiltroEstado('todos')}
                  className={`p-2.5 rounded-lg border text-left transition-all flex flex-col justify-between cursor-pointer ${
                    filtroEstado === 'todos' 
                      ? 'border-blue-500 bg-blue-50/30 ring-2 ring-blue-500/10 shadow-sm' 
                      : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 w-full">
                    <span className="text-[9px] font-bold uppercase text-gray-500">Todos</span>
                    <FileSpreadsheet size={14} className="text-gray-400" />
                  </div>
                  <p className="text-base font-bold text-gray-800 mt-1">{conteoEstados.todos}</p>
                </button>

                {/* Pendientes */}
                <button
                  onClick={() => setFiltroEstado('pendiente')}
                  className={`p-2.5 rounded-lg border text-left transition-all flex flex-col justify-between cursor-pointer ${
                    filtroEstado === 'pendiente' 
                      ? 'border-yellow-500 bg-yellow-50/30 ring-2 ring-yellow-500/10 shadow-sm' 
                      : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 w-full">
                    <span className="text-[9px] font-bold uppercase text-yellow-600">Pendientes</span>
                    <Clock size={14} className="text-yellow-500" />
                  </div>
                  <p className="text-base font-bold text-gray-800 mt-1">{conteoEstados.pendiente}</p>
                </button>

                {/* Programados */}
                <button
                  onClick={() => setFiltroEstado('programado')}
                  className={`p-2.5 rounded-lg border text-left transition-all flex flex-col justify-between cursor-pointer ${
                    filtroEstado === 'programado' 
                      ? 'border-purple-500 bg-purple-50/30 ring-2 ring-purple-500/10 shadow-sm' 
                      : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 w-full">
                    <span className="text-[9px] font-bold uppercase text-purple-600">Programados</span>
                    <Clock size={14} className="text-purple-500" />
                  </div>
                  <p className="text-base font-bold text-gray-800 mt-1">{conteoEstados.programado}</p>
                </button>

                {/* En Progreso */}
                <button
                  onClick={() => setFiltroEstado('en_progreso')}
                  className={`p-2.5 rounded-lg border text-left transition-all flex flex-col justify-between cursor-pointer ${
                    filtroEstado === 'en_progreso' 
                      ? 'border-blue-500 bg-blue-50/30 ring-2 ring-blue-500/10 shadow-sm' 
                      : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 w-full">
                    <span className="text-[9px] font-bold uppercase text-blue-600">En Progreso</span>
                    <Loader2 size={14} className={`text-blue-500 ${filtroEstado === 'en_progreso' ? 'animate-spin' : ''}`} />
                  </div>
                  <p className="text-base font-bold text-gray-800 mt-1">{conteoEstados.en_progreso}</p>
                </button>

                {/* Pausados */}
                <button
                  onClick={() => setFiltroEstado('pausado')}
                  className={`p-2.5 rounded-lg border text-left transition-all flex flex-col justify-between cursor-pointer ${
                    filtroEstado === 'pausado' 
                      ? 'border-orange-500 bg-orange-50/30 ring-2 ring-orange-500/10 shadow-sm' 
                      : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 w-full">
                    <span className="text-[9px] font-bold uppercase text-orange-600">Pausados</span>
                    <Pause size={14} className="text-orange-500" />
                  </div>
                  <p className="text-base font-bold text-gray-800 mt-1">{conteoEstados.pausado}</p>
                </button>

                {/* Completados */}
                <button
                  onClick={() => setFiltroEstado('completado')}
                  className={`p-2.5 rounded-lg border text-left transition-all flex flex-col justify-between cursor-pointer ${
                    filtroEstado === 'completado' 
                      ? 'border-green-500 bg-green-50/30 ring-2 ring-green-500/10 shadow-sm' 
                      : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 w-full">
                    <span className="text-[9px] font-bold uppercase text-green-600">Completados</span>
                    <CheckCircle2 size={14} className="text-green-500" />
                  </div>
                  <p className="text-base font-bold text-gray-800 mt-1">{conteoEstados.completado}</p>
                </button>

                {/* Revisados */}
                <button
                  onClick={() => setFiltroEstado('revisado')}
                  className={`p-2.5 rounded-lg border text-left transition-all flex flex-col justify-between cursor-pointer ${
                    filtroEstado === 'revisado' 
                      ? 'border-indigo-500 bg-indigo-50/30 ring-2 ring-indigo-500/10 shadow-sm' 
                      : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 w-full">
                    <span className="text-[9px] font-bold uppercase text-indigo-600">Revisados</span>
                    <CheckCheck size={14} className="text-indigo-500" />
                  </div>
                  <p className="text-base font-bold text-gray-800 mt-1">{conteoEstados.revisado}</p>
                </button>

                {/* Fallidos */}
                <button
                  onClick={() => setFiltroEstado('fallido')}
                  className={`p-2.5 rounded-lg border text-left transition-all flex flex-col justify-between cursor-pointer ${
                    filtroEstado === 'fallido' 
                      ? 'border-red-500 bg-red-50/30 ring-2 ring-red-500/10 shadow-sm' 
                      : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 w-full">
                    <span className="text-[9px] font-bold uppercase text-red-600">Fallidos</span>
                    <XCircle size={14} className="text-red-500" />
                  </div>
                  <p className="text-base font-bold text-gray-800 mt-1">{conteoEstados.fallido}</p>
                </button>
              </div>
            </div>

            {/* Grid del Historial */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Batches List */}
              <div className={`lg:col-span-1 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-[calc(100vh-220px)] lg:h-[calc(100vh-320px)]`}>
              <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-gray-800">Lotes Registrados</h3>
                  <button 
                    onClick={() => {
                      fetchLotes(true);
                      fetchCuentas();
                    }}
                    className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
                    title="Actualizar"
                    disabled={fetchingLotes}
                  >
                    <RefreshCw size={14} className={fetchingLotes ? 'animate-spin' : ''} />
                  </button>
                </div>
                
                {/* Filtro por Teléfono */}
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 text-gray-400">
                    <Search size={14} />
                  </span>
                  <input
                    type="text"
                    value={filtroTelefono}
                    onChange={(e) => setFiltroTelefono(e.target.value)}
                    placeholder="Buscar por nro de teléfono..."
                    className="w-full pl-8 pr-8 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-800 placeholder-gray-400"
                  />
                  {filtroTelefono && (
                    <button
                      onClick={() => setFiltroTelefono('')}
                      className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-gray-400 hover:text-gray-600"
                      title="Limpiar filtro"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
                {lotes.length === 0 && !fetchingLotes && (
                  <div className="p-8 text-center text-xs text-gray-400">
                    No has iniciado ningún envío masivo por CSV aún.
                  </div>
                )}

                {lotes.length > 0 && lotesFiltrados.length === 0 && !fetchingLotes && (
                  <div className="p-8 text-center text-xs text-gray-400 flex flex-col items-center gap-1.5">
                    <AlertCircle size={18} className="text-gray-400" />
                    <span>No hay lotes con estado <span className="font-semibold">"{filtroEstado}"</span>.</span>
                  </div>
                )}
                
                {lotesFiltrados.map(l => (
                  <div 
                    key={l.id} 
                    onClick={() => handleLoteClick(l.id)}
                    className={`p-4 hover:bg-gray-50 cursor-pointer transition-colors text-left relative ${
                      selectedLoteId === l.id ? 'bg-blue-50/40 border-l-4 border-blue-500' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-bold text-gray-800 truncate mb-0.5">{l.nombre_lote}</h4>
                        <p className="text-[10px] text-gray-500 truncate mb-0.5">
                          Instancia: <span className="font-semibold text-gray-700">{l.cuenta?.nombre_interno || l.cuenta?.nombre_cuenta || l.cuenta_id}</span>
                        </p>
                        {l.grupo_atencion && (
                          <p className="text-[10px] text-gray-500 truncate mb-0.5">
                            Grupo: <span className="font-semibold text-blue-600">{l.grupo_atencion.nombre_grupo}</span>
                          </p>
                        )}
                        <p className="text-[10px] text-gray-400 flex items-center gap-1" title="Fecha de creación">
                          <Clock size={10} /> Creado: {new Date(l.created_at).toLocaleString()}
                        </p>
                        {l.fecha_programada && (
                          <p className="text-[10px] text-purple-600 font-bold flex items-center gap-1 mt-0.5">
                            <Clock size={10} /> Programado: {new Date(l.fecha_programada).toLocaleString()}
                          </p>
                        )}
                      </div>
                      <button 
                        onClick={(e) => handleDeleteLote(l.id, e)}
                        className="text-gray-400 hover:text-red-500 p-1 rounded hover:bg-gray-100"
                        title="Eliminar lote"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between gap-1.5">
                      <div className="text-[10px] font-semibold text-gray-500">
                        Progreso: {l.enviados}/{l.total_mensajes} {l.fallidos > 0 && <span className="text-red-500">({l.fallidos} fallidos)</span>}
                      </div>
                      {getStatusPill(l.estado)}
                    </div>

                    {/* Simple progress bar */}
                    <div className="w-full bg-gray-100 h-1 rounded-full mt-2 overflow-hidden">
                      <div 
                        className={`h-full rounded-full ${
                          l.estado === 'completado' ? 'bg-green-500' : l.estado === 'fallido' ? 'bg-red-500' : 'bg-blue-500'
                        }`}
                        style={{ width: `${(l.enviados / (l.total_mensajes || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Batch Details */}
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-[calc(100vh-160px)]">
              {loadingDetail ? (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                  <Loader2 size={32} className="animate-spin text-blue-500 mb-2" />
                  <span className="text-xs">Cargando detalles del lote...</span>
                </div>
              ) : loteDetail ? (
                <>
                  {/* Detail Header */}
                  <div className="p-4 border-b border-gray-100 bg-gray-50/40 text-left">
                    <div className="flex items-start justify-between flex-wrap gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full uppercase">
                            ID: #{loteDetail.id}
                          </span>
                          <span className="text-[10px] font-medium text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Clock size={10} /> Creado: {new Date(loteDetail.created_at).toLocaleString()}
                          </span>
                        </div>
                        <h3 className="text-base font-bold text-gray-800 mt-1">{loteDetail.nombre_lote}</h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Línea: <strong>{loteDetail.cuenta?.nombre_interno || loteDetail.cuenta?.nombre_cuenta || loteDetail.cuenta_id}</strong> | Plantilla: <span className="italic">"{loteDetail.plantilla}"</span>
                        </p>
                        {loteDetail.grupo_atencion && (
                          <p className="text-xs text-gray-500 mt-0.5">
                            Grupo de Atención: <strong className="text-blue-600">{loteDetail.grupo_atencion.nombre_grupo}</strong>
                          </p>
                        )}
                        {loteDetail.media_filename && (
                          <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5 bg-blue-50/50 p-1 px-2.5 rounded border border-blue-100/30 w-fit font-medium">
                            <Paperclip size={12} className="text-blue-500" /> 
                            Adjunto: <span className="font-semibold text-gray-700">{loteDetail.media_filename}</span>
                            {loteDetail.media_path && (
                              <a 
                                href={loteDetail.media_path.startsWith('/') ? loteDetail.media_path : '/' + loteDetail.media_path} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="text-[10px] text-blue-600 hover:underline ml-1.5 font-bold bg-white px-1.5 py-0.5 rounded border border-blue-200"
                              >
                                Ver/Descargar
                              </a>
                            )}
                          </p>
                        )}
                        {loteDetail.fecha_programada && (
                          <p className="text-xs text-purple-700 font-bold mt-1 flex items-center gap-1">
                            <Clock size={12} /> Inicio programado: {new Date(loteDetail.fecha_programada).toLocaleString()}
                          </p>
                        )}
                      </div>
                      <div className="text-right flex flex-col items-end gap-1.5">
                        {getStatusPill(loteDetail.estado)}
                        <p className="text-[10px] text-gray-400">Total: {loteDetail.total_mensajes} mensajes</p>
                        <button
                          onClick={exportarCSV}
                          className="mt-1 flex items-center gap-1.5 bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors shadow-sm cursor-pointer"
                          title="Exportar mensajes a CSV"
                        >
                          <Download size={13} />
                          Exportar CSV
                        </button>
                      </div>
                    </div>

                    {/* Progress summary block */}
                    <div className="mt-4 flex items-center justify-between gap-4 bg-white p-3 rounded-lg border border-gray-100 flex-wrap">
                      <div className="grid grid-cols-3 gap-4 flex-1 text-center">
                        <div>
                          <p className="text-[10px] text-gray-400">Enviados</p>
                          <p className="text-sm font-bold text-green-600">{loteDetail.enviados}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-400">Fallidos</p>
                          <p className="text-sm font-bold text-red-600">{loteDetail.fallidos}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-400">Pendientes</p>
                          <p className="text-sm font-bold text-gray-500">
                            {['completado', 'revisado', 'fallido'].includes(loteDetail.estado)
                              ? 0
                              : Math.max(0, loteDetail.total_mensajes - loteDetail.enviados - loteDetail.fallidos)}
                          </p>
                        </div>
                      </div>
                      
                      {/* Botones de Pausa / Reanudación */}
                      <div className="flex gap-2">
                        {loteDetail.estado === 'en_progreso' && (
                          <button
                            onClick={() => handlePauseLote(loteDetail.id)}
                            className="flex items-center gap-1.5 bg-orange-100 hover:bg-orange-200 text-orange-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer"
                            title="Pausar el envío temporalmente"
                          >
                            <Pause size={13} />
                            Pausar
                          </button>
                        )}
                        {(loteDetail.estado === 'pendiente' || loteDetail.estado === 'programado') && (() => {
                          const currentCuenta = cuentas.find(c => c.cuenta_id === loteDetail.cuenta_id) || loteDetail.cuenta;
                          const isCuentaActiva = currentCuenta?.estado === 'Conectado';
                          const cuentasConectadas = cuentas.filter(c => c.estado === 'Conectado');
                          return (
                            <div className="flex flex-col gap-2.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                                  isCuentaActiva 
                                    ? 'bg-green-50 text-green-700 border-green-200' 
                                    : 'bg-red-50 text-red-700 border-red-200'
                                }`} title={`La instancia está ${currentCuenta?.estado || 'Desconectada'}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${isCuentaActiva ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
                                  {currentCuenta?.estado || 'Desconectado'}
                                </span>
                                <button
                                  onClick={() => isCuentaActiva && handleResumeLote(loteDetail.id)}
                                  disabled={!isCuentaActiva}
                                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${
                                    isCuentaActiva 
                                      ? 'bg-green-600 hover:bg-green-700 text-white cursor-pointer' 
                                      : 'bg-gray-100 text-gray-400 cursor-not-allowed opacity-60'
                                  }`}
                                  title={isCuentaActiva ? "Iniciar el envío inmediatamente" : "No se puede iniciar: la instancia está desconectada"}
                                >
                                  <Play size={13} />
                                  Iniciar
                                </button>
                              </div>

                              {!isCuentaActiva && cuentasConectadas.length > 0 && (
                                <div className="flex items-center gap-2 border border-orange-200 bg-orange-50/70 p-2.5 rounded-lg flex-wrap">
                                  <span className="text-[11px] text-orange-800 font-bold">Cambiar a instancia activa:</span>
                                  <select
                                    value={nuevaCuentaId}
                                    onChange={(e) => setNuevaCuentaId(e.target.value)}
                                    className="text-xs border border-orange-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-orange-500 text-gray-800 font-semibold"
                                  >
                                    <option value="">Seleccionar instancia...</option>
                                    {cuentasConectadas.map(c => {
                                      const activeBatchesCount = lotes.filter(
                                        l => l.cuenta_id === c.cuenta_id && (l.estado === 'en_progreso' || l.estado === 'pausado')
                                      ).length;
                                      return (
                                        <option key={c.cuenta_id} value={c.cuenta_id}>
                                          {c.nombre_interno || c.nombre_cuenta || c.cuenta_id} ({activeBatchesCount})
                                        </option>
                                      );
                                    })}
                                  </select>
                                  <button
                                    onClick={() => nuevaCuentaId && handleChangeInstanceAndResume(loteDetail.id, nuevaCuentaId)}
                                    disabled={!nuevaCuentaId}
                                    className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-bold shadow-sm transition-all ${
                                      nuevaCuentaId 
                                        ? 'bg-orange-600 hover:bg-orange-700 text-white cursor-pointer' 
                                        : 'bg-gray-200 text-gray-400 cursor-not-allowed opacity-60'
                                    }`}
                                    title="Cambiar de instancia e iniciar el envío"
                                  >
                                    <RefreshCw size={11} className={fetchingLotes ? "animate-spin" : ""} />
                                    Cambiar e Iniciar
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        {loteDetail.estado === 'pausado' && (() => {
                          const currentCuenta = cuentas.find(c => c.cuenta_id === loteDetail.cuenta_id) || loteDetail.cuenta;
                          const isCuentaActiva = currentCuenta?.estado === 'Conectado';
                          const cuentasConectadas = cuentas.filter(c => c.estado === 'Conectado');
                          return (
                            <div className="flex flex-col gap-2.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                                  isCuentaActiva 
                                    ? 'bg-green-50 text-green-700 border-green-200' 
                                    : 'bg-red-50 text-red-700 border-red-200'
                                }`} title={`La instancia está ${currentCuenta?.estado || 'Desconectada'}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${isCuentaActiva ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
                                  {currentCuenta?.estado || 'Desconectado'}
                                </span>
                                <button
                                  onClick={() => isCuentaActiva && handleResumeLote(loteDetail.id)}
                                  disabled={!isCuentaActiva}
                                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${
                                    isCuentaActiva 
                                      ? 'bg-green-100 hover:bg-green-200 text-green-700 cursor-pointer' 
                                      : 'bg-gray-100 text-gray-400 cursor-not-allowed opacity-60'
                                  }`}
                                  title={isCuentaActiva ? "Reanudar el envío" : "No se puede reanudar: la instancia está desconectada"}
                                >
                                  <PlayCircle size={13} />
                                  Reanudar
                                </button>
                                <button
                                  onClick={() => handleMarkReviewedLote(loteDetail.id)}
                                  className="flex items-center gap-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer"
                                  title="Marcar lote como revisado"
                                >
                                  <CheckCheck size={13} />
                                  Marcar como Revisado
                                </button>
                              </div>

                              {!isCuentaActiva && cuentasConectadas.length > 0 && (
                                <div className="flex items-center gap-2 border border-orange-200 bg-orange-50/70 p-2.5 rounded-lg flex-wrap">
                                  <span className="text-[11px] text-orange-800 font-bold">Cambiar a instancia activa:</span>
                                  <select
                                    value={nuevaCuentaId}
                                    onChange={(e) => setNuevaCuentaId(e.target.value)}
                                    className="text-xs border border-orange-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-orange-500 text-gray-800 font-semibold"
                                  >
                                    <option value="">Seleccionar instancia...</option>
                                    {cuentasConectadas.map(c => {
                                      const activeBatchesCount = lotes.filter(
                                        l => l.cuenta_id === c.cuenta_id && (l.estado === 'en_progreso' || l.estado === 'pausado')
                                      ).length;
                                      return (
                                        <option key={c.cuenta_id} value={c.cuenta_id}>
                                          {c.nombre_interno || c.nombre_cuenta || c.cuenta_id} ({activeBatchesCount})
                                        </option>
                                      );
                                    })}
                                  </select>
                                  <button
                                    onClick={() => nuevaCuentaId && handleChangeInstanceAndResume(loteDetail.id, nuevaCuentaId)}
                                    disabled={!nuevaCuentaId}
                                    className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-bold shadow-sm transition-all ${
                                      nuevaCuentaId 
                                        ? 'bg-orange-600 hover:bg-orange-700 text-white cursor-pointer' 
                                        : 'bg-gray-200 text-gray-400 cursor-not-allowed opacity-60'
                                    }`}
                                    title="Cambiar de instancia y reanudar el envío"
                                  >
                                    <RefreshCw size={11} className={fetchingLotes ? "animate-spin" : ""} />
                                    Cambiar e Iniciar
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        {loteDetail.estado === 'completado' && (
                          <button
                            onClick={() => handleMarkReviewedLote(loteDetail.id)}
                            className="flex items-center gap-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer"
                            title="Marcar lote como revisado"
                          >
                            <CheckCheck size={13} />
                            Marcar como Revisado
                          </button>
                        )}
                        {(loteDetail.estado === 'completado' || loteDetail.estado === 'fallido') && loteDetail.fallidos > 0 && (() => {
                          const currentCuenta = cuentas.find(c => c.cuenta_id === loteDetail.cuenta_id) || loteDetail.cuenta;
                          const isCuentaActiva = currentCuenta?.estado === 'Conectado';
                          return (
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                                isCuentaActiva 
                                  ? 'bg-green-50 text-green-700 border-green-200' 
                                  : 'bg-red-50 text-red-700 border-red-200'
                              }`} title={`La instancia está ${currentCuenta?.estado || 'Desconectada'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${isCuentaActiva ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
                                {currentCuenta?.estado || 'Desconectado'}
                              </span>
                              <button
                                onClick={() => isCuentaActiva && handleRetryFailedLote(loteDetail.id)}
                                disabled={!isCuentaActiva}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${
                                  isCuentaActiva 
                                    ? 'bg-red-100 hover:bg-red-200 text-red-700 cursor-pointer' 
                                    : 'bg-gray-100 text-gray-400 cursor-not-allowed opacity-60'
                                }`}
                                title={isCuentaActiva ? "Reintentar enviar únicamente los mensajes fallidos" : "No se puede reintentar: la instancia está desconectada"}
                              >
                                <RefreshCw size={12} />
                                Reintentar Fallidos
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Recipients List Table */}
                  <div className="flex-1 overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-gray-50/80 border-b border-gray-100 text-gray-500 font-bold">
                          <th className="p-3">Destinatario</th>
                          <th className="p-3">Variable</th>
                          <th className="p-3">Mensaje Personalizado</th>
                          <th className="p-3">Estado</th>
                          <th className="p-3">Fecha/Error</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {loteDetail.destinatarios.map(d => (
                          <tr key={d.id} className="hover:bg-gray-50/50">
                            <td className="p-3 font-semibold text-gray-800">+{d.numero}</td>
                            <td className="p-3 text-gray-600 max-w-[100px] truncate">{d.variable || <span className="text-gray-300 italic">-</span>}</td>
                            <td className="p-3 text-gray-500 max-w-[200px] truncate" title={d.mensaje_personalizado}>
                              {d.mensaje_personalizado}
                            </td>
                            <td className="p-3">
                              {d.estado === 'PENDING' ? (
                                <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100 text-[10px] font-bold flex items-center gap-1 w-fit animate-pulse">
                                  <Clock size={10} /> En Cola (Evo)
                                </span>
                              ) : d.estado === 'SERVER_ACK' ? (
                                <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100 text-[10px] font-bold flex items-center gap-1 w-fit">
                                  <Check size={10} /> Recibido Servidor
                                </span>
                              ) : d.estado === 'DELIVERY_ACK' ? (
                                <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-100 text-[10px] font-bold flex items-center gap-1 w-fit">
                                  <CheckCheck size={10} /> Entregado
                                </span>
                              ) : d.estado === 'READ' ? (
                                <span className="px-2 py-0.5 rounded bg-sky-100 text-sky-600 border border-sky-200 text-[10px] font-bold flex items-center gap-1 w-fit">
                                  <CheckCheck size={10} className="text-sky-600" /> Leído
                                </span>
                              ) : d.estado === 'enviado' ? (
                                <span className="px-2 py-0.5 rounded bg-green-50 text-green-600 border border-green-100 text-[10px] font-bold flex items-center gap-1 w-fit">
                                  <CheckCircle2 size={10} /> Enviado
                                </span>
                              ) : d.estado === 'fallido' || d.estado === 'ERROR' || d.estado === 'FAILED' ? (
                                <span className="px-2 py-0.5 rounded bg-red-50 text-red-600 border border-red-100 text-[10px] font-bold flex items-center gap-1 w-fit">
                                  <XCircle size={10} /> Fallido
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded bg-yellow-50 text-yellow-600 border border-yellow-100 text-[10px] font-bold flex items-center gap-1 w-fit">
                                  <Clock size={10} /> Pendiente
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-[11px] max-w-[150px] truncate">
                              {(d.estado === 'enviado' || d.estado === 'PENDING' || d.estado === 'SERVER_ACK' || d.estado === 'DELIVERY_ACK' || d.estado === 'READ') && d.fecha_envio ? (
                                <span className="text-gray-500">
                                  {new Date(d.fecha_envio).toLocaleString()}
                                </span>
                              ) : (d.estado === 'fallido' || d.estado === 'ERROR' || d.estado === 'FAILED') && d.error ? (
                                <span className="text-red-500 font-medium cursor-help" title={getFriendlyError(d.error)}>
                                  {getFriendlyError(d.error)}
                                </span>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8">
                  <Eye size={36} className="text-gray-300 mb-2" />
                  <span className="text-xs font-medium text-gray-500">Selecciona un lote del historial para ver el detalle del progreso</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
