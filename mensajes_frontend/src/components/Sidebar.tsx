import { MessageSquare, Settings, Users, X, UserCircle, UsersRound, LogOut, UserCog, MessageSquarePlus, ChevronLeft, Menu, FileSpreadsheet, Globe, Inbox, BarChart3, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  currentView: 'conversations' | 'groups' | 'agents' | 'users' | 'send_message' | 'csv_send' | 'import_contacts' | 'instances' | 'received_messages' | 'reports';
  setCurrentView: (view: 'conversations' | 'groups' | 'agents' | 'users' | 'send_message' | 'csv_send' | 'import_contacts' | 'instances' | 'received_messages' | 'reports') => void;
}

export default function Sidebar({ isOpen, setIsOpen, currentView, setCurrentView }: SidebarProps) {
  const [perfil, setPerfil] = useState<string>('agente');
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    const userLocal = localStorage.getItem('usuario');
    if (userLocal) {
      try {
        const p = JSON.parse(userLocal);
        setPerfil(p.perfil);
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    window.location.reload();
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={`fixed lg:static inset-y-0 left-0 z-40 bg-white transform transition-all duration-300 ease-in-out flex flex-col py-8 shrink-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } ${isCollapsed ? 'lg:w-[88px] w-[280px]' : 'w-[280px]'}`}
      >
        <div className={`flex items-center px-8 mb-10 relative ${isCollapsed ? 'lg:justify-center px-4' : ''}`}>
          <div className="bg-gray-50 p-2.5 rounded-2xl text-gray-800 shrink-0">
            <MessageSquare size={22} strokeWidth={1.5} />
          </div>
          <h1 className={`text-2xl font-bold ml-3.5 text-gray-900 tracking-tight transition-opacity duration-300 ${isCollapsed ? 'lg:hidden' : 'block'}`}>FluxChat</h1>
          
          {/* Mobile close button */}
          <button 
            className="lg:hidden absolute top-0 right-[-40px] p-2 bg-white rounded-r-2xl text-gray-500 shadow-[0_4px_12px_rgba(0,0,0,0.05)]"
            onClick={() => setIsOpen(false)}
          >
            <X size={20} strokeWidth={1.25} />
          </button>
        </div>

        {/* Desktop Collapse Toggle */}
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="hidden lg:flex absolute -right-3.5 top-10 bg-white rounded-full p-1.5 text-gray-400 hover:text-gray-900 hover:scale-110 shadow-[0_4px_12px_rgba(0,0,0,0.05)] z-50 transition-all"
        >
          {isCollapsed ? <Menu size={14} strokeWidth={2} /> : <ChevronLeft size={14} strokeWidth={2} />}
        </button>

        {/* Main Navigation Menu */}
        <nav className={`flex-1 flex flex-col gap-2 ${isCollapsed ? 'px-4' : 'px-6'}`}>
          <div className="flex flex-col gap-2">
            <button 
              onClick={() => { setCurrentView('conversations'); setIsOpen(false); }}
              className={`w-full flex items-center rounded-[24px] transition-all font-medium ${
                isCollapsed ? 'justify-center p-3' : 'gap-4 px-4 py-3.5'
              } ${
                currentView === 'conversations' ? 'text-gray-900 bg-white shadow-[0_4px_12px_rgba(0,0,0,0.05)] font-bold' : 'text-gray-400 hover:text-gray-900 hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] bg-transparent'
              }`}
              title={isCollapsed ? "Conversaciones" : undefined}
            >
              <MessageSquare size={22} strokeWidth={currentView === 'conversations' ? 2 : 1.25} />
              {!isCollapsed && <span className="text-[15px]">Conversaciones</span>}
            </button>

            <button 
              onClick={() => { setCurrentView('send_message'); setIsOpen(false); }}
              className={`w-full flex items-center rounded-[24px] transition-all font-medium ${
                isCollapsed ? 'justify-center p-3' : 'gap-4 px-4 py-3.5'
              } ${
                currentView === 'send_message' ? 'text-gray-900 bg-white shadow-[0_4px_12px_rgba(0,0,0,0.05)] font-bold' : 'text-gray-400 hover:text-gray-900 hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] bg-transparent'
              }`}
              title={isCollapsed ? "Enviar Mensaje" : undefined}
            >
              <MessageSquarePlus size={22} strokeWidth={currentView === 'send_message' ? 2 : 1.25} />
              {!isCollapsed && <span className="text-[15px]">Enviar Mensaje</span>}
            </button>

            <button 
              onClick={() => { setCurrentView('csv_send'); setIsOpen(false); }}
              className={`w-full flex items-center rounded-[24px] transition-all font-medium ${
                isCollapsed ? 'justify-center p-3' : 'gap-4 px-4 py-3.5'
              } ${
                currentView === 'csv_send' ? 'text-gray-900 bg-white shadow-[0_4px_12px_rgba(0,0,0,0.05)] font-bold' : 'text-gray-400 hover:text-gray-900 hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] bg-transparent'
              }`}
              title={isCollapsed ? "Envíos por CSV" : undefined}
            >
              <FileSpreadsheet size={22} strokeWidth={currentView === 'csv_send' ? 2 : 1.25} />
              {!isCollapsed && <span className="text-[15px]">Envíos por CSV</span>}
            </button>

            <button 
              onClick={() => { setCurrentView('import_contacts'); setIsOpen(false); }}
              className={`w-full flex items-center rounded-[24px] transition-all font-medium ${
                isCollapsed ? 'justify-center p-3' : 'gap-4 px-4 py-3.5'
              } ${
                currentView === 'import_contacts' ? 'text-gray-900 bg-white shadow-[0_4px_12px_rgba(0,0,0,0.05)] font-bold' : 'text-gray-400 hover:text-gray-900 hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] bg-transparent'
              }`}
              title={isCollapsed ? "Importar Contactos" : undefined}
            >
              <UserPlus size={22} strokeWidth={currentView === 'import_contacts' ? 2 : 1.25} />
              {!isCollapsed && <span className="text-[15px]">Importar Contactos</span>}
            </button>

            <button 
              onClick={() => { setCurrentView('received_messages'); setIsOpen(false); }}
              className={`w-full flex items-center rounded-[24px] transition-all font-medium ${
                isCollapsed ? 'justify-center p-3' : 'gap-4 px-4 py-3.5'
              } ${
                currentView === 'received_messages' ? 'text-gray-900 bg-white shadow-[0_4px_12px_rgba(0,0,0,0.05)] font-bold' : 'text-gray-400 hover:text-gray-900 hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] bg-transparent'
              }`}
              title={isCollapsed ? "Mensajes Recibidos" : undefined}
            >
              <Inbox size={22} strokeWidth={currentView === 'received_messages' ? 2 : 1.25} />
              {!isCollapsed && <span className="text-[15px]">Mensajes Recibidos</span>}
            </button>

            <button 
              onClick={() => { setCurrentView('reports'); setIsOpen(false); }}
              className={`w-full flex items-center rounded-[24px] transition-all font-medium ${
                isCollapsed ? 'justify-center p-3' : 'gap-4 px-4 py-3.5'
              } ${
                currentView === 'reports' ? 'text-gray-900 bg-white shadow-[0_4px_12px_rgba(0,0,0,0.05)] font-bold' : 'text-gray-400 hover:text-gray-900 hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] bg-transparent'
              }`}
              title={isCollapsed ? "Reportes" : undefined}
            >
              <BarChart3 size={22} strokeWidth={currentView === 'reports' ? 2 : 1.25} />
              {!isCollapsed && <span className="text-[15px]">Reportes</span>}
            </button>
            
            {perfil !== 'agente' && (
              <>
                <button 
                  onClick={() => { setCurrentView('groups'); setIsOpen(false); }}
                  className={`w-full flex items-center rounded-[24px] transition-all font-medium ${
                    isCollapsed ? 'justify-center p-3' : 'gap-4 px-4 py-3.5'
                  } ${
                    currentView === 'groups' ? 'text-gray-900 bg-white shadow-[0_4px_12px_rgba(0,0,0,0.05)] font-bold' : 'text-gray-400 hover:text-gray-900 hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] bg-transparent'
                  }`}
                  title={isCollapsed ? "Grupos de Atención" : undefined}
                >
                  <UsersRound size={22} strokeWidth={currentView === 'groups' ? 2 : 1.25} />
                  {!isCollapsed && <span className="text-[15px]">Grupos de Atención</span>}
                </button>
                <button 
                  onClick={() => { setCurrentView('agents'); setIsOpen(false); }}
                  className={`w-full flex items-center rounded-[24px] transition-all font-medium ${
                    isCollapsed ? 'justify-center p-3' : 'gap-4 px-4 py-3.5'
                  } ${
                    currentView === 'agents' ? 'text-gray-900 bg-white shadow-[0_4px_12px_rgba(0,0,0,0.05)] font-bold' : 'text-gray-400 hover:text-gray-900 hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] bg-transparent'
                  }`}
                  title={isCollapsed ? "Agentes" : undefined}
                >
                  <UserCircle size={22} strokeWidth={currentView === 'agents' ? 2 : 1.25} />
                  {!isCollapsed && <span className="text-[15px]">Agentes</span>}
                </button>
              </>
            )}

            {perfil === 'admin' && (
              <>
                <button 
                  onClick={() => { setCurrentView('users'); setIsOpen(false); }}
                  className={`w-full flex items-center rounded-[24px] transition-all font-medium ${
                    isCollapsed ? 'justify-center p-3' : 'gap-4 px-4 py-3.5'
                  } ${
                    currentView === 'users' ? 'text-gray-900 bg-white shadow-[0_4px_12px_rgba(0,0,0,0.05)] font-bold' : 'text-gray-400 hover:text-gray-900 hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] bg-transparent'
                  }`}
                  title={isCollapsed ? "Usuarios" : undefined}
                >
                  <UserCog size={22} strokeWidth={currentView === 'users' ? 2 : 1.25} />
                  {!isCollapsed && <span className="text-[15px]">Usuarios</span>}
                </button>

                <button 
                  onClick={() => { setCurrentView('instances'); setIsOpen(false); }}
                  className={`w-full flex items-center rounded-[24px] transition-all font-medium ${
                    isCollapsed ? 'justify-center p-3' : 'gap-4 px-4 py-3.5'
                  } ${
                    currentView === 'instances' ? 'text-gray-900 bg-white shadow-[0_4px_12px_rgba(0,0,0,0.05)] font-bold' : 'text-gray-400 hover:text-gray-900 hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] bg-transparent'
                  }`}
                  title={isCollapsed ? "Instancias" : undefined}
                >
                  <Globe size={22} strokeWidth={currentView === 'instances' ? 2 : 1.25} />
                  {!isCollapsed && <span className="text-[15px]">Instancias</span>}
                </button>
              </>
            )}
          </div>
          <div className="mt-auto flex flex-col gap-2 mb-4">
            <button 
              className={`w-full flex items-center text-gray-400 hover:text-gray-800 bg-transparent rounded-none transition-colors font-medium ${
                isCollapsed ? 'justify-center p-3' : 'gap-4 px-4 py-2'
              }`}
              title={isCollapsed ? "Configuración" : undefined}
            >
              <Settings size={22} strokeWidth={1.25} />
              {!isCollapsed && <span className="text-[15px]">Configuración</span>}
            </button>
            <button 
              onClick={handleLogout}
              className={`w-full flex items-center text-gray-400 hover:text-gray-800 bg-transparent rounded-none transition-colors font-medium ${
                isCollapsed ? 'justify-center p-3' : 'gap-4 px-4 py-2'
              }`}
              title={isCollapsed ? "Cerrar sesión" : undefined}
            >
              <LogOut size={22} strokeWidth={1.25} />
              {!isCollapsed && <span className="text-[15px]">Cerrar sesión</span>}
            </button>
          </div>
        </nav>
      </aside>
    </>
  );
}
