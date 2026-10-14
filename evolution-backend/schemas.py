from pydantic import BaseModel
from datetime import datetime

class CuentaActivaBase(BaseModel):
    cuenta_id: str
    nombre_cuenta: str
    token_cuenta: str
    numero_cuenta: str | None = None
    webhook_url: str | None = None
    estado: str | None = None
    server_url: str | None = None
    apikey: str | None = None
    nombre_interno: str | None = None

class CuentaActivaCreate(CuentaActivaBase):
    pass

class CuentaActivaUpdate(BaseModel):
    cuenta_id: str | None = None
    nombre_cuenta: str | None = None
    token_cuenta: str | None = None
    numero_cuenta: str | None = None
    webhook_url: str | None = None
    estado: str | None = None
    server_url: str | None = None
    apikey: str | None = None
    nombre_interno: str | None = None

class CuentaActivaResponse(CuentaActivaBase):
    class Config:
        from_attributes = True

class DatosContactoBase(BaseModel):
    numero_contacto: str
    nombres: str | None = None
    apellidos: str | None = None
    documento: str | None = None
    correo: str | None = None

class DatosContactoCreate(BaseModel):
    nombres: str | None = None
    apellidos: str | None = None
    documento: str | None = None
    correo: str | None = None

class DatosContactoResponse(DatosContactoBase):
    id: int
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True

class ContactoResponse(BaseModel):
    id: int
    remoteJid: str
    numero_contacto: str | None = None
    pushName: str | None = None
    datos_contacto: DatosContactoResponse | None = None
    
    class Config:
        from_attributes = True

class ConversacionGrupoNested(BaseModel):
    id: int
    id_conversacion: int
    id_grupo_atencion: int
    id_agente: int | None = None
    grupo_atencion: 'GrupoAtencionResponse | None' = None
    agente: 'AgentesAtencionResponse | None' = None

    class Config:
        from_attributes = True

class ConversacionResponse(BaseModel):
    id: int
    id_contacto: int
    id_canal: str | None = None
    activo: bool
    nuevo_mensaje: bool | None = False
    created_at: datetime | None = None
    updated_at: datetime | None = None
    contacto: ContactoResponse | None = None
    canal: CuentaActivaResponse | None = None
    grupo_asignado: ConversacionGrupoNested | None = None

    class Config:
        from_attributes = True

class SendMessageRequest(BaseModel):
    nombre_cuenta: str
    number: str
    text: str | None = None
    media: str | None = None
    mimetype: str | None = None
    fileName: str | None = None

# --- Grupo Atencion Schemas ---

class GrupoAtencionBase(BaseModel):
    nombre_grupo: str

class GrupoAtencionCreate(GrupoAtencionBase):
    pass

class GrupoAtencionUpdate(BaseModel):
    nombre_grupo: str | None = None

class GrupoAtencionResponse(GrupoAtencionBase):
    id: int
    class Config:
        from_attributes = True

# --- Agentes Atencion Schemas ---

class AgentesAtencionBase(BaseModel):
    login_agente: str
    nombre_agente: str
    ver_sin_grupo: bool = False
    id_canal: str | None = None

class AgentesAtencionCreate(AgentesAtencionBase):
    pass

class AgentesAtencionUpdate(BaseModel):
    login_agente: str | None = None
    nombre_agente: str | None = None
    ver_sin_grupo: bool | None = None
    id_canal: str | None = None

class AgentesAtencionResponse(AgentesAtencionBase):
    id: int
    canal: CuentaActivaResponse | None = None
    class Config:
        from_attributes = True

# --- Agentes Grupo Schemas ---

class AgentesGrupoBase(BaseModel):
    id_agente: int
    id_grupo: int

class AgentesGrupoCreate(AgentesGrupoBase):
    pass

class AgentesGrupoUpdate(BaseModel):
    id_agente: int | None = None
    id_grupo: int | None = None

class AgentesGrupoResponse(AgentesGrupoBase):
    id: int
    agente: AgentesAtencionResponse | None = None
    grupo: GrupoAtencionResponse | None = None
    class Config:
        from_attributes = True

# --- Conversaciones Grupo Schemas ---

class ConversacionGrupoBase(BaseModel):
    id_conversacion: int
    id_grupo_atencion: int
    id_agente: int | None = None

class ConversacionGrupoCreate(ConversacionGrupoBase):
    pass

class ConversacionGrupoUpdate(BaseModel):
    id_conversacion: int | None = None
    id_grupo_atencion: int | None = None
    id_agente: int | None = None

class ConversacionGrupoResponse(ConversacionGrupoBase):
    id: int
    conversacion: ConversacionResponse | None = None
    grupo_atencion: GrupoAtencionResponse | None = None
    agente: AgentesAtencionResponse | None = None
    class Config:
        from_attributes = True

# --- Usuario Schemas ---

class UsuarioBase(BaseModel):
    usuario: str
    nombre: str
    perfil: str
    id_agente: int | None = None

class UsuarioCreate(UsuarioBase):
    password: str

class UsuarioUpdate(BaseModel):
    usuario: str | None = None
    nombre: str | None = None
    perfil: str | None = None
    password: str | None = None
    id_agente: int | None = None

class UsuarioResponse(UsuarioBase):
    id: int

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str
    usuario: UsuarioResponse | None = None

class TokenData(BaseModel):
    usuario: str | None = None

# --- Lote Envio Schemas ---

class LoteDestinatarioResponse(BaseModel):
    id: int
    id_lote: int
    numero: str
    variable: str | None = None
    mensaje_personalizado: str
    estado: str
    error: str | None = None
    fecha_envio: datetime | None = None
    message_id: str | None = None

    class Config:
        from_attributes = True

class LoteEnvioBase(BaseModel):
    nombre_lote: str
    cuenta_id: str
    plantilla: str
    id_grupo_atencion: int | None = None
    media_path: str | None = None
    media_mimetype: str | None = None
    media_filename: str | None = None

class LoteEnvioCreate(LoteEnvioBase):
    pass

class LoteEnvioResponse(LoteEnvioBase):
    id: int
    total_mensajes: int
    enviados: int
    fallidos: int
    estado: str
    fecha_programada: datetime | None = None
    created_at: datetime
    updated_at: datetime | None = None
    cuenta: CuentaActivaResponse | None = None
    grupo_atencion: 'GrupoAtencionResponse | None' = None

    class Config:
        from_attributes = True

class LoteEnvioDetailResponse(LoteEnvioResponse):
    destinatarios: list[LoteDestinatarioResponse] = []

class EvolutionInstanceCreate(BaseModel):
    instanceName: str
    token: str | None = None
    number: str | None = None


