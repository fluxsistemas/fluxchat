import os
import requests
import json
import base64
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from celery_app import celery_app
from database import SessionLocal
import models
import redis
from sqlalchemy import func

redis_client = redis.Redis(
    host=os.getenv("REDIS_HOST", "evolution_redis"),
    port=int(os.getenv("REDIS_PORT", 6379)),
    db=int(os.getenv("REDIS_DB", 5)),
    decode_responses=True
)

@celery_app.task(bind=True, max_retries=3)
def process_send_message(self, nombre_cuenta: str, number: str, text: str = None, media: str = None, mimetype: str = None, fileName: str = None, media_path: str = None):
    db: Session = SessionLocal()
    temp_files_to_cleanup = []
    try:
        db_cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.nombre_cuenta == nombre_cuenta).first()
        if not db_cuenta:
            print(f"Instancia {nombre_cuenta} no encontrada en el backend")
            return

        host = db_cuenta.server_url or os.getenv("HOST_EVOLUTION")
        apikey = db_cuenta.apikey or os.getenv("API_KEY_EVOLUTION")
        
        if not host or not apikey:
            print("Error: HOST_EVOLUTION or API_KEY_EVOLUTION not configured")
            return

        # Si viene un archivo en disco (flujo multipart), leemos sus bytes.
        # La compresión es opcional: si media_utils no está desplegado todavía,
        # imágenes y videos se envían igualmente sin compresión.
        if media_path:
            if not os.path.exists(media_path):
                raise FileNotFoundError(f"No se encontró el archivo multimedia: {media_path}")
            temp_files_to_cleanup.append(media_path)
            if mimetype and mimetype.startswith("video/"):
                try:
                    from media_utils import compress_video
                    compressed_path = compress_video(media_path)
                    if compressed_path != media_path:
                        temp_files_to_cleanup.append(compressed_path)
                        media_path = compressed_path
                except ImportError as media_err:
                    print(f"[media] {media_err}; se enviará el video sin comprimir.", flush=True)
                except Exception as media_err:
                    print(f"[media] Falló la compresión; se enviará el video original: {media_err}", flush=True)
            with open(media_path, "rb") as f:
                media = base64.b64encode(f.read()).decode("utf-8")

        is_media = bool(media)
        
        if is_media:
            url = f"{host}/message/sendMedia/{nombre_cuenta}"
        else:
            url = f"{host}/message/sendText/{nombre_cuenta}"

        headers = {
            "Content-Type": "application/json",
            "apikey": apikey
        }
        
        # Simular presencia ANTES de enviar el mensaje
        presence_url = f"{host}/chat/sendPresence/{nombre_cuenta}"
        presence_payload = {
            "number": number,
            "presence": "composing",
            "delay": 3500
        }
        try:
            requests.post(presence_url, headers=headers, json=presence_payload)
        except Exception as e:
            print(f"Error al enviar presencia: {e}")

        if is_media:
            mediatype = "document"
            if mimetype:
                if mimetype.startswith("image/"):
                    mediatype = "image"
                elif mimetype.startswith("video/"):
                    mediatype = "video"
                elif mimetype.startswith("audio/"):
                    mediatype = "audio"

            payload = {
                "number": number,
                "mediatype": mediatype,
                "mimetype": mimetype,
                "media": media,
                "fileName": fileName or "archivo"
            }
            if text:
                payload["caption"] = text
        else:
            payload = {
                "number": number,
                "text": text or ""
            }

        try:
            response = requests.post(url, headers=headers, json=payload)
            if response.status_code >= 400:
                print(f"Error devuelto por Evolution API (Status {response.status_code}): {response.text}")
            response.raise_for_status()
            evo_response = response.json()
        except Exception as exc:
            print(f"Error enviando mensaje a Evolution API: {exc}")
            
            # Si es un error HTTP del cliente (4xx), no tiene sentido reintentar (ej. número inválido o instancia desconectada)
            is_client_error = False
            if isinstance(exc, requests.exceptions.HTTPError) and exc.response is not None:
                status_code = exc.response.status_code
                if 400 <= status_code < 500 and status_code not in (408, 429):
                    is_client_error = True
            
            if is_client_error:
                print(f"Error de cliente no recuperable ({status_code}). Se aborta el reintento de Celery.")
                raise exc
            else:
                raise self.retry(exc=exc, countdown=5)

        # 2. Persistencia en PG tras envío exitoso
        try:
            remoteJid = number if "@" in number else f"{number}@s.whatsapp.net"
            msg_id = evo_response.get("key", {}).get("id", "SENT_BY_BACKEND")

            # Guardar archivo si es media
            media_url = None
            if is_media and media:
                STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
                os.makedirs(STATIC_DIR, exist_ok=True)
                ext = "bin"
                if mimetype and "/" in mimetype:
                    ext = mimetype.split("/")[1].split(";")[0]
                    if ext == "vnd.openxmlformats-officedocument.wordprocessingml.document":
                        ext = "docx"
                    elif ext == "pdf":
                        ext = "pdf"
                
                filename = f"{msg_id}.{ext}"
                filepath = os.path.join(STATIC_DIR, filename)
                
                try:
                    with open(filepath, "wb") as f:
                        f.write(base64.b64decode(media))
                    media_url = f"/static/{filename}"
                except Exception as e:
                    print(f"Error guardando archivo enviado {filename}: {e}")

            db_contacto = db.query(models.ContactoConversacion).filter(models.ContactoConversacion.remoteJid == remoteJid).first()
            if not db_contacto:
                db_contacto = models.ContactoConversacion(
                    remoteJid=remoteJid,
                    numero_contacto=number,
                    id_contacto=msg_id,
                    pushName=None
                )
                db.add(db_contacto)
                db.flush()
            else:
                if not db_contacto.numero_contacto:
                    db_contacto.numero_contacto = number

            db_sesion = db.query(models.ConversacionSesion).filter(
                models.ConversacionSesion.id_contacto == db_contacto.id,
                models.ConversacionSesion.id_canal == db_cuenta.cuenta_id,
                models.ConversacionSesion.activo == True
            ).first()

            if not db_sesion:
                db_sesion = models.ConversacionSesion(
                    id_contacto=db_contacto.id,
                    id_canal=db_cuenta.cuenta_id,
                    activo=True
                )
                db.add(db_sesion)
                db.flush()
            else:
                db_sesion.updated_at = func.now()

            nuevo_mensaje = models.MensajeData(
                id_conversacion=db_sesion.id,
                id_contacto=db_contacto.id,
                tipo="OUT",
                contenido=text or (fileName if is_media else ""),
                mimetype=mimetype if is_media else None,
                media_url=media_url, # guardado en static
                message_id=msg_id,
                status="PENDING"
            )
            db.add(nuevo_mensaje)
            db.commit()

            # 3. Actualización de Caché en Redis
            try:
                redis_key = f"chat:{db_sesion.id}"
                msg_cache = {
                    "message_id": msg_id,
                    "status": "PENDING",
                    "tipo": "OUT",
                    "contenido": text or (fileName if is_media else ""),
                    "media_url": media_url,
                    "mimetype": mimetype if is_media else None,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "pushName": "System",
                    "nombre_cuenta": db_cuenta.nombre_cuenta,
                    "numero_cuenta": db_cuenta.numero_cuenta
                }
                redis_client.lpush(redis_key, json.dumps(msg_cache))
                redis_client.ltrim(redis_key, 0, 49)
                redis_client.expire(redis_key, 86400)
            except Exception as redis_err:
                print(f"Error actualizando Redis cache (send): {str(redis_err)}")

        except Exception as db_err:
            db.rollback()
            print(f"Error guardando mensaje enviado en BD: {str(db_err)}")
            
        return {"status": "success", "message_id": msg_id}
        
    finally:
        db.close()
        # Limpiar archivos temporales (original subido y versión comprimida)
        for temp_file in temp_files_to_cleanup:
            try:
                if temp_file and os.path.exists(temp_file):
                    os.remove(temp_file)
            except OSError as cleanup_err:
                print(f"No se pudo eliminar el archivo temporal {temp_file}: {cleanup_err}")

