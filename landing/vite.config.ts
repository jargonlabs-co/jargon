import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const dir = dirname(fileURLToPath(import.meta.url))
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(dir, '../src/renderer/src')
    }
  },
  server: { port: 5180, strictPort: true }
})
