import { useState, useEffect, useRef } from 'react';
import { Bell, BellRing, Trash2, Check } from 'lucide-react';
import Sidebar from './components/Sidebar';
import ConversationsList from './components/ConversationsList';
import Chat from './components/Chat';
import GroupsManager from './components/GroupsManager';
import AgentsManager from './components/AgentsManager';
import UsersManager from './components/UsersManager';
import SendMessage from './components/SendMessage';
import CsvManager from './components/CsvManager';
import CsvContactImporter from './components/CsvContactImporter';
import InstancesManager from './components/InstancesManager';
import SetupAdmin from './components/SetupAdmin';
import Login from './components/Login';
import MensajesRecibidos from './components/MensajesRecibidos';
import Reportes from './components/Reportes';
import { Conversacion } from './types';

interface Notificacion {
  id: string;
  mensaje: string;
  fechaHora: string;
  leido: boolean;
}

function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [selectedConversacion, setSelectedConversacion] = useState<Conversacion | null>(null);
  const [currentView, setCurrentView] = useState<'conversations' | 'groups' | 'agents' | 'users' | 'send_message' | 'csv_send' | 'import_contacts' | 'instances' | 'received_messages' | 'reports'>('conversations');

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [loadingConfig, setLoadingConfig] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const [notifications, setNotifications] = useState<Notificacion[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);

  const unreadCount = notifications.filter(n => !n.leido).length;

  const fetchNotifications = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch('/api/notificaciones/', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
      }
    } catch (err) {
      console.error("Error al obtener notificaciones de la BD:", err);
    }
  };

  const markAllAsRead = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch('/api/notificaciones/marcar-leidas', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        fetchNotifications();
      }
    } catch (err) {
      console.error("Error al marcar todas las notificaciones como leídas:", err);
    }
  };

  const clearNotifications = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch('/api/notificaciones/limpiar', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        setNotifications([]);
      }
    } catch (err) {
      console.error("Error al limpiar notificaciones:", err);
    }
  };

  const toggleNotificationRead = async (id: string | number) => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`/api/notificaciones/${id}/leido`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        fetchNotifications();
      }
    } catch (err) {
      console.error("Error al marcar notificación como leída:", err);
    }
  };

  const deleteNotification = async (id: string | number) => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`/api/notificaciones/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        fetchNotifications();
      }
    } catch (err) {
      console.error("Error al eliminar notificación:", err);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;

    fetchNotifications();
    const interval = setInterval(fetchNotifications, 5000); // Polling rápido cada 5s de las notificaciones reales guardadas en DB por webhook

    return () => clearInterval(interval);
  }, [isAuthenticated]);

  useEffect(() => {
    checkSetup();
    const token = localStorage.getItem('token');
    if (token) {
      setIsAuthenticated(true);
    }
  }, []);

  const checkSetup = async () => {
    try {
      const res = await fetch('/api/auth/check-setup');
      if (res.ok) {
        const data = await res.json();
        setNeedsSetup(data.needs_setup);
      }
    } catch (err) {
      console.error("Error al verificar configuración:", err);
    } finally {
      setLoadingConfig(false);
    }
  };

  if (loadingConfig) {
    return <div className="flex h-screen items-center justify-center chat-bg text-gray-500 font-medium">Cargando configuración...</div>;
  }

  if (needsSetup) {
    return <SetupAdmin onSetupComplete={() => setNeedsSetup(false)} />;
  }

  if (!isAuthenticated) {
    return <Login onLoginSuccess={(token, user) => setIsAuthenticated(true)} />;
  }

  return (
    <div className="flex h-screen w-full chat-bg overflow-hidden font-sans text-gray-800">
      <Sidebar 

        isOpen={isSidebarOpen} 
        setIsOpen={setIsSidebarOpen} 
        currentView={currentView}
        setCurrentView={setCurrentView}
      />
      <div className="flex flex-1 overflow-hidden relative">
        {currentView === 'conversations' && (
          <>
            <ConversationsList 
              selectedConversacion={selectedConversacion}
              onSelectConversacion={(conv) => {
                setSelectedConversacion(conv);
              }}
              onOpenSidebar={() => setIsSidebarOpen(true)}
              refreshTrigger={refreshTrigger}
            />
            <Chat 
              conversacion={selectedConversacion} 
              onBack={() => setSelectedConversacion(null)}
              onConversacionUpdated={() => {
                setRefreshTrigger(prev => prev + 1);
                setSelectedConversacion(null);
              }}
            />
          </>
        )}
        {currentView === 'groups' && (
          <GroupsManager onOpenSidebar={() => setIsSidebarOpen(true)} />
        )}
        {currentView === 'agents' && (
          <AgentsManager onOpenSidebar={() => setIsSidebarOpen(true)} />
        )}
        {currentView === 'users' && (
          <UsersManager onOpenSidebar={() => setIsSidebarOpen(true)} />
        )}
        {currentView === 'instances' && (
          <InstancesManager onOpenSidebar={() => setIsSidebarOpen(true)} />
        )}
        {currentView === 'send_message' && (
          <SendMessage onOpenSidebar={() => setIsSidebarOpen(true)} />
        )}
        {currentView === 'csv_send' && (
          <CsvManager onOpenSidebar={() => setIsSidebarOpen(true)} />
        )}
        {currentView === 'import_contacts' && (
          <CsvContactImporter onOpenSidebar={() => setIsSidebarOpen(true)} />
        )}
        {currentView === 'received_messages' && (
          <MensajesRecibidos onOpenSidebar={() => setIsSidebarOpen(true)} />
        )}
        {currentView === 'reports' && (
          <Reportes onOpenSidebar={() => setIsSidebarOpen(true)} />
        )}
      </div>

      {/* Sistema de Notificaciones Flotante */}
      {isAuthenticated && (
        <div className="fixed top-4 right-4 z-[9999] flex items-center">
          <div className="relative">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-gray-600 hover:text-gray-900 shadow-md border border-gray-100 transition-all hover:scale-105 active:scale-95 focus:outline-none cursor-pointer relative"
              title="Notificaciones de Instancias"
            >
              {unreadCount > 0 ? (
                <>
                  <BellRing className="h-5 w-5 text-amber-500 animate-pulse" />
                  <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm">
                    {unreadCount}
                  </span>
                </>
              ) : (
                <Bell className="h-5 w-5 text-gray-500" />
              )}
            </button>

            {showNotifications && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl bg-white shadow-2xl border border-gray-100 overflow-hidden transform origin-top-right transition-all duration-200 z-[10000]">
                {/* Header de Notificaciones */}
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-700 text-sm">Notificaciones</span>
                    {unreadCount > 0 && (
                      <span className="bg-amber-100 text-amber-800 text-[11px] font-medium px-2 py-0.5 rounded-full">
                        {unreadCount} nuevas
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {notifications.length > 0 && (
                      <>
                        <button
                          onClick={markAllAsRead}
                          className="text-xs text-blue-600 hover:text-blue-800 hover:underline font-medium cursor-pointer"
                          title="Marcar todas como leídas"
                        >
                          Marcar leídas
                        </button>
                        <span className="text-gray-300">|</span>
                        <button
                          onClick={clearNotifications}
                          className="text-xs text-red-600 hover:text-red-800 hover:underline font-medium cursor-pointer"
                          title="Limpiar"
                        >
                          Limpiar
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Lista de Notificaciones */}
                <div className="max-h-[350px] overflow-y-auto divide-y divide-gray-50">
                  {notifications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                      <Bell className="h-8 w-8 text-gray-300 mb-2" />
                      <p className="text-sm text-gray-400">No hay notificaciones</p>
                      <p className="text-xs text-gray-400 mt-1">Te avisaremos cuando una instancia cambie de estado.</p>
                    </div>
                  ) : (
                    notifications.map((notif) => (
                      <div
                        key={notif.id}
                        className={`p-4 hover:bg-gray-50 transition-colors flex gap-3 items-start justify-between ${
                          !notif.leido ? 'bg-amber-50/40' : ''
                        }`}
                      >
                        <div className="flex-1 min-w-0" onClick={() => toggleNotificationRead(notif.id)}>
                          <p className={`text-xs text-gray-700 leading-normal cursor-pointer ${!notif.leido ? 'font-medium' : ''}`}>
                            {notif.mensaje}
                          </p>
                          <span className="text-[10px] text-gray-400 mt-1 block">
                            {notif.fechaHora}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {!notif.leido && (
                            <button
                              onClick={() => toggleNotificationRead(notif.id)}
                              className="p-1 text-gray-400 hover:text-blue-600 rounded-full hover:bg-gray-100 cursor-pointer"
                              title="Marcar como leída"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => deleteNotification(notif.id)}
                            className="p-1 text-gray-400 hover:text-red-600 rounded-full hover:bg-gray-100 cursor-pointer"
                            title="Eliminar"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
