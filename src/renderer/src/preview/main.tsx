import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SharePreviewApp } from './SharePreviewApp'
import { bootstrapSharePreviewApi } from '../lib/sharePreviewUrl'
import '../styles/global.css'
import '../styles/app.css'

document.documentElement.classList.add('share-preview-root')
bootstrapSharePreviewApi()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SharePreviewApp />
  </StrictMode>
)
