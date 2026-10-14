import { useState, useEffect } from 'react';
import axios from 'axios';
import { Menu, Plus, Edit2, Trash2, UserCircle, X, Users, Settings2 } from 'lucide-react';
import { AgentesAtencion, GrupoAtencion, AgentesGrupo, CuentaActiva } from '../types';

interface AgentsManagerProps {
  onOpenSidebar: () => void;
}

export default function AgentsManager({ onOpenSidebar }: AgentsManagerProps) {
  const [agentes, setAgentes] = useState<AgentesAtencion[]>([]);
  const [grupos, setGrupos] = useState<GrupoAtencion[]>([]);
  const [loading, setLoading] = useState(false);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAgente, setEditingAgente] = useState<AgentesAtencion | null>(null);
  
  const [nombreAgente, setNombreAgente] = useState('');
  const [loginAgente, setLoginAgente] = useState('');
  const [verSinGrupo, setVerSinGrupo] = useState(false);
  const [idCanal, setIdCanal] = useState('');
  const [cuentas, setCuentas] = useState<CuentaActiva[]>([]);
  
  const [isGroupsModalOpen, setIsGroupsModalOpen] = useState(false);
  const [selectedAgente, setSelectedAgente] = useState<AgentesAtencion | null>(null);
  const [agenteGrupos, setAgenteGrupos] = useState<AgentesGrupo[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');

  const [currentUserProfile, setCurrentUserProfile] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [agentesRes, gruposRes, cuentasRes] = await Promise.all([
        axios.get('/api/agentes-atencion/'),
        axios.get('/api/grupos-atencion/'),
        axios.get('/api/cuentas/')
      ]);
      setAgentes(agentesRes.data);
      setGrupos(gruposRes.data);
      setCuentas(cuentasRes.data);
    } catch (error) {
      console.error("Error fetching data:", error);
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
    fetchData();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombreAgente.trim() || !loginAgente.trim()) return;

    try {
      if (editingAgente) {
        await axios.put(`/api/agentes-atencion/${editingAgente.id}`, { 
          nombre_agente: nombreAgente,
          login_agente: loginAgente,
          ver_sin_grupo: verSinGrupo,
          id_canal: idCanal || null
        });
      } else {
        await axios.post('/api/agentes-atencion/', { 
          nombre_agente: nombreAgente,
          login_agente: loginAgente,
          ver_sin_grupo: verSinGrupo,
          id_canal: idCanal || null
        });
      }
      setIsModalOpen(false);
      fetchData();
    } catch (error) {
      console.error("Error saving agente:", error);
    }
  };

  const handleEdit = (agente: AgentesAtencion) => {
    setEditingAgente(agente);
    setNombreAgente(agente.nombre_agente);
    setLoginAgente(agente.login_agente);
    setVerSinGrupo(agente.ver_sin_grupo || false);
    setIdCanal(agente.id_canal || '');
    setIsModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("¿Seguro que deseas eliminar este agente?")) return;
    try {
      await axios.delete(`/api/agentes-atencion/${id}`);
      fetchData();
    } catch (error) {
      console.error("Error deleting agente:", error);
    }
  };

  const openNewModal = () => {
    setEditingAgente(null);
    setNombreAgente('');
    setLoginAgente('');
    setVerSinGrupo(false);
    setIdCanal('');
    setIsModalOpen(true);
  };

  // --- Groups Management Logic ---
  
  const openGroupsModal = async (agente: AgentesAtencion) => {
    setSelectedAgente(agente);
    setSelectedGroupId('');
    setIsGroupsModalOpen(true);
    try {
      const response = await axios.get(`/api/agentes-grupo/?id_agente=${agente.id}`);
      // As the endpoint might not support filtering by id_agente depending on implementation, 
      // we filter client side to be safe.
      const associated = response.data.filter((ag: AgentesGrupo) => ag.id_agente === agente.id);
      setAgenteGrupos(associated);
    } catch (error) {
      console.error("Error fetching agent groups:", error);
    }
  };

  const handleAddGroup = async () => {
    if (!selectedAgente || !selectedGroupId) return;
    try {
      await axios.post('/api/agentes-grupo/', {
        id_agente: selectedAgente.id,
        id_grupo: parseInt(selectedGroupId)
      });
      // Refresh list
      openGroupsModal(selectedAgente);
    } catch (error) {
      console.error("Error adding group to agent:", error);
    }
  };

  const handleRemoveGroup = async (id: number) => {
    try {
      await axios.delete(`/api/agentes-grupo/${id}`);
      // Refresh list
      if (selectedAgente) openGroupsModal(selectedAgente);
    } catch (error) {
      console.error("Error removing group from agent:", error);
    }
  };

  if (currentUserProfile === 'agente') {
      return (
        <div className="flex flex-col h-full w-full bg-[#f4f7f6]">
          <header className="bg-white border-b border-gray-200 px-4 py-4 flex items-center shrink-0">
            <button className="lg:hidden p-2 mr-3 text-gray-500 hover:bg-gray-100 rounded-md" onClick={onOpenSidebar}>
              <Menu size={20} />
            </button>
            <div>
              <h2 className="text-xl font-bold text-gray-800">Agentes</h2>
            </div>
          </header>
          <div className="flex-1 flex items-center justify-center">
              <p className="text-gray-500">No tienes permisos para acceder a este módulo.</p>
          </div>
        </div>
      );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-white relative">
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
            <UserCircle size={24} className="text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-800">Agentes</h2>
          </div>
        </div>
        <button
          onClick={openNewModal}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm font-medium"
        >
          <Plus size={18} />
          <span>Nuevo Agente</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#f4f7f6]">
        {loading && agentes.length === 0 ? (
          <div className="flex justify-center py-10 text-gray-500">Cargando agentes...</div>
        ) : agentes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <UserCircle size={48} className="text-gray-300 mb-4" />
            <p className="text-lg font-medium">No hay agentes registrados</p>
            <p className="text-sm text-gray-400 mt-1">Crea un agente para empezar a asignarlo a grupos</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {agentes.map(agente => (
              <div key={agente.id} className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600">
                      <UserCircle size={20} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-800 text-lg leading-tight">{agente.nombre_agente}</h3>
                      <span className="text-sm text-gray-500">@{agente.login_agente}</span>
                    </div>
                  </div>
                </div>
                <div className="mb-4 flex flex-wrap gap-2">
                  {agente.ver_sin_grupo && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                      Ve conversaciones sin grupo
                    </span>
                  )}
                  {agente.canal && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                      Línea: {agente.canal.nombre_interno || agente.canal.nombre_cuenta}
                    </span>
                  )}
                </div>
                <div className="mt-auto pt-4 flex gap-2 border-t border-gray-50">
                  <button 
                    onClick={() => openGroupsModal(agente)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-gray-600 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                  >
                    <Settings2 size={16} /> Grupos
                  </button>
                  <button 
                    onClick={() => handleEdit(agente)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                  >
                    <Edit2 size={16} /> Editar
                  </button>
                  <button 
                    onClick={() => handleDelete(agente.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} /> Borrar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-800">
                {editingAgente ? 'Editar Agente' : 'Nuevo Agente'}
              </h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-6">
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Nombre del Agente</label>
                <input
                  type="text"
                  required
                  value={nombreAgente}
                  onChange={(e) => setNombreAgente(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                  placeholder="Ej: Juan Pérez"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Login / Usuario</label>
                <input
                  type="text"
                  required
                  value={loginAgente}
                  onChange={(e) => setLoginAgente(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                  placeholder="Ej: jperez"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Línea vinculada (Opcional)</label>
                <select
                  value={idCanal}
                  onChange={(e) => setIdCanal(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow bg-white"
                >
                  <option value="">-- Sin canal exclusivo --</option>
                  {cuentas.map((c) => (
                    <option key={c.cuenta_id} value={c.cuenta_id}>
                      {c.nombre_interno ? `${c.nombre_interno} (${c.nombre_cuenta})` : c.nombre_cuenta} (+{c.numero_cuenta})
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-4 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="verSinGrupo"
                  checked={verSinGrupo}
                  onChange={(e) => setVerSinGrupo(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="verSinGrupo" className="text-sm font-medium text-gray-700">
                  Puede ver conversaciones sin grupo asignado
                </label>
              </div>
              <div className="flex gap-3 justify-end mt-8">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Groups Modal */}
      {isGroupsModalOpen && selectedAgente && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-800">
                Grupos de {selectedAgente.nombre_agente}
              </h3>
              <button 
                onClick={() => setIsGroupsModalOpen(false)}
                className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6">
              <div className="flex gap-2 mb-6">
                <select
                  value={selectedGroupId}
                  onChange={(e) => setSelectedGroupId(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Seleccione un grupo...</option>
                  {grupos.filter(g => !agenteGrupos.find(ag => ag.id_grupo === g.id)).map(g => (
                    <option key={g.id} value={g.id}>{g.nombre_grupo}</option>
                  ))}
                </select>
                <button
                  onClick={handleAddGroup}
                  disabled={!selectedGroupId}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  Agregar
                </button>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wider mb-3">Grupos Asignados</h4>
                {agenteGrupos.length === 0 ? (
                  <p className="text-sm text-gray-500 italic">No tiene grupos asignados.</p>
                ) : (
                  agenteGrupos.map(ag => {
                    const grupo = grupos.find(g => g.id === ag.id_grupo);
                    return (
                      <div key={ag.id} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg border border-gray-100">
                        <span className="font-medium text-gray-800">{grupo?.nombre_grupo || 'Grupo Desconocido'}</span>
                        <button
                          onClick={() => handleRemoveGroup(ag.id)}
                          className="text-red-500 hover:bg-red-50 p-1.5 rounded-md transition-colors"
                          title="Quitar grupo"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
