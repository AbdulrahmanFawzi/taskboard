import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In development the API runs on its own port; Vite forwards /api and the SignalR hub to it,
// so the browser sees one origin, the same as behind nginx in staging and production.
const api = process.env.API_URL ?? 'http://localhost:5064'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: api, changeOrigin: true },
      '/hubs': { target: api, changeOrigin: true, ws: true },
    },
  },
})
