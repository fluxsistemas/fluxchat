import os
import requests
import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Form, File, UploadFile
from sqlalchemy.orm import Session

import models
import schemas
import auth
from database import get_db
from tasks import process_send_message

router = APIRouter(prefix="/evolution", tags=["Evolution API"])

@router.get("/instances")
def fetch_evolution_instances(current_user: models.Usuario = Depends(auth.get_current_user)):
    host = os.getenv("HOST_EVOLUTION")
    apikey = os.getenv("API_KEY_EVOLUTION")
    
    if not host or not apikey:
        raise HTTPException(status_code=500, detail="HOST_EVOLUTION or API_KEY_EVOLUTION not configured")

    url = f"{host}/instance/fetchInstances"
    headers = {"apikey": apikey}

    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Error connecting to Evolution API: {str(e)}")

@router.post("/sync-instances")
def sync_evolution_instances(db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    host = os.getenv("HOST_EVOLUTION")
    apikey = os.getenv("API_KEY_EVOLUTION")
    
    if not host or not apikey:
        raise HTTPException(status_code=500, detail="HOST_EVOLUTION or API_KEY_EVOLUTION not configured")

    url = f"{host}/instance/fetchInstances"
    headers = {"apikey": apikey}

    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        instances = response.json()
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Error connecting to Evolution API: {str(e)}")

    # --- FASE PREVIA DE LIMPIEZA DE CUENTAS HUÉRFANAS ---
    # Identificar y eliminar cuentas locales huérfanas (que ya no existen en Evolution API)
    # Hacemos esto AL INICIO para liberar cualquier número telefónico registrado de forma física y proactiva,
    # eliminando las instancias obsoletas de la plataforma y previniendo errores de UniqueViolation.
    remote_instance_ids = {inst.get("id") for inst in instances if inst.get("id")}
    local_cuentas = db.query(models.CuentaActiva).all()
    deleted_count = 0

    for local_cuenta in local_cuentas:
        if local_cuenta.cuenta_id not in remote_instance_ids:
            print(f"Eliminando cuenta huérfana local y liberando número: {local_cuenta.nombre_cuenta} ({local_cuenta.cuenta_id})")
            # Limpiar relaciones para evitar fallos de integridad referencial
            db.query(models.AgentesAtencion).filter(models.AgentesAtencion.id_canal == local_cuenta.cuenta_id).update({models.AgentesAtencion.id_canal: None}, synchronize_session=False)
            db.query(models.ConversacionSesion).filter(models.ConversacionSesion.id_canal == local_cuenta.cuenta_id).update({models.ConversacionSesion.id_canal: None}, synchronize_session=False)
            db.query(models.LoteEnvio).filter(models.LoteEnvio.cuenta_id == local_cuenta.cuenta_id).delete(synchronize_session=False)
            
            db.delete(local_cuenta)
            deleted_count += 1
    
    if deleted_count > 0:
        db.commit() # Confirmar físicamente la eliminación inmediata de las cuentas para liberar los números de forma real y limpia

    # --- PRE-PROCESAMIENTO Y DESDUPLICACIÓN EN MEMORIA ---
    # Extraer, limpiar formatos y desduplicar números de las instancias remotas antes de guardarlas,
    # impidiendo colisiones de UniqueViolation si múltiples instancias contienen el mismo número.
    parsed_instances = []
    for inst in instances:
        instance_id = inst.get("id")
        if not instance_id:
            continue
            
        instance_name = inst.get("name")
        instance_token = inst.get("token")
        
        # Obtener el número de forma robusta
        instance_number = inst.get("number")
        if not instance_number:
            instance_number = inst.get("owner") or inst.get("ownerJid")
            
        if not instance_number:
            conn_status = inst.get("connectionStatus")
            if isinstance(conn_status, dict):
                instance_number = conn_status.get("owner") or conn_status.get("ownerJid")
                
        # Limpiar el formato del número (extraer solo dígitos)
        if instance_number:
            instance_number_str = str(instance_number)
            if "@" in instance_number_str:
                instance_number_str = instance_number_str.split("@")[0]
            instance_number_clean = "".join(filter(str.isdigit, instance_number_str)) or None
        else:
            instance_number_clean = None

        # Obtener estado de la instancia de forma robusta
        api_status = inst.get("status")
        if not api_status:
            api_status = inst.get("connectionStatus")
            
        if isinstance(api_status, dict):
            api_status = api_status.get("status") or api_status.get("state")
            
        api_status_str = str(api_status).lower() if api_status else ""
        if api_status_str in ["open", "connected"]:
            instance_status = "Conectado"
        elif api_status_str in ["connecting"]:
            instance_status = "Conectando..."
        else:
            instance_status = "Desconectado"
            
        parsed_instances.append({
            "id": instance_id,
            "name": instance_name,
            "token": instance_token,
            "number": instance_number_clean,
            "status": instance_status
        })

    # Desduplicar números telefónicos en memoria (priorizando la instancia "Conectado" o la existente)
    numbers_seen = {}
    for item in parsed_instances:
        num = item["number"]
        if not num:
            continue
            
        if num not in numbers_seen:
            numbers_seen[num] = item
        else:
            previous_item = numbers_seen[num]
            # Si hay colisión, preferimos la que tenga estado activo o esté conectada
            if item["status"] == "Conectado" and previous_item["status"] != "Conectado":
                numbers_seen[num] = item
                previous_item["number"] = None
            elif previous_item["status"] == "Conectado" and item["status"] != "Conectado":
                item["number"] = None
            else:
                # Si tienen el mismo estado, preferimos la que ya exista en la DB
                db_item_exists = db.query(models.CuentaActiva).filter(models.CuentaActiva.cuenta_id == item["id"]).first() is not None
                db_prev_exists = db.query(models.CuentaActiva).filter(models.CuentaActiva.cuenta_id == previous_item["id"]).first() is not None
                if db_item_exists and not db_prev_exists:
                    numbers_seen[num] = item
                    previous_item["number"] = None
                else:
                    item["number"] = None

    added_count = 0
    updated_count = 0

    for item in parsed_instances:
        instance_id = item["id"]
        instance_name = item["name"]
        instance_token = item["token"]
        instance_number = item["number"]
        instance_status = item["status"]

        # Buscar si ya existe la cuenta por ID (ID único de instancia de Evolution API)
        db_cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.cuenta_id == instance_id).first()

        # En caso de que no exista por ID, pero el número de cuenta ya esté registrado en otra fila debido a un cambio de ID o recreación de instancia,
        # buscamos también por número para actualizarla o migrarla de ID de canal.
        if not db_cuenta and instance_number:
            db_cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.numero_cuenta == instance_number).first()

        if db_cuenta:
            # Si se encontró la cuenta (ya sea por ID o por número de cuenta existente), realizamos un UPDATE/MIGRATION.
            if db_cuenta.cuenta_id != instance_id:
                print(f"Migrando de forma segura ID de canal de {db_cuenta.cuenta_id} a {instance_id} preservando FKs.")
                
                # Para evitar conflictos UniqueViolation con el número_cuenta (que aún está en la fila vieja de db_cuenta),
                # primero ponemos temporalmente el número de cuenta de la fila vieja como NULL y guardamos.
                db_cuenta.numero_cuenta = None
                db.commit()

                # 1. Crear un clon temporal con el nuevo ID en cuentas_activas para que PostgreSQL permita asociar las FKs sin error
                clon_cuenta = models.CuentaActiva(
                    cuenta_id=instance_id,
                    nombre_cuenta=instance_name,
                    token_cuenta=instance_token,
                    numero_cuenta=None, # Temporalmente nulo para evitar colisión de UniqueViolation de numero_cuenta
                    estado=instance_status
                )
                db.add(clon_cuenta)
                db.commit() # ¡Confirmar de forma real el registro padre para que PostgreSQL lo vea antes de actualizar las FKs de las tablas hijas!
                
                # 2. Ahora que el nuevo ID existe de forma real en cuentas_activas, actualizamos las FKs de las tablas relacionadas
                db.query(models.AgentesAtencion).filter(models.AgentesAtencion.id_canal == db_cuenta.cuenta_id).update({models.AgentesAtencion.id_canal: instance_id}, synchronize_session=False)
                db.query(models.ConversacionSesion).filter(models.ConversacionSesion.id_canal == db_cuenta.cuenta_id).update({models.ConversacionSesion.id_canal: instance_id}, synchronize_session=False)
                db.query(models.LoteEnvio).filter(models.LoteEnvio.cuenta_id == db_cuenta.cuenta_id).update({models.LoteEnvio.cuenta_id: instance_id}, synchronize_session=False)
                db.commit() # Confirmar la actualización de las claves hijas
                
                # 3. Eliminar el registro de cuenta viejo con el ID viejo
                db.delete(db_cuenta)
                db.commit() # Confirmar eliminación de la fila primaria anterior
                
                # 4. Asignar el clon_cuenta creado como la cuenta activa actual para continuar la actualización de campos restantes
                db_cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.cuenta_id == instance_id).first()

            # Actualizar datos de la cuenta activa (incluyendo su número)
            estado_anterior = db_cuenta.estado
            db_cuenta.nombre_cuenta = instance_name
            db_cuenta.token_cuenta = instance_token
            db_cuenta.numero_cuenta = instance_number
            db_cuenta.estado = instance_status
            updated_count += 1
            
            try:
                db.commit()
                if instance_status == "Conectado" and estado_anterior != "Conectado":
                    host_inst = db_cuenta.server_url or host
                    apikey_inst = db_cuenta.apikey or apikey
                    if host_inst and apikey_inst:
                        try:
                            from main import fetch_and_process_unread_messages
                            import threading
                            threading.Thread(
                                target=fetch_and_process_unread_messages,
                                args=(instance_name, host_inst, apikey_inst)
                            ).start()
                            print(f"[Sync Sincronización] Instancia {instance_name} conectada detectada. Se inició fetch_and_process_unread_messages en segundo plano.")
                        except Exception as ex:
                            print(f"Error importando o ejecutando fetch_and_process_unread_messages en sync: {ex}")
            except Exception as e:
                db.rollback()
                print(f"Error al guardar actualización de la instancia {instance_name}: {str(e)}")
        else:
            # Crear nueva cuenta de forma segura si no existe de ninguna forma en la base de datos.
            # Sin embargo, como resguardo absoluto, si existiera un registro huérfano con el mismo número que por cualquier motivo de sesión de SQLAlchemy no fue detectado en las búsquedas anteriores,
            # lo liberamos para impedir bajo toda circunstancia un fallo de UniqueViolation.
            if instance_number:
                registro_fantasma = db.query(models.CuentaActiva).filter(models.CuentaActiva.numero_cuenta == instance_number).first()
                if registro_fantasma:
                    print(f"Limpiando de forma proactiva registro fantasma {registro_fantasma.cuenta_id} para el número {instance_number}")
                    registro_fantasma.numero_cuenta = None
                    db.commit()

            new_cuenta = models.CuentaActiva(
                cuenta_id=instance_id,
                nombre_cuenta=instance_name,
                token_cuenta=instance_token,
                numero_cuenta=instance_number,
                estado=instance_status
            )
            db.add(new_cuenta)
            added_count += 1
            
            try:
                db.commit()
            except Exception as e:
                db.rollback()
                print(f"Error al guardar nueva instancia {instance_name}: {str(e)}")

    return {
        "status": "success",
        "summary": {
            "total_instances_fetched": len(instances),
            "added": added_count,
            "updated": updated_count,
            "deleted": deleted_count
        }
    }

