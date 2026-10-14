import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0', // Required for Docker
    port: 5173,
    allowedHosts: true, // Allow all hosts for Docker
    watch: {
      usePolling: true, // Needed sometimes for Docker volumes
    },
    proxy: {
      '/api': {
        target: 'http://evolution_backend_api:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/static': {
        target: 'http://evolution_backend_api:8000',
        changeOrigin: true,
      }
    }
  }
})
