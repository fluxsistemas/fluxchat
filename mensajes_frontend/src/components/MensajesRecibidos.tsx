import { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Menu, 
  FileSpreadsheet, 
  Search, 
  Loader2, 
  Calendar, 
  Download, 
  MessageSquare, 
  Phone, 
  Smartphone,
  ChevronLeft,
  ChevronRight,
  Filter,
  X,
  Clock,
  User
} from 'lucide-react';

interface MensajesRecibidosProps {
  onOpenSidebar: () => void;
}

interface CuentaActiva {
  cuenta_id: string;
  nombre_cuenta: string;
  numero_cuenta: string;
  estado?: string;
  nombre_interno?: string;
}

interface MensajeRecibido {
  fecha_hora: string;
  mensaje: string;
  instancia_nombre_interno: string | null;
  instancia_numero: string | null;
  instancia_nombre: string;
  contacto_numero: string;
}

export default function MensajesRecibidos({ onOpenSidebar }: MensajesRecibidosProps) {
  // Obtener fechas por defecto (hoy)
  const getTodayString = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Filtros
  const [fechaDesde, setFechaDesde] = useState(getTodayString());
  const [fechaHasta, setFechaHasta] = useState(getTodayString());
  const [instanciaSeleccionada, setInstanciaSeleccionada] = useState('');
  
  // Listas
  const [mensajes, setMensajes] = useState<MensajeRecibido[]>([]);
  const [cuentas, setCuentas] = useState<CuentaActiva[]>([]);
  
  // Estados UI
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Paginación
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  // Estados Modal de Contexto / Conversación
  const [selectedMsgContext, setSelectedMsgContext] = useState<MensajeRecibido | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [contextMessages, setContextMessages] = useState<any[]>([]);
  const [loadingContext, setLoadingContext] = useState(false);
  const [contextError, setContextError] = useState('');

  // Cargar cuentas / instancias al montar
  useEffect(() => {
    fetchCuentas();
    fetchMensajes();
  }, []);

  const fetchContextMessages = async (msg: MensajeRecibido) => {
    setLoadingContext(true);
    setContextError('');
    setContextMessages([]);
    try {
      // Extraemos la fecha en formato YYYY-MM-DD
      const fechaMsg = msg.fecha_hora.split('T')[0];
      
      const response = await axios.get('/api/mensajes/contexto', {
        params: {
          contacto_numero: msg.contacto_numero,
          instancia_nombre: msg.instancia_nombre,
          fecha: fechaMsg
        }
      });
      setContextMessages(response.data);
    } catch (err: any) {
      console.error("Error al cargar mensajes de contexto:", err);
      setContextError(err.response?.data?.detail || 'Error al cargar la conversación de este día');
    } finally {
      setLoadingContext(false);
    }
  };

  const handleOpenContext = (msg: MensajeRecibido) => {
    setSelectedMsgContext(msg);
    setModalOpen(true);
    fetchContextMessages(msg);
  };

  const fetchCuentas = async () => {
    try {
      const response = await axios.get('/api/cuentas/');
      setCuentas(response.data);
    } catch (err) {
      console.error("Error al cargar instancias:", err);
    }
  };

  const fetchMensajes = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const response = await axios.get('/api/mensajes/recibidos', {
        params: {
          fecha_desde: fechaDesde,
          fecha_hasta: fechaHasta,
          id_canal: instanciaSeleccionada || undefined
        }
      });
      setMensajes(response.data);
      setCurrentPage(1); // Reiniciar paginación al filtrar
    } catch (err: any) {
      console.error("Error al cargar mensajes recibidos:", err);
      setErrorMsg(err.response?.data?.detail || 'Error al cargar los mensajes recibidos');
    } finally {
      setLoading(false);
    }
  };

  // Formatear fecha y hora para Paraguay (Asunción)
  const formatFechaHora = (isoString: string) => {
    if (!isoString) return '-';
    try {
      const date = new Date(isoString);
      return date.toLocaleString('es-PY', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch (e) {
      return isoString;
    }
  };

  // Filtrar localmente por búsqueda de texto (número o mensaje o instancia)
  const filteredMensajes = mensajes.filter(m => {
    const term = searchTerm.toLowerCase();
    const matchesNumber = m.contacto_numero?.toLowerCase().includes(term);
    const matchesMessage = m.mensaje?.toLowerCase().includes(term);
    const matchesInstanciaInterno = m.instancia_nombre_interno?.toLowerCase().includes(term);
    const matchesInstanciaNumero = m.instancia_numero?.toLowerCase().includes(term);
    const matchesInstanciaNombre = m.instancia_nombre?.toLowerCase().includes(term);
    return matchesNumber || matchesMessage || matchesInstanciaInterno || matchesInstanciaNumero || matchesInstanciaNombre;
  });

  // Cálculos de paginación
  const totalItems = filteredMensajes.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredMensajes.slice(indexOfFirstItem, indexOfLastItem);

  const handlePageChange = (pageNumber: number) => {
    if (pageNumber >= 1 && pageNumber <= totalPages) {
      setCurrentPage(pageNumber);
    }
  };

  // Exportar a CSV en el cliente
  const exportToCSV = () => {
    if (filteredMensajes.length === 0) return;
    
    // Encabezados
    const headers = ['Fecha y Hora', 'Nombre Instancia', 'Numero Instancia', 'Numero del Contacto', 'Mensaje'];
    
    // Filas
    const rows = filteredMensajes.map(m => {
      const cleanMessage = m.mensaje 
        ? m.mensaje.replace(/"/g, '""').replace(/\n/g, ' ') 
        : '';
      return [
        formatFechaHora(m.fecha_hora),
        m.instancia_nombre_interno || m.instancia_nombre || '',
        m.instancia_numero || '',
        m.contacto_numero || '',
        `"${cleanMessage}"`
      ];
    });
    
    const csvContent = [
      headers.join(','),
      ...rows.map(e => e.join(','))
    ].join('\n');
    
    // Crear el blob con BOM UTF-8 para que Excel lo interprete correctamente
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `mensajes_recibidos_${fechaDesde}_al_${fechaHasta}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden bg-gray-50 dark:bg-zinc-950 text-gray-900 dark:text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between p-4 bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800 shadow-sm z-10">
        <div className="flex items-center space-x-3">
          <button 
            onClick={onOpenSidebar}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition md:hidden"
            title="Abrir menú"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center space-x-2">
            <MessageSquare className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            <h1 className="text-xl font-bold tracking-tight">Mensajes Recibidos</h1>
          </div>
        </div>
      </header>

      {/* Contenido Principal con scroll */}
      <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {/* Panel de Filtros */}
        <section className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-sm space-y-4">
          <div className="flex items-center space-x-2 pb-2 border-b border-gray-100 dark:border-zinc-800">
            <Filter className="w-5 h-5 text-indigo-500" />
            <h2 className="text-base font-semibold">Filtros de búsqueda</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Fecha Desde */}
            <div className="flex flex-col space-y-1">
              <label className="text-xs font-medium text-gray-500 dark:text-zinc-400 flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Fecha Desde
              </label>
              <input
                type="date"
                value={fechaDesde}
                onChange={(e) => setFechaDesde(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-zinc-100"
              />
            </div>

            {/* Fecha Hasta */}
            <div className="flex flex-col space-y-1">
              <label className="text-xs font-medium text-gray-500 dark:text-zinc-400 flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Fecha Hasta
              </label>
              <input
                type="date"
                value={fechaHasta}
                onChange={(e) => setFechaHasta(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-zinc-100"
              />
            </div>

            {/* Instancia */}
            <div className="flex flex-col space-y-1">
              <label className="text-xs font-medium text-gray-500 dark:text-zinc-400 flex items-center gap-1">
                <Smartphone className="w-3 h-3" /> Instancia
              </label>
              <select
                value={instanciaSeleccionada}
                onChange={(e) => setInstanciaSeleccionada(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-zinc-100"
              >
                <option value="">Todas las instancias</option>
                {cuentas.map((c) => (
                  <option key={c.cuenta_id} value={c.cuenta_id}>
                    {c.nombre_cuenta} {c.nombre_interno ? `(${c.nombre_interno})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Botones de acción */}
            <div className="flex items-end space-x-2">
              <button
                onClick={fetchMensajes}
                disabled={loading}
                className="flex-1 md:flex-initial px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-sm transition flex items-center justify-center gap-2"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                Buscar
              </button>

              <button
                onClick={exportToCSV}
                disabled={loading || filteredMensajes.length === 0}
                className="flex-1 md:flex-initial px-4 py-2 text-sm font-medium text-gray-700 dark:text-zinc-200 bg-white dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-750 disabled:opacity-50 rounded-lg shadow-sm transition flex items-center justify-center gap-2"
                title="Exportar a CSV"
              >
                <FileSpreadsheet className="w-4 h-4 text-green-600 dark:text-green-500" />
                Exportar CSV
              </button>
            </div>
          </div>
        </section>

        {/* Buscador Local e Información */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por número, mensaje o instancia..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 w-full text-sm bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm dark:text-zinc-100"
            />
          </div>
          <div className="text-sm text-gray-500 dark:text-zinc-400 font-medium">
            Total encontrados: <span className="text-indigo-600 dark:text-indigo-400 font-bold">{totalItems}</span>
          </div>
        </div>

        {/* Mensajes de error */}
        {errorMsg && (
          <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400 rounded-xl flex items-start gap-2">
            <span className="font-medium">Error:</span> {errorMsg}
          </div>
        )}

        {/* Listado / Tabla */}
        <section className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-3">
              <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
              <p className="text-sm text-gray-500 dark:text-zinc-400">Cargando mensajes recibidos...</p>
            </div>
          ) : currentItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500 dark:text-zinc-400 space-y-3">
              <MessageSquare className="w-12 h-12 text-gray-300 dark:text-zinc-700" />
              <div className="text-center">
                <p className="font-semibold text-base">No se encontraron mensajes</p>
                <p className="text-sm">Probá cambiando el rango de fechas o los filtros.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Vista Desktop (Tabla) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-zinc-800/50 border-b border-gray-200 dark:border-zinc-800">
                      <th className="p-4 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-400 w-1/6">Fecha y Hora</th>
                      <th className="p-4 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-400 w-1/5">Nombre Instancia</th>
                      <th className="p-4 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-400 w-1/6">Número Instancia</th>
                      <th className="p-4 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-400 w-1/6 flex items-center gap-1">
                        <Phone className="w-3.5 h-3.5" /> Contacto
                      </th>
                      <th className="p-4 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-400 w-2/6">Mensaje</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                    {currentItems.map((m, idx) => (
                      <tr 
                        key={idx} 
                        onClick={() => handleOpenContext(m)}
                        className="cursor-pointer hover:bg-indigo-50/20 dark:hover:bg-zinc-800/40 transition even:bg-gray-50/10 dark:even:bg-zinc-800/5"
                        title="Hacé click para ver la conversación de este día"
                      >
                        <td className="p-4 text-sm font-medium whitespace-nowrap text-gray-600 dark:text-zinc-300">
                          {formatFechaHora(m.fecha_hora)}
                        </td>
                        <td className="p-4 text-sm font-semibold whitespace-nowrap text-indigo-600 dark:text-indigo-400">
                          {m.instancia_nombre_interno || m.instancia_nombre}
                        </td>
                        <td className="p-4 text-sm text-gray-500 dark:text-zinc-400 whitespace-nowrap font-medium">
                          {m.instancia_numero || '-'}
                        </td>
                        <td className="p-4 text-sm font-semibold whitespace-nowrap text-gray-700 dark:text-zinc-200">
                          {m.contacto_numero}
                        </td>
                        <td className="p-4 text-sm text-gray-600 dark:text-zinc-300 break-words whitespace-pre-wrap max-w-xs md:max-w-md lg:max-w-xl">
                          {m.mensaje || <span className="italic text-gray-400">Mensaje vacío o multimedia</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Vista Móvil (Cards) */}
              <div className="md:hidden divide-y divide-gray-100 dark:divide-zinc-800">
                {currentItems.map((m, idx) => (
                  <div 
                    key={idx} 
                    onClick={() => handleOpenContext(m)}
                    className="p-4 space-y-3 cursor-pointer hover:bg-indigo-50/10 dark:hover:bg-zinc-800/10 transition"
                    title="Hacé click para ver la conversación de este día"
                  >
                    <div className="flex justify-between items-start">
                      <span className="text-xs text-gray-400 dark:text-zinc-500">
                        {formatFechaHora(m.fecha_hora)}
                      </span>
                      <div className="flex flex-col items-end gap-1">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400">
                          {m.instancia_nombre_interno || m.instancia_nombre}
                        </span>
                        {m.instancia_numero && (
                          <span className="text-[10px] text-gray-400 dark:text-zinc-500 font-medium">
                            {m.instancia_numero}
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-400 dark:text-zinc-500 flex items-center gap-1 mb-0.5">
                        <Phone className="w-3 h-3" /> Número de Contacto
                      </div>
                      <div className="text-sm font-bold text-gray-800 dark:text-zinc-200">
                        {m.contacto_numero}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-400 dark:text-zinc-500 mb-0.5">
                        Mensaje
                      </div>
                      <div className="text-sm text-gray-600 dark:text-zinc-300 break-words whitespace-pre-wrap bg-gray-50 dark:bg-zinc-800/30 p-2.5 rounded-lg border border-gray-100 dark:border-zinc-800/50">
                        {m.mensaje || <span className="italic text-gray-400">Mensaje vacío o multimedia</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Barra de Paginación */}
              <div className="p-4 bg-gray-50 dark:bg-zinc-800/30 border-t border-gray-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                {/* Registros por página */}
                <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-zinc-400">
                  <span>Mostrar</span>
                  <select
                    value={itemsPerPage}
                    onChange={(e) => {
                      setItemsPerPage(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="px-2 py-1 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                  <span>mensajes por página</span>
                </div>

                {/* Info y Controles */}
                <div className="flex items-center justify-between sm:justify-end gap-4">
                  <span className="text-sm text-gray-500 dark:text-zinc-400">
                    Mostrando {indexOfFirstItem + 1} - {Math.min(indexOfLastItem, totalItems)} de {totalItems}
                  </span>
                  
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="p-1.5 rounded bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 text-gray-500 hover:bg-gray-50 dark:hover:bg-zinc-800 disabled:opacity-50"
                      title="Página anterior"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      // Mostrar páginas lógicas centradas en currentPage
                      let pageNum = currentPage;
                      if (currentPage <= 3) {
                        pageNum = i + 1;
                      } else if (currentPage >= totalPages - 2) {
                        pageNum = totalPages - 4 + i;
                      } else {
                        pageNum = currentPage - 2 + i;
                      }
                      
                      // Ajuste por si totalPages < 5
                      if (pageNum > totalPages || pageNum < 1) return null;

                      return (
                        <button
                          key={pageNum}
                          onClick={() => handlePageChange(pageNum)}
                          className={`px-3 py-1 text-sm font-medium rounded transition ${
                            currentPage === pageNum
                              ? 'bg-indigo-600 text-white'
                              : 'bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 hover:bg-gray-50'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}

                    <button
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="p-1.5 rounded bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 text-gray-500 hover:bg-gray-50 dark:hover:bg-zinc-800 disabled:opacity-50"
                      title="Siguiente página"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </main>

      {/* Modal de Conversación (Contexto del Día) */}
      {modalOpen && selectedMsgContext && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-2xl h-[85vh] flex flex-col shadow-2xl overflow-hidden border border-gray-150 dark:border-zinc-800 animate-in fade-in zoom-in-95 duration-200">
            {/* Cabecera del Modal */}
            <div className="p-4 bg-gray-50 dark:bg-zinc-850 border-b border-gray-200 dark:border-zinc-800 flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-3">
                <div className="bg-indigo-100 dark:bg-indigo-950/50 p-2 rounded-xl text-indigo-600 dark:text-indigo-400">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-zinc-100 flex items-center gap-2">
                    {contextMessages[0]?.contacto_pushname || 'Contacto'} 
                    <span className="text-sm text-gray-500 dark:text-zinc-400 font-normal">({selectedMsgContext.contacto_numero})</span>
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-zinc-400">
                    Instancia: <span className="font-semibold text-indigo-600 dark:text-indigo-400">{selectedMsgContext.instancia_nombre_interno || selectedMsgContext.instancia_nombre}</span>
                  </p>
                </div>
              </div>
              
              <button 
                onClick={() => { setModalOpen(false); setSelectedMsgContext(null); }}
                className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-zinc-800 text-gray-500 hover:text-gray-800 dark:hover:text-zinc-200 transition"
                title="Cerrar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Fecha del día en el modal */}
            <div className="bg-indigo-50/50 dark:bg-zinc-800/40 px-6 py-2 border-b border-gray-200/50 dark:border-zinc-800 flex items-center gap-2 text-xs font-semibold text-indigo-800 dark:text-indigo-300 shrink-0">
              <Calendar className="w-4 h-4" />
              Conversación del día: {new Date(selectedMsgContext.fecha_hora).toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric' })}
            </div>

            {/* Cuerpo del Chat */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 bg-gray-50 dark:bg-zinc-950/40">
              {loadingContext ? (
                <div className="flex flex-col items-center justify-center h-full space-y-3">
                  <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                  <p className="text-sm text-gray-500 dark:text-zinc-400">Cargando historial del día...</p>
                </div>
              ) : contextError ? (
                <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400 rounded-xl">
                  {contextError}
                </div>
              ) : contextMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-zinc-400 space-y-2">
                  <MessageSquare className="w-10 h-10 text-gray-300 dark:text-zinc-800" />
                  <p className="text-sm">No se encontraron mensajes en esta fecha.</p>
                </div>
              ) : (
                <div className="flex flex-col space-y-3.5">
                  {contextMessages.map((msg, index) => {
                    const isIncoming = msg.tipo === 'IN';
                    const timeString = new Date(msg.fecha_hora).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
                    
                    return (
                      <div 
                        key={msg.id || index}
                        className={`flex flex-col max-w-[80%] ${isIncoming ? 'self-start' : 'self-end'}`}
                      >
                        {/* Mensaje globo */}
                        <div 
                          className={`p-3 rounded-2xl shadow-sm border ${
                            isIncoming 
                              ? 'bg-white dark:bg-zinc-900 border-gray-100 dark:border-zinc-800 text-gray-900 dark:text-zinc-100 rounded-tl-none' 
                              : 'bg-indigo-600 text-white border-transparent rounded-tr-none'
                          }`}
                        >
                          {/* Contenido multimedia (si existe) */}
                          {msg.media_url && (
                            <div className="mb-2 max-w-xs rounded-lg overflow-hidden border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5">
                              {msg.mimetype?.startsWith('image/') ? (
                                <img 
                                  src={msg.media_url} 
                                  alt="Media" 
                                  className="w-full object-cover max-h-48 hover:scale-105 transition duration-200 cursor-pointer"
                                  onClick={() => window.open(msg.media_url, '_blank')}
                                />
                              ) : msg.mimetype?.startsWith('video/') ? (
                                <video src={msg.media_url} controls className="w-full max-h-48" />
                              ) : (
                                <a 
                                  href={msg.media_url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="p-3 flex items-center gap-2 text-xs hover:underline"
                                >
                                  <Download className="w-4 h-4 shrink-0" />
                                  Descargar archivo
                                </a>
                              )}
                            </div>
                          )}
                          
                          {/* Texto de mensaje */}
                          {msg.mensaje && (
                            <p className="text-[14px] leading-relaxed whitespace-pre-wrap break-words">
                              {msg.mensaje}
                            </p>
                          )}
                        </div>

                        {/* Hora del mensaje */}
                        <span className={`text-[10px] mt-1 px-1 flex items-center gap-1 text-gray-400 dark:text-zinc-500 ${isIncoming ? 'self-start' : 'self-end'}`}>
                          <Clock className="w-2.5 h-2.5" />
                          {timeString}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pie de página del Modal */}
            <div className="p-4 bg-gray-50 dark:bg-zinc-850 border-t border-gray-200 dark:border-zinc-800 flex justify-end shrink-0">
              <button
                onClick={() => { setModalOpen(false); setSelectedMsgContext(null); }}
                className="px-5 py-2 text-sm font-semibold text-gray-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-750 rounded-xl transition shadow-sm"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