@router.post("/create-instance")
def create_evolution_instance(
    payload: schemas.EvolutionInstanceCreate,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_user)
):
    host = os.getenv("HOST_EVOLUTION")
    apikey = os.getenv("API_KEY_EVOLUTION")
    
    if not host or not apikey:
        raise HTTPException(status_code=500, detail="HOST_EVOLUTION or API_KEY_EVOLUTION not configured")

    create_url = f"{host}/instance/create"
    headers = {"apikey": apikey}
    
    create_payload = {
        "instanceName": payload.instanceName,
        "qrcode": True,
        "integration": "WHATSAPP-BAILEYS",
        "webhookUrl": "http://evolution_backend_api:8000/webhook/evolution",
        "webhookByEvents": False,
        "webhookBase64": True,
        "webhookEvents": [
            "CONNECTION_UPDATE",
            "MESSAGES_UPDATE",
            "MESSAGES_UPSERT",
            "SEND_MESSAGE"
        ],
        "webhook": {
            "enabled": True,
            "url": "http://evolution_backend_api:8000/webhook/evolution",
            "byEvents": False,
            "webhookByEvents": False,
            "base64": True,
            "webhookBase64": True,
            "events": [
                "CONNECTION_UPDATE",
                "MESSAGES_UPDATE",
                "MESSAGES_UPSERT",
                "SEND_MESSAGE"
            ]
        }
    }
    if payload.token:
        create_payload["token"] = payload.token

    try:
        response = requests.post(create_url, headers=headers, json=create_payload)
        if response.status_code not in [200, 201]:
            try:
                err_detail = response.json()
            except Exception:
                err_detail = response.text
            raise HTTPException(status_code=response.status_code, detail=f"Evolution API error: {err_detail}")
        
        create_response_data = response.json()
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Error connecting to Evolution API: {str(e)}")

    # Intentar configurar el webhook de forma explícita como fallback
    webhook_url_api = f"{host}/webhook/set/{payload.instanceName}"
    webhook_payload = {
        "enabled": True,
        "url": "http://evolution_backend_api:8000/webhook/evolution",
        "byEvents": False,
        "webhookByEvents": False,
        "base64": True,
        "webhookBase64": True,
        "events": [
            "CONNECTION_UPDATE",
            "MESSAGES_UPDATE",
            "MESSAGES_UPSERT",
            "SEND_MESSAGE"
        ]
    }

    try:
        web_resp = requests.post(webhook_url_api, headers=headers, json=webhook_payload)
        print(f"Resultado fallback de configuración de webhook (Status {web_resp.status_code}): {web_resp.text}")
    except Exception as ex:
        print(f"Advertencia: Excepción al configurar el webhook fallback: {ex}")

    # Guardar en base de datos local
    instance_id = None
    instance_token = None
    instance_number = payload.number or None

    # Evolution API v1 vs v2
    inst_data = create_response_data.get("instance") or create_response_data
    if inst_data:
        instance_id = inst_data.get("instanceId") or inst_data.get("id")
        instance_token = inst_data.get("token") or payload.token
        api_number = inst_data.get("number")
        if api_number:
            instance_number = api_number
    
    if not instance_id:
        instance_id = str(uuid.uuid4())

    db_cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.nombre_cuenta == payload.instanceName).first()
    if db_cuenta:
        if instance_id:
            db_cuenta.cuenta_id = instance_id
        if instance_token:
            db_cuenta.token_cuenta = instance_token
        if instance_number:
            db_cuenta.numero_cuenta = instance_number
        db_cuenta.estado = "Desconectado"
    else:
        new_cuenta = models.CuentaActiva(
            cuenta_id=instance_id,
            nombre_cuenta=payload.instanceName,
            token_cuenta=instance_token if instance_token else "",
            numero_cuenta=instance_number if instance_number else None,
            estado="Desconectado"
        )
        db.add(new_cuenta)
    
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"Database error during creation sync: {str(e)}")

    return {
        "status": "success",
        "message": "Instancia creada correctamente en Evolution API y configurada localmente con el webhook.",
        "data": create_response_data
    }

