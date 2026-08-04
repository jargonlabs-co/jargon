import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BrandMark } from './components/BrandMark'
import { BuilderMock, ContextMock, DashboardMock, DialerMock } from './components/ProductMocks'

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

export default function App() {
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
          <BrandMark size={18} plain />
          <span>Jargon</span>
        </a>
        <nav className="nav-links">
          <a href="#product">Product</a>
          <a href="#build">Build</a>
          <a href="#run">Run</a>
        </nav>
        <a
          className="nav-cta"
          href="https://calendly.com/tara_jargonlabs/30min"
          target="_blank"
          rel="noopener noreferrer"
        >
          Book a demo
        </a>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <h1>For those who are brave enough to build.</h1>
            <p className="hero-lede">
              The desktop tool for GTM and revenue leaders who create outbound systems on top of
              their own context and data layers — not someone else&apos;s playbook.
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
              <a className="btn ghost" href="#product">
                See how it works
              </a>
            </div>
          </div>

          <div className="hero-visual">
            <DialerMock />
          </div>
        </section>

        <Reveal className="section product-section" as="section">
          <div className="section-inner split" id="product">
            <div className="section-copy">
              <p className="eyebrow">Built on your stack</p>
              <h2>Outbound tools that speak your data.</h2>
              <p>
                Jargon sits on the context you already trust — CRM segments, enrichment, intent,
                and outcomes — then generates dialers, sequencers, cadences, and lists that feel
                native to how your team sells.
              </p>
            </div>
            <ContextMock />
          </div>
        </Reveal>

        <Reveal className="section build-section" as="section">
          <div className="section-inner" id="build">
            <div className="section-copy centered">
              <p className="eyebrow">From prompt to product</p>
              <h2>Describe the motion. Ship the tool.</h2>
              <p>
                Tell Jargon what you need. It clarifies the audience, channels, and goals — then
                builds a full multi-page outbound workspace you can run immediately.
              </p>
            </div>
            <BuilderMock />
          </div>
        </Reveal>

        <Reveal className="section run-section" as="section">
          <div className="section-inner" id="run">
            <div className="section-copy centered">
              <p className="eyebrow">Operate with clarity</p>
              <h2>Run outbound that fits the way you sell.</h2>
              <p>
                Live dial consoles, sequenced inboxes, campaign dashboards, and analytics —
                generated around your process, not bolted onto a generic SDR suite.
              </p>
            </div>
            <DashboardMock />
          </div>
        </Reveal>

        <Reveal className="section capabilities" as="section">
          <div className="section-inner">
            <div className="section-copy centered">
              <p className="eyebrow">What you can build</p>
              <h2>Four outbound primitives. Infinite configurations.</h2>
            </div>
            <ul className="capability-list">
              <li>
                <span className="cap-glyph">☎</span>
                <div>
                  <h3>Outbound dialer</h3>
                  <p>Live queues, dispositions, and call stages wired to your segments.</p>
                </div>
              </li>
              <li>
                <span className="cap-glyph">✉</span>
                <div>
                  <h3>Email sequencer</h3>
                  <p>Multi-step sequences with inbox, replies, and outcome logging.</p>
                </div>
              </li>
              <li>
                <span className="cap-glyph">↻</span>
                <div>
                  <h3>Multi-channel cadence</h3>
                  <p>Coordinate calls, email, and notes in one revenue motion.</p>
                </div>
              </li>
              <li>
                <span className="cap-glyph">▤</span>
                <div>
                  <h3>Lead list builder</h3>
                  <p>Assemble and refine lists from the context you already own.</p>
                </div>
              </li>
            </ul>
          </div>
        </Reveal>

        <Reveal className="section cta-section" as="section">
          <div className="cta-panel" id="demo">
            <BrandMark size={36} className="cta-mark" />
            <h2>Build the outbound stack only you could design.</h2>
            <p>
              Jargon is a desktop app for leaders who would rather create tools than rent them.
            </p>
            <a
              className="btn primary large"
              href="https://calendly.com/tara_jargonlabs/30min"
              target="_blank"
              rel="noopener noreferrer"
            >
              Book a demo
            </a>
            <p className="cta-note">30 minutes · Meet the product</p>
          </div>
        </Reveal>
      </main>

      <footer className="footer">
        <div className="footer-brand">
          <BrandMark size={22} />
          <span>Jargon</span>
        </div>
        <p>For those who are brave enough to build.</p>
      </footer>
    </div>
  )
}
