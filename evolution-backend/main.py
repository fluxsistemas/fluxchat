from fastapi import FastAPI, Depends, HTTPException, Request, Form, File, UploadFile, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import text, func
from typing import List, Optional
import os
import requests
import json
import redis
import base64
from datetime import datetime, timezone
from database import engine, Base, get_db

import models
import schemas
from tasks import process_send_message
import auth
import evolution
import usuarios
import lotes

# Configuración de Redis
redis_client = redis.Redis(
    host=os.getenv("REDIS_HOST", "evolution_redis"),
    port=int(os.getenv("REDIS_PORT", 6379)),
    db=int(os.getenv("REDIS_DB", 5)),
    decode_responses=True
)

# Crea las tablas (para producción usar Alembic)
models.Base.metadata.create_all(bind=engine)

# Ejecutar migraciones acumuladas al iniciar la aplicación
try:
    from migrations import run_migrations
    run_migrations()
except Exception as e:
    print("Error al ejecutar las migraciones automáticas:", e)

app = FastAPI(title="Evolution Backend API", version="1.0.0")

# Setup static directory
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

app.include_router(auth.router)
app.include_router(evolution.router)
app.include_router(usuarios.router)
app.include_router(lotes.router)

import asyncio

# Conjunto para rastrear qué instancias ya han sido notificadas por desconexión o transición a Conectando...
# Se limpia cuando la instancia pasa a "Conectado". Esto evita notificaciones repetidas en fluctuaciones rápidas.
cuentas_notificadas_desconexion = set()

async def reconnect_disconnected_instances_loop():
    import requests
    from database import SessionLocal
    import models
    from zoneinfo import ZoneInfo
    global cuentas_notificadas_desconexion
    
    print("[Reconector] Iniciando bucle asíncrono de reconexión de instancias desconectadas...")
    while True:
        try:
            # Esperamos 1 minuto (60 segundos) entre comprobaciones
            await asyncio.sleep(60)
            
            db = SessionLocal()
            try:
                # Obtenemos únicamente las instancias con estado "Desconectado", nulo o vacío.
                # Se excluyen explícitamente "Conectado" y "Conectando..." para evitar reintentos concurrentes.
                instancias_desconectadas = db.query(models.CuentaActiva).filter(
                    (models.CuentaActiva.estado == "Desconectado") | 
                    (models.CuentaActiva.estado == None) | 
                    (models.CuentaActiva.estado == "")
                ).all()
                
                if not instancias_desconectadas:
                    continue
                
                print(f"[Reconector] Se detectaron {len(instancias_desconectadas)} instancias desconectadas. Intentando reconectar de forma automática...")
                
                for db_cuenta in instancias_desconectadas:
                    instance_name = db_cuenta.nombre_cuenta
                    cuenta_id = db_cuenta.cuenta_id
                    
                    # Generar notificación si no existe una no leída para esta cuenta_id
                    try:
                        notif_existente = db.query(models.NotificacionEvento).filter(
                            models.NotificacionEvento.cuenta_id == cuenta_id,
                            models.NotificacionEvento.leido == False
                        ).first()

                        if not notif_existente:
                            try:
                                tz_py = ZoneInfo("America/Asuncion")
                                ahora_py = datetime.now(tz_py)
                            except Exception:
                                ahora_py = datetime.now()
                            fecha_str = ahora_py.strftime("%d/%m/%Y, %H:%M:%S")
                            nombre_mostrar = db_cuenta.nombre_interno or db_cuenta.nombre_cuenta
                            notif_mensaje = f"{fecha_str} - Instancia {nombre_mostrar} Desconectada"
                            
                            nueva_notif = models.NotificacionEvento(
                                cuenta_id=cuenta_id,
                                mensaje=notif_mensaje,
                                leido=False
                            )
                            db.add(nueva_notif)
                            db.commit()
                            
                            # Registrar en el conjunto global de notificadas por desconexión
                            cuentas_notificadas_desconexion.add(cuenta_id)
                            
                            print(f"[Reconector] Se creó una notificación de desconexión para la instancia: {nombre_mostrar}")
                    except Exception as notif_err:
                        db.rollback()
                        print(f"[Reconector] Error al generar notificación para la instancia {instance_name}: {notif_err}")

                    host = db_cuenta.server_url or os.getenv("HOST_EVOLUTION")
                    apikey = db_cuenta.apikey or os.getenv("API_KEY_EVOLUTION")
                    
                    if not host or not apikey:
                        print(f"[Reconector] No se puede reconectar la instancia '{instance_name}' debido a la falta de HOST_EVOLUTION o API_KEY_EVOLUTION.")
                        continue
                    
                    url = f"{host}/instance/connect/{instance_name}"
                    headers = {"apikey": apikey}
                    
                    print(f"[Reconector] Intentando iniciar conexión para '{instance_name}' en: {url}")
                    
                    # Ejecutamos la petición síncrona en un hilo separado utilizando asyncio.to_thread para no bloquear el loop de FastAPI.
                    def run_connection_request():
                        try:
                            # Hacemos una petición GET como en evolution.py y frontend
                            return requests.get(url, headers=headers, timeout=15)
                        except Exception as req_e:
                            print(f"[Reconector] Excepción al enviar petición HTTP para '{instance_name}': {req_e}")
                            return None
                    
                    response = await asyncio.to_thread(run_connection_request)
                    if response is not None:
                        print(f"[Reconector] Respuesta para '{instance_name}' (Status {response.status_code}): {response.text[:250]}")
                    else:
                        print(f"[Reconector] No se obtuvo respuesta de la API para '{instance_name}'")
                        
            except Exception as db_err:
                print(f"[Reconector] Error en base de datos durante el ciclo de reconexión: {db_err}")
            finally:
                db.close()
                
        except asyncio.CancelledError:
            print("[Reconector] El proceso asíncrono de reconexión ha sido cancelado.")
            break
        except Exception as main_err:
            print(f"[Reconector] Error inesperado en el bucle asíncrono principal: {main_err}")

@app.on_event("startup")
async def startup_event():
    # Iniciamos el bucle asíncrono en segundo plano al arrancar la aplicación
    asyncio.create_task(reconnect_disconnected_instances_loop())

@app.get("/", tags=["General"])
def read_root():
    return {"message": "Welcome to Evolution Backend API"}

@app.get("/health", tags=["General"])
def health_check(db: Session = Depends(get_db)):
    # Ejecutamos una query sencilla para validar que hay conexión
    try:
        db.execute(text("SELECT 1"))
        return {"status": "healthy", "db_connection": "ok"}
    except Exception as e:
        return {"status": "unhealthy", "db_connection": "failed", "error": str(e)}

# --- CRUD de Cuentas Activas ---

