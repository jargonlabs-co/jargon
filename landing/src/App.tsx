import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BrandMark } from './components/BrandMark'
import { LogoMark } from './components/LogoMark'
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
          <LogoMark size={26} />
          <span>Jargon</span>
        </a>
        <nav className="nav-links">
          <a href="#build">Build</a>
          <a href="#execute">Execute</a>
          <a href="#share">Share</a>
          <a href="#use-cases">Use cases</a>
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
              Revenue teams already build AI tools in Claude and ChatGPT. Jargon turns those
              scattered builds into consistent, shareable infrastructure — across sales, retention,
              account management, and ops.
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
              <a className="btn ghost" href="#build">
                See how it works
              </a>
            </div>
          </div>

          <div className="hero-visual">
            <DialerMock />
          </div>
        </section>

        <Reveal className="section pillars-section" as="section">
          <div className="section-inner" id="pillars">
            <div className="section-copy centered">
              <p className="eyebrow">Three pillars</p>
              <h2>Build. Execute. Standardize.</h2>
              <p>
                The platform for builder-managers and the revenue leaders who champion them —
                so every team can ship tools their whole org can run.
              </p>
            </div>
            <ul className="pillar-list">
              <li>
                <span className="pillar-num">01</span>
                <h3>Build on your stack</h3>
                <p>
                  Describe what you need in natural language. Jargon builds on whatever data layer
                  you already trust — CRM, warehouse, enrichment, outcomes — so tools fit how your
                  teams actually work.
                </p>
              </li>
              <li>
                <span className="pillar-num">02</span>
                <h3>Execution built in</h3>
                <p>
                  Dialing, sequencing, write-back, and workflows ship with the tool — not stitched
                  together from a dozen APIs after the prompt ends.
                </p>
              </li>
              <li>
                <span className="pillar-num">03</span>
                <h3>Share across the org</h3>
                <p>
                  What one team builds can be standardized and shared. Leadership gets visibility;
                  reps and managers get consistent tools that travel with the motion.
                </p>
              </li>
            </ul>
          </div>
        </Reveal>

        <Reveal className="section product-section" as="section">
          <div className="section-inner split" id="build">
            <div className="section-copy">
              <p className="eyebrow">Flexible by design</p>
              <h2>Natural language on the data you already own.</h2>
              <p>
                Claude and ChatGPT showed your teams what&apos;s possible. Jargon is the next step:
                the same builder instinct, grounded in your context and data layers — so a retention
                workspace, an account-prep console, or an outbound motion all speak the same
                source of truth.
              </p>
            </div>
            <ContextMock />
          </div>
        </Reveal>

        <Reveal className="section build-section" as="section">
          <div className="section-inner" id="execute">
            <div className="section-copy centered">
              <p className="eyebrow">From prompt to production</p>
              <h2>Describe the motion. Ship something the team can run.</h2>
              <p>
                Tell Jargon what your team needs. It clarifies the audience, channels, and goals —
                then builds a workspace with execution wired in, not a prompt you have to re-run
                every Monday.
              </p>
            </div>
            <BuilderMock />
          </div>
        </Reveal>

        <Reveal className="section run-section" as="section">
          <div className="section-inner" id="share">
            <div className="section-copy centered">
              <p className="eyebrow">Org-wide, not one-off</p>
              <h2>Standardize what works. Make it visible.</h2>
              <p>
                Tools built by one manager become shareable infrastructure — the same quality bar
                across sales, retention, and ops, with leadership clarity into what the org is
                running.
              </p>
            </div>
            <DashboardMock />
          </div>
        </Reveal>

        <Reveal className="section capabilities" as="section">
          <div className="section-inner" id="use-cases">
            <div className="section-copy centered">
              <p className="eyebrow">Across the revenue center</p>
              <h2>One platform. Every motion that matters.</h2>
              <p>
                Built by the people closest to the work — shared by the org that depends on it.
              </p>
            </div>
            <ul className="capability-list">
              <li>
                <span className="cap-glyph">◎</span>
                <div>
                  <h3>Retention &amp; expansion</h3>
                  <p>
                    Risk queues, renewal prep, and save motions wired to health scores and CRM
                    write-back.
                  </p>
                </div>
              </li>
              <li>
                <span className="cap-glyph">▤</span>
                <div>
                  <h3>Account prep</h3>
                  <p>
                    Briefings and talking points pulled from your data layer — ready before the
                    meeting, not rebuilt in a chat each time.
                  </p>
                </div>
              </li>
              <li>
                <span className="cap-glyph">☎</span>
                <div>
                  <h3>Outbound</h3>
                  <p>
                    Dialers, sequencers, and cadences your teams design — on your segments, with
                    execution included.
                  </p>
                </div>
              </li>
              <li>
                <span className="cap-glyph">↻</span>
                <div>
                  <h3>Post-call admin</h3>
                  <p>
                    Summaries, next steps, and CRM updates that close the loop so reps stay in the
                    conversation, not the paperwork.
                  </p>
                </div>
              </li>
            </ul>
          </div>
        </Reveal>

        <Reveal className="section cta-section" as="section">
          <div className="cta-panel" id="demo">
            <BrandMark size={36} className="cta-mark" />
            <h2>Build the revenue stack only you could design.</h2>
            <p>
              Jargon is for leaders who would rather create tools than rent them — and for the
              teams who turn those builds into infrastructure the whole org can share and run.
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
          <LogoMark size={22} />
          <span>Jargon</span>
        </div>
        <p>For those who are brave enough to build.</p>
      </footer>
    </div>
  )
}
