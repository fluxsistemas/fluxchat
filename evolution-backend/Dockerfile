FROM python:3.11-slim

# Evitar que python escriba .pyc files
ENV PYTHONDONTWRITEBYTECODE 1
# Evitar que python haga buffer en stdout y stderr
ENV PYTHONUNBUFFERED 1

WORKDIR /app

# Instalar dependencias del sistema necesarias para psycopg2 y compresión de video (ffmpeg)
RUN apt-get update \
    && apt-get install -y gcc libpq-dev ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

COPY . /app/

# El puerto 8000 es el que expondrá uvicorn internamente
EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
