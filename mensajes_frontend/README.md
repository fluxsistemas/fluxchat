# Mensajes Frontend - React + Vite

Este es el frontend del sistema de mensajería para gestionar agentes, chats, grupos y usuarios integrados con Evolution API.

## Cómo levantar el proyecto

Toda la aplicación está dockerizada. Para ver la guía completa paso a paso con el orden de inicialización de los servicios de la base de datos, el backend y la API de Evolution, por favor consultá el archivo principal de ayuda:

👉 **[Ver README principal en la raíz de la aplicación](../README.md)**

### Levantar solo el Frontend

Si ya tenés la red Docker de base y el backend corriendo:

```bash
docker compose up -d --build
```

El frontend estará accesible en `http://localhost:5177`.