@celery_app.task(bind=True, max_retries=1)
def process_lote_envio(self, lote_id: int):
    import random
    import time
    db: Session = SessionLocal()
    lote = None
    lote_temp_files = []
    try:
        lote = db.query(models.LoteEnvio).filter(models.LoteEnvio.id == lote_id).first()
        if not lote:
            print(f"Lote {lote_id} no encontrado")
            return
        
        # Si el lote fue pausado o cancelado antes de arrancar la tarea programada
        if lote.estado == "pausado":
            print(f"Lote {lote_id} está pausado, no se inicia la ejecución de envíos.")
            return
        
        # Evitar procesamiento duplicado si el lote ya está en progreso o completado
        if lote.estado in ["en_progreso", "completado"]:
            print(f"Lote {lote_id} ya está en estado '{lote.estado}'. Se cancela la ejecución para evitar duplicaciones.")
            return
        
        # Actualizar estado a en_progreso
        lote.estado = "en_progreso"
        db.commit()

        # Obtener los destinatarios pendientes de este lote
        destinatarios = db.query(models.LoteDestinatario).filter(
            models.LoteDestinatario.id_lote == lote_id,
            models.LoteDestinatario.estado == "pendiente"
        ).all()

        cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.cuenta_id == lote.cuenta_id).first()
        if not cuenta:
            lote.estado = "fallido"
            db.commit()
            print(f"Cuenta de envío {lote.cuenta_id} no encontrada")
            return

        host = cuenta.server_url or os.getenv("HOST_EVOLUTION")
        apikey = cuenta.apikey or os.getenv("API_KEY_EVOLUTION")
        if not host or not apikey:
            lote.estado = "fallido"
            db.commit()
            print("Error: HOST_EVOLUTION or API_KEY_EVOLUTION not configured")
            return

        nombre_cuenta = cuenta.nombre_cuenta
        headers = {
            "Content-Type": "application/json",
            "apikey": apikey
        }

        # Preparar archivo multimedia si el lote lo incluye (se procesa una sola vez)
        lote_has_media = bool(lote.media_path)
        media_b64 = None
        media_mimetype = None
        media_filename = None
        media_type = "document"

        if lote_has_media:
            backend_dir = os.path.dirname(os.path.abspath(__file__))
            filepath = os.path.join(backend_dir, lote.media_path)
            if os.path.exists(filepath):
                import base64
                try:
                    media_mimetype = lote.media_mimetype
                    media_filename = lote.media_filename

                    # Si es un video que supera el límite de WhatsApp, se comprime
                    # UNA SOLA VEZ antes del loop (no por cada destinatario).
                    if media_mimetype and media_mimetype.startswith("video/"):
                        try:
                            from media_utils import compress_video
                            compressed_path = compress_video(filepath)
                            if compressed_path != filepath:
                                lote_temp_files.append(compressed_path)
                                filepath = compressed_path
                        except ImportError as media_err:
                            print(f"[media] {media_err}; se enviará el video sin comprimir.", flush=True)
                        except Exception as media_err:
                            print(f"[media] Falló la compresión; se enviará el video original: {media_err}", flush=True)

                    with open(filepath, "rb") as f:
                        media_b64 = base64.b64encode(f.read()).decode("utf-8")

                    if media_mimetype:
                        if media_mimetype.startswith("image/"):
                            media_type = "image"
                        elif media_mimetype.startswith("video/"):
                            media_type = "video"
                        elif media_mimetype.startswith("audio/"):
                            media_type = "audio"
                except Exception as b64_err:
                    print(f"Error codificando adjunto de lote {lote_id} a base64: {b64_err}", flush=True)
                    raise
            else:
                raise FileNotFoundError(f"No se encontró el archivo adjunto del lote {lote_id}: {filepath}")

        for index, dest in enumerate(destinatarios):
            # Volver a consultar el estado del lote en cada paso para ver si fue pausado por el usuario
            db.refresh(lote)
            if lote.estado == "pausado":
                print(f"Lote {lote_id} ha sido PAUSADO por el usuario.")
                return

            number = dest.numero
            text = dest.mensaje_personalizado

            # Retardo random: para el primer mensaje del ciclo, un retardo humano corto (2 a 5 segundos).
            # Para los siguientes, el retardo anti-ban de entre 2 minutos (120 segundos) y 8 minutos (480 segundos).
            if index == 0:
                delay = random.uniform(2.0, 5.0)
            else:
                delay = random.uniform(120.0, 480.0)
                
            time.sleep(delay)

            # Volver a verificar la pausa justo después de la espera
            db.refresh(lote)
            if lote.estado == "pausado":
                print(f"Lote {lote_id} ha sido PAUSADO por el usuario después del delay.")
                return

            try:
                # Enviar presencia de componiendo
                presence_url = f"{host}/chat/sendPresence/{nombre_cuenta}"
                presence_payload = {
                    "number": number,
                    "presence": "composing",
                    "delay": min(3500, int(delay * 1000))
                }
                try:
                    requests.post(presence_url, headers=headers, json=presence_payload, timeout=5)
                except Exception as pe:
                    print(f"Error al enviar presencia para {number}: {pe}")

                if lote_has_media and media_b64:
                    url = f"{host}/message/sendMedia/{nombre_cuenta}"
                    payload = {
                        "number": number,
                        "mediatype": media_type,
                        "mimetype": media_mimetype,
                        "media": media_b64,
                        "fileName": media_filename or "archivo"
                    }
                    if text:
                        payload["caption"] = text
                else:
                    url = f"{host}/message/sendText/{nombre_cuenta}"
                    payload = {
                        "number": number,
                        "text": text
                    }
                
                response = requests.post(url, headers=headers, json=payload, timeout=10)
                if response.status_code >= 400:
                    print(f"Error devuelto por Evolution API en lote {lote_id} (Status {response.status_code}): {response.text}", flush=True)
                response.raise_for_status()
                evo_response = response.json()
                
                print("--- Respuesta de Envío por Lote desde Evolution ---", flush=True)
                print(evo_response, flush=True)
                print("----------------------------------------------------", flush=True)
                
                msg_id = evo_response.get("key", {}).get("id") or evo_response.get("messageId") or "SENT_BY_BATCH"

                # 1. Guardar de inmediato en base de datos el destinatario para evitar race conditions con el webhook
                dest.estado = "PENDING"
                dest.message_id = msg_id
                dest.fecha_envio = func.now()
                lote.enviados += 1
                db.commit()
                print(f"Destinatario {number} guardado en BD de inmediato con mensaje_id: {msg_id} y estado: PENDING", flush=True)

                # 2. Guardar en base de datos como conversación/mensaje OUT para chat vivo
                try:
                    remoteJid = number if "@" in number else f"{number}@s.whatsapp.net"
                    db_contacto = db.query(models.ContactoConversacion).filter(models.ContactoConversacion.remoteJid == remoteJid).first()
                    if not db_contacto:
                        db_contacto = models.ContactoConversacion(
                            remoteJid=remoteJid,
                            numero_contacto=number,
                            id_contacto=msg_id,
                            pushName=None
                        )
                        db.add(db_contacto)
                        db.flush()
                    else:
                        if not db_contacto.numero_contacto:
                            db_contacto.numero_contacto = number

                    db_sesion = db.query(models.ConversacionSesion).filter(
                        models.ConversacionSesion.id_contacto == db_contacto.id,
                        models.ConversacionSesion.id_canal == cuenta.cuenta_id,
                        models.ConversacionSesion.activo == True
                    ).first()

                    if not db_sesion:
                        db_sesion = models.ConversacionSesion(
                            id_contacto=db_contacto.id,
                            id_canal=cuenta.cuenta_id,
                            activo=True
                        )
                        db.add(db_sesion)
                        db.flush()
                    else:
                        db_sesion.updated_at = func.now()

                    # Si el lote tiene id_grupo_atencion, asociar la conversación con el grupo
                    if lote.id_grupo_atencion:
                        db_grupo_asignado = db.query(models.ConversacionGrupo).filter(
                            models.ConversacionGrupo.id_conversacion == db_sesion.id
                        ).first()
                        if not db_grupo_asignado:
                            db_grupo_asignado = models.ConversacionGrupo(
                                id_conversacion=db_sesion.id,
                                id_grupo_atencion=lote.id_grupo_atencion,
                                id_agente=None
                            )
                            db.add(db_grupo_asignado)
                        else:
                            db_grupo_asignado.id_grupo_atencion = lote.id_grupo_atencion
                            db_grupo_asignado.id_agente = None
                        db.flush()

                    nuevo_mensaje = models.MensajeData(
                        id_conversacion=db_sesion.id,
                        id_contacto=db_contacto.id,
                        tipo="OUT",
                        contenido=text or (media_filename if lote_has_media else ""),
                        mimetype=media_mimetype if lote_has_media else None,
                        media_url=f"/{lote.media_path}" if lote_has_media else None,
                        message_id=msg_id,
                        status="PENDING"
                    )
                    db.add(nuevo_mensaje)

                    # Guardar en redis para chat vivo
                    try:
                        redis_key = f"chat:{db_sesion.id}"
                        msg_cache = {
                            "message_id": msg_id,
                            "status": "PENDING",
                            "tipo": "OUT",
                            "contenido": text or (media_filename if lote_has_media else ""),
                            "media_url": f"/{lote.media_path}" if lote_has_media else None,
                            "mimetype": media_mimetype if lote_has_media else None,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "pushName": "System",
                            "nombre_cuenta": cuenta.nombre_cuenta,
                            "numero_cuenta": cuenta.numero_cuenta
                        }
                        redis_client.lpush(redis_key, json.dumps(msg_cache))
                        redis_client.ltrim(redis_key, 0, 49)
                        redis_client.expire(redis_key, 86400)
                    except Exception as redis_err:
                        print(f"Error actualizando Redis cache (lote): {str(redis_err)}", flush=True)

                    db.commit() # Confirmar chat vivo

                except Exception as db_msg_err:
                    db.rollback()
                    print(f"Error guardando mensaje de lote en BD para chat vivo: {db_msg_err}", flush=True)

            except Exception as e:
                print(f"Error enviando mensaje a {number} en lote {lote_id}: {e}")
                
                # Intentar extraer detalle más específico si es un HTTPError
                error_msg = str(e)
                if isinstance(e, requests.exceptions.HTTPError) and e.response is not None:
                    try:
                        error_detail = e.response.json()
                        error_msg = f"{e.response.status_code} - {error_detail.get('message', e.response.text)}"
                    except Exception:
                        error_msg = f"{e.response.status_code} - {e.response.text}"
                
                # Si falla por "Connection Closed", timeout de conexión o lectura, o error de conexión, pausamos el lote
                error_lower = error_msg.lower()
                is_conn_error = (
                    "connection closed" in error_lower
                    or "timed out" in error_lower
                    or "timeout" in error_lower
                    or "connection" in error_lower
                    or "httpconnectionpool" in error_lower
                    or isinstance(e, (requests.exceptions.ConnectionError, requests.exceptions.Timeout))
                )
                
                if is_conn_error:
                    print(f"Se detectó que la instancia no está disponible (error: {error_msg}). Pausando el lote {lote_id} para evitar pérdidas.", flush=True)
                    dest.estado = "pendiente"  # Se deja en pendiente para ser reintentado al reanudar
                    dest.error = f"Instancia no disponible (Lote pausado automáticamente: {error_msg[:100]})"
                    lote.estado = "pausado"
                    db.commit()
                    break
                else:
                    dest.estado = "fallido"
                    dest.error = error_msg[:500]
                    lote.fallidos += 1

            db.commit()

        # Al finalizar el loop de destinatarios, actualizar a completado solo si no está pausado
        db.refresh(lote)
        if lote.estado != "pausado":
            lote.estado = "completado"
            
        # Recalcular contadores finales para garantizar sincronización perfecta
        fallidos = db.query(models.LoteDestinatario).filter(
            models.LoteDestinatario.id_lote == lote_id,
            models.LoteDestinatario.estado.in_(["fallido", "ERROR", "FAILED"])
        ).count()
        enviados = db.query(models.LoteDestinatario).filter(
            models.LoteDestinatario.id_lote == lote_id,
            models.LoteDestinatario.estado.in_(["PENDING", "SERVER_ACK", "DELIVERY_ACK", "READ", "enviado"])
        ).count()
        lote.fallidos = fallidos
        lote.enviados = enviados
        db.commit()

    except Exception as exc:
        db.rollback()
        print(f"Error procesando lote de envio {lote_id}: {exc}")
        if lote:
            lote.estado = "fallido"
            try:
                fallidos = db.query(models.LoteDestinatario).filter(
                    models.LoteDestinatario.id_lote == lote_id,
                    models.LoteDestinatario.estado.in_(["fallido", "ERROR", "FAILED"])
                ).count()
                enviados = db.query(models.LoteDestinatario).filter(
                    models.LoteDestinatario.id_lote == lote_id,
                    models.LoteDestinatario.estado.in_(["PENDING", "SERVER_ACK", "DELIVERY_ACK", "READ", "enviado"])
                ).count()
                lote.fallidos = fallidos
                lote.enviados = enviados
            except Exception as inner_err:
                print(f"Error al recalcular contadores en fallback de excepcion: {inner_err}")
            db.commit()
    finally:
        db.close()
        # Limpiar la versión comprimida temporal del adjunto del lote (si se generó)
        for temp_file in lote_temp_files:
            try:
                if temp_file and os.path.exists(temp_file):
                    os.remove(temp_file)
            except OSError as cleanup_err:
                print(f"No se pudo eliminar el archivo temporal del lote {temp_file}: {cleanup_err}")
