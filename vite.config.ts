import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { localProjectExportPlugin } from './server/project-export/vite-plugin.mjs'

export default defineConfig({
  plugins: [react(), localProjectExportPlugin()],
  server: {
    proxy: {
      // Preserve Host: the local backend checks Origin against it.
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false },
    },
  },
})
