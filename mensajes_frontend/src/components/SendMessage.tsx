import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Menu, Send, MessageSquarePlus, Paperclip, X, FileText, Image, Video } from 'lucide-react';
import { getFriendlyError } from '../utils/errorFormatter';

interface SendMessageProps {
  onOpenSidebar: () => void;
}

interface CuentaActiva {
  cuenta_id: string;
  nombre_cuenta: string;
  numero_cuenta: string;
  estado?: string;
  nombre_interno?: string;
}

export default function SendMessage({ onOpenSidebar }: SendMessageProps) {
  const [cuentas, setCuentas] = useState<CuentaActiva[]>([]);
  const [nombreCuenta, setNombreCuenta] = useState('');
  const [countryCode, setCountryCode] = useState('595');
  const [number, setNumber] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Realizar la sincronización de las instancias primero
        await axios.post('/api/evolution/sync-instances').catch(err => {
          console.error("Error sincronizando instancias de forma transparente:", err);
        });

        const response = await axios.get('/api/cuentas/');
        // Guardar todas las cuentas en estado
        setCuentas(response.data);
        
        // Filtrar solo las activas/conectadas para el uso por defecto
        const cuentasConectadas = response.data.filter((c: CuentaActiva) => c.estado === 'Conectado');
        let defaultCuenta = cuentasConectadas.length > 0 ? cuentasConectadas[0].nombre_cuenta : '';

        const userLocal = localStorage.getItem('usuario');
        if (userLocal) {
          const user = JSON.parse(userLocal);
          if (user.id_agente) {
             const agentResponse = await axios.get(`/api/agentes-atencion/${user.id_agente}`);
             if (agentResponse.data.canal) {
                 defaultCuenta = agentResponse.data.canal.nombre_cuenta;
             }
          }
        }
        
        setNombreCuenta(defaultCuenta);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };
    fetchData();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      
      const fileType = file.type;
      const isImage = fileType.startsWith('image/');
      const isPdf = fileType === 'application/pdf';
      const isVideo = fileType.startsWith('video/');

      if (!isImage && !isPdf && !isVideo) {
        setErrorMsg("Formato de adjunto no soportado. Debe ser imagen, PDF o video.");
        setSelectedFile(null);
        setFilePreview(null);
        return;
      }

      setErrorMsg('');
      setSelectedFile(file);
      
      if (isImage) {
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

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombreCuenta.trim() || !number.trim() || (!text.trim() && !selectedFile)) return;

    setLoading(true);
    setSuccessMsg('');
    setErrorMsg('');

    // Asegurarnos de limpiar el número de cualquier prefijo repetido si el usuario ya lo ingresó con el código de país.
    let cleanNumber = number.trim().replace(/\D/g, ''); // eliminar todo lo que no sea número
    const selectedCountryCode = countryCode.trim();

    if (selectedCountryCode) {
      if (cleanNumber.startsWith(selectedCountryCode)) {
        // Si el número ingresado ya empieza con el código de país elegido, no lo duplicamos
        cleanNumber = cleanNumber.slice(selectedCountryCode.length);
      }
    }

    const finalNumber = selectedCountryCode + cleanNumber;

    try {
      if (selectedFile) {
        // Envío con adjunto por multipart/form-data (sin base64 en el navegador).
        // El backend comprime el video si supera el límite de WhatsApp.
        const formData = new FormData();
        formData.append('nombre_cuenta', nombreCuenta);
        formData.append('number', finalNumber);
        formData.append('text', text);
        formData.append('media_file', selectedFile);

        await axios.post('/api/evolution/message/send-media', formData);
      } else {
        await axios.post('/api/evolution/message/send', {
          nombre_cuenta: nombreCuenta,
          number: finalNumber,
          text: text
        });
      }
      setSuccessMsg('Mensaje enviado exitosamente a la cola de envío.');
      setNumber('');
      setText('');
      clearSelectedFile();
    } catch (error: any) {
      console.error("Error sending message:", error);
      const rawError = error.response?.data?.detail || "Ocurrió un error al enviar el mensaje.";
      setErrorMsg(getFriendlyError(rawError));
    } finally {
      setLoading(false);
    }
  };

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
            <MessageSquarePlus size={24} className="text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-800">Enviar Mensaje</h2>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#f4f7f6] flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 w-full max-w-md overflow-hidden">
          <div className="p-5 border-b border-gray-50 bg-gray-50/50">
            <h3 className="text-base font-semibold text-gray-800">Nuevo Mensaje Manual</h3>
            <p className="text-xs text-gray-500 mt-1">Inicia una conversación de forma directa.</p>
          </div>
          
          <form onSubmit={handleSend} className="p-5 space-y-4">
            {successMsg && (
              <div className="bg-green-50 text-green-700 p-2.5 rounded-lg text-sm border border-green-100 font-medium">
                {successMsg}
              </div>
            )}
            
            {errorMsg && (
              <div className="bg-red-50 text-red-700 p-2.5 rounded-lg text-sm border border-red-100 font-medium">
                {errorMsg}
              </div>
            )}

            <div>
              <label className="block text-[13px] font-semibold text-gray-700 mb-1">
                Línea de Envío
              </label>
              <select
                value={nombreCuenta}
                onChange={(e) => setNombreCuenta(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow bg-white"
                required
                disabled={loading}
              >
                {cuentas.filter(c => c.estado === 'Conectado').length === 0 && (
                  <option value="">No hay canales activos o conectados</option>
                )}
                {cuentas.filter(c => c.estado === 'Conectado').map(cuenta => (
                  <option key={cuenta.cuenta_id} value={cuenta.nombre_cuenta}>
                    {cuenta.nombre_interno ? `${cuenta.nombre_interno} (${cuenta.nombre_cuenta})` : cuenta.nombre_cuenta} (+{cuenta.numero_cuenta})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-gray-700 mb-1">
                Número de Destino
              </label>
              <div className="flex gap-2">
                <select
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className="w-24 border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow bg-white"
                  disabled={loading}
                >
                  <option value="595">+595</option>
                  <option value="">Otro</option>
                </select>
                <input
                  type="text"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                  placeholder={countryCode ? "Ej: 981123456" : "Ej: 5491123456789"}
                  required
                  disabled={loading}
                />
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                {countryCode ? "Ingresa el número sin el código de país." : "Ingresa el código de país sin el signo +."}
              </p>
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-gray-700 mb-1">
                Mensaje
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow resize-none h-24 mb-2"
                placeholder="Escribe tu mensaje..."
                required={!selectedFile}
                disabled={loading}
              ></textarea>
              
              {/* Adjuntar Archivo */}
              <div className="flex flex-col gap-2 border border-gray-200 rounded-lg p-3 bg-gray-50/50">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium text-gray-600 flex items-center gap-2">
                    <Paperclip size={16} /> Adjuntar Imagen, PDF o Video
                  </span>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileChange} 
                    className="hidden" 
                    accept="image/*,application/pdf,video/*"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading}
                    className="text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-md transition-colors"
                  >
                    Seleccionar Archivo
                  </button>
                </div>
                
                {selectedFile && (
                  <div className="flex items-center justify-between bg-white border border-gray-200 p-2 rounded-md mt-1">
                    <div className="flex items-center gap-3">
                      {filePreview ? (
                        <img src={filePreview} alt="Preview" className="w-10 h-10 object-cover rounded shadow-sm border border-gray-100" />
                      ) : selectedFile.type.startsWith('video/') ? (
                        <div className="w-10 h-10 bg-purple-50 text-purple-500 rounded flex items-center justify-center border border-purple-100">
                          <Video size={20} />
                        </div>
                      ) : selectedFile.type === 'application/pdf' ? (
                        <div className="w-10 h-10 bg-red-50 text-red-500 rounded flex items-center justify-center border border-red-100">
                          <FileText size={20} />
                        </div>
                      ) : (
                        <div className="w-10 h-10 bg-blue-50 text-blue-500 rounded flex items-center justify-center border border-blue-100">
                          <FileText size={20} />
                        </div>
                      )}
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold text-gray-700 truncate max-w-[180px]">{selectedFile.name}</span>
                        <span className="text-[10px] text-gray-400">{(selectedFile.size / 1024).toFixed(1)} KB</span>
                      </div>
                    </div>
                    <button 
                      type="button"
                      onClick={clearSelectedFile}
                      className="text-gray-400 hover:text-red-500 p-1.5 rounded-md hover:bg-red-50 transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={loading || cuentas.length === 0}
                className="flex items-center justify-center w-full gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50"
              >
                {loading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                ) : (
                  <Send size={16} className="transform rotate-45 -ml-1 mt-0.5" />
                )}
                <span>{loading ? 'Enviando...' : 'Enviar Mensaje'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
