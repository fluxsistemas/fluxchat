from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base

class CuentaActiva(Base):
    __tablename__ = "cuentas_activas"

    cuenta_id = Column(String, primary_key=True, index=True)
    nombre_cuenta = Column(String, index=True, nullable=False)
    token_cuenta = Column(String, unique=True, index=True, nullable=False)
    numero_cuenta = Column(String, unique=True, index=True, nullable=True)
    webhook_url = Column(String, nullable=True)
    estado = Column(String, nullable=True, default="Desconectado")
    server_url = Column(String, nullable=True)
    apikey = Column(String, nullable=True)
    nombre_interno = Column(String, nullable=True)

class ContactoConversacion(Base):
    __tablename__ = "contactos_conversaciones"
    id = Column(Integer, primary_key=True, index=True)
    remoteJid = Column(String, unique=True, index=True, nullable=False)
    numero_contacto = Column(String, index=True)
    id_contacto = Column(String) # valor de "data":"key":"id" según requerimiento
    pushName = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    datos_contacto = relationship("DatosContacto", primaryjoin="ContactoConversacion.numero_contacto == DatosContacto.numero_contacto", foreign_keys="[DatosContacto.numero_contacto]", uselist=False, lazy="joined")

class DatosContacto(Base):
    __tablename__ = "datos_contacto"
    id = Column(Integer, primary_key=True, index=True)
    numero_contacto = Column(String, unique=True, index=True, nullable=False)
    nombres = Column(String, nullable=True)
    apellidos = Column(String, nullable=True)
    documento = Column(String, nullable=True)
    correo = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

class ConversacionSesion(Base):
    __tablename__ = "conversaciones_sesion"
    id = Column(Integer, primary_key=True, index=True)
    id_contacto = Column(Integer, ForeignKey("contactos_conversaciones.id"))
    id_canal = Column(String, ForeignKey("cuentas_activas.cuenta_id"))
    activo = Column(Boolean, default=True)
    nuevo_mensaje = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    contacto = relationship("ContactoConversacion")
    canal = relationship("CuentaActiva")
    grupo_asignado = relationship("ConversacionGrupo", back_populates="conversacion", uselist=False)

class MensajeData(Base):
    __tablename__ = "mensajes_data"
    id = Column(Integer, primary_key=True, index=True)
    id_conversacion = Column(Integer, ForeignKey("conversaciones_sesion.id"))
    id_contacto = Column(Integer, ForeignKey("contactos_conversaciones.id"))
    tipo = Column(String) # IN, OUT
    contenido = Column(Text)
    media_url = Column(Text, nullable=True)
    mimetype = Column(Text, nullable=True)
    message_id = Column(String) # data.key.id
    status = Column(String, nullable=True) # PENDING, SERVER_ACK, DELIVERY_ACK, READ, ERROR, FAILED
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True)

class GrupoAtencion(Base):
    __tablename__ = "grupo_atencion"
    id = Column(Integer, primary_key=True, index=True)
    nombre_grupo = Column(String, index=True, nullable=False)

class AgentesAtencion(Base):
    __tablename__ = "agentes_atencion"
    id = Column(Integer, primary_key=True, index=True)
    login_agente = Column(String, unique=True, index=True, nullable=False)
    nombre_agente = Column(String, index=True, nullable=False)
    ver_sin_grupo = Column(Boolean, default=False)
    id_canal = Column(String, ForeignKey("cuentas_activas.cuenta_id"), nullable=True)

    canal = relationship("CuentaActiva")

class AgentesGrupo(Base):
    __tablename__ = "agentes_grupo"
    id = Column(Integer, primary_key=True, index=True)
    id_agente = Column(Integer, ForeignKey("agentes_atencion.id"), nullable=False)
    id_grupo = Column(Integer, ForeignKey("grupo_atencion.id"), nullable=False)

    agente = relationship("AgentesAtencion")
    grupo = relationship("GrupoAtencion")

class Usuario(Base):
    __tablename__ = "usuarios"
    id = Column(Integer, primary_key=True, index=True)
    usuario = Column(String, unique=True, index=True, nullable=False)
    nombre = Column(String, nullable=False)
    perfil = Column(String, nullable=False) # agente, supervisor, admin
    hashed_password = Column(String, nullable=False)
    id_agente = Column(Integer, ForeignKey("agentes_atencion.id"), nullable=True)

    agente = relationship("AgentesAtencion")

class ConversacionGrupo(Base):
    __tablename__ = "conversaciones_grupo"
    id = Column(Integer, primary_key=True, index=True)
    id_conversacion = Column(Integer, ForeignKey("conversaciones_sesion.id"), nullable=False)
    id_grupo_atencion = Column(Integer, ForeignKey("grupo_atencion.id"), nullable=False)
    id_agente = Column(Integer, ForeignKey("agentes_atencion.id"), nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    conversacion = relationship("ConversacionSesion", back_populates="grupo_asignado")
    grupo_atencion = relationship("GrupoAtencion")
    agente = relationship("AgentesAtencion")

class LoteEnvio(Base):
    __tablename__ = "lotes_envio"

    id = Column(Integer, primary_key=True, index=True)
    nombre_lote = Column(String, index=True, nullable=False)
    cuenta_id = Column(String, ForeignKey("cuentas_activas.cuenta_id"), nullable=False)
    plantilla = Column(Text, nullable=False)
    total_mensajes = Column(Integer, default=0)
    enviados = Column(Integer, default=0)
    fallidos = Column(Integer, default=0)
    estado = Column(String, default="pendiente") # pendiente, en_progreso, completado, fallido, programado, revisado
    fecha_programada = Column(DateTime(timezone=True), nullable=True)
    id_grupo_atencion = Column(Integer, ForeignKey("grupo_atencion.id"), nullable=True)
    media_path = Column(String, nullable=True)
    media_mimetype = Column(String, nullable=True)
    media_filename = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    cuenta = relationship("CuentaActiva")
    grupo_atencion = relationship("GrupoAtencion")
    destinatarios = relationship("LoteDestinatario", back_populates="lote", cascade="all, delete-orphan")

class LoteDestinatario(Base):
    __tablename__ = "lotes_destinatarios"

    id = Column(Integer, primary_key=True, index=True)
    id_lote = Column(Integer, ForeignKey("lotes_envio.id", ondelete="CASCADE"), nullable=False)
    numero = Column(String, nullable=False)
    variable = Column(String, nullable=True)
    mensaje_personalizado = Column(Text, nullable=False)
    estado = Column(String, default="pendiente") # pendiente, enviado, fallido, o estados de webhook
    error = Column(String, nullable=True)
    fecha_envio = Column(DateTime(timezone=True), nullable=True)
    message_id = Column(String, nullable=True)

    lote = relationship("LoteEnvio", back_populates="destinatarios")


class NotificacionEvento(Base):
    __tablename__ = "notificaciones_eventos"

    id = Column(Integer, primary_key=True, index=True)
    cuenta_id = Column(String, nullable=True, index=True)
    mensaje = Column(String, nullable=False)
    fecha_hora = Column(DateTime(timezone=True), server_default=func.now())
    leido = Column(Boolean, default=False)


