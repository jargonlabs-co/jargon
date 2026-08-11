import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Default `/` for Vercel / custom domains.
// GitHub Pages sets VITE_BASE=/jargon/ in CI.
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [react()],
  server: { port: 5180, strictPort: true }
})
