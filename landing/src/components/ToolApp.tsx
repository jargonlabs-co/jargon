import { useEffect } from 'react'
import { ProductApp } from '../../../src/renderer/src/components/workspace/ProductApp'
import { setClientAuthToken } from '../../../src/renderer/src/api/client'
import { getStoredToken } from '../api'
import '../../../src/renderer/src/styles/global.css'
import '../../../src/renderer/src/styles/app.css'

export function ToolApp({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  useEffect(() => {
    setClientAuthToken(getStoredToken())
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
