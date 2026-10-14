import os
import csv
import io
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Form, File, UploadFile
from sqlalchemy.orm import Session
from sqlalchemy import or_

import models
import schemas
import auth
from database import get_db

router = APIRouter(prefix="/lotes-envio", tags=["Lotes Envio"])

def recalculate_lote_counters(db: Session, lote: models.LoteEnvio):
    # Contar destinatarios que fallaron
    fallidos = db.query(models.LoteDestinatario).filter(
        models.LoteDestinatario.id_lote == lote.id,
        models.LoteDestinatario.estado.in_(["fallido", "ERROR", "FAILED"])
    ).count()

    # Contar destinatarios enviados o con estados de webhook exitosos
    enviados = db.query(models.LoteDestinatario).filter(
        models.LoteDestinatario.id_lote == lote.id,
        models.LoteDestinatario.estado.in_(["PENDING", "SERVER_ACK", "DELIVERY_ACK", "READ", "enviado"])
    ).count()

    if lote.fallidos != fallidos or lote.enviados != enviados:
        lote.fallidos = fallidos
        lote.enviados = enviados
        db.add(lote)
        db.commit()

@router.post("/", tags=["Lotes Envio"])
async def create_lote_envio(
    nombre_lote: str = Form(...),
    cuenta_id: str = Form(...),
    plantilla: str = Form(...),
    csv_file: UploadFile = File(...),
    fecha_programada: str = Form(None),
    id_grupo_atencion: Optional[int] = Form(None),
    media_file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_user)
):
    # Validar cuenta
    db_cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.cuenta_id == cuenta_id).first()
    if not db_cuenta:
        raise HTTPException(status_code=404, detail="Cuenta de envío no encontrada")

    # Leer CSV
    content = await csv_file.read()
    try:
        text = content.decode('utf-8')
    except UnicodeDecodeError:
        try:
            text = content.decode('latin-1')
        except Exception:
            raise HTTPException(status_code=400, detail="Error de codificación en el archivo CSV. Use UTF-8 o Latin-1.")

    # Usar csv.reader para procesar dialectos (comas o punto y coma)
    delimiter = ','
    # Detectar delimitador de forma básica en la primera línea
    first_line = text.split('\n')[0] if text else ''
    if ';' in first_line and ',' not in first_line:
        delimiter = ';'

    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    rows = list(reader)

    # Filtrar cabecera si existe
    if rows:
        first_row = rows[0]
        # Si el primer campo tiene letras y no parece número, descartamos como cabecera
        is_num = any(c.isdigit() for c in first_row[0]) if first_row else False
        if not is_num or (first_row and ("num" in first_row[0].lower() or "tel" in first_row[0].lower() or "phone" in first_row[0].lower())):
            rows = rows[1:]

    if not rows:
        raise HTTPException(status_code=400, detail="El archivo CSV está vacío o no contiene registros válidos")

    # Determinar estado inicial y fecha programada
    estado_inicial = "pendiente"
    db_fecha_programada = None
    if fecha_programada:
        try:
            # Reemplazar la Z con +00:00 para asegurar que python lo entienda como UTC
            clean_fecha = fecha_programada.replace('Z', '+00:00')
            db_fecha_programada = datetime.fromisoformat(clean_fecha)
            estado_inicial = "programado"
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Formato de fecha programada inválido: {str(e)}")
    else:
        # Verificar si ya existe un lote en progreso para la misma instancia
        lote_en_curso = db.query(models.LoteEnvio).filter(
            models.LoteEnvio.cuenta_id == cuenta_id,
            models.LoteEnvio.estado == "en_progreso"
        ).first()
        if lote_en_curso:
            estado_inicial = "pausado"

    # Guardar archivo multimedia si se proporciona
    media_path = None
    media_mimetype = None
    media_filename = None

    if media_file and media_file.filename:
        import uuid
        STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
        lotes_dir = os.path.join(STATIC_DIR, "lotes")
        os.makedirs(lotes_dir, exist_ok=True)
        
        unique_id = uuid.uuid4().hex
        ext = os.path.splitext(media_file.filename)[1]
        filename_saved = f"lote_{unique_id}{ext}"
        filepath = os.path.join(lotes_dir, filename_saved)
        
        content_media = await media_file.read()
        with open(filepath, "wb") as f:
            f.write(content_media)
            
        media_path = f"static/lotes/{filename_saved}"
        media_mimetype = media_file.content_type
        media_filename = media_file.filename

    # Crear el lote en BD
    db_lote = models.LoteEnvio(
        nombre_lote=nombre_lote,
        cuenta_id=cuenta_id,
        plantilla=plantilla,
        total_mensajes=0,
        enviados=0,
        fallidos=0,
        estado=estado_inicial,
        fecha_programada=db_fecha_programada,
        id_grupo_atencion=id_grupo_atencion,
        media_path=media_path,
        media_mimetype=media_mimetype,
        media_filename=media_filename
    )
    db.add(db_lote)
    db.flush() # para obtener db_lote.id

    destinatarios = []
    for row in rows:
        if not row or not row[0].strip():
            continue
        # Primera columna: número
        numero_raw = row[0].strip()
        
        # Limpiar número de caracteres no deseados (+, espacios, guiones) excepto dígitos
        numero = "".join(c for c in numero_raw if c.isdigit())
        if not numero:
            continue
        
        # Segunda columna: variable
        variable = row[1].strip() if len(row) > 1 else ""
        
        # Aplicar variable a plantilla: {{1}} -> variable
        mensaje_personalizado = plantilla.replace("{{1}}", variable)

        db_dest = models.LoteDestinatario(
            id_lote=db_lote.id,
            numero=numero,
            variable=variable,
            mensaje_personalizado=mensaje_personalizado,
            estado="pendiente"
        )
        destinatarios.append(db_dest)

    if not destinatarios:
        db.rollback()
        raise HTTPException(status_code=400, detail="No se encontraron números de teléfono válidos en el CSV")

    db_lote.total_mensajes = len(destinatarios)
    db.add_all(destinatarios)
    try:
        db.commit()
        db.refresh(db_lote)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error guardando lote en BD: {str(e)}")

    # Disparar tarea Celery en segundo plano o programada
    from tasks import process_lote_envio
    if db_lote.fecha_programada:
        process_lote_envio.apply_async(args=[db_lote.id], eta=db_lote.fecha_programada)
        msg_exito = f"Lote '{nombre_lote}' programado con éxito"
    else:
        if db_lote.estado == "pausado":
            msg_exito = f"Lote '{nombre_lote}' creado y pausado automáticamente ya que existe otro lote activo para esta instancia"
        else:
            process_lote_envio.delay(db_lote.id)
            msg_exito = f"Lote '{nombre_lote}' creado con éxito y encolado para envío"

    return {
        "status": "success",
        "message": msg_exito,
        "lote_id": db_lote.id,
        "total_mensajes": db_lote.total_mensajes
    }

