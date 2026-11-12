import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BrandMark } from './components/BrandMark'
import { ChatGptMark } from './components/ChatGptMark'
import { ClaudeMark } from './components/ClaudeMark'
import { LogoMark } from './components/LogoMark'
import { PlayAccounts, PlayDiagram, PlaySequence } from './components/PlayStory'
import { HeroClaudeMock } from './components/ProductMocks'

function useReveal() {
  const ref = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('is-visible')
          observer.disconnect()
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return ref
}

function Reveal({
  as: Tag = 'section',
  className = '',
  children
}: {
  as?: 'section' | 'div' | 'footer'
  className?: string
  children: ReactNode
}) {
  const ref = useReveal()
  return (
    <Tag ref={ref as never} className={`reveal ${className}`}>
      {children}
    </Tag>
  )
}

export function MarketingPage() {
  const [scrolled, setScrolled] = useState(false)

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
        <a className="nav-brand" href="#top">
          <LogoMark size={26} />
          <span>Jargon</span>
        </a>
        <nav className="nav-links">
          <a href="#connect">Connect</a>
          <a href="#build">Build</a>
          <a href="#execute">Execute</a>
          <a href="/changelog">Changelog</a>
        </nav>
        <div className="nav-actions">
          <a
            className="nav-cta"
            href="https://calendly.com/tara_jargonlabs/30min"
            target="_blank"
            rel="noopener noreferrer"
          >
            Book a demo
          </a>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">For GTM and Marketing Ops</p>
            <h1>Helping sales teams communicate better.</h1>
            <p className="hero-lede">
              Build and assign custom sequences using first and third party data. All of your
              intelligence at your fingertips, made for modern execution.
            </p>
            <div className="hero-actions">
              <a
                className="btn primary"
                href="https://calendly.com/tara_jargonlabs/30min"
                target="_blank"
                rel="noopener noreferrer"
              >
                Book a demo
              </a>
            </div>
            <div className="hero-available" aria-label="Available on Claude and ChatGPT">
              <span className="hero-available-label">Available on</span>
              <span className="hero-available-item">
                <ClaudeMark />
                Claude
              </span>
              <span className="hero-available-sep" aria-hidden="true" />
              <span className="hero-available-item">
                <ChatGptMark />
                ChatGPT
              </span>
            </div>
          </div>

          <div className="hero-visual">
            <HeroClaudeMock />
          </div>
        </section>

        <Reveal className="section" as="section">
          <div className="section-inner" id="connect">
            <div className="section-copy centered wide">
              <p className="eyebrow">Sources</p>
              <h2>Personalized plays, built from every source you have.</h2>
            </div>
            <PlayDiagram />
          </div>
        </Reveal>

        <Reveal className="section product-section" as="section">
          <div className="section-inner split" id="build">
            <div className="section-copy">
              <p className="eyebrow">Built for GTM Operations teams</p>
              <h2>A custom sequence, stitched from the tools you already run.</h2>
              <p>
                GTM ops writes the play once. Jargon pulls the CRM, the last call, the thread,
                and what’s public, fills a sequence for each account, and pushes it to the
                sequencer your team already runs.
              </p>
            </div>
            <PlaySequence />
          </div>
        </Reveal>

        <Reveal className="section capabilities" as="section">
          <div className="section-inner" id="execute">
            <div className="section-copy centered wide">
              <p className="eyebrow">Your sequencer</p>
              <h2>A personalized play, assigned to reps.</h2>
              <p>
                The same sentence becomes a different opener and a different call time for every
                account. It lands in Outreach, Salesloft, Gong Engage, or HubSpot, assigned to the
                rep who owns the book.
              </p>
            </div>
            <PlayAccounts />
          </div>
        </Reveal>

        <Reveal className="section cta-section" as="section">
          <div className="cta-panel" id="demo">
            <BrandMark size={36} className="cta-mark" />
            <h2>Helping sales teams communicate better.</h2>
            <a
              className="btn primary large"
              href="https://calendly.com/tara_jargonlabs/30min"
              target="_blank"
              rel="noopener noreferrer"
            >
              Book a demo
            </a>
          </div>
        </Reveal>
      </main>

      <footer className="footer">
        <a className="footer-brand" href="/">
          <LogoMark size={22} />
          <span>Jargon</span>
        </a>
        <a className="footer-link" href="/changelog">
          Changelog
        </a>
        <p>Helping sales teams communicate better.</p>
      </footer>
    </div>
  )
}
