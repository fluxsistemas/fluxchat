from database import engine
from sqlalchemy import text

with engine.connect() as conn:
    try:
        conn.execute(text("ALTER TABLE mensajes_data ADD COLUMN media_url TEXT;"))
        print("media_url added")
    except Exception as e:
        print("Error media_url:", e)
    
    try:
        conn.execute(text("ALTER TABLE mensajes_data ADD COLUMN mimetype TEXT;"))
        print("mimetype added")
    except Exception as e:
        print("Error mimetype:", e)
        
    conn.commit()