@router.get("/connect/{instance_name}")
def connect_evolution_instance(instance_name: str, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    db_cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.nombre_cuenta == instance_name).first()
    
    host = (db_cuenta.server_url if db_cuenta else None) or os.getenv("HOST_EVOLUTION")
    apikey = (db_cuenta.apikey if db_cuenta else None) or os.getenv("API_KEY_EVOLUTION")
    
    if not host or not apikey:
        raise HTTPException(status_code=500, detail="HOST_EVOLUTION or API_KEY_EVOLUTION not configured")

    url = f"{host}/instance/connect/{instance_name}"
    headers = {"apikey": apikey}

    try:
        response = requests.get(url, headers=headers)
        # Retornamos el JSON devuelto por Evolution API (que contiene la imagen en base64 del QR, etc.)
        return response.json()
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Error connecting to Evolution API: {str(e)}")

@router.post("/restart/{instance_name}")
def restart_evolution_instance(instance_name: str, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    db_cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.nombre_cuenta == instance_name).first()
    
    host = (db_cuenta.server_url if db_cuenta else None) or os.getenv("HOST_EVOLUTION")
    apikey = (db_cuenta.apikey if db_cuenta else None) or os.getenv("API_KEY_EVOLUTION")
    
    if not host or not apikey:
        raise HTTPException(status_code=500, detail="HOST_EVOLUTION or API_KEY_EVOLUTION not configured")

    url = f"{host}/instance/restart/{instance_name}"
    headers = {"apikey": apikey}

    try:
        response = requests.post(url, headers=headers)
        return response.json()
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Error restarting Evolution API instance: {str(e)}")

