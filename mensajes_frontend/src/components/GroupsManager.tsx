import { useState, useEffect } from 'react';
import axios from 'axios';
import { Menu, Plus, Edit2, Trash2, UsersRound, X } from 'lucide-react';
import { GrupoAtencion } from '../types';

interface GroupsManagerProps {
  onOpenSidebar: () => void;
}

export default function GroupsManager({ onOpenSidebar }: GroupsManagerProps) {
  const [grupos, setGrupos] = useState<GrupoAtencion[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGrupo, setEditingGrupo] = useState<GrupoAtencion | null>(null);
  const [nombreGrupo, setNombreGrupo] = useState('');
  
  const [currentUserProfile, setCurrentUserProfile] = useState('');

  const fetchGrupos = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/grupos-atencion/');
      setGrupos(response.data);
    } catch (error) {
      console.error("Error fetching grupos:", error);
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
    fetchGrupos();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombreGrupo.trim()) return;

    try {
      if (editingGrupo) {
        await axios.put(`/api/grupos-atencion/${editingGrupo.id}`, { nombre_grupo: nombreGrupo });
      } else {
        await axios.post('/api/grupos-atencion/', { nombre_grupo: nombreGrupo });
      }
      setIsModalOpen(false);
      fetchGrupos();
    } catch (error) {
      console.error("Error saving grupo:", error);
    }
  };

  const handleEdit = (grupo: GrupoAtencion) => {
    setEditingGrupo(grupo);
    setNombreGrupo(grupo.nombre_grupo);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("¿Seguro que deseas eliminar este grupo?")) return;
    try {
      await axios.delete(`/api/grupos-atencion/${id}`);
      fetchGrupos();
    } catch (error) {
      console.error("Error deleting grupo:", error);
    }
  };

  const openNewModal = () => {
    setEditingGrupo(null);
    setNombreGrupo('');
    setIsModalOpen(true);
  };

  if (currentUserProfile === 'agente') {
      return (
        <div className="flex flex-col h-full w-full bg-[#f4f7f6]">
          <header className="bg-white border-b border-gray-200 px-4 py-4 flex items-center shrink-0">
            <button className="lg:hidden p-2 mr-3 text-gray-500 hover:bg-gray-100 rounded-md" onClick={onOpenSidebar}>
              <Menu size={20} />
            </button>
            <div>
              <h2 className="text-xl font-bold text-gray-800">Grupos de Atención</h2>
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
            <UsersRound size={24} className="text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-800">Grupos de Atención</h2>
          </div>
        </div>
        <button
          onClick={openNewModal}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm font-medium"
        >
          <Plus size={18} />
          <span>Nuevo Grupo</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#f4f7f6]">
        {loading && grupos.length === 0 ? (
          <div className="flex justify-center py-10 text-gray-500">Cargando grupos...</div>
        ) : grupos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <UsersRound size={48} className="text-gray-300 mb-4" />
            <p className="text-lg font-medium">No hay grupos de atención</p>
            <p className="text-sm text-gray-400 mt-1">Crea un grupo para organizar a tus agentes</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {grupos.map(grupo => (
              <div key={grupo.id} className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                      <UsersRound size={20} />
                    </div>
                    <h3 className="font-semibold text-gray-800 text-lg">{grupo.nombre_grupo}</h3>
                  </div>
                </div>
                <div className="mt-auto pt-4 flex gap-2 border-t border-gray-50">
                  <button 
                    onClick={() => handleEdit(grupo)}
                    className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  >
                    <Edit2 size={16} /> Editar
                  </button>
                  <button 
                    onClick={() => handleDelete(grupo.id)}
                    className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} /> Eliminar
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
                {editingGrupo ? 'Editar Grupo' : 'Nuevo Grupo'}
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
                <label className="block text-sm font-medium text-gray-700 mb-2">Nombre del Grupo</label>
                <input
                  type="text"
                  required
                  value={nombreGrupo}
                  onChange={(e) => setNombreGrupo(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                  placeholder="Ej: Soporte Técnico"
                />
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
    </div>
  );
}