import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0', // Listen on all interfaces so it's reachable from outside the container
    watch: {
      // SQLite (WAL + SHM) is written by the backend on every chat/enrich; Vite
      // picking up those mutations triggers a full-page reload that wipes UI state
      // like the filters Ori just applied.
      ignored: ['**/data/**', '**/server/**'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
