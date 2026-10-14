import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { ArrowLeft, Send, User, Users, UserPlus, Paperclip, X, FileText, MessageSquare, Check, CheckCheck, Clock, AlertCircle, UserCog } from 'lucide-react';
import { Conversacion, Mensaje, GrupoAtencion, AgentesAtencion } from '../types';

interface ChatProps {
  conversacion: Conversacion | null;
  onBack: () => void;
  onConversacionUpdated?: () => void;
}

const getMessageDateString = (timestamp: string) => {
  if (!timestamp || timestamp === 'now()') {
    return 'Hoy';
  }
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return 'Hoy';
    }
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Hoy';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Ayer';
    } else {
      const formatted = date.toLocaleDateString('es-ES', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
      return formatted.charAt(0).toUpperCase() + formatted.slice(1);
    }
  } catch (error) {
    console.error("Error parsing date:", error);
    return 'Hoy';
  }
};

export default function Chat({ conversacion, onBack, onConversacionUpdated }: ChatProps) {
  const [messages, setMessages] = useState<Mensaje[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  
  const [grupos, setGrupos] = useState<GrupoAtencion[]>([]);
  const [agentes, setAgentes] = useState<AgentesAtencion[]>([]);
  const [isAssigning, setIsAssigning] = useState(false);
  const [currentUserProfile, setCurrentUserProfile] = useState('');
  const [currentUserIdAgente, setCurrentUserIdAgente] = useState<number | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Estados para datos de contacto
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [nombres, setNombres] = useState('');
  const [apellidos, setApellidos] = useState('');
  const [documento, setDocumento] = useState('');
  const [correo, setCorreo] = useState('');

  // Ref's para el chat
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isUserScrolling = useRef(false);
  const prevMessagesLength = useRef(0);

  useEffect(() => {
    if (conversacion?.contacto?.datos_contacto) {
      setNombres(conversacion.contacto.datos_contacto.nombres || '');
      setApellidos(conversacion.contacto.datos_contacto.apellidos || '');
      setDocumento(conversacion.contacto.datos_contacto.documento || '');
      setCorreo(conversacion.contacto.datos_contacto.correo || '');
    } else {
      setNombres('');
      setApellidos('');
      setDocumento('');
      setCorreo('');
    }
  }, [conversacion, isContactModalOpen]);

  const handleScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      // Consideramos que el usuario está scrolleando hacia arriba si está a más de 100px del fondo
      isUserScrolling.current = scrollHeight - scrollTop - clientHeight > 100;
    }
  };

  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  };

  useEffect(() => {
    const userLocal = localStorage.getItem('usuario');
    if (userLocal) {
        try {
            const p = JSON.parse(userLocal);
            setCurrentUserProfile(p.perfil);
            if (p.id_agente) {
                setCurrentUserIdAgente(p.id_agente);
            }
        } catch(e) { console.error(e); }
    }
  }, []);

  useEffect(() => {
    if (!conversacion) {
      setMessages([]);
      return;
    }

    let active = true;

    const fetchMessages = async () => {
      try {
        const response = await axios.get(`/api/conversaciones/${conversacion.id}/mensajes`);
        if (active && response.data && response.data.mensajes) {
          // Ordenamos explícitamente por timestamp (más viejo arriba, más nuevo abajo)
          const sortedMessages = [...response.data.mensajes].sort((a, b) => {
            const timeA = a.timestamp === 'now()' ? Date.now() : new Date(a.timestamp).getTime();
            const timeB = b.timestamp === 'now()' ? Date.now() : new Date(b.timestamp).getTime();
            return timeA - timeB;
          });
          setMessages(sortedMessages);
        }
      } catch (error) {
        console.error("Error fetching messages:", error);
      }
    };

    fetchMessages();
    const intervalId = setInterval(fetchMessages, 3000); // Polling cada 3 segundos
    
    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [conversacion]);

  // Obtener listas de Grupos y Agentes para los dropdowns
  useEffect(() => {
    const fetchSelectOptions = async () => {
      try {
        const [gruposRes, agentesRes] = await Promise.all([
          axios.get('/api/grupos-atencion/'),
          axios.get('/api/agentes-atencion/')
        ]);
        setGrupos(gruposRes.data);
        setAgentes(agentesRes.data);
      } catch (error) {
        console.error("Error fetching options:", error);
      }
    };
    fetchSelectOptions();
  }, []);

  useEffect(() => {
    // Solo scrollear al fondo automáticamente si:
    // 1. Es la primera vez que cargan mensajes
    // 2. El usuario NO está scrolleando hacia arriba leyendo mensajes viejos
    // 3. O bien, acaba de llegar un mensaje nuevo y ya estábamos abajo
    if (!isUserScrolling.current || messages.length > prevMessagesLength.current) {
      scrollToBottom(messages.length > prevMessagesLength.current); // Smooth si es mensaje nuevo, auto si es carga inicial
    }
    prevMessagesLength.current = messages.length;
  }, [messages]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setSelectedFile(file);
      
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setFilePreview(reader.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        setFilePreview(null);
      }
    }
  };

  const clearSelectedFile = () => {
    setSelectedFile(null);
    setFilePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSend = async () => {
    if ((!input.trim() && !selectedFile) || !conversacion) return;

    const fileToSend = selectedFile;
    const mimetype = fileToSend?.type;
    const fileName = fileToSend?.name;

    // Temporalmente agregamos un mensaje optimista a la UI
    const optimisticMessage: Mensaje = {
      message_id: Date.now().toString(),
      tipo: 'OUT',
      contenido: input || (fileToSend ? fileName! : ''),
      media_url: filePreview || undefined,
      mimetype: mimetype,
      timestamp: new Date().toISOString(),
      pushName: 'Yo',
      nombre_cuenta: '...',
      numero_cuenta: 'Enviando',
      status: 'PENDING'
    };
    
    setMessages(prev => [...prev, optimisticMessage]);
    setInput('');
    clearSelectedFile();
    setLoading(true);

    try {
      // Para enviar necesitamos la cuenta, la obtenemos por el id_canal
      const cuentaRes = await axios.get(`/api/cuentas/${conversacion.id_canal}`);
      const nombreCuenta = cuentaRes.data.nombre_cuenta;
      
      // Intentar obtener el número de contacto directamente o parsearlo del remoteJid
      let targetNumber = conversacion.contacto.numero_contacto;
      if (!targetNumber && conversacion.contacto.remoteJid) {
        targetNumber = conversacion.contacto.remoteJid.split('@')[0];
      }

      if (fileToSend) {
        // Envío con adjunto por multipart/form-data (sin base64 en el navegador).
        // El backend comprime el video si supera el límite de WhatsApp.
        const formData = new FormData();
        formData.append('nombre_cuenta', nombreCuenta);
        formData.append('number', targetNumber);
        formData.append('text', optimisticMessage.contenido);
        formData.append('media_file', fileToSend);

        await axios.post('/api/evolution/message/send-media', formData);
      } else {
        await axios.post('/api/evolution/message/send', { 
          nombre_cuenta: nombreCuenta,
          number: targetNumber,
          text: optimisticMessage.contenido
        });
      }
    } catch (error) {
      console.error("Error enviando el mensaje:", error);
      // Podríamos mostrar un error en la UI o quitar el mensaje optimista
    } finally {
      setLoading(false);
    }
  };

  const handleAssignGroup = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!conversacion) return;
    const groupId = e.target.value;
    setIsAssigning(true);

    try {
      if (conversacion.grupo_asignado) {
        if (groupId) {
          // Update
          await axios.put(`/api/conversaciones-grupo/${conversacion.grupo_asignado.id}`, {
            id_grupo_atencion: parseInt(groupId)
          });
        } else {
          // Delete
          await axios.delete(`/api/conversaciones-grupo/${conversacion.grupo_asignado.id}`);
        }
      } else if (groupId) {
        // Create
        await axios.post('/api/conversaciones-grupo/', {
          id_conversacion: conversacion.id,
          id_grupo_atencion: parseInt(groupId)
        });
      }
      if (onConversacionUpdated) onConversacionUpdated();
    } catch (error) {
      console.error("Error asignando grupo:", error);
    } finally {
      setIsAssigning(false);
    }
  };

  const handleAssignAgent = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!conversacion || !conversacion.grupo_asignado) return;
    const agentId = e.target.value;
    setIsAssigning(true);

    try {
      await axios.put(`/api/conversaciones-grupo/${conversacion.grupo_asignado.id}`, {
        id_agente: agentId ? parseInt(agentId) : null
      });
      if (onConversacionUpdated) onConversacionUpdated();
    } catch (error) {
      console.error("Error asignando agente:", error);
    } finally {
      setIsAssigning(false);
    }
  };

  const handleTomarConversacion = async () => {
    if (!conversacion || !currentUserIdAgente) return;
    setIsAssigning(true);
    try {
      if (conversacion.grupo_asignado) {
        await axios.put(`/api/conversaciones-grupo/${conversacion.grupo_asignado.id}`, {
          id_agente: currentUserIdAgente
        });
      } else {
        // En FluxChat, la base de datos exige que la conversación pertenezca a un grupo obligatoriamente
        // para tener la entidad "conversacion_grupo". Podríamos asignarla al primer grupo del agente:
        // Pero primero veamos si podemos dejarla "sin grupo". La tabla "conversaciones_grupo" exige id_grupo_atencion.
        // Alertemos al usuario que necesita un grupo.
        const res = await axios.get(`/api/agentes-grupo/?id_agente=${currentUserIdAgente}`);
        if (res.data && res.data.length > 0) {
          const primerGrupo = res.data[0].id_grupo;
          await axios.post('/api/conversaciones-grupo/', {
            id_conversacion: conversacion.id,
            id_grupo_atencion: primerGrupo,
            id_agente: currentUserIdAgente
          });
        } else {
          alert("No puedes tomarla directamente sin un grupo porque tu agente no pertenece a ningún grupo de atención. Un admin debe asignarle un grupo a la conversación primero.");
          setIsAssigning(false);
          return;
        }
      }
      if (onConversacionUpdated) onConversacionUpdated();
    } catch (error) {
      console.error("Error tomando conversacion:", error);
    } finally {
      setIsAssigning(false);
    }
  };

  const handleSaveContactDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!conversacion?.contacto?.numero_contacto) return;

    try {
      const response = await axios.post(`/api/conversaciones/contactos/${conversacion.contacto.numero_contacto}/datos`, {
        nombres: nombres.trim() || null,
        apellidos: apellidos.trim() || null,
        documento: documento.trim() || null,
        correo: correo.trim() || null
      });
      
      // Actualizar estado local inmediatamente
      if (conversacion.contacto) {
        conversacion.contacto.datos_contacto = response.data;
      }
      
      setIsContactModalOpen(false);
      if (onConversacionUpdated) onConversacionUpdated();
    } catch (error) {
      console.error("Error saving contact details:", error);
      alert("Error al guardar los datos del contacto");
    }
  };

  if (!conversacion) {
    return (
      <div className="hidden lg:flex flex-1 flex-col h-screen chat-bg items-center justify-center">
        <div className="text-center p-12 max-w-sm">
          <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <MessageSquare size={40} strokeWidth={1.25} className="text-gray-300" />
          </div>
          <h3 className="text-2xl font-bold text-gray-900 tracking-tight">FluxChat</h3>
          <p className="text-gray-400 mt-3 text-[15px] font-medium leading-relaxed">Selecciona una conversación en la lista para comenzar a chatear.</p>
        </div>
      </div>
    );
  }

  const datos = conversacion.contacto?.datos_contacto;
  const displayName = datos && (datos.nombres || datos.apellidos)
    ? `${datos.nombres || ''} ${datos.apellidos || ''}`.trim()
    : conversacion.contacto?.pushName || `+${conversacion.contacto?.numero_contacto}` || 'Desconocido';
  
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className={`flex-1 flex-col h-screen chat-bg ${conversacion ? 'flex' : 'hidden lg:flex'}`}>
      {/* Header */}
      <header className="h-[80px] flex items-center px-8 bg-white shrink-0 z-10">
        <button 
          className="lg:hidden p-2 mr-4 text-gray-500 hover:bg-gray-50 rounded-2xl transition-colors"
          onClick={onBack}
        >
          <ArrowLeft size={20} strokeWidth={1.5} />
        </button>
        <div className="flex items-center gap-4">
          <div className="w-[48px] h-[48px] rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-lg shrink-0">
            {initial}
          </div>
          <div>
            <h2 className="text-[18px] font-bold text-gray-900 leading-tight tracking-tight flex items-center gap-2">
              <span>{displayName}</span>
              {conversacion.contacto?.pushName && (datos?.nombres || datos?.apellidos) && (
                <span className="text-[12px] text-gray-400 font-normal">
                  (WA: {conversacion.contacto.pushName})
                </span>
              )}
              <span className="text-[13px] text-gray-400 font-normal">
                (+{conversacion.contacto?.numero_contacto})
              </span>
              <button
                onClick={() => setIsContactModalOpen(true)}
                className="p-1 hover:bg-gray-100 rounded-md text-blue-500 hover:text-blue-700 transition-colors flex items-center"
                title="Editar/Cargar datos de contacto"
              >
                <UserCog size={16} />
              </button>
            </h2>
            <p className="text-[12px] text-gray-400 font-medium mt-0.5 flex items-center gap-2 flex-wrap">
              {conversacion.contacto?.pushName && !datos?.nombres && !datos?.apellidos && (
                <span>WhatsApp: {conversacion.contacto.pushName}</span>
              )}
              {datos?.documento && (
                <span>• CI/RUC: {datos.documento}</span>
              )}
              {datos?.correo && (
                <span>• Correo: {datos.correo}</span>
              )}
              {conversacion.canal && (
                <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-500 border border-blue-100 shrink-0">
                  Canal: {conversacion.canal.nombre_interno || conversacion.canal.nombre_cuenta}
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Assignment Controls */}
        <div className="ml-auto flex items-center gap-3 text-sm">
          <div className={`flex items-center gap-2 rounded-full px-4 py-2 transition-colors ${currentUserProfile === 'agente' ? 'bg-transparent opacity-80' : 'bg-gray-50 hover:bg-gray-100'}`}>
            <Users size={16} strokeWidth={1.5} className="text-gray-400" />
            <select 
              value={conversacion.grupo_asignado?.id_grupo_atencion || ""} 
              onChange={handleAssignGroup}
              disabled={isAssigning || currentUserProfile === 'agente'}
              className="bg-transparent border-none focus:ring-0 text-gray-700 py-0 pl-1 pr-6 cursor-pointer text-[13px] font-semibold w-32 disabled:opacity-50 appearance-none outline-none"
            >
              <option value="">Sin Grupo</option>
              {grupos.map(g => (
                <option key={g.id} value={g.id}>{g.nombre_grupo}</option>
              ))}
            </select>
          </div>

          <div className={`flex items-center gap-2 rounded-full px-4 py-2 transition-colors ${(conversacion.grupo_asignado && currentUserProfile !== 'agente') ? 'bg-gray-50 hover:bg-gray-100' : 'bg-transparent opacity-80'}`}>
            <UserPlus size={16} strokeWidth={1.5} className="text-gray-400" />
            <select 
              value={conversacion.grupo_asignado?.id_agente || ""} 
              onChange={handleAssignAgent}
              disabled={isAssigning || !conversacion.grupo_asignado || currentUserProfile === 'agente'}
              className="bg-transparent border-none focus:ring-0 text-gray-700 py-0 pl-1 pr-6 cursor-pointer text-[13px] font-semibold w-32 disabled:opacity-50 appearance-none outline-none"
            >
              <option value="">Sin Agente</option>
              {agentes.map(a => (
                <option key={a.id} value={a.id}>{a.nombre_agente}</option>
              ))}
            </select>
          </div>
          
          {/* Tomar Conversacion button for Agents */}
          {currentUserProfile === 'agente' && !conversacion.grupo_asignado?.id_agente && (
            <button 
              onClick={handleTomarConversacion}
              disabled={isAssigning}
              className="ml-2 bg-blue-500 hover:bg-blue-600 text-white px-5 py-2 rounded-full text-[13px] font-bold transition-all disabled:opacity-50 flex items-center active:scale-95"
            >
              Tomar Conversación
            </button>
          )}
        </div>
      </header>

      {/* Messages Area */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-2.5"
      >
        {messages.map((msg, idx) => {
          const isOut = msg.tipo === 'OUT';
          const msgDateStr = getMessageDateString(msg.timestamp);
          const prevMsg = idx > 0 ? messages[idx - 1] : null;
          const prevMsgDateStr = prevMsg ? getMessageDateString(prevMsg.timestamp) : null;
          const showDateHeader = msgDateStr !== prevMsgDateStr;

          return (
            <div key={msg.message_id || idx} className="w-full">
              {showDateHeader && (
                <div className="flex justify-center my-4">
                  <span className="bg-gray-100 text-gray-600 text-[11px] font-bold px-4 py-1.5 rounded-full shadow-sm border border-gray-200/50">
                    {msgDateStr}
                  </span>
                </div>
              )}
              <div 
                className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}
              >
                <div 
                  className={`max-w-[85%] md:max-w-[70%] px-4 py-3 relative ${
                    isOut 
                      ? 'bg-gray-800 text-white rounded-[20px]' 
                      : 'bg-gray-50 text-gray-800 rounded-[20px]'
                  }`}
                >
                {!isOut && msg.pushName && (
                  <div className="text-[11px] font-bold text-gray-400 mb-1 tracking-wide">
                    {msg.pushName}
                  </div>
                )}
                {isOut && (msg.nombre_cuenta || msg.numero_cuenta) && (
                  <div className="text-[9px] font-bold text-gray-400 mb-1 pb-1 uppercase tracking-wider">
                    {msg.nombre_cuenta || msg.numero_cuenta} {msg.numero_cuenta ? `(${msg.numero_cuenta})` : ''}
                  </div>
                )}
                <div className={`text-[14px] break-words whitespace-pre-wrap leading-relaxed ${isOut ? 'text-gray-100' : 'text-gray-800'}`}>
                  {msg.media_url && msg.mimetype?.startsWith('image/') && (
                    <img src={msg.media_url} alt="Media" className="max-w-full rounded-[12px] mb-1.5 max-h-48 object-contain" />
                  )}
                  {msg.media_url && msg.mimetype?.startsWith('audio/') && (
                    <audio controls src={msg.media_url} className="w-full max-w-[200px] mb-1.5 h-8" />
                  )}
                  {msg.media_url && msg.mimetype?.startsWith('video/') && (
                    <video controls src={msg.media_url} className="w-full max-w-sm rounded-[12px] mb-1.5 max-h-48" />
                  )}
                  {msg.media_url && !msg.mimetype?.startsWith('image/') && !msg.mimetype?.startsWith('audio/') && !msg.mimetype?.startsWith('video/') && (
                    <a href={msg.media_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 bg-black/5 p-2 rounded-[12px] mb-1.5 hover:bg-black/10 transition-colors w-fit">
                      <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
                      <span className="text-xs font-medium text-blue-500 underline">Descargar archivo</span>
                    </a>
                  )}
                  {msg.contenido}
                </div>
                <div className={`text-[9px] text-right mt-1.5 flex justify-end items-center gap-1.5 font-medium text-gray-400`}>
                  {msg.timestamp && msg.timestamp !== 'now()' 
                    ? new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) 
                    : new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  {isOut && (
                    <span className="inline-flex items-center">
                      {msg.status === 'PENDING' && <Clock size={11} className="text-gray-400 animate-pulse" />}
                      {msg.status === 'SERVER_ACK' && <Check size={11} className="text-gray-400" />}
                      {msg.status === 'DELIVERY_ACK' && <CheckCheck size={11} className="text-gray-400" />}
                      {msg.status === 'READ' && <CheckCheck size={11} className="text-blue-500" />}
                      {(msg.status === 'ERROR' || msg.status === 'FAILED') && <AlertCircle size={11} className="text-red-500" />}
                      {!msg.status && <Check size={11} className="text-gray-400" />}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
          );
        })}
        {loading && (
          <div className="flex justify-end">
             <div className="text-xs text-gray-400 bg-gray-50 px-3 py-1.5 rounded-full">Enviando...</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-6 bg-white shrink-0">
        {currentUserProfile === 'agente' && conversacion.grupo_asignado?.id_agente !== currentUserIdAgente ? (
          <div className="flex justify-center p-4 rounded-3xl bg-gray-50">
            <span className="text-[14px] text-gray-500 font-semibold">No puedes enviar mensajes a esta conversación porque no está asignada a ti.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-3 max-w-5xl mx-auto">
            {selectedFile && (
              <div className="flex items-center gap-3 p-2 bg-gray-50 rounded-[16px] w-fit mb-1 relative">
                <button 
                  onClick={clearSelectedFile}
                  className="absolute -top-2 -right-2 bg-white text-gray-400 hover:text-red-500 rounded-full p-1 shadow-[0_4px_12px_rgba(0,0,0,0.05)] transition-colors"
                >
                  <X size={12} strokeWidth={2} />
                </button>
                {filePreview ? (
                  <img src={filePreview} alt="Preview" className="w-10 h-10 object-cover rounded-lg" />
                ) : (
                  <div className="w-10 h-10 bg-white text-blue-500 rounded-lg flex items-center justify-center">
                    <FileText size={20} strokeWidth={1.5} />
                  </div>
                )}
                <div className="flex flex-col pr-3">
                  <span className="text-xs font-semibold text-gray-700 max-w-[150px] truncate">{selectedFile.name}</span>
                  <span className="text-[10px] text-gray-400 font-medium">{(selectedFile.size / 1024).toFixed(1)} KB</span>
                </div>
              </div>
            )}
            <div className="flex gap-2 bg-gray-50 rounded-[28px] px-2.5 py-2.5 transition-all focus-within:bg-white focus-within:shadow-[0_4px_12px_rgba(0,0,0,0.05)]">
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                className="hidden" 
                accept="image/*,application/pdf"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="text-gray-400 hover:text-gray-800 rounded-full p-3 flex items-center justify-center transition-all"
                title="Adjuntar imagen o PDF"
              >
                <Paperclip size={22} strokeWidth={1.5} />
              </button>
              <input
                type="text"
                className="flex-1 bg-transparent px-4 py-2 focus:outline-none text-gray-700 text-[15px] placeholder:text-gray-400 font-medium"
                placeholder="Escribe tu mensaje..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                disabled={loading}
              />
              <button 
                onClick={handleSend}
                disabled={(!input.trim() && !selectedFile) || loading}
                className="bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-100 disabled:text-gray-300 rounded-full w-12 h-12 flex items-center justify-center transition-all active:scale-95"
              >
                <Send size={20} strokeWidth={1.5} className="transform translate-x-[2px] translate-y-[-1px]" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Contact Details Modal */}
      {isContactModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setIsContactModalOpen(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-2 rounded-full hover:bg-gray-50 transition-all cursor-pointer"
            >
              <X size={18} />
            </button>
            <div className="flex items-center gap-3 border-b border-gray-100 pb-4 mb-4">
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-2xl">
                <UserCog size={22} />
              </div>
              <div className="text-left">
                <h3 className="text-lg font-bold text-gray-900">Datos de Contacto</h3>
                <p className="text-xs text-gray-500">Asociados al número +{conversacion.contacto?.numero_contacto}</p>
              </div>
            </div>

            <form onSubmit={handleSaveContactDetails} className="space-y-4">
              <div className="text-left">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Nombres</label>
                <input
                  type="text"
                  value={nombres}
                  onChange={(e) => setNombres(e.target.value)}
                  placeholder="Ej. Juan Andrés"
                  className="w-full bg-gray-50 border border-gray-200 focus:border-blue-500 rounded-2xl px-4 py-3 text-sm focus:outline-none transition-colors text-gray-700 font-medium"
                />
              </div>

              <div className="text-left">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Apellidos</label>
                <input
                  type="text"
                  value={apellidos}
                  onChange={(e) => setApellidos(e.target.value)}
                  placeholder="Ej. Pérez Gómez"
                  className="w-full bg-gray-50 border border-gray-200 focus:border-blue-500 rounded-2xl px-4 py-3 text-sm focus:outline-none transition-colors text-gray-700 font-medium"
                />
              </div>

              <div className="text-left">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Documento (CI / RUC)</label>
                <input
                  type="text"
                  value={documento}
                  onChange={(e) => setDocumento(e.target.value)}
                  placeholder="Ej. 1234567-8"
                  className="w-full bg-gray-50 border border-gray-200 focus:border-blue-500 rounded-2xl px-4 py-3 text-sm focus:outline-none transition-colors text-gray-700 font-medium"
                />
              </div>

              <div className="text-left">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Correo Electrónico</label>
                <input
                  type="email"
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  placeholder="Ej. juan.perez@gmail.com"
                  className="w-full bg-gray-50 border border-gray-200 focus:border-blue-500 rounded-2xl px-4 py-3 text-sm focus:outline-none transition-colors text-gray-700 font-medium"
                />
              </div>

              <div className="flex gap-3 pt-4 border-t border-gray-100 mt-6">
                <button
                  type="button"
                  onClick={() => setIsContactModalOpen(false)}
                  className="flex-1 border border-gray-200 hover:bg-gray-50 text-gray-500 font-bold py-3 px-4 rounded-2xl text-sm transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-4 rounded-2xl text-sm shadow-md hover:shadow-lg transition-all active:scale-95 cursor-pointer"
                >
                  Guardar Datos
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