@router.post("/logout/{instance_name}")
def logout_evolution_instance(instance_name: str, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    db_cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.nombre_cuenta == instance_name).first()
    if not db_cuenta:
        raise HTTPException(status_code=404, detail="Instancia no encontrada localmente")
    
    host = (db_cuenta.server_url if db_cuenta else None) or os.getenv("HOST_EVOLUTION")
    apikey = (db_cuenta.apikey if db_cuenta else None) or os.getenv("API_KEY_EVOLUTION")
    
    if not host or not apikey:
        raise HTTPException(status_code=500, detail="HOST_EVOLUTION or API_KEY_EVOLUTION not configured")

    url = f"{host}/instance/logout/{instance_name}"
    headers = {"apikey": apikey}

    # Intentar hacer logout en Evolution API (DELETE es el estándar de logout)
    try:
        response = requests.delete(url, headers=headers)
        print(f"Resultado de logout en Evolution API (Status {response.status_code}): {response.text}")
    except Exception as e:
        print(f"Error al hacer logout de la instancia {instance_name} en Evolution API: {e}")

    # Forzar el estado a Desconectado en la base de datos local
    db_cuenta.estado = "Desconectado"
    try:
        db.commit()
        return {"status": "success", "message": "Sesión cerrada correctamente (Logout)"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error al actualizar la base de datos: {str(e)}")

@router.delete("/delete/{instance_name}")
def delete_evolution_instance(instance_name: str, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    db_cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.nombre_cuenta == instance_name).first()
    if not db_cuenta:
        raise HTTPException(status_code=404, detail="Instancia no encontrada localmente")
    
    host = (db_cuenta.server_url if db_cuenta else None) or os.getenv("HOST_EVOLUTION")
    apikey = (db_cuenta.apikey if db_cuenta else None) or os.getenv("API_KEY_EVOLUTION")
    
    if not host or not apikey:
        raise HTTPException(status_code=500, detail="HOST_EVOLUTION or API_KEY_EVOLUTION not configured")

    url = f"{host}/instance/delete/{instance_name}"
    headers = {"apikey": apikey}

    # Intentar eliminar de Evolution API
    try:
        response = requests.delete(url, headers=headers)
        print(f"Resultado de eliminar en Evolution API (Status {response.status_code}): {response.text}")
    except Exception as e:
        print(f"Error al eliminar la instancia {instance_name} en Evolution API: {e}")

    # Limpiar relaciones para evitar fallos de integridad referencial
    cuenta_id = db_cuenta.cuenta_id
    db.query(models.AgentesAtencion).filter(models.AgentesAtencion.id_canal == cuenta_id).update({models.AgentesAtencion.id_canal: None}, synchronize_session=False)
    db.query(models.ConversacionSesion).filter(models.ConversacionSesion.id_canal == cuenta_id).update({models.ConversacionSesion.id_canal: None}, synchronize_session=False)
    db.query(models.LoteEnvio).filter(models.LoteEnvio.cuenta_id == cuenta_id).delete(synchronize_session=False)

    db.delete(db_cuenta)
    try:
        db.commit()
        return {"status": "success", "message": "Instancia eliminada correctamente de forma local y remota"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error al eliminar de la base de datos: {str(e)}")

@router.post("/message/send")
def send_message_via_evolution(message_req: schemas.SendMessageRequest, db: Session = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_user)):
    # 1. Validar instancia en BD para obtener el id_canal (cuenta_id) de forma sincrónica
    db_cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.nombre_cuenta == message_req.nombre_cuenta).first()
    if not db_cuenta:
        raise HTTPException(status_code=404, detail=f"Instancia {message_req.nombre_cuenta} no encontrada en el backend")

    # 2. Delegar a Celery el envío y la persistencia
    process_send_message.delay(
        nombre_cuenta=message_req.nombre_cuenta,
        number=message_req.number,
        text=message_req.text,
        media=message_req.media,
        mimetype=message_req.mimetype,
        fileName=message_req.fileName
    )

    return {"status": "queued", "message": "Mensaje encolado correctamente"}


