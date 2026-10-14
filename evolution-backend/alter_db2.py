from database import engine
from sqlalchemy import text

with engine.connect() as conn:
    try:
        conn.execute(text("ALTER TABLE conversaciones_sesion ADD COLUMN nuevo_mensaje BOOLEAN DEFAULT FALSE;"))
        conn.commit()
        print("nuevo_mensaje added")
    except Exception as e:
        print("Error nuevo_mensaje:", e)
        
with engine.connect() as conn:
    try:
        conn.execute(text("ALTER TABLE cuentas_activas ADD COLUMN webhook_url VARCHAR;"))
        conn.commit()
        print("webhook_url added")
    except Exception as e:
        print("Error webhook_url:", e)