@router.get("/", response_model=List[schemas.LoteEnvioResponse], tags=["Lotes Envio"])
def list_lotes_envio(
    telefono: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_user)
):
    query = db.query(models.LoteEnvio)
    if telefono:
        query = query.join(models.LoteDestinatario).filter(models.LoteDestinatario.numero.contains(telefono)).distinct()
    lotes = query.order_by(models.LoteEnvio.id.desc()).offset(skip).limit(limit).all()
    for lote in lotes:
        recalculate_lote_counters(db, lote)
    return lotes

@router.get("/{id}", response_model=schemas.LoteEnvioDetailResponse, tags=["Lotes Envio"])
def get_lote_envio(
    id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_user)
):
    lote = db.query(models.LoteEnvio).filter(models.LoteEnvio.id == id).first()
    if not lote:
        raise HTTPException(status_code=404, detail="Lote no encontrado")
    recalculate_lote_counters(db, lote)
    return lote

@router.post("/{id}/pause", tags=["Lotes Envio"])
def pause_lote_envio(
    id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_user)
):
    lote = db.query(models.LoteEnvio).filter(models.LoteEnvio.id == id).first()
    if not lote:
        raise HTTPException(status_code=404, detail="Lote no encontrado")
    
    if lote.estado != "en_progreso":
        raise HTTPException(status_code=400, detail="Solo se pueden pausar lotes en progreso")
        
    lote.estado = "pausado"
    db.commit()
    return {"status": "success", "message": "Lote pausado correctamente"}

