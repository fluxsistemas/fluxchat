import os
from database import engine
from sqlalchemy import text, inspect

def run_migrations():
    print("Iniciando verificación y migración de base de datos...")
    inspector = inspect(engine)
    
    # 1. Verificar columnas de mensajes_data
    columns_mensajes = [col["name"] for col in inspector.get_columns("mensajes_data")]
    with engine.connect() as conn:
        if "media_url" not in columns_mensajes:
            try:
                conn.execute(text("ALTER TABLE mensajes_data ADD COLUMN media_url TEXT;"))
                conn.commit()
                print("- Columna 'media_url' agregada a 'mensajes_data'")
            except Exception as e:
                print("Error agregando 'media_url':", e)
        
        if "mimetype" not in columns_mensajes:
            try:
                conn.execute(text("ALTER TABLE mensajes_data ADD COLUMN mimetype TEXT;"))
                conn.commit()
                print("- Columna 'mimetype' agregada a 'mensajes_data'")
            except Exception as e:
                print("Error agregando 'mimetype':", e)

        if "status" not in columns_mensajes:
            try:
                conn.execute(text("ALTER TABLE mensajes_data ADD COLUMN status VARCHAR;"))
                conn.commit()
                print("- Columna 'status' agregada a 'mensajes_data'")
            except Exception as e:
                print("Error agregando 'status':", e)

    # 2. Verificar columnas de conversaciones_sesion
    columns_conversaciones = [col["name"] for col in inspector.get_columns("conversaciones_sesion")]
    with engine.connect() as conn:
        if "nuevo_mensaje" not in columns_conversaciones:
            try:
                conn.execute(text("ALTER TABLE conversaciones_sesion ADD COLUMN nuevo_mensaje BOOLEAN DEFAULT FALSE;"))
                conn.commit()
                print("- Columna 'nuevo_mensaje' agregada a 'conversaciones_sesion'")
            except Exception as e:
                print("Error agregando 'nuevo_mensaje':", e)

    # 3. Verificar columnas de cuentas_activas
    columns_cuentas = [col["name"] for col in inspector.get_columns("cuentas_activas")]
    with engine.connect() as conn:
        if "webhook_url" not in columns_cuentas:
            try:
                conn.execute(text("ALTER TABLE cuentas_activas ADD COLUMN webhook_url VARCHAR;"))
                conn.commit()
                print("- Columna 'webhook_url' agregada a 'cuentas_activas'")
            except Exception as e:
                print("Error agregando 'webhook_url':", e)
                
        if "estado" not in columns_cuentas:
            try:
                conn.execute(text("ALTER TABLE cuentas_activas ADD COLUMN estado VARCHAR DEFAULT 'Desconectado';"))
                conn.commit()
                print("- Columna 'estado' agregada a 'cuentas_activas'")
            except Exception as e:
                print("Error agregando 'estado':", e)

        if "server_url" not in columns_cuentas:
            try:
                conn.execute(text("ALTER TABLE cuentas_activas ADD COLUMN server_url VARCHAR;"))
                conn.commit()
                print("- Columna 'server_url' agregada a 'cuentas_activas'")
            except Exception as e:
                print("Error agregando 'server_url':", e)

        if "apikey" not in columns_cuentas:
            try:
                conn.execute(text("ALTER TABLE cuentas_activas ADD COLUMN apikey VARCHAR;"))
                conn.commit()
                print("- Columna 'apikey' agregada a 'cuentas_activas'")
            except Exception as e:
                print("Error agregando 'apikey':", e)

        if "nombre_interno" not in columns_cuentas:
            try:
                conn.execute(text("ALTER TABLE cuentas_activas ADD COLUMN nombre_interno VARCHAR;"))
                conn.commit()
                print("- Columna 'nombre_interno' agregada a 'cuentas_activas'")
            except Exception as e:
                print("Error agregando 'nombre_interno':", e)

        # Remover restricción NOT NULL de numero_cuenta para soportar instancias desconectadas recién creadas
        try:
            conn.execute(text("ALTER TABLE cuentas_activas ALTER COLUMN numero_cuenta DROP NOT NULL;"))
            conn.commit()
            print("- Restricción NOT NULL eliminada de la columna 'numero_cuenta' en 'cuentas_activas'")
        except Exception as e:
            print("Error eliminando restricción NOT NULL de 'numero_cuenta':", e)

    # 4. Verificar columnas de lotes_destinatarios
    columns_destinatarios = [col["name"] for col in inspector.get_columns("lotes_destinatarios")]
    with engine.connect() as conn:
        if "message_id" not in columns_destinatarios:
            try:
                conn.execute(text("ALTER TABLE lotes_destinatarios ADD COLUMN message_id VARCHAR;"))
                conn.commit()
                print("- Columna 'message_id' agregada a 'lotes_destinatarios'")
            except Exception as e:
                print("Error agregando 'message_id':", e)

    # 5. Verificar columnas de lotes_envio
    columns_lotes = [col["name"] for col in inspector.get_columns("lotes_envio")]
    with engine.connect() as conn:
        if "fecha_programada" not in columns_lotes:
            try:
                conn.execute(text("ALTER TABLE lotes_envio ADD COLUMN fecha_programada TIMESTAMP WITH TIME ZONE;"))
                conn.commit()
                print("- Columna 'fecha_programada' agregada a 'lotes_envio'")
            except Exception as e:
                print("Error agregando 'fecha_programada':", e)

        if "id_grupo_atencion" not in columns_lotes:
            try:
                conn.execute(text("ALTER TABLE lotes_envio ADD COLUMN id_grupo_atencion INTEGER;"))
                conn.commit()
                print("- Columna 'id_grupo_atencion' agregada a 'lotes_envio'")
            except Exception as e:
                print("Error agregando 'id_grupo_atencion':", e)

        if "media_path" not in columns_lotes:
            try:
                conn.execute(text("ALTER TABLE lotes_envio ADD COLUMN media_path VARCHAR;"))
                conn.commit()
                print("- Columna 'media_path' agregada a 'lotes_envio'")
            except Exception as e:
                print("Error agregando 'media_path':", e)

        if "media_mimetype" not in columns_lotes:
            try:
                conn.execute(text("ALTER TABLE lotes_envio ADD COLUMN media_mimetype VARCHAR;"))
                conn.commit()
                print("- Columna 'media_mimetype' agregada a 'lotes_envio'")
            except Exception as e:
                print("Error agregando 'media_mimetype':", e)

        if "media_filename" not in columns_lotes:
            try:
                conn.execute(text("ALTER TABLE lotes_envio ADD COLUMN media_filename VARCHAR;"))
                conn.commit()
                print("- Columna 'media_filename' agregada a 'lotes_envio'")
            except Exception as e:
                print("Error agregando 'media_filename':", e)

    # 6. Crear tabla de notificaciones si no existe
    try:
        # Usamos Base.metadata.create_all para asegurar que todas las tablas definidas estén creadas
        import models
        models.Base.metadata.create_all(bind=engine)
        print("- Tabla 'notificaciones_eventos' verificada/creada exitosamente")
    except Exception as e:
        print("Error asegurando creación de tablas con Base.metadata:", e)

    # 7. Verificar columnas de notificaciones_eventos
    try:
        columns_notif = [col["name"] for col in inspector.get_columns("notificaciones_eventos")]
        with engine.connect() as conn:
            if "cuenta_id" not in columns_notif:
                conn.execute(text("ALTER TABLE notificaciones_eventos ADD COLUMN cuenta_id VARCHAR;"))
                conn.commit()
                print("- Columna 'cuenta_id' agregada a 'notificaciones_eventos'")
    except Exception as e:
        print("Error agregando 'cuenta_id' a 'notificaciones_eventos':", e)

    print("Verificación y migración de base de datos completada exitosamente.")

if __name__ == "__main__":
    run_migrations()
