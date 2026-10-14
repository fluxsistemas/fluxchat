import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Menu, 
  BarChart3, 
  Calendar, 
  Loader2, 
  Send, 
  Inbox, 
  Smartphone,
  AlertCircle,
  TrendingUp,
  RefreshCw,
  Users,
  ArrowUpDown,
  Download
} from 'lucide-react';

interface ReportesProps {
  onOpenSidebar: () => void;
}

interface DetalleInstancia {
  cuenta_id: string;
  nombre_cuenta: string;
  nombre_interno: string | null;
  numero_cuenta: string;
  enviados_lotes: number;
  recibidos: number;
  contactos_enviados?: number;
  contactos_recibidos?: number;
}

interface ReporteConsolidado {
  total_enviados_lotes: number;
  total_recibidos: number;
  total_contactos_enviados?: number;
  total_contactos_recibidos?: number;
  detalles: DetalleInstancia[];
}

export default function Reportes({ onOpenSidebar }: ReportesProps) {
  // Fechas por defecto (desde hace 7 días hasta hoy)
  const getTodayString = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const [fechaDesde, setFechaDesde] = useState(getTodayString());
  const [fechaHasta, setFechaHasta] = useState(getTodayString());
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [data, setData] = useState<ReporteConsolidado | null>(null);

  const [sortConfig, setSortConfig] = useState<{ key: 'enviados_lotes' | 'recibidos' | 'total_transacciones' | null; direction: 'asc' | 'desc' }>({ key: null, direction: 'asc' });

  const handleSort = (key: 'enviados_lotes' | 'recibidos' | 'total_transacciones') => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortedDetalles = () => {
    if (!data) return [];
    const items = [...data.detalles];
    if (!sortConfig.key) return items;

    return items.sort((a, b) => {
      let valA = 0;
      let valB = 0;

      if (sortConfig.key === 'enviados_lotes') {
        valA = a.enviados_lotes;
        valB = b.enviados_lotes;
      } else if (sortConfig.key === 'recibidos') {
        valA = a.recibidos;
        valB = b.recibidos;
      } else if (sortConfig.key === 'total_transacciones') {
        valA = a.enviados_lotes + a.recibidos;
        valB = b.enviados_lotes + b.recibidos;
      }

      if (valA < valB) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (valA > valB) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
  };

  const exportToCSV = () => {
    if (!data || data.detalles.length === 0) return;

    // Headers para el CSV
    const headers = [
      "Instancia",
      "Número de Cuenta",
      "Mensajes Enviados (Lotes)",
      "Contactos Destinatarios",
      "Mensajes Recibidos",
      "Contactos Remitentes",
      "Total Transacciones"
    ];

    // Filas de datos
    const rows = data.detalles.map((inst: DetalleInstancia) => [
      `"${inst.nombre_interno || inst.nombre_cuenta}"`,
      `"+${inst.numero_cuenta}"`,
      inst.enviados_lotes,
      inst.contactos_enviados || 0,
      inst.recibidos,
      inst.contactos_recibidos || 0,
      inst.enviados_lotes + inst.recibidos
    ]);

    // Combinar en string con BOM para UTF-8 (soporte Excel tildes y ñ)
    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((e: (string | number)[]) => e.join(","))].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `reporte_consolidado_${fechaDesde}_al_${fechaHasta}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const fetchReporte = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const response = await axios.get('/api/reportes/consolidado', {
        params: {
          fecha_desde: fechaDesde,
          fecha_hasta: fechaHasta
        }
      });
      setData(response.data);
    } catch (err: any) {
      console.error("Error al cargar reporte consolidado:", err);
      setErrorMsg(err.response?.data?.detail || 'No se pudo obtener el reporte para el rango seleccionado.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReporte();
  }, []);

  // Encontrar el valor máximo para escalar el gráfico de barras de manera uniforme
  const maxVal = data?.detalles.reduce((max: number, inst: DetalleInstancia) => {
    return Math.max(max, inst.enviados_lotes, inst.recibidos);
  }, 0) || 1;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f4f7f6] relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-white border-b border-gray-200 shadow-sm shrink-0">
        <div className="flex items-center gap-2">
          <button 
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-md lg:hidden"
            onClick={onOpenSidebar}
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <BarChart3 size={24} className="text-blue-600" />
            <h2 className="text-xl font-bold text-gray-800">Reporte de Actividad</h2>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        
        {/* Date Selector and Controls Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex flex-col md:flex-row items-end md:items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto">
              <div className="w-full sm:w-auto">
                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Fecha Desde</label>
                <div className="relative">
                  <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input 
                    type="date" 
                    value={fechaDesde}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFechaDesde(e.target.value)}
                    className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold text-gray-700 w-full"
                  />
                </div>
              </div>

              <div className="w-full sm:w-auto">
                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Fecha Hasta</label>
                <div className="relative">
                  <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input 
                    type="date" 
                    value={fechaHasta}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFechaHasta(e.target.value)}
                    className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold text-gray-700 w-full"
                  />
                </div>
              </div>
            </div>

            <button
              onClick={fetchReporte}
              disabled={loading}
              className="w-full md:w-auto flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-5 py-2.5 rounded-xl shadow-md shadow-blue-500/10 hover:shadow-blue-500/25 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Consultando...
                </>
              ) : (
                <>
                  <RefreshCw size={15} />
                  Consultar Reporte
                </>
              )}
            </button>
          </div>

          {errorMsg && (
            <div className="mt-4 bg-red-50 text-red-700 p-3.5 rounded-xl border border-red-100 flex items-center gap-2.5 text-sm font-semibold">
              <AlertCircle size={18} />
              {errorMsg}
            </div>
          )}
        </div>

        {data && (
          <>
            {/* Total Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              
              {/* Card Enviados */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex items-center justify-between relative overflow-hidden transition-all hover:translate-y-[-2px] hover:shadow-md">
                <div className="space-y-1.5 z-10">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Mensajes Enviados por Lotes</span>
                  <h3 className="text-3xl font-extrabold text-green-600 tracking-tight">{data.total_enviados_lotes.toLocaleString('es-PY')}</h3>
                  <div className="flex items-center gap-1 text-[11px] font-bold text-green-500 bg-green-50 px-2 py-0.5 rounded-full w-fit">
                    <TrendingUp size={12} />
                    <span>Lotes Masivos</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-2.5 pt-1 border-t border-gray-100/80 text-xs font-semibold text-gray-500">
                    <Users size={14} className="text-green-600" />
                    <span>Contactos destinatarios: <strong className="text-green-600 font-bold">{(data.total_contactos_enviados ?? 0).toLocaleString('es-PY')}</strong></span>
                  </div>
                </div>
                <div className="p-4 bg-green-50 rounded-2xl text-green-500 shrink-0">
                  <Send size={24} strokeWidth={1.75} />
                </div>
                <div className="absolute -right-6 -bottom-6 w-24 h-24 bg-green-50/20 rounded-full blur-xl pointer-events-none" />
              </div>

              {/* Card Recibidos */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex items-center justify-between relative overflow-hidden transition-all hover:translate-y-[-2px] hover:shadow-md">
                <div className="space-y-1.5 z-10">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Mensajes Recibidos</span>
                  <h3 className="text-3xl font-extrabold text-blue-600 tracking-tight">{data.total_recibidos.toLocaleString('es-PY')}</h3>
                  <div className="flex items-center gap-1 text-[11px] font-bold text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full w-fit">
                    <Inbox size={12} />
                    <span>Respuestas Recibidas</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-2.5 pt-1 border-t border-gray-100/80 text-xs font-semibold text-gray-500">
                    <Users size={14} className="text-blue-600" />
                    <span>Contactos remitentes: <strong className="text-blue-700 font-bold">{(data.total_contactos_recibidos ?? 0).toLocaleString('es-PY')}</strong></span>
                  </div>
                </div>
                <div className="p-4 bg-blue-50 rounded-2xl text-blue-500 shrink-0">
                  <Inbox size={24} strokeWidth={1.75} />
                </div>
                <div className="absolute -right-6 -bottom-6 w-24 h-24 bg-blue-50/20 rounded-full blur-xl pointer-events-none" />
              </div>

            </div>

            {/* Grafico de Barras */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 md:p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-gray-100 pb-4 mb-6 gap-3">
                <div>
                  <h3 className="text-base font-bold text-gray-800">Gráfico de Comparativa de Mensajes</h3>
                  <p className="text-xs text-gray-400 font-medium">Visualización de actividad consolidada por instancia de WhatsApp</p>
                </div>
                <div className="flex items-center gap-4 text-xs font-bold self-end sm:self-auto">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded bg-green-500 block"></span>
                    <span className="text-gray-600">Enviados por Lotes</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded bg-blue-500 block"></span>
                    <span className="text-gray-600">Recibidos</span>
                  </div>
                </div>
              </div>

              {/* Contenedor de barras */}
              {data.detalles.length === 0 ? (
                <div className="text-center py-12 text-gray-400 font-medium text-sm">
                  No se registraron datos en ninguna instancia para este rango de fechas.
                </div>
              ) : (
                <div className="space-y-6 pt-2">
                  {data.detalles.map(inst => {
                    const pctEnviados = (inst.enviados_lotes / maxVal) * 100;
                    const pctRecibidos = (inst.recibidos / maxVal) * 100;
                    
                    return (
                      <div key={inst.cuenta_id} className="grid grid-cols-1 md:grid-cols-4 items-center gap-2 md:gap-4 group">
                        
                        {/* Nombre de la Instancia */}
                        <div className="md:col-span-1 pr-2">
                          <span className="text-sm font-bold text-gray-700 block truncate" title={inst.nombre_interno || inst.nombre_cuenta}>
                            {inst.nombre_interno || inst.nombre_cuenta}
                          </span>
                          <span className="text-[11px] font-semibold text-gray-400 flex items-center gap-1 mt-0.5">
                            <Smartphone size={10} /> +{inst.numero_cuenta}
                          </span>
                        </div>

                        {/* Barras de comparación */}
                        <div className="md:col-span-3 space-y-2 relative bg-gray-50/50 p-2 rounded-xl border border-gray-100">
                          
                          {/* Barra Enviados (Verde) */}
                          <div className="flex items-center gap-3">
                            <div className="flex-1 bg-gray-100 h-5 rounded-md overflow-hidden relative shadow-inner">
                              <div 
                                className="bg-gradient-to-r from-green-400 to-green-500 h-full rounded-md transition-all duration-700 ease-out"
                                style={{ width: `${Math.max(pctEnviados, inst.enviados_lotes > 0 ? 3 : 0)}%` }}
                              />
                            </div>
                            <span className="text-xs font-bold text-green-600 w-12 text-right">
                              {inst.enviados_lotes.toLocaleString('es-PY')}
                            </span>
                          </div>

                          {/* Barra Recibidos (Azul) */}
                          <div className="flex items-center gap-3">
                            <div className="flex-1 bg-gray-100 h-5 rounded-md overflow-hidden relative shadow-inner">
                              <div 
                                className="bg-gradient-to-r from-blue-400 to-blue-500 h-full rounded-md transition-all duration-700 ease-out"
                                style={{ width: `${Math.max(pctRecibidos, inst.recibidos > 0 ? 3 : 0)}%` }}
                              />
                            </div>
                            <span className="text-xs font-bold text-blue-600 w-12 text-right">
                              {inst.recibidos.toLocaleString('es-PY')}
                            </span>
                          </div>

                        </div>

                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Tabla de Detalle */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-5 md:p-6 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold text-gray-800">Detalles de Actividad por Instancia</h3>
                  <p className="text-xs text-gray-400 font-medium">Tabla analítica de envíos y respuestas</p>
                </div>
                <button
                  onClick={exportToCSV}
                  className="flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs px-4 py-2.5 rounded-xl transition-all cursor-pointer border border-gray-200 self-start sm:self-auto"
                >
                  <Download size={14} />
                  Exportar a CSV
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Instancia</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Número de Cuenta</th>
                      <th 
                        onClick={() => handleSort('enviados_lotes')}
                        className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right cursor-pointer select-none hover:text-gray-600 transition-colors"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>Mensajes Enviados (Lotes)</span>
                          <ArrowUpDown size={12} className={sortConfig.key === 'enviados_lotes' ? 'text-blue-500' : 'text-gray-300'} />
                        </div>
                      </th>
                      <th 
                        onClick={() => handleSort('recibidos')}
                        className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right cursor-pointer select-none hover:text-gray-600 transition-colors"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>Mensajes Recibidos</span>
                          <ArrowUpDown size={12} className={sortConfig.key === 'recibidos' ? 'text-blue-500' : 'text-gray-300'} />
                        </div>
                      </th>
                      <th 
                        onClick={() => handleSort('total_transacciones')}
                        className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right cursor-pointer select-none hover:text-gray-600 transition-colors"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>Total Transacciones</span>
                          <ArrowUpDown size={12} className={sortConfig.key === 'total_transacciones' ? 'text-blue-500' : 'text-gray-300'} />
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {getSortedDetalles().length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-400 font-medium">
                          No se registraron datos en ninguna instancia para este rango de fechas.
                        </td>
                      </tr>
                    ) : (
                      getSortedDetalles().map(inst => (
                        <tr key={inst.cuenta_id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-6 py-4">
                            <span className="text-sm font-bold text-gray-800">
                              {inst.nombre_interno || inst.nombre_cuenta}
                            </span>
                            {inst.nombre_interno && (
                              <span className="text-xs font-medium text-gray-400 block">
                                {inst.nombre_cuenta}
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm font-semibold text-gray-500">
                            +{inst.numero_cuenta}
                          </td>
                          <td className="px-6 py-4 text-sm text-right">
                            <span className="font-bold text-green-600 block">
                              {inst.enviados_lotes.toLocaleString('es-PY')}
                            </span>
                            <span className="text-[10px] font-semibold text-gray-400 block mt-0.5">
                              {(inst.contactos_enviados ?? 0).toLocaleString('es-PY')} contactos
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-right">
                            <span className="font-bold text-blue-600 block">
                              {inst.recibidos.toLocaleString('es-PY')}
                            </span>
                            <span className="text-[10px] font-semibold text-gray-400 block mt-0.5">
                              {(inst.contactos_recibidos ?? 0).toLocaleString('es-PY')} contactos
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm font-extrabold text-gray-800 text-right">
                            {(inst.enviados_lotes + inst.recibidos).toLocaleString('es-PY')}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