@router.post("/{id}/resume", tags=["Lotes Envio"])
def resume_lote_envio(
    id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_user)
):
    lote = db.query(models.LoteEnvio).filter(models.LoteEnvio.id == id).first()
    if not lote:
        raise HTTPException(status_code=404, detail="Lote no encontrado")
        
    if lote.estado not in ["pausado", "pendiente", "programado"]:
        raise HTTPException(status_code=400, detail="Solo se pueden iniciar o reanudar lotes pausados, pendientes o programados")
        
    # Verificar si ya existe otro lote en progreso para la misma instancia
    lote_en_curso = db.query(models.LoteEnvio).filter(
        models.LoteEnvio.cuenta_id == lote.cuenta_id,
        models.LoteEnvio.estado == "en_progreso",
        models.LoteEnvio.id != id
    ).first()
    if lote_en_curso:
        raise HTTPException(
            status_code=400,
            detail="Ya existe un lote activo en curso para esta misma instancia. Debés esperar que finalice o pausarlo antes de iniciar este."
        )
        
    # Resetear destinatarios que tengan el error de messages.update o problemas de conexión
    destinatarios_con_error = db.query(models.LoteDestinatario).filter(
        models.LoteDestinatario.id_lote == id,
        or_(
            models.LoteDestinatario.error == "Error de envío reportado por Evolution (messages.update)",
            models.LoteDestinatario.error.ilike("%Connection Closed%"),
            models.LoteDestinatario.error.ilike("%Instancia no disponible%")
        )
    ).all()
    for d in destinatarios_con_error:
        d.estado = "pendiente"
        d.error = None
        
    lote.estado = "pendiente" # Al poner en pendiente, Celery lo retomará
    db.commit()
    
    # Recalcular contadores después de resetear errores
    recalculate_lote_counters(db, lote)
    
    # Disparar tarea Celery en segundo plano para procesar lo restante
    from tasks import process_lote_envio
    process_lote_envio.delay(lote.id)
    
    return {"status": "success", "message": "Lote iniciado/reanudado correctamente"}

@router.post("/{id}/change-instance-and-resume", tags=["Lotes Envio"])
def change_instance_and_resume_lote_envio(
    id: int,
    nueva_cuenta_id: str,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_user)
):
    lote = db.query(models.LoteEnvio).filter(models.LoteEnvio.id == id).first()
    if not lote:
        raise HTTPException(status_code=404, detail="Lote no encontrado")
        
    # Validar cuenta nueva
    nueva_cuenta = db.query(models.CuentaActiva).filter(models.CuentaActiva.cuenta_id == nueva_cuenta_id).first()
    if not nueva_cuenta:
        raise HTTPException(status_code=404, detail="Nueva cuenta de envío no encontrada")
        
    if nueva_cuenta.estado != "Conectado":
        raise HTTPException(status_code=400, detail="La nueva instancia seleccionada no está conectada")

    if lote.estado not in ["pausado", "pendiente", "programado"]:
        raise HTTPException(status_code=400, detail="Solo se pueden iniciar o reanudar lotes pausados, pendientes o programados")
        
    # Verificar si ya existe otro lote en progreso para la nueva instancia
    lote_en_curso = db.query(models.LoteEnvio).filter(
        models.LoteEnvio.cuenta_id == nueva_cuenta_id,
        models.LoteEnvio.estado == "en_progreso"
    ).first()
    if lote_en_curso:
        raise HTTPException(
            status_code=400,
            detail="Ya existe un lote activo en curso para la nueva instancia seleccionada. Debés esperar que finalice o pausarlo antes de iniciar este."
        )
        
    # Actualizar la cuenta_id del lote
    lote.cuenta_id = nueva_cuenta_id

    # Resetear destinatarios que tengan el error de messages.update o problemas de conexión
    destinatarios_con_error = db.query(models.LoteDestinatario).filter(
        models.LoteDestinatario.id_lote == id,
        or_(
            models.LoteDestinatario.error == "Error de envío reportado por Evolution (messages.update)",
            models.LoteDestinatario.error.ilike("%Connection Closed%"),
            models.LoteDestinatario.error.ilike("%Instancia no disponible%")
        )
    ).all()
    for d in destinatarios_con_error:
        d.estado = "pendiente"
        d.error = None
        
    lote.estado = "pendiente" # Al poner en pendiente, Celery lo retomará
    db.commit()
    
    # Recalcular contadores después de resetear errores al cambiar de instancia
    recalculate_lote_counters(db, lote)
    
    # Disparar tarea Celery en segundo plano para procesar lo restante
    from tasks import process_lote_envio
    process_lote_envio.delay(lote.id)
    
    return {"status": "success", "message": "Instancia cambiada y lote reanudado correctamente"}