@router.post("/message/send-media")
async def send_media_via_evolution(
    nombre_cuenta: str = Form(...),
    number: str = Form(...),
    text: str | None = Form(None),
    media_file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_user)
):
    """
    Envía un mensaje con adjunto (imagen, PDF, video o audio) usando
    multipart/form-data en lugar de base64 dentro del JSON.

    El archivo se guarda temporalmente en disco y se delega a Celery, que se
    encarga de comprimir el video (si supera el límite de WhatsApp) y enviarlo.
    """
    # 1. Validar instancia en BD
    db_cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.nombre_cuenta == nombre_cuenta).first()
    if not db_cuenta:
        raise HTTPException(status_code=404, detail=f"Instancia {nombre_cuenta} no encontrada en el backend")

    if not media_file or not media_file.filename:
        raise HTTPException(status_code=400, detail="No se recibió ningún archivo adjunto")

    # 2. Guardar el archivo en disco (uploads temporales)
    STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
    uploads_dir = os.path.join(STATIC_DIR, "uploads")
    os.makedirs(uploads_dir, exist_ok=True)

    ext = os.path.splitext(media_file.filename)[1]
    unique_id = uuid.uuid4().hex
    filename_saved = f"upload_{unique_id}{ext}"
    filepath = os.path.join(uploads_dir, filename_saved)

    try:
        content = await media_file.read()
        with open(filepath, "wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error guardando el archivo adjunto: {str(e)}")

    # 3. Delegar a Celery el envío, compresión y persistencia
    process_send_message.delay(
        nombre_cuenta=nombre_cuenta,
        number=number,
        text=text,
        media_path=filepath,
        mimetype=media_file.content_type,
        fileName=media_file.filename
    )

    return {"status": "queued", "message": "Mensaje con adjunto encolado correctamente"}
