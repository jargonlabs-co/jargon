export function BrandMark({
  size = 28,
  className = '',
  plain = false
}: {
  size?: number
  className?: string
  plain?: boolean
}) {
  return (
    <div
      className={`brand-mark ${plain ? 'plain' : ''} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="brand-dot orange" />
      <span className="brand-dot navy" />
      <span className="brand-dot blue" />
    </div>
  )
}

export function TitlebarMark() {
  return (
    <div className="titlebar-mark" aria-hidden="true">
      <span className="titlebar-dot orange" />
      <span className="titlebar-dot navy" />
      <span className="titlebar-dot blue" />
    </div>
  )
}
