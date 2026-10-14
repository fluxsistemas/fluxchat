import { useState, useEffect, ChangeEvent } from 'react';
import axios from 'axios';
import { Menu, Search } from 'lucide-react';
import { Conversacion } from '../types';

interface ConversationsListProps {
  selectedConversacion: Conversacion | null;
  onSelectConversacion: (conv: Conversacion) => void;
  onOpenSidebar: () => void;
  refreshTrigger?: number;
}

export default function ConversationsList({ selectedConversacion, onSelectConversacion, onOpenSidebar, refreshTrigger }: ConversationsListProps) {
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [loading, setLoading] = useState(false);

  const [instances, setInstances] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string>('');
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');

  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const [instancesRes, groupsRes] = await Promise.all([
          axios.get('/api/cuentas/'),
          axios.get('/api/grupos-atencion/')
        ]);
        setInstances(instancesRes.data);
        setGroups(groupsRes.data);
      } catch (error) {
        console.error("Error fetching filters for conversations:", error);
      }
    };
    fetchFilters();
  }, []);

  useEffect(() => {
    const fetchConversaciones = async () => {
      try {
        const params: any = {};
        if (selectedInstance) {
          params.id_canal = selectedInstance;
        }
        if (selectedGroup) {
          params.id_grupo_atencion = selectedGroup;
        }
        const response = await axios.get('/api/conversaciones/', { params });
        setConversaciones(response.data);
      } catch (error) {
        console.error("Error fetching conversaciones:", error);
      }
    };

    setLoading(true);
    fetchConversaciones().finally(() => setLoading(false));

    const intervalId = setInterval(fetchConversaciones, 5000); // Refrescar cada 5 seg
    return () => clearInterval(intervalId);
  }, [refreshTrigger, selectedInstance, selectedGroup]);

  const filteredConversaciones = conversaciones.filter((conv: Conversacion) => {
    const datos = conv.contacto?.datos_contacto;
    const customName = datos ? `${datos.nombres || ''} ${datos.apellidos || ''}`.toLowerCase() : '';
    const documentStr = datos?.documento ? datos.documento.toLowerCase() : '';
    const emailStr = datos?.correo ? datos.correo.toLowerCase() : '';
    const contactName = (conv.contacto?.pushName || '').toLowerCase();
    const contactNumber = (conv.contacto?.numero_contacto || '').toLowerCase();
    const query = searchTerm.toLowerCase();
    return (
      contactName.includes(query) || 
      contactNumber.includes(query) || 
      customName.includes(query) || 
      documentStr.includes(query) || 
      emailStr.includes(query)
    );
  });

  return (
    <div className={`w-full lg:w-[380px] bg-white flex flex-col h-full shrink-0 ${selectedConversacion ? 'hidden lg:flex' : 'flex'}`}>
      <div className="p-6 shrink-0 border-b border-gray-100/80 space-y-4">
        <div className="flex items-center gap-3 mb-6 lg:hidden">
          <button 
            className="p-2.5 text-gray-500 hover:bg-gray-50 rounded-2xl transition-colors"
            onClick={onOpenSidebar}
          >
            <Menu size={20} strokeWidth={1.5} />
          </button>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Mensajes</h2>
        </div>
        
        {/* Search Bar */}
        <div className="relative group">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-gray-800 transition-colors" strokeWidth={1.5} />
          <input 
            type="text" 
            placeholder="Buscar chats..." 
            value={searchTerm}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-50 rounded-2xl pl-11 pr-4 py-3 text-[14px] focus:outline-none focus:bg-white focus:shadow-[0_4px_12px_rgba(0,0,0,0.05)] text-gray-700 transition-all placeholder:text-gray-400 border border-transparent focus:border-gray-200"
          />
        </div>

        {/* Dropdown Filters */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider pl-1">Instancia</label>
            <select
              value={selectedInstance}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setSelectedInstance(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 hover:border-gray-300 text-gray-700 rounded-xl px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer"
            >
              <option value="">Todas</option>
              {instances.map((inst: any) => (
                <option key={inst.cuenta_id} value={inst.cuenta_id}>
                  {inst.nombre_interno || inst.nombre_cuenta}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider pl-1">Grupo de Atención</label>
            <select
              value={selectedGroup}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setSelectedGroup(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 hover:border-gray-300 text-gray-700 rounded-xl px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer"
            >
              <option value="">Todos</option>
              {groups.map((group: any) => (
                <option key={group.id} value={group.id}>
                  {group.nombre_grupo}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar pb-4 px-4 pt-4">
        {loading && filteredConversaciones.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-400">Cargando...</div>
        ) : (
          <ul className="space-y-2.5">
            {filteredConversaciones.map((conv: Conversacion) => {
              const isSelected = selectedConversacion?.id === conv.id;
              const datos = conv.contacto?.datos_contacto;
              const hasCustomName = datos && (datos.nombres || datos.apellidos);
              const contactName = hasCustomName
                ? `${datos.nombres || ''} ${datos.apellidos || ''}`.trim()
                : conv.contacto?.pushName || `+${conv.contacto?.numero_contacto}` || 'Desconocido';
              
              const hasPushName = !!conv.contacto?.pushName || !!hasCustomName;
              const initial = contactName.charAt(0).toUpperCase();
              
              // Soft pastel colors for avatar
              const colors = ['bg-blue-50 text-blue-600', 'bg-emerald-50 text-emerald-600', 'bg-purple-50 text-purple-600', 'bg-amber-50 text-amber-600', 'bg-rose-50 text-rose-600'];
              const colorIndex = contactName.charCodeAt(0) % colors.length;
              const avatarColor = colors[colorIndex];

              return (
              <li key={conv.id}>
                <button
                  onClick={() => onSelectConversacion(conv)}
                  className={`w-full text-left flex items-start gap-3 p-3 rounded-[20px] transition-all ${
                    isSelected 
                      ? 'bg-white shadow-[0_4px_12px_rgba(0,0,0,0.05)]' 
                      : 'bg-transparent hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)]'
                  }`}
                >
                  <div className="relative shrink-0 mt-0.5">
                    <div className={`w-[40px] h-[40px] rounded-full flex items-center justify-center font-bold text-base ${avatarColor}`}>
                      {initial}
                    </div>
                    {conv.nuevo_mensaje && (
                      <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-blue-500 border-2 border-white"></span>
                    )}
                  </div>
                  <div className="overflow-hidden w-full flex flex-col gap-0.5">
                    <div className="flex justify-between items-baseline w-full">
                      <p className="text-[15px] truncate flex items-center gap-1 font-bold text-gray-900">
                        {contactName}
                      </p>
                      <span className={`text-[11px] shrink-0 font-medium ${conv.nuevo_mensaje ? 'text-blue-500 font-bold' : 'text-gray-400'}`}>
                        {conv.updated_at || conv.created_at 
                          ? new Date(conv.updated_at || conv.created_at || '').toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
                          : 'Ahora'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 w-full overflow-hidden">
                      {hasPushName ? (
                        <p className="text-[12px] truncate font-medium text-gray-400 shrink-0">
                          +{conv.contacto?.numero_contacto || 'Sin número'}
                        </p>
                      ) : (
                        <p className="text-[12px] truncate font-medium text-gray-400 shrink-0 italic">
                          Sin nombre de contacto
                        </p>
                      )}

                      {conv.canal && (
                        <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200/50 truncate shrink-0">
                          {conv.canal.nombre_interno || conv.canal.nombre_cuenta}
                        </span>
                      )}
                      
                      {/* Badges de Grupo y Agente alineados horizontalmente */}
                      {conv.grupo_asignado && (
                        <div className="flex items-center gap-1.5 truncate">
                          {conv.grupo_asignado.grupo_atencion && (
                            <span className="inline-flex items-center text-[10px] font-semibold text-gray-500 truncate before:content-['|'] before:mr-1.5 before:text-gray-300">
                              {conv.grupo_asignado.grupo_atencion.nombre_grupo}
                            </span>
                          )}
                          {conv.grupo_asignado.agente && (
                            <span className="inline-flex items-center text-[10px] font-semibold text-gray-400 truncate before:content-['•'] before:mr-1.5">
                              {conv.grupo_asignado.agente.nombre_agente}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              </li>
              );
            })}
            {conversaciones.length === 0 && !loading && (
              <div className="p-4 text-center text-sm text-gray-400">No hay conversaciones activas</div>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}