import { useEffect, useState } from 'react'
import initialReleases from 'virtual:changelog'
import { LogoMark } from './LogoMark'

interface Props {
  signedIn: boolean
  onLogin: () => void
  onSignUp: () => void
  onOpenApp: () => void
}

function isReleaseList(value: unknown): value is typeof initialReleases {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item.version === 'string' &&
        Array.isArray(item.titles) &&
        item.titles.every((title: unknown) => typeof title === 'string')
    )
  )
}

export function ChangelogPage({ signedIn, onLogin, onSignUp, onOpenApp }: Props) {
  const [scrolled, setScrolled] = useState(false)
  const [releases, setReleases] = useState(initialReleases)

  useEffect(() => {
    let cancelled = false
    fetch('/api/changelog', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && isReleaseList(data) && data.length > 0) setReleases(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const previous = document.title
    document.title = 'Changelog — Jargon'
    return () => {
      document.title = previous
    }
  }, [])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="page">
      <div className="atmosphere" aria-hidden="true" />

      <header className={`nav ${scrolled ? 'scrolled' : ''}`}>
        <a className="nav-brand" href="/">
          <LogoMark size={26} />
          <span>Jargon</span>
        </a>
        <nav className="nav-links">
          <a href="/#deploy">Build</a>
          <a href="/#run">Use</a>
          <a href="/#data">Connect</a>
          <a href="/#use-cases">Use cases</a>
          <a href="/changelog" aria-current="page">
            Changelog
          </a>
        </nav>
        <div className="nav-actions">
          {signedIn ? (
            <button type="button" className="nav-cta" onClick={onOpenApp}>
              Open app
            </button>
          ) : (
            <>
              <button type="button" className="nav-login" onClick={onLogin}>
                Log in
              </button>
              <button type="button" className="nav-cta" onClick={onSignUp}>
                Sign up
              </button>
            </>
          )}
        </div>
      </header>

      <main className="changelog">
        <header className="changelog-intro">
          <p className="eyebrow">Changelog</p>
          <h1>What just shipped.</h1>
          <p>
            The latest ways your team calls, writes, and follows up — so the right message gets
            through.
          </p>
        </header>

        {releases.length === 0 ? (
          <p className="changelog-empty">No launches yet.</p>
        ) : (
          <div className="changelog-days">
            {releases.map((release) => (
              <section key={release.version} className="changelog-day">
                <p className="changelog-version">{release.version}</p>
                <div className="changelog-notes">
                  {release.titles.map((title) => (
                    <p key={title}>{title}</p>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      <footer className="footer">
        <a className="footer-brand" href="/">
          <LogoMark size={22} />
          <span>Jargon</span>
        </a>
        <a className="footer-link" href="/changelog">
          Changelog
        </a>
        <p>For those who are brave enough to build.</p>
      </footer>
    </div>
  )
}