@app.post("/cuentas/", response_model=schemas.CuentaActivaResponse, tags=["Cuentas Activas"])
def create_cuenta(cuenta: schemas.CuentaActivaCreate, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    db_cuenta = models.CuentaActiva(**cuenta.model_dump())
    db.add(db_cuenta)
    try:
        db.commit()
        db.refresh(db_cuenta)
        return db_cuenta
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/cuentas/", response_model=List[schemas.CuentaActivaResponse], tags=["Cuentas Activas"])
def read_cuentas(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    cuentas = db.query(models.CuentaActiva).offset(skip).limit(limit).all()
    return cuentas

@app.get("/cuentas/{cuenta_id}", response_model=schemas.CuentaActivaResponse, tags=["Cuentas Activas"])
def read_cuenta(cuenta_id: str, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.cuenta_id == cuenta_id).first()
    if cuenta is None:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    return cuenta

@app.put("/cuentas/{cuenta_id}", response_model=schemas.CuentaActivaResponse, tags=["Cuentas Activas"])
def update_cuenta(cuenta_id: str, cuenta_update: schemas.CuentaActivaUpdate, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    db_cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.cuenta_id == cuenta_id).first()
    if db_cuenta is None:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    
    update_data = cuenta_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_cuenta, key, value)
        
    try:
        db.commit()
        db.refresh(db_cuenta)
        return db_cuenta
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/cuentas/{cuenta_id}", tags=["Cuentas Activas"])
def delete_cuenta(cuenta_id: str, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    db_cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.cuenta_id == cuenta_id).first()
    if db_cuenta is None:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    
    # Limpiar relaciones para evitar fallos de integridad referencial
    db.query(models.AgentesAtencion).filter(models.AgentesAtencion.id_canal == cuenta_id).update({models.AgentesAtencion.id_canal: None}, synchronize_session=False)
    db.query(models.ConversacionSesion).filter(models.ConversacionSesion.id_canal == cuenta_id).update({models.ConversacionSesion.id_canal: None}, synchronize_session=False)
    db.query(models.LoteEnvio).filter(models.LoteEnvio.cuenta_id == cuenta_id).delete(synchronize_session=False)

    db.delete(db_cuenta)
    db.commit()
    return {"message": "Cuenta eliminada correctamente"}

# --- Notificaciones de Eventos de Instancias ---

@app.get("/notificaciones/", tags=["Notificaciones"])
def get_notificaciones(db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    notificaciones = db.query(models.NotificacionEvento).order_by(models.NotificacionEvento.id.desc()).limit(100).all()
    # Mapeamos los campos para el front
    res = []
    for n in notificaciones:
        # Formatear fecha_hora para el front si es necesario
        from datetime import datetime
        from zoneinfo import ZoneInfo
        try:
            tz_py = ZoneInfo("America/Asuncion")
            fh_local = n.fecha_hora.astimezone(tz_py)
            fecha_str = fh_local.strftime("%d/%m/%Y, %H:%M:%S")
        except Exception:
            fecha_str = n.fecha_hora.strftime("%d/%m/%Y, %H:%M:%S") if n.fecha_hora else ""
            
        res.append({
            "id": n.id,
            "mensaje": n.mensaje,
            "fechaHora": fecha_str,
            "leido": n.leido
        })
    return res

@app.put("/notificaciones/marcar-leidas", tags=["Notificaciones"])
def marcar_todas_leidas(db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    db.query(models.NotificacionEvento).filter(models.NotificacionEvento.leido == False).update({models.NotificacionEvento.leido: True}, synchronize_session=False)
    db.commit()
    return {"message": "Todas las notificaciones marcadas como leídas"}

@app.put("/notificaciones/{id}/leido", tags=["Notificaciones"])
def marcar_leida(id: int, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    notif = db.query(models.NotificacionEvento).filter(models.NotificacionEvento.id == id).first()
    if not notif:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")
    notif.leido = True
    db.commit()
    return {"id": notif.id, "mensaje": notif.mensaje, "leido": notif.leido}

@app.delete("/notificaciones/limpiar", tags=["Notificaciones"])
def limpiar_notificaciones(db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    db.query(models.NotificacionEvento).delete(synchronize_session=False)
    db.commit()
    return {"message": "Notificaciones eliminadas"}

@app.delete("/notificaciones/{id}", tags=["Notificaciones"])
def eliminar_notificacion(id: int, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    notif = db.query(models.NotificacionEvento).filter(models.NotificacionEvento.id == id).first()
    if not notif:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")
    db.delete(notif)
    db.commit()
    return {"message": "Notificación eliminada correctamente"}

# --- CRUD de Grupos de Atención ---

@app.post("/grupos-atencion/", response_model=schemas.GrupoAtencionResponse, tags=["Grupos de Atención"])
def create_grupo_atencion(grupo: schemas.GrupoAtencionCreate, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    db_grupo = models.GrupoAtencion(**grupo.model_dump())
    db.add(db_grupo)
    try:
        db.commit()
        db.refresh(db_grupo)
        return db_grupo
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/grupos-atencion/", response_model=List[schemas.GrupoAtencionResponse], tags=["Grupos de Atención"])
def read_grupos_atencion(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    grupos = db.query(models.GrupoAtencion).offset(skip).limit(limit).all()
    return grupos

@app.get("/grupos-atencion/{id}", response_model=schemas.GrupoAtencionResponse, tags=["Grupos de Atención"])
def read_grupo_atencion(id: int, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    grupo = db.query(models.GrupoAtencion).filter(models.GrupoAtencion.id == id).first()
    if grupo is None:
        raise HTTPException(status_code=404, detail="Grupo no encontrado")
    return grupo

@app.put("/grupos-atencion/{id}", response_model=schemas.GrupoAtencionResponse, tags=["Grupos de Atención"])
def update_grupo_atencion(id: int, grupo_update: schemas.GrupoAtencionUpdate, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    db_grupo = db.query(models.GrupoAtencion).filter(models.GrupoAtencion.id == id).first()
    if db_grupo is None:
        raise HTTPException(status_code=404, detail="Grupo no encontrado")
    
    update_data = grupo_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_grupo, key, value)
        
    try:
        db.commit()
        db.refresh(db_grupo)
        return db_grupo
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/grupos-atencion/{id}", tags=["Grupos de Atención"])
def delete_grupo_atencion(id: int, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    db_grupo = db.query(models.GrupoAtencion).filter(models.GrupoAtencion.id == id).first()
    if db_grupo is None:
        raise HTTPException(status_code=404, detail="Grupo no encontrado")
    
    db.delete(db_grupo)
    db.commit()
    return {"message": "Grupo eliminado correctamente"}

# --- CRUD de Agentes de Atención ---

@app.post("/agentes-atencion/", response_model=schemas.AgentesAtencionResponse, tags=["Agentes de Atención"])
def create_agente_atencion(agente: schemas.AgentesAtencionCreate, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    db_agente = models.AgentesAtencion(**agente.model_dump())
    db.add(db_agente)
    try:
        db.commit()
        db.refresh(db_agente)
        return db_agente
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/agentes-atencion/", response_model=List[schemas.AgentesAtencionResponse], tags=["Agentes de Atención"])
def read_agentes_atencion(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    agentes = db.query(models.AgentesAtencion).offset(skip).limit(limit).all()
    return agentes

@app.get("/agentes-atencion/{id}", response_model=schemas.AgentesAtencionResponse, tags=["Agentes de Atención"])
def read_agent_atencion(id: int, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    agente = db.query(models.AgentesAtencion).filter(models.AgentesAtencion.id == id).first()
    if agente is None:
        raise HTTPException(status_code=404, detail="Agente no encontrado")
    return agente

@app.put("/agentes-atencion/{id}", response_model=schemas.AgentesAtencionResponse, tags=["Agentes de Atención"])
def update_agente_atencion(id: int, agente_update: schemas.AgentesAtencionUpdate, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    db_agente = db.query(models.AgentesAtencion).filter(models.AgentesAtencion.id == id).first()
    if db_agente is None:
        raise HTTPException(status_code=404, detail="Agente no encontrado")
    
    update_data = agente_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_agente, key, value)
        
    try:
        db.commit()
        db.refresh(db_agente)
        return db_agente
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/agentes-atencion/{id}", tags=["Agentes de Atención"])
def delete_agente_atencion(id: int, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    db_agente = db.query(models.AgentesAtencion).filter(models.AgentesAtencion.id == id).first()
    if db_agente is None:
        raise HTTPException(status_code=404, detail="Agente no encontrado")
    
    db.delete(db_agente)
    db.commit()
    return {"message": "Agente eliminado correctamente"}

# --- CRUD de Agentes por Grupo ---

@app.post("/agentes-grupo/", response_model=schemas.AgentesGrupoResponse, tags=["Agentes por Grupo"])
def create_agente_grupo(agente_grupo: schemas.AgentesGrupoCreate, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    db_agente_grupo = models.AgentesGrupo(**agente_grupo.model_dump())
    db.add(db_agente_grupo)
    try:
        db.commit()
        db.refresh(db_agente_grupo)
        return db_agente_grupo
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/agentes-grupo/", response_model=List[schemas.AgentesGrupoResponse], tags=["Agentes por Grupo"])
def read_agentes_grupo(id_grupo: int | None = None, skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    query = db.query(models.AgentesGrupo)
    if id_grupo:
        query = query.filter(models.AgentesGrupo.id_grupo == id_grupo)
    
    agentes_grupo = query.offset(skip).limit(limit).all()
    return agentes_grupo

@app.get("/agentes-grupo/{id}", response_model=schemas.AgentesGrupoResponse, tags=["Agentes por Grupo"])
def read_agente_grupo(id: int, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    agente_grupo = db.query(models.AgentesGrupo).filter(models.AgentesGrupo.id == id).first()
    if agente_grupo is None:
        raise HTTPException(status_code=404, detail="Asociación agente-grupo no encontrada")
    return agente_grupo

@app.put("/agentes-grupo/{id}", response_model=schemas.AgentesGrupoResponse, tags=["Agentes por Grupo"])
def update_agente_grupo(id: int, agente_grupo_update: schemas.AgentesGrupoUpdate, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    db_agente_grupo = db.query(models.AgentesGrupo).filter(models.AgentesGrupo.id == id).first()
    if db_agente_grupo is None:
        raise HTTPException(status_code=404, detail="Asociación agente-grupo no encontrada")
    
    update_data = agente_grupo_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_agente_grupo, key, value)
        
    try:
        db.commit()
        db.refresh(db_agente_grupo)
        return db_agente_grupo
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/agentes-grupo/{id}", tags=["Agentes por Grupo"])
def delete_agente_grupo(id: int, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    db_agente_grupo = db.query(models.AgentesGrupo).filter(models.AgentesGrupo.id == id).first()
    if db_agente_grupo is None:
        raise HTTPException(status_code=404, detail="Asociación agente-grupo no encontrada")
    
    db.delete(db_agente_grupo)
    db.commit()
    return {"message": "Asociación agente-grupo eliminada correctamente"}

# --- CRUD de Conversaciones Grupo ---

@app.post("/conversaciones-grupo/", response_model=schemas.ConversacionGrupoResponse, tags=["Conversaciones Grupo"])
def create_conversacion_grupo(conversacion_grupo: schemas.ConversacionGrupoCreate, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    db_conversacion_grupo = models.ConversacionGrupo(**conversacion_grupo.model_dump())
    db.add(db_conversacion_grupo)
    try:
        db.commit()
        db.refresh(db_conversacion_grupo)
        return db_conversacion_grupo
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/conversaciones-grupo/", response_model=List[schemas.ConversacionGrupoResponse], tags=["Conversaciones Grupo"])
def read_conversaciones_grupo(id_grupo_atencion: int | None = None, id_agente: int | None = None, skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    query = db.query(models.ConversacionGrupo)
    
    if id_grupo_atencion:
        query = query.filter(models.ConversacionGrupo.id_grupo_atencion == id_grupo_atencion)
    if id_agente:
        query = query.filter(models.ConversacionGrupo.id_agente == id_agente)
        
    conversaciones_grupo = query.offset(skip).limit(limit).all()
    return conversaciones_grupo

@app.get("/conversaciones-grupo/{id}", response_model=schemas.ConversacionGrupoResponse, tags=["Conversaciones Grupo"])
def read_conversacion_grupo(id: int, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    conversacion_grupo = db.query(models.ConversacionGrupo).filter(models.ConversacionGrupo.id == id).first()
    if conversacion_grupo is None:
        raise HTTPException(status_code=404, detail="Asociación conversación-grupo no encontrada")
    return conversacion_grupo

@app.put("/conversaciones-grupo/{id}", response_model=schemas.ConversacionGrupoResponse, tags=["Conversaciones Grupo"])
def update_conversacion_grupo(id: int, conversacion_grupo_update: schemas.ConversacionGrupoUpdate, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    db_conversacion_grupo = db.query(models.ConversacionGrupo).filter(models.ConversacionGrupo.id == id).first()
    if db_conversacion_grupo is None:
        raise HTTPException(status_code=404, detail="Asociación conversación-grupo no encontrada")
    
    update_data = conversacion_grupo_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_conversacion_grupo, key, value)
        
    try:
        db.commit()
        db.refresh(db_conversacion_grupo)
        return db_conversacion_grupo
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/conversaciones-grupo/{id}", tags=["Conversaciones Grupo"])
def delete_conversacion_grupo(id: int, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    db_conversacion_grupo = db.query(models.ConversacionGrupo).filter(models.ConversacionGrupo.id == id).first()
    if db_conversacion_grupo is None:
        raise HTTPException(status_code=404, detail="Asociación conversación-grupo no encontrada")
    
    db.delete(db_conversacion_grupo)
    db.commit()
    return {"message": "Asociación conversación-grupo eliminada correctamente"}

# --- Consultar Conversaciones (DB Local) ---

@app.get("/conversaciones/", response_model=List[schemas.ConversacionResponse], tags=["Conversaciones"])
def list_conversaciones(id_canal: str | None = None, id_grupo_atencion: int | None = None, skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    # Consultamos las sesiones de conversación
    query = db.query(models.ConversacionSesion)
    
    if id_canal:
        query = query.filter(models.ConversacionSesion.id_canal == id_canal)

    # Filter by permission if agent first, then check id_grupo_atencion
    is_agent = (current_user.perfil == "agente" and current_user.id_agente)
    
    # Filter by permissions if user is an agent
    if is_agent:
        # Get agent info
        agente = db.query(models.AgentesAtencion).filter(models.AgentesAtencion.id == current_user.id_agente).first()
        ver_sin_grupo = agente.ver_sin_grupo if agente else False
        
        # Get assigned groups
        grupos_asignados = db.query(models.AgentesGrupo.id_grupo).filter(models.AgentesGrupo.id_agente == current_user.id_agente).all()
        grupo_ids = [g[0] for g in grupos_asignados]
        
        # Join with ConversacionGrupo to filter
        query = query.outerjoin(models.ConversacionGrupo, models.ConversacionSesion.id == models.ConversacionGrupo.id_conversacion)
        
        from sqlalchemy import or_
        conditions = []
        if grupo_ids:
            conditions.append(models.ConversacionGrupo.id_grupo_atencion.in_(grupo_ids))
            
        if ver_sin_grupo:
            conditions.append(models.ConversacionGrupo.id == None)
            
        if conditions:
            query = query.filter(or_(*conditions))
            
            # Y la segunda regla es: 
            # El agente solo puede ver las conversaciones que no tengan un agente asignado,
            # o que estén explícitamente asignadas a él.
            # (No puede ver conversaciones que han sido asignadas a OTROS agentes, incluso dentro de sus grupos)
            query = query.filter(
                or_(
                    models.ConversacionGrupo.id_agente == None,
                    models.ConversacionGrupo.id_agente == current_user.id_agente
                )
            )
        else:
            # If no groups and can't see without group, return empty
            return []

    # Filter by id_grupo_atencion
    if id_grupo_atencion is not None:
        if is_agent:
            # Already outerjoined/joined in the agent block, so we just filter
            query = query.filter(models.ConversacionGrupo.id_grupo_atencion == id_grupo_atencion)
        else:
            # Not an agent, so we join and filter
            query = query.join(models.ConversacionGrupo, models.ConversacionSesion.id == models.ConversacionGrupo.id_conversacion).filter(
                models.ConversacionGrupo.id_grupo_atencion == id_grupo_atencion
            )
            
    # Traemos un lote amplio de conversaciones ordenadas por actividad reciente
    conversaciones_db = query.order_by(func.coalesce(models.ConversacionSesion.updated_at, models.ConversacionSesion.created_at).desc()).limit(500).all()
    
    # Filtramos por existencia de chat activo en Redis para garantizar que haya mensajes visibles en las últimas 24hs
    conversaciones_activas = []
    if conversaciones_db:
        pipe = redis_client.pipeline()
        for conv in conversaciones_db:
            pipe.exists(f"chat:{conv.id}")
        exists_results = pipe.execute()
        
        conversaciones_activas = [
            conv for conv, exists in zip(conversaciones_db, exists_results) if exists
        ]
        
    # Aplicamos paginación manual sobre el resultado filtrado
    return conversaciones_activas[skip : skip + limit]

@app.get("/conversaciones/{id_sesion}/mensajes", tags=["Conversaciones"])
def get_conversacion_mensajes(id_sesion: int, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    # Marcar conversación como leída
    db_sesion = db.query(models.ConversacionSesion).filter(models.ConversacionSesion.id == id_sesion).first()
    if db_sesion and db_sesion.nuevo_mensaje:
        db_sesion.nuevo_mensaje = False
        db.commit()

    redis_key = f"chat:{id_sesion}"
    
    try:
        # Obtener todos los elementos de la lista en Redis
        mensajes_json = redis_client.lrange(redis_key, 0, -1)
        
        # Convertir los strings JSON de vuelta a diccionarios de Python
        mensajes = [json.loads(m) for m in mensajes_json]
        
        return {
            "id_sesion": id_sesion,
            "total_cache": len(mensajes),
            "mensajes": mensajes
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error consultando Redis: {str(e)}")

@app.post("/conversaciones/contactos/{numero_contacto}/datos", response_model=schemas.DatosContactoResponse, tags=["Conversaciones"])
def upsert_datos_contacto(
    numero_contacto: str,
    datos: schemas.DatosContactoCreate,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_user)
):
    clean_num = "".join(c for c in numero_contacto if c.isdigit())
    if not clean_num:
        raise HTTPException(status_code=400, detail="Número de contacto inválido")
        
    db_datos = db.query(models.DatosContacto).filter(models.DatosContacto.numero_contacto == clean_num).first()
    if db_datos:
        db_datos.nombres = datos.nombres
        db_datos.apellidos = datos.apellidos
        db_datos.documento = datos.documento
        db_datos.correo = datos.correo
    else:
        db_datos = models.DatosContacto(
            numero_contacto=clean_num,
            nombres=datos.nombres,
            apellidos=datos.apellidos,
            documento=datos.documento,
            correo=datos.correo
        )
        db.add(db_datos)
        
    try:
        db.commit()
        db.refresh(db_datos)
        return db_datos
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error al guardar datos de contacto: {str(e)}")

@app.post("/conversaciones/contactos/importar", tags=["Conversaciones"])
def importar_datos_contacto_bulk(
    lista_contactos: List[schemas.DatosContactoBase],
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_user)
):
    importados = 0
    errores = 0
    for contacto in lista_contactos:
        clean_num = "".join(c for c in contacto.numero_contacto if c.isdigit())
        if not clean_num:
            errores += 1
            continue
            
        try:
            db_datos = db.query(models.DatosContacto).filter(models.DatosContacto.numero_contacto == clean_num).first()
            if db_datos:
                db_datos.nombres = contacto.nombres
                db_datos.apellidos = contacto.apellidos
                db_datos.documento = contacto.documento
                db_datos.correo = contacto.correo
            else:
                db_datos = models.DatosContacto(
                    numero_contacto=clean_num,
                    nombres=contacto.nombres,
                    apellidos=contacto.apellidos,
                    documento=contacto.documento,
                    correo=contacto.correo
                )
                db.add(db_datos)
            importados += 1
        except Exception:
            errores += 1

    try:
        db.commit()
        return {
            "status": "success",
            "message": f"Se procesaron los contactos. Importados/Actualizados con éxito: {importados}. Errores: {errores}",
            "importados": importados,
            "errores": errores
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error al guardar lote de contactos: {str(e)}")

# --- Webhook Forwarding Utility ---

def forward_webhook_payload(webhook_url: str, payload: dict):
    try:
        response = requests.post(webhook_url, json=payload, timeout=10)
        response.raise_for_status()
        print(f"Payload successfully forwarded to {webhook_url}")
    except Exception as e:
        print(f"Error forwarding payload to {webhook_url}: {e}")

def reconnect_instance_task(instance_name: str, host: str, apikey: str, delay_seconds: int = 5):
    import time
    import requests
    
    print(f"[Auto-Reconectar] Aguardando {delay_seconds} segundos antes de intentar reconectar {instance_name}...")
    time.sleep(delay_seconds)
    
    url = f"{host}/instance/connect/{instance_name}"
    headers = {"apikey": apikey}
    
    try:
        print(f"[Auto-Reconectar] Enviando POST a {url} para reconectar...")
        response = requests.post(url, headers=headers, timeout=15)
        print(f"[Auto-Reconectar] Respuesta del intento de reconexión para {instance_name} (Status {response.status_code}): {response.text}")
    except Exception as e:
        print(f"[Auto-Reconectar] Error al intentar reconectar la instancia {instance_name}: {e}")

def verify_disconnection_and_notify_task(cuenta_id: str, wait_seconds: int = 20):
    import time
    from database import SessionLocal
    from datetime import datetime
    from zoneinfo import ZoneInfo
    import models
    global cuentas_notificadas_desconexion

    print(f"[Auto-Notificar] Aguardando {wait_seconds} segundos para verificar si la instancia {cuenta_id} sigue desconectada...")
    time.sleep(wait_seconds)

    db = SessionLocal()
    try:
        db_cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.cuenta_id == cuenta_id).first()
        if db_cuenta and db_cuenta.estado == "Desconectado":
            # Sigue desconectado, procedemos a crear el log de notificación en BD
            try:
                tz_py = ZoneInfo("America/Asuncion")
                ahora_py = datetime.now(tz_py)
            except Exception:
                ahora_py = datetime.now()
            fecha_str = ahora_py.strftime("%d/%m/%Y, %H:%M:%S")
            nombre_mostrar = db_cuenta.nombre_interno or db_cuenta.nombre_cuenta
            
            notif_mensaje = f"{fecha_str} - Instancia {nombre_mostrar} Desconectada"
            
            # Verificar si ya existe una notificación no leída para esta misma cuenta_id
            # para evitar duplicaciones molestas si se intentó reconectar varias veces seguidas y falló.
            notif_existente = db.query(models.NotificacionEvento).filter(
                models.NotificacionEvento.cuenta_id == cuenta_id,
                models.NotificacionEvento.leido == False
            ).first()

            if not notif_existente:
                nueva_notif = models.NotificacionEvento(
                    cuenta_id=db_cuenta.cuenta_id,
                    mensaje=notif_mensaje,
                    leido=False
                )
                db.add(nueva_notif)
                db.commit()
                print(f"[Auto-Notificar] Instancia {db_cuenta.nombre_cuenta} sigue en estado {db_cuenta.estado} tras reintento. Guardada notificación en BD: {notif_mensaje}")
            else:
                print(f"[Auto-Notificar] Instancia {db_cuenta.nombre_cuenta} sigue en estado {db_cuenta.estado} pero ya existe una notificación no leída activa en BD.")
        else:
            if db_cuenta:
                # Si no está en estado "Desconectado" (ej: Conectado o Conectando...), no enviamos notificación de desconexión.
                if db_cuenta.estado == "Conectado":
                    # Si logró reconectarse, limpiar del set global de notificadas
                    cuentas_notificadas_desconexion.discard(cuenta_id)
                print(f"[Auto-Notificar] Instancia {db_cuenta.nombre_cuenta} está en estado {db_cuenta.estado}. No se guarda notificación.")
            else:
                print(f"[Auto-Notificar] Instancia con ID {cuenta_id} no fue encontrada en la BD.")
    except Exception as e:
        print(f"[Auto-Notificar] Error verificando estado de desconexión para {cuenta_id}: {e}")
    finally:
        db.close()

# --- Helper functions for robust payload parsing ---

def find_base64_recursive(d):
    if isinstance(d, dict):
        if "base64" in d and isinstance(d["base64"], str) and len(d["base64"]) > 50:
            return d["base64"]
        for v in d.values():
            res = find_base64_recursive(v)
            if res:
                return res
    elif isinstance(d, list):
        for item in d:
            res = find_base64_recursive(item)
            if res:
                return res
    return None

def decode_base64_robust(b64_str: str) -> bytes:
    if "," in b64_str:
        b64_str = b64_str.split(",")[1]
    b64_str = b64_str.strip()
    # Reparar relleno (padding) si es necesario
    padding = len(b64_str) % 4
    if padding:
        b64_str += "=" * (4 - padding)
    return base64.b64decode(b64_str)

def process_message_payload_sync(payload: dict, db: Session, background_tasks: BackgroundTasks = None):
    event = payload.get("event")
    if event not in ["messages.upsert", "send.message", "SEND_MESSAGE"]:
        return {"status": "ignored", "event": event}

    instance_name = payload.get("instance")
    data = payload.get("data", {})
    key = data.get("key", {})
    
    # Priorizar el JID con formato de teléfono (@s.whatsapp.net) frente a identidades LID de WhatsApp (@lid)
    remoteJid_temp = key.get("remoteJid")
    remoteJid_alt_temp = key.get("remoteJidAlt")
    
    if remoteJid_temp and "@lid" in remoteJid_temp and remoteJid_alt_temp and "@s.whatsapp.net" in remoteJid_alt_temp:
        remoteJid = remoteJid_alt_temp
    else:
        remoteJid = remoteJid_temp or remoteJid_alt_temp
        
    msg_id = key.get("id")
    from_me = key.get("fromMe", False)
    if event in ["send.message", "SEND_MESSAGE"]:
        from_me = True
    push_name = data.get("pushName")
    
    # Extraer contenido del mensaje
    message_content = data.get("message", {})
    message_type = data.get("messageType", "")

    # Desempaquetar viewOnceMessage o viewOnceMessageV2 si aplica
    real_message_content = message_content
    real_message_type = message_type
    
    if message_type in ["viewOnceMessage", "viewOnceMessageV2"]:
        inner_msg = message_content.get(message_type, {}).get("message", {})
        for k in ["imageMessage", "documentMessage", "audioMessage", "videoMessage", "stickerMessage"]:
            if k in inner_msg:
                real_message_content = inner_msg
                real_message_type = k
                break

    msg_details = real_message_content.get(real_message_type, {}) if isinstance(real_message_content, dict) else {}
    
    text_content = (
        message_content.get("conversation") 
        or message_content.get("extendedTextMessage", {}).get("text") 
        or msg_details.get("caption") 
        or ""
    )

    # Procesar archivos base64 (Documentos, Imágenes, Audio)
    media_url = None
    mimetype = None
    
    # Buscar el campo base64 de forma robusta y recursiva en todo el payload
    base64_data = find_base64_recursive(payload)
    
    # Fallback: Si no viene base64_data en el webhook, lo solicitamos directamente a la Evolution API
    if not base64_data and real_message_type in ["imageMessage", "documentMessage", "audioMessage", "videoMessage", "stickerMessage"]:
        try:
            db_cuenta_for_media = db.query(models.CuentaActiva).filter(models.CuentaActiva.nombre_cuenta == instance_name).first()
            host = (db_cuenta_for_media.server_url if db_cuenta_for_media else None) or os.getenv("HOST_EVOLUTION")
            apikey = (db_cuenta_for_media.apikey if db_cuenta_for_media else None) or os.getenv("API_KEY_EVOLUTION")
            if host and apikey:
                fetch_url = f"{host}/chat/getBase64FromMediaMessage/{instance_name}"
                headers = {
                    "Content-Type": "application/json",
                    "apikey": apikey
                }
                # La API de Evolution requiere la clave (key) original del mensaje
                req_body = {
                    "message": {
                        "key": {
                            "remoteJid": key.get("remoteJid"),
                            "fromMe": from_me,
                            "id": msg_id
                        }
                    }
                }
                print(f"Solicitando Base64 a Evolution API para el mensaje {msg_id}: {fetch_url}")
                resp = requests.post(fetch_url, headers=headers, json=req_body, timeout=15)
                if resp.ok:
                    resp_data = resp.json()
                    if isinstance(resp_data, dict):
                        base64_data = resp_data.get("base64") or resp_data.get("base64_data")
                    
                    # Si no se encuentra en el primer nivel, buscar recursivamente en la respuesta
                    if not base64_data:
                        base64_data = find_base64_recursive(resp_data)
                    
                    if base64_data:
                        print(f"Base64 recuperado con éxito desde la Evolution API para el mensaje {msg_id}")
                else:
                    print(f"Error llamando a getBase64FromMediaMessage (status {resp.status_code}): {resp.text}")
        except Exception as ex:
            print(f"Error obteniendo base64 desde Evolution API: {ex}")

    if base64_data and real_message_type in ["imageMessage", "documentMessage", "audioMessage", "videoMessage", "stickerMessage"]:
        # Obtener detalles del archivo y definir mimetype con fallbacks inteligentes
        mimetype = msg_details.get("mimetype", "application/octet-stream")
        if mimetype == "application/octet-stream":
            if real_message_type == "imageMessage":
                mimetype = "image/jpeg"
            elif real_message_type == "audioMessage":
                mimetype = "audio/ogg"
            elif real_message_type == "videoMessage":
                mimetype = "video/mp4"
            elif real_message_type == "stickerMessage":
                mimetype = "image/webp"
        
        if not text_content:
            text_content = msg_details.get("caption") or msg_details.get("fileName") or ""
            if not text_content:
                if real_message_type == "audioMessage":
                    text_content = "🎵 Audio Recibido"
                elif real_message_type == "imageMessage":
                    text_content = "📷 Imagen Recibida"
                elif real_message_type == "documentMessage":
                    text_content = "📄 Documento Recibido"
                elif real_message_type == "videoMessage":
                    text_content = "🎥 Video Recibido"
                elif real_message_type == "stickerMessage":
                    text_content = "🌟 Sticker Recibido"
                else:
                    text_content = "📎 Archivo Recibido"
            
        ext = "bin"
        if "/" in mimetype:
            ext = mimetype.split("/")[1].split(";")[0]
            if ext == "vnd.openxmlformats-officedocument.wordprocessingml.document":
                ext = "docx"
            elif ext == "pdf":
                ext = "pdf"
        
        if real_message_type == "audioMessage" and ext.startswith("ogg"):
            ext = "ogg"

        filename = f"{msg_id}.{ext}"
        filepath = os.path.join(STATIC_DIR, filename)
        
        try:
            with open(filepath, "wb") as f:
                f.write(decode_base64_robust(base64_data))
            media_url = f"/static/{filename}"
            print(f"Archivo multimedia guardado exitosamente: {media_url} (tipo: {real_message_type})")
        except Exception as e:
            print(f"Error guardando archivo {filename}: {e}")

    # 1. Validar instancia
    db_cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.nombre_cuenta == instance_name).first()
    if not db_cuenta:
        # Si la instancia no está registrada, podrías optar por ignorarla o crearla
        return {"status": "error", "message": f"Instance {instance_name} not found"}

    # Reenviar el webhook solo si es un mensaje entrante (fromMe es False) y el evento es messages.upsert
    if db_cuenta.webhook_url and event == "messages.upsert" and not from_me:
        if background_tasks is not None:
            background_tasks.add_task(forward_webhook_payload, db_cuenta.webhook_url, payload)
        else:
            import threading
            threading.Thread(target=forward_webhook_payload, args=(db_cuenta.webhook_url, payload)).start()

    # 2. Gestionar Contacto
    try:
        db_contacto = db.query(models.ContactoConversacion).filter(models.ContactoConversacion.remoteJid == remoteJid).first()
    except Exception:
        db.rollback()
        db_contacto = db.query(models.ContactoConversacion).filter(models.ContactoConversacion.remoteJid == remoteJid).first()

    if not db_contacto:
        # Lógica inteligente para evitar contactos duplicados cuando se recibe un identificador @lid de WhatsApp
        # Buscamos si ya tenemos un mensaje en BD (MensajeData) o en lotes de envío (LoteDestinatario) con este mismo message_id (msg_id)
        existing_msg = db.query(models.MensajeData).filter(models.MensajeData.message_id == msg_id).first() if msg_id else None
        if existing_msg:
            db_contacto = db.query(models.ContactoConversacion).filter(models.ContactoConversacion.id == existing_msg.id_contacto).first()
        else:
            existing_dest = db.query(models.LoteDestinatario).filter(models.LoteDestinatario.message_id == msg_id).first() if msg_id else None
            if existing_dest:
                dest_num = existing_dest.numero
                dest_jid = dest_num if "@" in dest_num else f"{dest_num}@s.whatsapp.net"
                db_contacto = db.query(models.ContactoConversacion).filter(
                    (models.ContactoConversacion.remoteJid == dest_jid) |
                    (models.ContactoConversacion.numero_contacto == dest_num)
                ).first()
        
        if db_contacto:
            # Encontramos el contacto original (que estaba con @s.whatsapp.net o el número de teléfono).
            # Actualizamos su remoteJid al JID actual de Evolution API (por ejemplo, el @lid) para futuras coincidencias
            if remoteJid and db_contacto.remoteJid != remoteJid:
                print(f"Fusión de identidad: actualizando remoteJid de {db_contacto.remoteJid} a {remoteJid} para contacto {db_contacto.id}")
                db_contacto.remoteJid = remoteJid
                try:
                    db.flush()
                except Exception:
                    db.rollback()
                    db_contacto = db.query(models.ContactoConversacion).filter(models.ContactoConversacion.remoteJid == remoteJid).first()

    if not db_contacto:
        # Extraer número del remoteJid (ej: 5491112345678@s.whatsapp.net -> 5491112345678)
        numero_contacto = remoteJid.split("@")[0] if remoteJid else None
        
        # Volver a verificar la existencia por remoteJid para prevenir condiciones de carrera (Race Conditions)
        db_contacto = db.query(models.ContactoConversacion).filter(models.ContactoConversacion.remoteJid == remoteJid).first()
        if not db_contacto:
            try:
                db_contacto = models.ContactoConversacion(
                    remoteJid=remoteJid,
                    numero_contacto=numero_contacto,
                    id_contacto=msg_id, # Siguiendo el requerimiento: valor de "data":"key":"id"
                    pushName=push_name
                )
                db.add(db_contacto)
                db.flush() # Para obtener el id_contacto generado si es autoincremental
            except Exception as e:
                db.rollback()
                print(f"Conflicto de clave única evitado durante la inserción paralela del contacto: {e}")
                db_contacto = db.query(models.ContactoConversacion).filter(models.ContactoConversacion.remoteJid == remoteJid).first()
                if not db_contacto:
                    raise e
    else:
        # Opcional: Actualizar pushName si cambió
        if push_name and db_contacto.pushName != push_name:
            db_contacto.pushName = push_name
        
        # Actualizar numero_contacto si no existe
        if not db_contacto.numero_contacto and remoteJid:
            db_contacto.numero_contacto = remoteJid.split("@")[0]

    # 3. Gestionar Sesión de Conversación
    db_sesion = db.query(models.ConversacionSesion).filter(
        models.ConversacionSesion.id_contacto == db_contacto.id,
        models.ConversacionSesion.id_canal == db_cuenta.cuenta_id,
        models.ConversacionSesion.activo == True
    ).first()

    if not db_sesion:
        db_sesion = models.ConversacionSesion(
            id_contacto=db_contacto.id,
            id_canal=db_cuenta.cuenta_id,
            activo=True,
            nuevo_mensaje=(not from_me),
            updated_at=func.now()
        )
        db.add(db_sesion)
        db.flush()
    else:
        # Actualizar el campo updated_at para que la conversación sea la más reciente
        db_sesion.updated_at = func.now()
        if not from_me:
            db_sesion.nuevo_mensaje = True

    # 4. Registrar Mensaje (o actualizar si ya existe)
    tipo = "OUT" if from_me else "IN"
    
    # Buscar si ya existe para evitar duplicados (ej: mensaje OUT que ya se guardó en tasks.py)
    mensaje_existente = db.query(models.MensajeData).filter(models.MensajeData.message_id == msg_id).first()
    
    if mensaje_existente:
        updated = False
        if media_url and not mensaje_existente.media_url:
            mensaje_existente.media_url = media_url
            updated = True
        if mimetype and not mensaje_existente.mimetype:
            mensaje_existente.mimetype = mimetype
            updated = True
        if updated:
            db.commit()
            
            # Actualizar en Redis es complicado al ser una lista, pero ya deberíamos tener la media_url
            # si tasks.py la guarda correctamente, así que podemos ignorarlo.
        return {"status": "success", "message_id": msg_id, "note": "Mensaje ya existente actualizado/ignorado"}
    
    # Utilizar SIEMPRE la hora del servidor para evitar desincronizaciones 
    # de tiempo con el dispositivo del usuario/EvolutionAPI
    dt_timestamp = func.now()
    iso_timestamp = datetime.now(timezone.utc).isoformat()

    nuevo_mensaje = models.MensajeData(
        id_conversacion=db_sesion.id,
        id_contacto=db_contacto.id,
        tipo=tipo,
        contenido=text_content,
        media_url=media_url,
        mimetype=mimetype,
        message_id=msg_id,
        created_at=dt_timestamp
    )
    db.add(nuevo_mensaje)
    
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

    # 5. Actualización de Caché en Redis
    try:
        # Usamos el ID de la sesión como identificador del chat
        redis_key = f"chat:{db_sesion.id}"
        
        # Armamos un diccionario con los datos esenciales del mensaje
        msg_cache = {
            "message_id": msg_id,
            "tipo": tipo,
            "contenido": text_content,
            "media_url": media_url,
            "mimetype": mimetype,
            "timestamp": iso_timestamp,
            "pushName": push_name,
            "nombre_cuenta": db_cuenta.nombre_cuenta,
            "numero_cuenta": db_cuenta.numero_cuenta
        }
        
        # Agregar el mensaje al inicio de la lista (LPUSH)
        redis_client.lpush(redis_key, json.dumps(msg_cache))
        
        # Limitar la lista a los últimos 50 mensajes (índices del 0 al 49)
        redis_client.ltrim(redis_key, 0, 49)
        
        # Definir expiración (TTL) de 24 horas = 86400 segundos
        # Si la lista ya existía, expire reinicia el contador a 24 horas
        redis_client.expire(redis_key, 86400)
    except Exception as e:
        print(f"Error actualizando Redis cache: {str(e)}")

    return {"status": "success", "message_id": msg_id}

def fetch_and_process_unread_messages(instance_name: str, host: str, apikey: str):
    from database import SessionLocal
    import requests
    import os
    
    db = SessionLocal()
    try:
        print(f"[Mensajes No Leídos] Iniciando recuperación de mensajes no leídos para la instancia: {instance_name}")
        
        # 1. Obtener chats con findChats
        find_chats_url = f"{host}/chat/findChats/{instance_name}"
        headers = {"apikey": apikey}
        
        try:
            response = requests.post(find_chats_url, headers=headers, json={}, timeout=15)
            if not response.ok:
                print(f"[Mensajes No Leídos] Error consultando chats (Status {response.status_code}): {response.text}")
                return
            
            chats_data = response.json()
        except Exception as e:
            print(f"[Mensajes No Leídos] Excepción al buscar chats para {instance_name}: {e}")
            return
        
        chats = []
        if isinstance(chats_data, list):
            chats = chats_data
        elif isinstance(chats_data, dict):
            chats = chats_data.get("chats") or chats_data.get("records") or []
            
        print(f"[Mensajes No Leídos] Se obtuvieron {len(chats)} chats totales de la instancia {instance_name}")
        
        for chat in chats:
            if not isinstance(chat, dict):
                continue
                
            unread_count = chat.get("unreadCount") or chat.get("unread_count") or 0
            if not isinstance(unread_count, int) or unread_count <= 0:
                continue
                
            chat_id = chat.get("id") or chat.get("jid")
            if not chat_id:
                continue
                
            print(f"[Mensajes No Leídos] Chat {chat_id} tiene {unread_count} mensajes no leídos. Recuperando...")
            
            # 2. Buscar mensajes para este chat con findMessages
            find_messages_url = f"{host}/chat/findMessages/{instance_name}"
            query_limit = max(unread_count, 15)
            
            req_body = {
                "where": {
                    "key": {
                        "remoteJid": chat_id
                    }
                },
                "limit": query_limit
            }
            
            try:
                msg_resp = requests.post(find_messages_url, headers=headers, json=req_body, timeout=15)
                if not msg_resp.ok:
                    print(f"[Mensajes No Leídos] Error buscando mensajes para {chat_id} (Status {msg_resp.status_code}): {msg_resp.text}")
                    continue
                    
                msg_data = msg_resp.json()
            except Exception as e:
                print(f"[Mensajes No Leídos] Excepción al buscar mensajes para {chat_id}: {e}")
                continue
                
            messages_list = []
            if isinstance(msg_data, list):
                messages_list = msg_data
            elif isinstance(msg_data, dict):
                messages_list = msg_data.get("messages") or msg_data.get("records") or []
                
            # 3. Filtrar mensajes entrantes (fromMe == False)
            incoming_messages = [m for m in messages_list if not m.get("key", {}).get("fromMe", False)]
            
            # Ordenamos por timestamp cronológico
            def get_timestamp(m):
                return m.get("messageTimestamp") or m.get("message_timestamp") or 0
                
            incoming_messages.sort(key=get_timestamp)
            
            # Nos quedamos con los unread_count mensajes más recientes
            unread_incoming = incoming_messages[-unread_count:] if unread_count < len(incoming_messages) else incoming_messages
            
            print(f"[Mensajes No Leídos] Procesando {len(unread_incoming)} mensajes no leídos para {chat_id}")
            
            for msg in unread_incoming:
                payload_simulado = {
                    "event": "messages.upsert",
                    "instance": instance_name,
                    "data": msg
                }
                
                try:
                    res = process_message_payload_sync(payload_simulado, db, None)
                    print(f"[Mensajes No Leídos] Mensaje {msg.get('key', {}).get('id')} procesado: {res}")
                except Exception as pe:
                    print(f"[Mensajes No Leídos] Error procesando mensaje {msg.get('key', {}).get('id')}: {pe}")
                    
    except Exception as main_err:
        print(f"[Mensajes No Leídos] Error inesperado en fetch_and_process_unread_messages: {main_err}")
    finally:
        db.close()

# --- Webhook Evolution API ---

@app.post("/webhook/evolution", tags=["Webhooks"])
async def webhook_evolution(request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    global cuentas_notificadas_desconexion
    payload = await request.json()
    
    # Imprimir el payload recibido para depuración
    print("--- Payload Recibido de Evolution ---")
    print(payload)
    print("-------------------------------------")
    
    # Extraer y resolver dinámicamente server_url y apikey para instancias externas
    instance_name = payload.get("instance")
    webhook_server_url = payload.get("server_url")
    webhook_apikey = payload.get("apikey")
    
    if webhook_server_url:
        # Si apunta a localhost o 127.0.0.1, intentar usar la IP del cliente (remoto)
        if "localhost" in webhook_server_url or "127.0.0.1" in webhook_server_url:
            client_ip = request.client.host if request.client else None
            if client_ip:
                from urllib.parse import urlparse
                try:
                    parsed = urlparse(webhook_server_url)
                    port_suffix = f":{parsed.port}" if parsed.port else ""
                    resolved_server_url = f"{parsed.scheme}://{client_ip}{port_suffix}"
                    print(f"Resolviendo server_url dinámicamente de {webhook_server_url} a {resolved_server_url} usando la IP del cliente {client_ip}")
                    webhook_server_url = resolved_server_url
                except Exception as e:
                    print(f"Error parseando server_url {webhook_server_url}: {e}")

    # Si la instancia se menciona en el payload, buscarla y actualizarla
    if instance_name:
        db_cuenta_temp = db.query(models.CuentaActiva).filter(models.CuentaActiva.nombre_cuenta == instance_name).first()
        if db_cuenta_temp:
            updated_any = False
            if webhook_server_url and db_cuenta_temp.server_url != webhook_server_url:
                db_cuenta_temp.server_url = webhook_server_url
                updated_any = True
            if webhook_apikey and db_cuenta_temp.apikey != webhook_apikey:
                db_cuenta_temp.apikey = webhook_apikey
                updated_any = True
            if updated_any:
                try:
                    db.commit()
                    db.refresh(db_cuenta_temp)
                    print(f"Instancia {instance_name} actualizada con server_url y apikey del webhook.")
                except Exception as e:
                    db.rollback()
                    print(f"Error guardando server_url/apikey para {instance_name}: {e}")

    event = payload.get("event")
    
    # Manejar evento de actualización de conexión
    if event == "connection.update":
        instance_name = payload.get("instance")
        if not instance_name:
            return {"status": "error", "message": "Instance name not found in payload"}
            
        db_cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.nombre_cuenta == instance_name).first()
        if not db_cuenta:
            return {"status": "error", "message": f"Instance {instance_name} not found"}
            
        # No reenviar eventos connection.update al webhook externo
        # (Se eliminó el bloque de reenvío que estaba aquí)
            
        data = payload.get("data", {})
        state = data.get("state")
        
        # Mapear el estado recibido al estado interno ("Conectado" / "Desconectado" / "Conectando...")
        state_str = str(state).lower() if state else ""
        if state_str in ["open", "connected"]:
            nuevo_estado = "Conectado"
        elif state_str in ["connecting"]:
            nuevo_estado = "Conectando..."
        else:
            nuevo_estado = "Desconectado"
            
        estado_anterior = db_cuenta.estado
        db_cuenta.estado = nuevo_estado

        if nuevo_estado == "Desconectado":
            # No guardamos la notificación de desconexión de inmediato.
            # En su lugar, planificamos una tarea en segundo plano que espere 20 segundos
            # (tiempo suficiente para que corra el auto-reconnect) y luego verifique
            # si la instancia sigue desconectada.
            if db_cuenta.cuenta_id not in cuentas_notificadas_desconexion:
                cuentas_notificadas_desconexion.add(db_cuenta.cuenta_id)
                background_tasks.add_task(verify_disconnection_and_notify_task, db_cuenta.cuenta_id, 20)
                print(f"[Webhook Evento] Instancia {db_cuenta.nombre_cuenta} pasó a {nuevo_estado}. Se programó verificación de notificación en 20s.")
            else:
                print(f"[Webhook Evento] Instancia {db_cuenta.nombre_cuenta} cambió a {nuevo_estado} pero ya está registrada como notificada/desconectada.")
        elif nuevo_estado == "Conectado" and estado_anterior != "Conectado":
            # Si se reconectó la instancia, removemos la cuenta de la lista de notificadas
            cuentas_notificadas_desconexion.discard(db_cuenta.cuenta_id)
            
            # Si se reconectó la instancia, borramos cualquier notificación de desconexión de esta instancia específica
            # para no alarmar al usuario si ya está solucionado.
            deleted_count = db.query(models.NotificacionEvento).filter(models.NotificacionEvento.cuenta_id == db_cuenta.cuenta_id).delete(synchronize_session=False)
            if deleted_count > 0:
                print(f"[Webhook Evento] Instancia {db_cuenta.nombre_cuenta} reconectada. Se eliminaron {deleted_count} notificaciones previas.")
            
            # Buscar mensajes no leídos y procesarlos
            host = db_cuenta.server_url or os.getenv("HOST_EVOLUTION")
            apikey = db_cuenta.apikey or os.getenv("API_KEY_EVOLUTION")
            if host and apikey:
                import threading
                threading.Thread(
                    target=fetch_and_process_unread_messages,
                    args=(db_cuenta.nombre_cuenta, host, apikey)
                ).start()
                print(f"[Webhook Evento] Instancia {db_cuenta.nombre_cuenta} reconectada. Se inició fetch_and_process_unread_messages en segundo plano.")

        # Extraer y actualizar de forma dinámica el número de la cuenta si está presente en el webhook
        owner_jid = data.get("jid") or data.get("owner") or data.get("ownerJid")
        if owner_jid:
            owner_number = str(owner_jid).split("@")[0]
            owner_number = "".join(filter(str.isdigit, owner_number))
            if owner_number:
                db_cuenta.numero_cuenta = owner_number
                print(f"Número de cuenta de la instancia {instance_name} actualizado a {owner_number} mediante webhook")
        
        # Verificar si corresponde reconectar automáticamente por desconexión inesperada
        # state == "close" o reason == 401/500
        state_data = data.get("state")
        reason_data = data.get("reason")
        
        should_reconnect = False
        if state_data and str(state_data).lower() == "close":
            should_reconnect = True
        elif reason_data and str(reason_data) in ["401", "500"]:
            should_reconnect = True
            
        if should_reconnect and nuevo_estado == "Desconectado":
            host = db_cuenta.server_url or os.getenv("HOST_EVOLUTION")
            apikey = db_cuenta.apikey or os.getenv("API_KEY_EVOLUTION")
            if host and apikey:
                print(f"[Auto-Reconectar] Se detectó desconexión de {instance_name} (state={state_data}, reason={reason_data}). Programando intento de reconexión...")
                background_tasks.add_task(reconnect_instance_task, instance_name, host, apikey)
        
        try:
            db.commit()
            print(f"Estado de la instancia {instance_name} actualizado a {nuevo_estado} por evento connection.update")
            return {"status": "success", "message": f"Instance {instance_name} state updated to {nuevo_estado}"}
        except Exception as e:
            db.rollback()
            return {"status": "error", "message": str(e)}

    # Manejar evento de actualización de mensajes (confirmación de entrega)
    if event == "messages.update":
        instance_name = payload.get("instance")
        db_cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.nombre_cuenta == instance_name).first()
        
        # No reenviar eventos messages.update al webhook externo
        # (Se eliminó el bloque de reenvío que estaba aquí)
            
        data = payload.get("data", {}) or []
        # En la Evolution API, data a veces es una lista de objetos o un solo objeto
        updates_to_process = data if isinstance(data, list) else [data]
        
        updated_ids = []
        for update_item in updates_to_process:
            if not isinstance(update_item, dict):
                continue
            
            # En la Evolution API v2, los estados de los mensajes se actualizan mediante el objeto 'key'
            # 'key' contiene: remoteJid, fromMe y el 'id' único del mensaje enviado.
            # Evitamos usar update_item.get("id") directamente porque a veces se refiere al ID propio del evento de actualización de base de datos o lote,
            # lo que provoca que se mezclen estados o se asigne incorrectamente.
            key = update_item.get("key", {})
            msg_id = None
            if isinstance(key, dict):
                msg_id = key.get("id")
            
            if not msg_id:
                msg_id = update_item.get("keyId") or update_item.get("messageId")
            
            if not msg_id:
                continue
                
            # Buscar el mensaje en la base de datos (podría ser un MensajeData de un chat o un LoteDestinatario)
            db_mensaje = db.query(models.MensajeData).filter(models.MensajeData.message_id == msg_id).first()
            
            status_raw = update_item.get("status") or update_item.get("update", {}).get("status")
            if status_raw is None:
                continue
                
            status_map = {
                0: "ERROR",
                1: "PENDING",
                2: "SERVER_ACK",
                3: "DELIVERY_ACK",
                4: "READ",
                5: "READ"  # PLAYED
            }
            
            nuevo_estado = None
            if isinstance(status_raw, int):
                nuevo_estado = status_map.get(status_raw)
            elif isinstance(status_raw, str):
                status_upper = status_raw.upper()
                if status_upper in ["PENDING", "SERVER_ACK", "DELIVERY_ACK", "READ", "ERROR", "FAILED"]:
                    nuevo_estado = status_upper
                elif status_upper == "PLAYED":
                    nuevo_estado = "READ"
                else:
                    nuevo_estado = status_upper
                    
            if not nuevo_estado:
                continue
                
            # Actualizar MensajeData si existe
            if db_mensaje:
                db_mensaje.status = nuevo_estado
                try:
                    db.commit()
                    print(f"Mensaje {msg_id} actualizado a estado {nuevo_estado} en BD")
                    updated_ids.append(msg_id)
                except Exception as e:
                    db.rollback()
                    print(f"Error actualizando mensaje {msg_id} en BD: {str(e)}")
                    
                # Actualizar caché de Redis
                try:
                    redis_key = f"chat:{db_mensaje.id_conversacion}"
                    mensajes_json = redis_client.lrange(redis_key, 0, -1)
                    for idx, m_json in enumerate(mensajes_json):
                        m = json.loads(m_json)
                        if m.get("message_id") == msg_id:
                            m["status"] = nuevo_estado
                            redis_client.lset(redis_key, idx, json.dumps(m))
                            print(f"Mensaje {msg_id} actualizado a estado {nuevo_estado} en Redis")
                            break
                except Exception as redis_err:
                    print(f"Error actualizando Redis para mensaje {msg_id}: {str(redis_err)}")

            # Buscar si este mensaje pertenece a un lote CSV para actualizar el estado del destinatario (independiente de si existe MensajeData)
            # Evitamos comparar contra variables que puedan ser None, ya que SQLAlchemy lo convierte en "IS NULL"
            # y seleccionaría erróneamente destinatarios pendientes cuyo message_id es NULL.
            conditions = []
            if msg_id:
                conditions.append(models.LoteDestinatario.message_id == msg_id)
            if key and isinstance(key, dict) and key.get("id"):
                conditions.append(models.LoteDestinatario.message_id == key.get("id"))
            if update_item.get("keyId"):
                conditions.append(models.LoteDestinatario.message_id == update_item.get("keyId"))
            if update_item.get("messageId"):
                conditions.append(models.LoteDestinatario.message_id == update_item.get("messageId"))

            db_destinatario = None
            if conditions:
                from sqlalchemy import or_
                db_destinatario = db.query(models.LoteDestinatario).filter(or_(*conditions)).first()
            
            if db_destinatario:
                estado_anterior = db_destinatario.estado
                
                # Si el estado es un error de Evolution (messages.update), dejamos el destinatario
                # como "pendiente" y pausamos el lote para evitar más errores en ráfaga.
                es_error_evolution = nuevo_estado in ["ERROR", "FAILED", "fallido"]
                
                if es_error_evolution:
                    estado_guardar = "pendiente"
                    db_destinatario.estado = estado_guardar
                    db_destinatario.error = "Error de envío reportado por Evolution (messages.update)"
                    
                    # Restamos de enviados ya que se volverá a enviar, y pausamos el lote
                    try:
                        lote = db.query(models.LoteEnvio).filter(models.LoteEnvio.id == db_destinatario.id_lote).first()
                        if lote:
                            if lote.enviados > 0:
                                lote.enviados -= 1
                            lote.estado = "pausado"
                            db.add(lote)
                            print(f"Lote {lote.id} pausado automáticamente y contadores actualizados debido a error en el destinatario {msg_id}")
                    except Exception as lote_err:
                        print(f"Error actualizando estado/contadores de lote para {msg_id}: {lote_err}")
                        
                    # Dejar la instancia a Desconectado si existe la cuenta asociada
                    try:
                        if db_cuenta:
                            db_cuenta.estado = "Desconectado"
                            db.add(db_cuenta)
                            print(f"Instancia {db_cuenta.nombre_cuenta} marcada como Desconectado por error de envío en messages.update")
                    except Exception as cuenta_err:
                        print(f"Error actualizando estado de la cuenta a Desconectado: {cuenta_err}")
                else:
                    estado_guardar = nuevo_estado
                    db_destinatario.estado = estado_guardar
                
                try:
                    db.commit()
                    print(f"Destinatario de lote CSV para {msg_id} actualizado a estado {estado_guardar}")
                    if msg_id not in updated_ids:
                        updated_ids.append(msg_id)
                except Exception as de_err:
                    db.rollback()
                    print(f"Error actualizando estado en LoteDestinatario para {msg_id}: {str(de_err)}")
                
        return {"status": "success", "updated_message_ids": updated_ids}

    if event not in ["messages.upsert", "send.message", "SEND_MESSAGE"]:
        return {"status": "ignored", "event": event}

    instance_name = payload.get("instance")
    data = payload.get("data", {})
    key = data.get("key", {})
    
    # Priorizar el JID con formato de teléfono (@s.whatsapp.net) frente a identidades LID de WhatsApp (@lid)
    remoteJid_temp = key.get("remoteJid")
    remoteJid_alt_temp = key.get("remoteJidAlt")
    
    if remoteJid_temp and "@lid" in remoteJid_temp and remoteJid_alt_temp and "@s.whatsapp.net" in remoteJid_alt_temp:
        remoteJid = remoteJid_alt_temp
    else:
        remoteJid = remoteJid_temp or remoteJid_alt_temp
        
    msg_id = key.get("id")
    from_me = key.get("fromMe", False)
    if event in ["send.message", "SEND_MESSAGE"]:
        from_me = True
    push_name = data.get("pushName")
    
    # Extraer contenido del mensaje
    message_content = data.get("message", {})
    message_type = data.get("messageType", "")

    # Desempaquetar viewOnceMessage o viewOnceMessageV2 si aplica
    real_message_content = message_content
    real_message_type = message_type
    
    if message_type in ["viewOnceMessage", "viewOnceMessageV2"]:
        inner_msg = message_content.get(message_type, {}).get("message", {})
        for k in ["imageMessage", "documentMessage", "audioMessage", "videoMessage", "stickerMessage"]:
            if k in inner_msg:
                real_message_content = inner_msg
                real_message_type = k
                break

    msg_details = real_message_content.get(real_message_type, {}) if isinstance(real_message_content, dict) else {}
    
    text_content = (
        message_content.get("conversation") 
        or message_content.get("extendedTextMessage", {}).get("text") 
        or msg_details.get("caption") 
        or ""
    )

    # Procesar archivos base64 (Documentos, Imágenes, Audio)
    media_url = None
    mimetype = None
    
    # Buscar el campo base64 de forma robusta y recursiva en todo el payload
    base64_data = find_base64_recursive(payload)
    
    # Fallback: Si no viene base64_data en el webhook, lo solicitamos directamente a la Evolution API
    if not base64_data and real_message_type in ["imageMessage", "documentMessage", "audioMessage", "videoMessage", "stickerMessage"]:
        try:
            db_cuenta_for_media = db.query(models.CuentaActiva).filter(models.CuentaActiva.nombre_cuenta == instance_name).first()
            host = (db_cuenta_for_media.server_url if db_cuenta_for_media else None) or os.getenv("HOST_EVOLUTION")
            apikey = (db_cuenta_for_media.apikey if db_cuenta_for_media else None) or os.getenv("API_KEY_EVOLUTION")
            if host and apikey:
                fetch_url = f"{host}/chat/getBase64FromMediaMessage/{instance_name}"
                headers = {
                    "Content-Type": "application/json",
                    "apikey": apikey
                }
                # La API de Evolution requiere la clave (key) original del mensaje
                req_body = {
                    "message": {
                        "key": {
                            "remoteJid": key.get("remoteJid"),
                            "fromMe": from_me,
                            "id": msg_id
                        }
                    }
                }
                print(f"Solicitando Base64 a Evolution API para el mensaje {msg_id}: {fetch_url}")
                resp = requests.post(fetch_url, headers=headers, json=req_body, timeout=15)
                if resp.ok:
                    resp_data = resp.json()
                    if isinstance(resp_data, dict):
                        base64_data = resp_data.get("base64") or resp_data.get("base64_data")
                    
                    # Si no se encuentra en el primer nivel, buscar recursivamente en la respuesta
                    if not base64_data:
                        base64_data = find_base64_recursive(resp_data)
                    
                    if base64_data:
                        print(f"Base64 recuperado con éxito desde la Evolution API para el mensaje {msg_id}")
                else:
                    print(f"Error llamando a getBase64FromMediaMessage (status {resp.status_code}): {resp.text}")
        except Exception as ex:
            print(f"Error obteniendo base64 desde Evolution API: {ex}")

    if base64_data and real_message_type in ["imageMessage", "documentMessage", "audioMessage", "videoMessage", "stickerMessage"]:
        # Obtener detalles del archivo y definir mimetype con fallbacks inteligentes
        mimetype = msg_details.get("mimetype", "application/octet-stream")
        if mimetype == "application/octet-stream":
            if real_message_type == "imageMessage":
                mimetype = "image/jpeg"
            elif real_message_type == "audioMessage":
                mimetype = "audio/ogg"
            elif real_message_type == "videoMessage":
                mimetype = "video/mp4"
            elif real_message_type == "stickerMessage":
                mimetype = "image/webp"
        
        if not text_content:
            text_content = msg_details.get("caption") or msg_details.get("fileName") or ""
            if not text_content:
                if real_message_type == "audioMessage":
                    text_content = "🎵 Audio Recibido"
                elif real_message_type == "imageMessage":
                    text_content = "📷 Imagen Recibida"
                elif real_message_type == "documentMessage":
                    text_content = "📄 Documento Recibido"
                elif real_message_type == "videoMessage":
                    text_content = "🎥 Video Recibido"
                elif real_message_type == "stickerMessage":
                    text_content = "🌟 Sticker Recibido"
                else:
                    text_content = "📎 Archivo Recibido"
            
        ext = "bin"
        if "/" in mimetype:
            ext = mimetype.split("/")[1].split(";")[0]
            if ext == "vnd.openxmlformats-officedocument.wordprocessingml.document":
                ext = "docx"
            elif ext == "pdf":
                ext = "pdf"
        
        if real_message_type == "audioMessage" and ext.startswith("ogg"):
            ext = "ogg"

        filename = f"{msg_id}.{ext}"
        filepath = os.path.join(STATIC_DIR, filename)
        
        try:
            with open(filepath, "wb") as f:
                f.write(decode_base64_robust(base64_data))
            media_url = f"/static/{filename}"
            print(f"Archivo multimedia guardado exitosamente: {media_url} (tipo: {real_message_type})")
        except Exception as e:
            print(f"Error guardando archivo {filename}: {e}")

    # 1. Validar instancia
    db_cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.nombre_cuenta == instance_name).first()
    if not db_cuenta:
        # Si la instancia no está registrada, podrías optar por ignorarla o crearla
        return {"status": "error", "message": f"Instance {instance_name} not found"}

    # Reenviar el webhook solo si es un mensaje entrante (fromMe es False) y el evento es messages.upsert
    if db_cuenta.webhook_url and event == "messages.upsert" and not from_me:
        background_tasks.add_task(forward_webhook_payload, db_cuenta.webhook_url, payload)

    # 2. Gestionar Contacto
    try:
        db_contacto = db.query(models.ContactoConversacion).filter(models.ContactoConversacion.remoteJid == remoteJid).first()
    except Exception:
        db.rollback()
        db_contacto = db.query(models.ContactoConversacion).filter(models.ContactoConversacion.remoteJid == remoteJid).first()

    if not db_contacto:
        # Lógica inteligente para evitar contactos duplicados cuando se recibe un identificador @lid de WhatsApp
        # Buscamos si ya tenemos un mensaje en BD (MensajeData) o en lotes de envío (LoteDestinatario) con este mismo message_id (msg_id)
        existing_msg = db.query(models.MensajeData).filter(models.MensajeData.message_id == msg_id).first() if msg_id else None
        if existing_msg:
            db_contacto = db.query(models.ContactoConversacion).filter(models.ContactoConversacion.id == existing_msg.id_contacto).first()
        else:
            existing_dest = db.query(models.LoteDestinatario).filter(models.LoteDestinatario.message_id == msg_id).first() if msg_id else None
            if existing_dest:
                dest_num = existing_dest.numero
                dest_jid = dest_num if "@" in dest_num else f"{dest_num}@s.whatsapp.net"
                db_contacto = db.query(models.ContactoConversacion).filter(
                    (models.ContactoConversacion.remoteJid == dest_jid) |
                    (models.ContactoConversacion.numero_contacto == dest_num)
                ).first()
        
        if db_contacto:
            # Encontramos el contacto original (que estaba con @s.whatsapp.net o el número de teléfono).
            # Actualizamos su remoteJid al JID actual de Evolution API (por ejemplo, el @lid) para futuras coincidencias
            if remoteJid and db_contacto.remoteJid != remoteJid:
                print(f"Fusión de identidad: actualizando remoteJid de {db_contacto.remoteJid} a {remoteJid} para contacto {db_contacto.id}")
                db_contacto.remoteJid = remoteJid
                try:
                    db.flush()
                except Exception:
                    db.rollback()
                    db_contacto = db.query(models.ContactoConversacion).filter(models.ContactoConversacion.remoteJid == remoteJid).first()

    if not db_contacto:
        # Extraer número del remoteJid (ej: 5491112345678@s.whatsapp.net -> 5491112345678)
        numero_contacto = remoteJid.split("@")[0] if remoteJid else None
        
        # Volver a verificar la existencia por remoteJid para prevenir condiciones de carrera (Race Conditions)
        db_contacto = db.query(models.ContactoConversacion).filter(models.ContactoConversacion.remoteJid == remoteJid).first()
        if not db_contacto:
            try:
                db_contacto = models.ContactoConversacion(
                    remoteJid=remoteJid,
                    numero_contacto=numero_contacto,
                    id_contacto=msg_id, # Siguiendo el requerimiento: valor de "data":"key":"id"
                    pushName=push_name
                )
                db.add(db_contacto)
                db.flush() # Para obtener el id_contacto generado si es autoincremental
            except Exception as e:
                db.rollback()
                print(f"Conflicto de clave única evitado durante la inserción paralela del contacto: {e}")
                db_contacto = db.query(models.ContactoConversacion).filter(models.ContactoConversacion.remoteJid == remoteJid).first()
                if not db_contacto:
                    raise e
    else:
        # Opcional: Actualizar pushName si cambió
        if push_name and db_contacto.pushName != push_name:
            db_contacto.pushName = push_name
        
        # Actualizar numero_contacto si no existe
        if not db_contacto.numero_contacto and remoteJid:
            db_contacto.numero_contacto = remoteJid.split("@")[0]

    # 3. Gestionar Sesión de Conversación
    db_sesion = db.query(models.ConversacionSesion).filter(
        models.ConversacionSesion.id_contacto == db_contacto.id,
        models.ConversacionSesion.id_canal == db_cuenta.cuenta_id,
        models.ConversacionSesion.activo == True
    ).first()

    if not db_sesion:
        db_sesion = models.ConversacionSesion(
            id_contacto=db_contacto.id,
            id_canal=db_cuenta.cuenta_id,
            activo=True,
            nuevo_mensaje=(not from_me),
            updated_at=func.now()
        )
        db.add(db_sesion)
        db.flush()
    else:
        # Actualizar el campo updated_at para que la conversación sea la más reciente
        db_sesion.updated_at = func.now()
        if not from_me:
            db_sesion.nuevo_mensaje = True

    # 4. Registrar Mensaje (o actualizar si ya existe)
    tipo = "OUT" if from_me else "IN"
    
    # Buscar si ya existe para evitar duplicados (ej: mensaje OUT que ya se guardó en tasks.py)
    mensaje_existente = db.query(models.MensajeData).filter(models.MensajeData.message_id == msg_id).first()
    
    if mensaje_existente:
        updated = False
        if media_url and not mensaje_existente.media_url:
            mensaje_existente.media_url = media_url
            updated = True
        if mimetype and not mensaje_existente.mimetype:
            mensaje_existente.mimetype = mimetype
            updated = True
        if updated:
            db.commit()
            
            # Actualizar en Redis es complicado al ser una lista, pero ya deberíamos tener la media_url
            # si tasks.py la guarda correctamente, así que podemos ignorarlo.
        return {"status": "success", "message_id": msg_id, "note": "Mensaje ya existente actualizado/ignorado"}
    
    # Utilizar SIEMPRE la hora del servidor para evitar desincronizaciones 
    # de tiempo con el dispositivo del usuario/EvolutionAPI
    dt_timestamp = func.now()
    iso_timestamp = datetime.now(timezone.utc).isoformat()

    nuevo_mensaje = models.MensajeData(
        id_conversacion=db_sesion.id,
        id_contacto=db_contacto.id,
        tipo=tipo,
        contenido=text_content,
        media_url=media_url,
        mimetype=mimetype,
        message_id=msg_id,
        created_at=dt_timestamp
    )
    db.add(nuevo_mensaje)
    
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

    # 5. Actualización de Caché en Redis
    try:
        # Usamos el ID de la sesión como identificador del chat
        redis_key = f"chat:{db_sesion.id}"
        
        # Armamos un diccionario con los datos esenciales del mensaje
        msg_cache = {
            "message_id": msg_id,
            "tipo": tipo,
            "contenido": text_content,
            "media_url": media_url,
            "mimetype": mimetype,
            "timestamp": iso_timestamp,
            "pushName": push_name,
            "nombre_cuenta": db_cuenta.nombre_cuenta,
            "numero_cuenta": db_cuenta.numero_cuenta
        }
        
        # Agregar el mensaje al inicio de la lista (LPUSH)
        redis_client.lpush(redis_key, json.dumps(msg_cache))
        
        # Limitar la lista a los últimos 50 mensajes (índices del 0 al 49)
        redis_client.ltrim(redis_key, 0, 49)
        
        # Definir expiración (TTL) de 24 horas = 86400 segundos
        # Si la lista ya existía, expire reinicia el contador a 24 horas
        redis_client.expire(redis_key, 86400)
    except Exception as e:
        print(f"Error actualizando Redis cache: {str(e)}")

    return {"status": "success", "message_id": msg_id}

# --- Consultar Mensajes Recibidos con filtros ---

@app.get("/mensajes/recibidos", tags=["Mensajes"])
def get_mensajes_recibidos(
    fecha_desde: str | None = None,
    fecha_hasta: str | None = None,
    id_canal: str | None = None,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_user)
):
    query = db.query(
        models.MensajeData.created_at,
        models.MensajeData.contenido,
        models.CuentaActiva.nombre_interno.label("instancia_nombre_interno"),
        models.CuentaActiva.numero_cuenta.label("instancia_numero"),
        models.CuentaActiva.nombre_cuenta.label("instancia_nombre"),
        models.ContactoConversacion.numero_contacto.label("contacto_numero")
    ).join(
        models.ConversacionSesion, models.MensajeData.id_conversacion == models.ConversacionSesion.id
    ).join(
        models.CuentaActiva, models.ConversacionSesion.id_canal == models.CuentaActiva.cuenta_id
    ).join(
        models.ContactoConversacion, models.MensajeData.id_contacto == models.ContactoConversacion.id
    ).filter(
        models.MensajeData.tipo == "IN"
    )

    if id_canal:
        query = query.filter(models.ConversacionSesion.id_canal == id_canal)

    # Filtrado por fechas
    if fecha_desde:
        try:
            dt_desde = datetime.strptime(fecha_desde, "%Y-%m-%d")
            query = query.filter(models.MensajeData.created_at >= dt_desde)
        except ValueError:
            raise HTTPException(status_code=400, detail="fecha_desde debe estar en formato YYYY-MM-DD")
            
    if fecha_hasta:
        try:
            from datetime import time
            dt_hasta = datetime.combine(datetime.strptime(fecha_hasta, "%Y-%m-%d"), time(23, 59, 59))
            query = query.filter(models.MensajeData.created_at <= dt_hasta)
        except ValueError:
            raise HTTPException(status_code=400, detail="fecha_hasta debe estar en formato YYYY-MM-DD")

    # Filtro por permisos de agente (si el perfil es 'agente')
    if current_user.perfil == "agente" and current_user.id_agente:
        # Obtener información del agente
        agente = db.query(models.AgentesAtencion).filter(models.AgentesAtencion.id == current_user.id_agente).first()
        ver_sin_grupo = agente.ver_sin_grupo if agente else False
        
        # Obtener grupos asignados
        grupos_assigned = db.query(models.AgentesGrupo.id_grupo).filter(models.AgentesGrupo.id_agente == current_user.id_agente).all()
        grupo_ids = [g[0] for g in grupos_assigned]
        
        # Join con ConversacionGrupo en la consulta principal para filtrar
        query = query.outerjoin(models.ConversacionGrupo, models.ConversacionSesion.id == models.ConversacionGrupo.id_conversacion)
        
        from sqlalchemy import or_
        conditions = []
        if grupo_ids:
            conditions.append(models.ConversacionGrupo.id_grupo_atencion.in_(grupo_ids))
            
        if ver_sin_grupo:
            conditions.append(models.ConversacionGrupo.id == None)
            
        if conditions:
            query = query.filter(or_(*conditions))
            query = query.filter(
                or_(
                    models.ConversacionGrupo.id_agente == None,
                    models.ConversacionGrupo.id_agente == current_user.id_agente
                )
            )
        else:
            # Si no tiene grupos asignados ni puede ver sin grupo, no retorna mensajes
            return []

    # Ordenar por fecha decreciente
    mensajes = query.order_by(models.MensajeData.created_at.desc()).all()
    
    # Formatear el resultado
    result = []
    for m in mensajes:
        result.append({
            "fecha_hora": m.created_at.isoformat() if m.created_at else None,
            "mensaje": m.contenido,
            "instancia_nombre_interno": m.instancia_nombre_interno,
            "instancia_numero": m.instancia_numero,
            "instancia_nombre": m.instancia_nombre,
            "contacto_numero": m.contacto_numero
        })
        
    return result

# --- Obtener contexto de conversación de un contacto en un día específico ---

@app.get("/mensajes/contexto", tags=["Mensajes"])
def get_mensajes_contexto(
    contacto_numero: str,
    instancia_nombre: str,
    fecha: str, # Formato YYYY-MM-DD
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_user)
):
    try:
        dt_desde = datetime.strptime(fecha, "%Y-%m-%d")
        from datetime import time
        dt_hasta = datetime.combine(dt_desde, time(23, 59, 59))
    except ValueError:
        raise HTTPException(status_code=400, detail="fecha debe estar en formato YYYY-MM-DD")

    query = db.query(
        models.MensajeData.id,
        models.MensajeData.created_at,
        models.MensajeData.contenido,
        models.MensajeData.tipo,
        models.MensajeData.media_url,
        models.MensajeData.mimetype,
        models.ContactoConversacion.pushName.label("contacto_pushname")
    ).join(
        models.ConversacionSesion, models.MensajeData.id_conversacion == models.ConversacionSesion.id
    ).join(
        models.CuentaActiva, models.ConversacionSesion.id_canal == models.CuentaActiva.cuenta_id
    ).join(
        models.ContactoConversacion, models.MensajeData.id_contacto == models.ContactoConversacion.id
    ).filter(
        models.ContactoConversacion.numero_contacto == contacto_numero,
        models.CuentaActiva.nombre_cuenta == instancia_nombre,
        models.MensajeData.created_at >= dt_desde,
        models.MensajeData.created_at <= dt_hasta
    )

    # Filtro por permisos de agente (si el perfil es 'agente')
    if current_user.perfil == "agente" and current_user.id_agente:
        agente = db.query(models.AgentesAtencion).filter(models.AgentesAtencion.id == current_user.id_agente).first()
        ver_sin_grupo = agente.ver_sin_grupo if agente else False
        
        grupos_assigned = db.query(models.AgentesGrupo.id_grupo).filter(models.AgentesGrupo.id_agente == current_user.id_agente).all()
        grupo_ids = [g[0] for g in grupos_assigned]
        
        query = query.outerjoin(models.ConversacionGrupo, models.ConversacionSesion.id == models.ConversacionGrupo.id_conversacion)
        
        from sqlalchemy import or_
        conditions = []
        if grupo_ids:
            conditions.append(models.ConversacionGrupo.id_grupo_atencion.in_(grupo_ids))
            
        if ver_sin_grupo:
            conditions.append(models.ConversacionGrupo.id == None)
            
        if conditions:
            query = query.filter(or_(*conditions))
            query = query.filter(
                or_(
                    models.ConversacionGrupo.id_agente == None,
                    models.ConversacionGrupo.id_agente == current_user.id_agente
                )
            )
        else:
            return []

    # Ordenar por fecha cronológicamente (ascendente) para que se lea como chat
    mensajes = query.order_by(models.MensajeData.created_at.asc()).all()

    result = []
    for m in mensajes:
        result.append({
            "id": m.id,
            "fecha_hora": m.created_at.isoformat() if m.created_at else None,
            "mensaje": m.contenido,
            "tipo": m.tipo, # IN, OUT
            "media_url": m.media_url,
            "mimetype": m.mimetype,
            "contacto_pushname": m.contacto_pushname
        })

    return result


# --- Reportes consolidados ---

@app.get("/reportes/consolidado", tags=["Reportes"])
def get_reporte_consolidado(
    fecha_desde: str,
    fecha_hasta: str,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_user)
):
    try:
        from datetime import time
        from sqlalchemy import distinct
        dt_desde = datetime.strptime(fecha_desde, "%Y-%m-%d")
        dt_hasta = datetime.combine(datetime.strptime(fecha_hasta, "%Y-%m-%d"), time(23, 59, 59))
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de fecha inválido. Usar YYYY-MM-DD")

    # 1. Obtener todas las instancias (cuentas activas)
    cuentas = db.query(models.CuentaActiva).all()
    
    # 2. Consultar mensajes enviados por Lotes agrupados por cuenta_id y filtrados por fecha_envio
    enviados_lotes = db.query(
        models.LoteEnvio.cuenta_id,
        func.count(models.LoteDestinatario.id).label("total")
    ).join(
        models.LoteDestinatario, models.LoteDestinatario.id_lote == models.LoteEnvio.id
    ).filter(
        models.LoteDestinatario.estado.in_(["PENDING", "SERVER_ACK", "DELIVERY_ACK", "READ", "enviado"]),
        models.LoteDestinatario.fecha_envio >= dt_desde,
        models.LoteDestinatario.fecha_envio <= dt_hasta
    ).group_by(
        models.LoteEnvio.cuenta_id
    ).all()
    
    dict_enviados = {c_id: total for c_id, total in enviados_lotes}

    # 2b. Consultar contactos únicos a los que se enviaron mensajes por lotes, agrupados por cuenta_id
    contactos_enviados = db.query(
        models.LoteEnvio.cuenta_id,
        func.count(distinct(models.LoteDestinatario.numero)).label("total")
    ).join(
        models.LoteDestinatario, models.LoteDestinatario.id_lote == models.LoteEnvio.id
    ).filter(
        models.LoteDestinatario.estado.in_(["PENDING", "SERVER_ACK", "DELIVERY_ACK", "READ", "enviado"]),
        models.LoteDestinatario.fecha_envio >= dt_desde,
        models.LoteDestinatario.fecha_envio <= dt_hasta
    ).group_by(
        models.LoteEnvio.cuenta_id
    ).all()

    dict_contactos_enviados = {c_id: total for c_id, total in contactos_enviados}

    # 3. Consultar mensajes recibidos agrupados por id_canal y filtrados por created_at
    recibidos = db.query(
        models.ConversacionSesion.id_canal,
        func.count(models.MensajeData.id).label("total")
    ).join(
        models.MensajeData, models.MensajeData.id_conversacion == models.ConversacionSesion.id
    ).filter(
        models.MensajeData.tipo == "IN",
        models.MensajeData.created_at >= dt_desde,
        models.MensajeData.created_at <= dt_hasta
    ).group_by(
        models.ConversacionSesion.id_canal
    ).all()

    dict_recibidos = {c_id: total for c_id, total in recibidos}

    # 3b. Consultar contactos únicos que enviaron mensajes (tipo IN), agrupados por id_canal
    contactos_recibidos = db.query(
        models.ConversacionSesion.id_canal,
        func.count(distinct(models.MensajeData.id_contacto)).label("total")
    ).join(
        models.MensajeData, models.MensajeData.id_conversacion == models.ConversacionSesion.id
    ).filter(
        models.MensajeData.tipo == "IN",
        models.MensajeData.created_at >= dt_desde,
        models.MensajeData.created_at <= dt_hasta
    ).group_by(
        models.ConversacionSesion.id_canal
    ).all()

    dict_contactos_recibidos = {c_id: total for c_id, total in contactos_recibidos}

    # 3c. Consultar totales consolidados globales de contactos únicos
    total_contactos_enviados_global = db.query(
        func.count(distinct(models.LoteDestinatario.numero))
    ).join(
        models.LoteEnvio, models.LoteDestinatario.id_lote == models.LoteEnvio.id
    ).filter(
        models.LoteDestinatario.estado.in_(["PENDING", "SERVER_ACK", "DELIVERY_ACK", "READ", "enviado"]),
        models.LoteDestinatario.fecha_envio >= dt_desde,
        models.LoteDestinatario.fecha_envio <= dt_hasta
    ).scalar() or 0

    total_contactos_recibidos_global = db.query(
        func.count(distinct(models.MensajeData.id_contacto))
    ).join(
        models.ConversacionSesion, models.MensajeData.id_conversacion == models.ConversacionSesion.id
    ).filter(
        models.MensajeData.tipo == "IN",
        models.MensajeData.created_at >= dt_desde,
        models.MensajeData.created_at <= dt_hasta
    ).scalar() or 0

    # 4. Construir respuesta detallada por instancia
    detalles = []
    total_enviados_general = 0
    total_recibidos_general = 0

    for c in cuentas:
        env = dict_enviados.get(c.cuenta_id, 0)
        rec = dict_recibidos.get(c.cuenta_id, 0)
        c_env = dict_contactos_enviados.get(c.cuenta_id, 0)
        c_rec = dict_contactos_recibidos.get(c.cuenta_id, 0)
        
        total_enviados_general += env
        total_recibidos_general += rec

        detalles.append({
            "cuenta_id": c.cuenta_id,
            "nombre_cuenta": c.nombre_cuenta,
            "nombre_interno": c.nombre_interno,
            "numero_cuenta": c.numero_cuenta,
            "enviados_lotes": env,
            "recibidos": rec,
            "contactos_enviados": c_env,
            "contactos_recibidos": c_rec
        })

    return {
        "total_enviados_lotes": total_enviados_general,
        "total_recibidos": total_recibidos_general,
        "total_contactos_enviados": total_contactos_enviados_global,
        "total_contactos_recibidos": total_contactos_recibidos_global,
        "detalles": detalles
    }




