# Guía de Inicio Rápido - Stack de Evolución API (React + FastAPI + Docker)

Este proyecto es un ecosistema completo para interactuar con WhatsApp a través de **Evolution API**. Consta de tres capas independientes, todas Dockerizadas y comunicadas mediante una red compartida (`evolution_net`).

## Estructura del Proyecto

1. **Evolution API (Raíz):** Contenedor oficial de Evolution API, base de datos PostgreSQL de la API y un cache Redis.
2. **Backend (FastAPI):** Backend personalizado con FastAPI, base de datos PostgreSQL dedicada, RabbitMQ y workers de Celery para procesamiento de colas.
3. **Frontend (React + Vite + Tailwind):** Interfaz de usuario para gestionar agentes, chats, grupos y usuarios.

---

## Requisitos Previos

- Tener instalado **Docker** y **Docker Compose**.
- No necesitás instalar nada localmente (ni Node, ni Python, ni bases de datos en tu máquina host), todo corre dentro de Docker.

---

## Paso a Paso para Levantar el Proyecto

Seguí estos pasos en orden para asegurar que las redes de Docker y las dependencias se inicialicen correctamente.

### Paso 1: Configurar los Archivos de Entorno (`.env`)

Antes de levantar cualquier servicio, tenés que crear los archivos `.env` a partir de sus ejemplos.

1. **En la raíz del proyecto:**
   ```bash
   cp .env.example .env
   ```
   *Ajustá las variables si lo necesitás (por ejemplo, la `AUTHENTICATION_API_KEY` que se usará para autenticar llamadas de la API).*

2. **En el backend (`evolution-backend/`):**
   ```bash
   cp evolution-backend/.env.example evolution-backend/.env
   ```
   *Comprobá que `API_KEY_EVOLUTION` coincida con la `AUTHENTICATION_API_KEY` que definiste en la raíz.*

3. **En el frontend (`mensajes_frontend/`):**
   ```bash
   cp mensajes_frontend/.env.example mensajes_frontend/.env
   ```
   *Definí la URL de tu backend. Por defecto en desarrollo es `VITE_BACKEND_URL=http://localhost:8000` o podés dejarlo según la config deseada.*

---

### Paso 2: Levantar el Core (Evolution API + Redis + Postgres)

La red compartida de Docker `evolution_net` se crea aquí. Por lo tanto, **este paso es obligatorio antes de levantar el backend o el frontend**.

Desde la **raíz del proyecto**, ejecutá:
```bash
docker compose up -d
```

Esto levantará:
- **Evolution API** en `http://localhost:8002` (puerto interno 8080)
- **Postgres (Database de Evolution)**
- **Redis (Caché de Evolution)**

---

### Paso 3: Levantar el Backend (FastAPI + Celery + RabbitMQ)

Una vez que la red `evolution_net` esté activa, dirigite a la carpeta del backend y levantá sus servicios:

```bash
cd evolution-backend
docker compose up -d --build
```

Esto levantará:
- **FastAPI API** en `http://localhost:8000` (con documentación Swagger en `http://localhost:8000/docs`)
- **RabbitMQ** (gestor de colas) en `http://localhost:15672` (Panel de Administración, user/pass: `guest`/`guest` por defecto)
- **Celery Worker** para tareas en segundo plano.
- **Postgres (Database del Backend)** independiente.

---

### Paso 4: Levantar el Frontend (React + Vite)

Por último, ingresá a la carpeta del frontend y levantá la interfaz gráfica:

```bash
cd ../mensajes_frontend
docker compose up -d --build
```

Esto levantará:
- **Vite Dev Server** en `http://localhost:5177`.

---

## Comandos Útiles de Mantenimiento

### Detener todos los servicios
Para apagar cada módulo podés ejecutar `docker compose down` en sus respectivas carpetas. Si querés reconstruir las imágenes tras un cambio de dependencias, usá:
```bash
docker compose down && docker compose up --build -d
```

### Ver Logs en tiempo real
- Del backend: `docker compose -f evolution-backend/docker-compose.yml logs -f`
- Del frontend: `docker compose -f mensajes_frontend/docker-compose.yml logs -f`
- De Evolution API: `docker compose logs -f`

### Ejecutar comandos dentro de los contenedores (Cero instalación local)
- Backend (instalar paquetes u otras tareas): `docker compose -f evolution-backend/docker-compose.yml exec evolution-backend [comando]`
- Frontend: `docker compose -f mensajes_frontend/docker-compose.yml exec mensajes-frontend [comando]`
