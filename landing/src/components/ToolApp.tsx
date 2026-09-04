import { useEffect } from 'react'
import { ProductApp } from '../../../src/renderer/src/components/workspace/ProductApp'
import { setClientAuthToken } from '../../../src/renderer/src/api/client'
import { getStoredToken } from '../api'
import '../../../src/renderer/src/styles/global.css'
import '../../../src/renderer/src/styles/app.css'

export function ToolApp({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  // Must sync before ProductApp mounts — its fetch runs in useEffect and would
  // otherwise race ahead of a parent useEffect that only set the token later.
  setClientAuthToken(getStoredToken())

  useEffect(() => {
    document.documentElement.classList.add('tool-shell')
    return () => document.documentElement.classList.remove('tool-shell')
  }, [])

  return (
    <div className="tool-host">
      <button type="button" className="tool-back" onClick={onBack}>
        Dashboard
      </button>
      <ProductApp projectId={projectId} />
    </div>
  )
}
