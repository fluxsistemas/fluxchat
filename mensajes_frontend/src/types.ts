export interface DatosContacto {
  id: number;
  numero_contacto: string;
  nombres?: string;
  apellidos?: string;
  documento?: string;
  correo?: string;
}

export interface Contacto {
  id: number;
  remoteJid: string;
  numero_contacto: string;
  pushName: string;
  datos_contacto?: DatosContacto | null;
}

export interface GrupoAtencion {
  id: number;
  nombre_grupo: string;
}

export interface CuentaActiva {
  cuenta_id: string;
  nombre_cuenta: string;
  numero_cuenta: string;
  nombre_interno?: string;
}

export interface AgentesAtencion {
  id: number;
  login_agente: string;
  nombre_agente: string;
  ver_sin_grupo: boolean;
  id_canal?: string;
  canal?: CuentaActiva;
}

export interface AgentesGrupo {
  id: number;
  id_agente: number;
  id_grupo: number;
  agente?: AgentesAtencion;
  grupo?: GrupoAtencion;
}

export interface Usuario {
  id: number;
  usuario: string;
  nombre: string;
  perfil: string;
  id_agente?: number;
}

export interface ConversacionGrupo {
  id: number;
  id_conversacion: number;
  id_grupo_atencion: number;
  id_agente?: number;
  grupo_atencion?: GrupoAtencion;
  agente?: AgentesAtencion;
}

export interface Conversacion {
  id: number;
  id_contacto: number;
  id_canal: string;
  activo: boolean;
  nuevo_mensaje?: boolean;
  created_at?: string;
  updated_at?: string;
  contacto: Contacto;
  canal?: CuentaActiva | null;
  grupo_asignado?: ConversacionGrupo;
}

export interface Mensaje {
  message_id: string;
  tipo: 'IN' | 'OUT';
  contenido: string;
  media_url?: string | null;
  mimetype?: string | null;
  timestamp: string;
  pushName: string;
  nombre_cuenta?: string;
  numero_cuenta?: string;
  status?: 'PENDING' | 'SERVER_ACK' | 'DELIVERY_ACK' | 'READ' | 'ERROR' | 'FAILED';
}

export interface SendMessageRequest {
  nombre_cuenta: string;
  number: string;
  text?: string;
  media?: string;
  mimetype?: string;
  fileName?: string;
}
