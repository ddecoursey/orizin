import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // Keep the Vite /api proxy aligned with server PORT (.env), so login works
  // when the backend isn't on the hard-coded 3001 default.
  const env = loadEnv(mode, process.cwd(), '')
  const apiPort = env.PORT || '3001'

  return {
  plugins: [react(), tailwindcss()],
  build: {
    // The main app chunk is ~540KB minified (158KB gzip) by design — the data
    // grid, charts and motion runtime ship together for signed-in users.
    chunkSizeWarningLimit: 600,
  },
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
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  }
})
