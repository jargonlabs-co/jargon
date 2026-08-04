import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves from /<repo>/ unless this is a user/org *.github.io repo
// or a custom domain. Override with: VITE_BASE=/ npm run build
const base = process.env.VITE_BASE ?? '/jargon/'

export default defineConfig({
  base,
  plugins: [react()],
  server: { port: 5180, strictPort: true }
})
