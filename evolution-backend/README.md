# Evolution Backend API 🚀

Este es el backend personalizado del ecosistema, construido con **FastAPI** (Python 3.11+). Se encarga de la lógica de negocio, asignación de agentes, grupos de atención, webhooks de Evolution API y procesamiento de colas mediante **Celery** y **RabbitMQ**.

---

## Guía de Instalación y Ejecución

Seguí estos pasos para configurar y levantar el backend correctamente:

### Paso 1: Configurar el archivo `.env`

Ubicate dentro de esta carpeta (`evolution-backend/`) y creá tu archivo de configuración a partir del ejemplo:

```bash
cp .env.example .env
```

Abrí el archivo `.env` y configurá las variables:
- **`DB_PASSWORD`**: Definí una contraseña segura para la base de datos PostgreSQL del backend.
- **`API_KEY_EVOLUTION`**: Debe coincidir exactamente con la `AUTHENTICATION_API_KEY` que definiste en el archivo `.env` de la raíz del proyecto.
- **`SECRET_KEY`**: Generá y colocá una clave secreta segura para el firmado de tokens JWT de la autenticación.

---

### Paso 2: Asegurar la Red Compartida

Este backend requiere comunicarse con los servicios de Evolution API a través de la red `evolution_net`. Asegurate de haber iniciado los servicios de la raíz del proyecto:

```bash
# En la raíz de todo el proyecto (evolucionAPI/)
docker compose up -d
```

---

### Paso 3: Levantar los Servicios del Backend

Una vez que la red `evolution_net` esté activa y tu `.env` configurado, levantá el backend y sus dependencias (PostgreSQL, RabbitMQ, Celery Worker):

```bash
# Dentro de la carpeta evolution-backend/
docker compose up -d --build
```

Esto levantará en segundo plano:
1. **`evolution_backend_api`**: El servidor de FastAPI en `http://localhost:8000`.
2. **`evolution_backend_postgres`**: Base de datos PostgreSQL dedicada para este backend.
3. **`evolution_rabbitmq`**: Gestor de colas para Celery en `http://localhost:15672` (Panel de control con usuario/contraseña `guest`/`guest`).
4. **`evolution_celery_worker`**: Worker de Celery para procesamiento asíncrono.

---

## 🔄 Integración y Flujo de Trabajo: RabbitMQ + Celery 

Para optimizar el rendimiento y evitar que la API del backend se bloquee al interactuar con WhatsApp, el envío de mensajes se procesa de forma **asíncrona** delegando el trabajo a un gestor de colas (**RabbitMQ**) y a un procesador de tareas (**Celery**).

### ⚙️ ¿Cómo trabajan juntos? (El Flujo)

Cuando enviás un mensaje (texto o archivo adjunto) desde el frontend:
1. **FastAPI (`evolution_backend_api`)**:
   - Valida de forma sincrónica que la cuenta/instancia exista en la base de datos PostgreSQL.
   - Encola la tarea `process_send_message` en **RabbitMQ** y responde de inmediato al frontend con `{"status": "queued"}`.
2. **RabbitMQ (`evolution_rabbitmq`)**:
   - Almacena temporalmente la tarea en su cola de mensajería hasta que un worker esté libre.
   - ⚠️ **Importante:** **No es necesario crear ninguna cola, usuario, exchange o vhost manualmente en RabbitMQ.** Cuando el backend y el Celery Worker se conectan por primera vez usando las credenciales por defecto (`guest`/`guest`), Celery se encarga de declarar y crear de forma 100% automática todas las colas e intercambios necesarios (como la cola predeterminada llamada `celery`).
3. **Celery Worker (`evolution_celery_worker`)**:
   - Toma la tarea de la cola y ejecuta los siguientes subpasos de forma autónoma:
     - **Simulación Humana:** Envía una señal de presencia (`sendPresence` / `composing`) a la Evolution API para simular que el agente está escribiendo durante 3.5 segundos antes de mandar el mensaje.
     - **Envío a WhatsApp:** Realiza la petición HTTP post a Evolution API (`HOST_EVOLUTION`) enviando el texto o el archivo codificado en Base64.
     - **Descarga y Persistencia:** En caso de que sea multimedia, decodifica el archivo, lo almacena localmente en la carpeta `/app/static` (mapeada a tu host) y registra la conversación y el mensaje en la base de datos PostgreSQL.
     - **Tiempo Real:** Notifica a través de **Redis Cache** la actualización de la sesión de conversación para que el frontend actualice el chat de forma instantánea.

---

### 🛠️ Configuración y Variables Clave

Para que esta comunicación funcione sin problemas, ambos contenedores (`evolution-backend` y `evolution_celery_worker`) deben tener las mismas variables configuradas en sus respectivos archivos `.env`. Las más críticas para la integración son:

| Variable | Valor por defecto en Docker | Descripción |
| :--- | :--- | :--- |
| **`CELERY_BROKER_URL`** | `amqp://guest:guest@evolution_rabbitmq:5672//` | URI de conexión a RabbitMQ. El host debe ser el nombre del contenedor `evolution_rabbitmq`. |
| **`HOST_EVOLUTION`** | `http://evolution_api:8080` | URL interna de comunicación con la instancia de Evolution API dentro de la red docker. |
| **`API_KEY_EVOLUTION`** | *Tu API Key de Evolution* | Token para autenticar las peticiones del Celery worker hacia la Evolution API. |
| **`REDIS_HOST`** | `evolution_redis` | Host de Redis para actualizar el estado del chat en tiempo real. |

---

### 🔍 Monitoreo y Resolución de Problemas (Troubleshooting)

Si ves que los mensajes quedan "encolados" pero nunca le llegan al destinatario o no se guardan en la base de datos, hacé las siguientes verificaciones:

1. **Monitorear RabbitMQ (El Broker):**
   - Accedé al panel web de administración de RabbitMQ en `http://localhost:15672` (usuario: `guest`, contraseña: `guest`).
   - Dirigite a la pestaña **Queues** y revisá si hay mensajes acumulados en la cola `celery`. Si se acumulan y no bajan, el Celery Worker está caído o no puede conectarse.

2. **Verificar Logs del Celery Worker:**
   - Podés ver exactamente qué está haciendo el procesador en segundo plano (si hay errores de conexión a Evolution API, token inválido o fallas de base de datos) corriendo:
     ```bash
     docker compose logs -f evolution_celery_worker
     ```

3. **Revisar Reintentos Automáticos:**
   - El worker está configurado para reintentar el envío de un mensaje de forma automática hasta **3 veces** con un intervalo de **5 segundos** en caso de que la Evolution API devuelva un error temporal.

---

## Características y Documentación

### Documentación Interactiva de la API
Una vez levantado el backend, podés acceder a las siguientes especificaciones OpenAPI interactivas:
- **Swagger UI:** `http://localhost:8000/docs`
- **ReDoc:** `http://localhost:8000/redoc`

### Funcionalidad Clave: Webhook de Evolution API
El backend incluye un webhook de alto rendimiento (`POST /webhook/evolution`) para procesar eventos provenientes de WhatsApp:
- Recibe los mensajes en tiempo real (`messages.upsert`).
- Almacena texto, imágenes, audios, videos y stickers en la base de datos y cachea en Redis.
- Administra el flujo de conversaciones y contactos de manera automatizada.
