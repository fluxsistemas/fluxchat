import { useState, useEffect } from 'react';
import axios from 'axios';
import { Menu, Plus, Edit2, Trash2, UserCog, X, RefreshCw } from 'lucide-react';
import { Usuario, AgentesAtencion } from '../types';

interface UsersManagerProps {
  onOpenSidebar: () => void;
}

export default function UsersManager({ onOpenSidebar }: UsersManagerProps) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [agentes, setAgentes] = useState<AgentesAtencion[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUsuario, setEditingUsuario] = useState<Usuario | null>(null);
  
  const [usuario, setUsuario] = useState('');
  const [nombre, setNombre] = useState('');
  const [perfil, setPerfil] = useState('agente');
  const [password, setPassword] = useState('');
  const [idAgente, setIdAgente] = useState<string>('');
  
  const [currentUserProfile, setCurrentUserProfile] = useState('');
  const [syncing, setSyncing] = useState(false);

  const handleSyncInstances = async () => {
    setSyncing(true);
    try {
      const response = await axios.post('/api/evolution/sync-instances');
      const { summary } = response.data;
      alert(`Sincronización completada con éxito.\nTotal de instancias obtenidas: ${summary.total_instances_fetched}\nAgregadas: ${summary.added}\nActualizadas: ${summary.updated}`);
    } catch (error: any) {
      console.error("Error al sincronizar instancias:", error);
      alert(error.response?.data?.detail || "Ocurrió un error al sincronizar las cuentas de Evolution API.");
    } finally {
      setSyncing(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [userRes, agentRes] = await Promise.all([
        axios.get('/api/usuarios/'),
        axios.get('/api/agentes-atencion/')
      ]);
      setUsuarios(userRes.data);
      setAgentes(agentRes.data);
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
    if (!usuario.trim() || !nombre.trim()) return;
    if (!editingUsuario && !password.trim()) return; // Password is required on create

    try {
      const payload: any = { 
        usuario,
        nombre,
        perfil,
        id_agente: idAgente ? parseInt(idAgente) : null
      };

      if (password.trim()) {
        payload.password = password;
      }

      if (editingUsuario) {
        await axios.put(`/api/usuarios/${editingUsuario.id}`, payload);
      } else {
        await axios.post('/api/usuarios/', payload);
      }
      setIsModalOpen(false);
      fetchData();
    } catch (error: any) {
      alert(error.response?.data?.detail || "Ocurrió un error al guardar");
    }
  };

  const openModal = (user?: Usuario) => {
    if (user) {
      setEditingUsuario(user);
      setUsuario(user.usuario);
      setNombre(user.nombre);
      setPerfil(user.perfil);
      setIdAgente(user.id_agente ? user.id_agente.toString() : '');
      setPassword('');
    } else {
      setEditingUsuario(null);
      setUsuario('');
      setNombre('');
      setPerfil('agente');
      setIdAgente('');
      setPassword('');
    }
    setIsModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('¿Estás seguro de eliminar este usuario?')) return;
    try {
      await axios.delete(`/api/usuarios/${id}`);
      fetchData();
    } catch (error: any) {
        alert(error.response?.data?.detail || "Ocurrió un error al eliminar");
    }
  };

  if (currentUserProfile !== 'admin') {
      return (
        <div className="flex flex-col h-full w-full bg-[#f4f7f6]">
          <header className="bg-white border-b border-gray-200 px-4 py-4 flex items-center shrink-0">
            <button className="lg:hidden p-2 mr-3 text-gray-500 hover:bg-gray-100 rounded-md" onClick={onOpenSidebar}>
              <Menu size={20} />
            </button>
            <div>
              <h2 className="text-xl font-bold text-gray-800">Usuarios</h2>
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
            <h2 className="text-xl font-bold text-gray-800">Usuarios</h2>
            <p className="text-sm text-gray-500">Gestión de acceso al sistema</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={handleSyncInstances}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors shadow-sm font-medium disabled:opacity-50"
            title="Sincronizar instancias de Evolution API"
          >
            <RefreshCw size={18} className={syncing ? "animate-spin" : ""} />
            <span className="hidden sm:inline">{syncing ? 'Sincronizando...' : 'Sincronizar Cuentas'}</span>
          </button>
          <button 
            onClick={() => openModal()}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm font-medium"
          >
            <Plus size={18} />
            <span className="hidden sm:inline">Nuevo Usuario</span>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-4xl mx-auto">
          {loading ? (
            <div className="flex justify-center p-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : usuarios.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-12 text-center border border-gray-100">
              <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <UserCog size={32} />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-1">No hay usuarios</h3>
              <p className="text-gray-500 max-w-sm mx-auto">Comienza agregando tu primer usuario para acceder al sistema.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500 tracking-wider">
                      <th className="px-6 py-4 font-medium">Login</th>
                      <th className="px-6 py-4 font-medium">Nombre Completo</th>
                      <th className="px-6 py-4 font-medium">Perfil</th>
                      <th className="px-6 py-4 font-medium">Agente Asignado</th>
                      <th className="px-6 py-4 font-medium text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {usuarios.map((u) => (
                      <tr key={u.id} className="hover:bg-blue-50/50 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm shrink-0">
                              {u.usuario.substring(0, 2).toUpperCase()}
                            </div>
                            <span className="font-medium text-gray-900">{u.usuario}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-gray-600">{u.nombre}</td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize
                            ${u.perfil === 'admin' ? 'bg-purple-100 text-purple-800' : 
                              u.perfil === 'supervisor' ? 'bg-orange-100 text-orange-800' : 
                              'bg-green-100 text-green-800'}`}>
                            {u.perfil}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-gray-600">
                          {u.id_agente ? (
                             <span className="flex items-center gap-1">
                               <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                               {agentes.find(a => a.id === u.id_agente)?.nombre_agente || u.id_agente}
                             </span>
                          ) : (
                             <span className="text-gray-400 italic">No asignado</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => openModal(u)}
                              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Editar"
                            >
                              <Edit2 size={18} />
                            </button>
                            <button 
                              onClick={() => handleDelete(u.id)}
                              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Eliminar"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">
                {editingUsuario ? 'Editar Usuario' : 'Nuevo Usuario'}
              </h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-2 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleSave} className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Login de Usuario <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={usuario}
                    onChange={(e) => setUsuario(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    placeholder="Ej: jperez"
                    required
                    disabled={!!editingUsuario}
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Nombre Completo <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    placeholder="Ej: Juan Pérez"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Contraseña {editingUsuario && <span className="text-gray-400 font-normal text-xs">(Dejar en blanco para no cambiar)</span>} {!editingUsuario && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    placeholder="Contraseña segura"
                    required={!editingUsuario}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Perfil <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={perfil}
                    onChange={(e) => setPerfil(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-white"
                    required
                  >
                    <option value="agente">Agente</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Agente Asignado (Opcional)
                  </label>
                  <select
                    value={idAgente}
                    onChange={(e) => setIdAgente(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-white"
                  >
                    <option value="">-- Ninguno --</option>
                    {agentes.map(a => (
                        <option key={a.id} value={a.id}>{a.nombre_agente} ({a.login_agente})</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Si este usuario también atiende chats, puedes vincularlo a un agente existente.</p>
                </div>
              </div>

              <div className="mt-8 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-5 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors shadow-sm"
                >
                  {editingUsuario ? 'Guardar Cambios' : 'Crear Usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
