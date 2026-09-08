import { useEffect } from 'react'

/** Public mark-only page + asset URLs for OAuth app logos. */
export function IconPage() {
  useEffect(() => {
    document.title = 'Jargon'
  }, [])

  return (
    <div className="icon-page">
      <img src="/icon.png" width={256} height={256} alt="Jargon" />
    </div>
  )
}
