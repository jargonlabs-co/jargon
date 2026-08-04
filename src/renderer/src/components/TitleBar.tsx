export function TitleBar() {
  return (
    <header className="titlebar">
      <div className="titlebar-drag" />
      <div className="titlebar-brand">
        <span className="titlebar-mark" role="img" aria-label="Jargon">
          <span className="titlebar-dot orange" />
          <span className="titlebar-dot navy" />
          <span className="titlebar-dot blue" />
        </span>
      </div>
    </header>
  )
}
