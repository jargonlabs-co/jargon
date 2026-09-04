import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BrandMark } from './components/BrandMark'
import { LogoMark } from './components/LogoMark'
import { CliDeployMock, ContextMock, DialerMock, TeamToolsMock } from './components/ProductMocks'

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

interface Props {
  onLogin: () => void
  onSignUp: () => void
}

export function MarketingPage({ onLogin, onSignUp }: Props) {
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
          <a href="#deploy">Deploy</a>
          <a href="#run">Run</a>
          <a href="#data">Data</a>
          <a href="#use-cases">Use cases</a>
        </nav>
        <div className="nav-actions">
          <button type="button" className="nav-login" onClick={onLogin}>
            Log in
          </button>
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
            <h1>For those who are brave enough to build.</h1>
            <p className="hero-lede">
              Create enterprise-ready custom software on top of your own data layer — CRM, data
              warehouse, and context — so revenue tools fit how you sell, not how a vendor assumed
              you would.
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
              <button type="button" className="btn ghost" onClick={onSignUp}>
                Sign up
              </button>
            </div>
          </div>

          <div className="hero-visual">
            <DialerMock />
          </div>
        </section>

        <Reveal className="section build-section" as="section">
          <div className="section-inner" id="deploy">
            <div className="section-copy centered">
              <p className="eyebrow">For GTM Engineers</p>
              <h2>Deploy fully functional UIs from Claude Code.</h2>
              <p>
                Describe the motion once. Jargon ships a working UI on your CRM, data warehouse,
                and context layer — dialing, email, and LinkedIn included — without the tickets,
                sprint cycles, or ongoing maintenance of a traditional engineering build. Sales
                opens the tool in the browser and runs it.
              </p>
            </div>
            <CliDeployMock />
          </div>
        </Reveal>

        <Reveal className="section run-section" as="section">
          <div className="section-inner" id="run">
            <div className="section-copy centered">
              <p className="eyebrow">For the revenue team</p>
              <h2>Working software. Not another chat thread.</h2>
              <p>
                What one GTM Engineer deploys from Claude Code becomes a UI the team can open and
                run — same quality bar, same data layer, execution wired in, without waiting on
                engineering to build or maintain it.
              </p>
            </div>
            <TeamToolsMock />
          </div>
        </Reveal>

        <Reveal className="section pillars-section" as="section">
          <div className="section-inner" id="pillars">
            <div className="section-copy centered">
              <p className="eyebrow">Three pillars</p>
              <h2>Your data. Custom software. Tools the team can run.</h2>
              <p>
                Jargon is for revenue leaders who want durable software on their stack — and for
                the GTM Engineers who ship it.
              </p>
            </div>
            <ul className="pillar-list">
              <li>
                <span className="pillar-num">01</span>
                <h3>Your data layer</h3>
                <p>
                  Build on the systems you already trust — CRM, data warehouse, and context layer —
                  so every tool speaks your source of truth, not a generic list.
                </p>
              </li>
              <li>
                <span className="pillar-num">02</span>
                <h3>Custom software</h3>
                <p>
                  Describe the motion. Jargon ships a functional UI — dialers, queues, sequencers —
                  with calling, email, and LinkedIn included, not stitched on later.
                </p>
              </li>
              <li>
                <span className="pillar-num">03</span>
                <h3>Built for how you ship</h3>
                <p>
                  GTM Engineers deploy from Claude Code or the CLI — fully functional UIs without
                  standing up an eng backlog. Sales opens a browser tool and works the queue.
                </p>
              </li>
            </ul>
          </div>
        </Reveal>

        <Reveal className="section product-section" as="section">
          <div className="section-inner split" id="data">
            <div className="section-copy">
              <p className="eyebrow">Enterprise-ready on your stack</p>
              <h2>Custom software on the data layer you already own.</h2>
              <p>
                Claude and ChatGPT showed your teams what&apos;s possible. Jargon is the next step:
                enterprise-ready tools grounded in your CRM, data warehouse, and context layer —
                so a today queue, dialer, or sequencer runs on how your org actually sells.
              </p>
            </div>
            <ContextMock />
          </div>
        </Reveal>

        <Reveal className="section capabilities" as="section">
          <div className="section-inner" id="use-cases">
            <div className="section-copy centered">
              <p className="eyebrow">What you can ship</p>
              <h2>Custom UIs for every motion that matters.</h2>
              <p>
                Built by the people closest to the work — run by the reps who depend on it.
              </p>
            </div>
            <ul className="capability-list">
              <li>
                <span className="cap-glyph">☎</span>
                <div>
                  <h3>Outbound dialers</h3>
                  <p>
                    Functional call UIs on your segments — dispositions, next steps, and write-back
                    included.
                  </p>
                </div>
              </li>
              <li>
                <span className="cap-glyph">⚑</span>
                <div>
                  <h3>Today queues</h3>
                  <p>
                    Prioritized worklists for AEs and SDRs, pulled from your CRM and context layer —
                    ready when the day starts.
                  </p>
                </div>
              </li>
              <li>
                <span className="cap-glyph">↻</span>
                <div>
                  <h3>Sequencers &amp; cadences</h3>
                  <p>
                    Multi-channel motions your GTM Engineers design — email, call, and LinkedIn in
                    one runnable tool.
                  </p>
                </div>
              </li>
              <li>
                <span className="cap-glyph">◎</span>
                <div>
                  <h3>Account &amp; retention motions</h3>
                  <p>
                    Prep consoles and risk queues on the same data layer — custom software that
                    travels with the motion.
                  </p>
                </div>
              </li>
            </ul>
          </div>
        </Reveal>

        <Reveal className="section cta-section" as="section">
          <div className="cta-panel" id="demo">
            <BrandMark size={36} className="cta-mark" />
            <h2>
              Build the revenue stack
              <br />
              only you could design.
            </h2>
            <p>
              Enterprise-ready custom software on your data layer — deployed by GTM Engineers from
              Claude Code, without engineering maintenance, and run by sales as working tools.
            </p>
            <a
              className="btn primary large"
              href="https://calendly.com/tara_jargonlabs/30min"
              target="_blank"
              rel="noopener noreferrer"
            >
              Book a demo
            </a>
            <p className="cta-note">
              Connect your data · Deploy from Claude Code · Run in the browser
            </p>
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