@router.post("/{id}/retry-failed", tags=["Lotes Envio"])
def retry_failed_messages(
    id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_user)
):
    lote = db.query(models.LoteEnvio).filter(models.LoteEnvio.id == id).first()
    if not lote:
        raise HTTPException(status_code=404, detail="Lote no encontrado")
        
    if lote.estado not in ["completado", "fallido"]:
        raise HTTPException(status_code=400, detail="Solo se pueden reintentar lotes finalizados (completados o fallidos)")

    # Verificar si ya existe otro lote en progreso para la misma instancia
    lote_en_curso = db.query(models.LoteEnvio).filter(
        models.LoteEnvio.cuenta_id == lote.cuenta_id,
        models.LoteEnvio.estado == "en_progreso",
        models.LoteEnvio.id != id
    ).first()
    if lote_en_curso:
        raise HTTPException(
            status_code=400,
            detail="Ya existe un lote activo en curso para esta misma instancia. Debés esperar que finalice o pausarlo antes de iniciar este reintento."
        )

    # Buscar destinatarios que fallaron
    failed_destinatarios = db.query(models.LoteDestinatario).filter(
        models.LoteDestinatario.id_lote == id,
        models.LoteDestinatario.estado == "fallido"
    ).all()
    
    if not failed_destinatarios:
        raise HTTPException(status_code=400, detail="No hay mensajes fallidos para reintentar en este lote")
        
    # Reiniciar el estado de los destinatarios fallidos a pendiente
    for dest in failed_destinatarios:
        dest.estado = "pendiente"
        dest.error = None
        dest.fecha_envio = None
        
    # Ajustar contadores del lote
    lote.estado = "pendiente"
    db.commit()
    
    # Recalcular contadores con los registros actualizados de destinatarios
    recalculate_lote_counters(db, lote)
    
    # Disparar tarea Celery en segundo plano para reenviar los ahora pendientes
    from tasks import process_lote_envio
    process_lote_envio.delay(lote.id)
    
    return {
        "status": "success",
        "message": f"Se han puesto en cola {len(failed_destinatarios)} mensajes fallidos para reintento"
    }

@router.post("/{id}/mark-reviewed", tags=["Lotes Envio"])
def mark_lote_reviewed(
    id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_user)
):
    lote = db.query(models.LoteEnvio).filter(models.LoteEnvio.id == id).first()
    if not lote:
        raise HTTPException(status_code=404, detail="Lote no encontrado")
        
    if lote.estado not in ["completado", "pausado"]:
        raise HTTPException(status_code=400, detail="Solo se pueden marcar como revisados los lotes completados o pausados")
        
    lote.estado = "revisado"
    db.commit()
    return {"status": "success", "message": "Lote marcado como revisado correctamente"}

@router.delete("/{id}", tags=["Lotes Envio"])
def delete_lote_envio(
    id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_user)
):
    lote = db.query(models.LoteEnvio).filter(models.LoteEnvio.id == id).first()
    if not lote:
        raise HTTPException(status_code=404, detail="Lote no encontrado")
    db.delete(lote)
    db.commit()
    return {"status": "success", "message": "Lote eliminado correctamente"}
