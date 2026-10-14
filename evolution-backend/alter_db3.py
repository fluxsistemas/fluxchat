from database import engine
from sqlalchemy import text

with engine.connect() as conn:
    try:
        conn.execute(text("ALTER TABLE cuentas_activas ADD COLUMN estado VARCHAR DEFAULT 'Desconectado';"))
        conn.commit()
        print("estado added to cuentas_activas")
    except Exception as e:
        print("Error estado:", e)
