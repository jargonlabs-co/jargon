import { useEffect, useState } from 'react'
import { ClaudeMark } from './ClaudeMark'
import { LoginPanel } from './LoginPanel'
import { LogoMark } from './LogoMark'

const STEPS = [
  {
    n: '1',
    title: 'Create your Jargon account',
    body: 'Your name, your company, and a password. This is the workspace you sell from.'
  },
  {
    n: '2',
    title: 'Bring the data you already sell from',
    body: 'Your CRM or a Clay table, connected in Claude. Jargon executes on those people.'
  },
  {
    n: '3',
    title: 'Execute outbound in Claude',
    body: 'The queue, the cadence, and today’s email, calls, and LinkedIn run in the chat.'
  }
]

const PROMPTS = [
  'Who on my book is closest to a meeting this week? Build the outreach.',
  'Write an 8-day cadence for the economic buyers on my named accounts.',
  'What’s due today? Let me start with the calls.'
]

const QUEUE = [
  { name: 'Maya Chen', meta: 'Lattice · VP Sales', next: 'Call' },
  { name: 'Jordan Blake', meta: 'Rippling · Director', next: 'Email' },
  { name: 'Priya Nair', meta: 'Notion · Economic buyer', next: 'LinkedIn' }
]

export function SignupPage({ onSignIn }: { onSignIn: () => void }) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Create your account — Jargon'
    const description = document.querySelector('meta[name="description"]')
    const previousDescription = description?.getAttribute('content') ?? ''
    description?.setAttribute(
      'content',
      'Jargon lets you execute on top of your data in Claude. Work your book — email, calls, and LinkedIn — from the chat.'
    )
    return () => {
      document.title = previousTitle
      if (previousDescription) description?.setAttribute('content', previousDescription)
    }
  }, [])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function signIn(event: React.MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    onSignIn()
  }

  return (
    <div className="page signup-page">
      <div className="atmosphere" aria-hidden="true" />

      <header className={`nav ${scrolled ? 'scrolled' : ''}`}>
        <a className="nav-brand" href="/">
          <LogoMark size={26} />
          <span>Jargon</span>
        </a>
        <nav className="nav-links">
          <a href="#start">How it starts</a>
          <a href="#book">Your book</a>
          <a href="#ask">What you’d ask</a>
        </nav>
        <div className="nav-actions">
          <a className="nav-login" href="/login" onClick={signIn}>
            Sign in
          </a>
        </div>
      </header>

      <main>
        <section className="signup-hero">
          <div className="signup-copy">
            <p className="eyebrow">For enterprise sales</p>
            <h1>Work your book from the chat you already use.</h1>
            <p className="signup-lede">
              Jargon lets you execute on top of your data in Claude. Your CRM or Clay table stays
              the source. Email, calls, and LinkedIn run from that chat.
            </p>
            <ul className="signup-points">
              <li>Execute outbound on the accounts already in your data</li>
              <li>The queue, the cadence, and today’s tasks, inside Claude</li>
              <li>Email, calls, and LinkedIn from the same conversation</li>
            </ul>
            <div className="hero-available" aria-label="Runs in Claude">
              <span className="hero-available-label">Runs in</span>
              <span className="hero-available-item">
                <ClaudeMark />
                Claude
              </span>
            </div>
          </div>

          <div className="signup-card" id="create-account">
            <LoginPanel
              embedded
              showBrand
              showTabs={false}
              initialMode="register"
              registerLead="Create your account and execute on your data in Claude."
              onModeChange={(mode) => {
                if (mode === 'login') onSignIn()
              }}
            />
            <p className="signup-switch">
              Already have an account?{' '}
              <a href="/login" onClick={signIn}>
                Sign in
              </a>
            </p>
          </div>
        </section>

        <section className="signup-section" id="start">
          <div className="signup-section-head">
            <p className="eyebrow">How Jargon works</p>
            <h2>Execute on the data you already sell from.</h2>
          </div>
          <ol className="signup-steps">
            {STEPS.map((step) => (
              <li key={step.n}>
                <span>{step.n}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="signup-section signup-book" id="book">
          <div className="signup-book-copy">
            <p className="eyebrow">In Claude</p>
            <h2>Your data, executed as outbound.</h2>
            <p>
              Jargon sits on the CRM or Clay table you already use and runs the work from Claude —
              email, a call, or a LinkedIn note, with the context on the contact.
            </p>
          </div>
          <div className="signup-preview" aria-hidden="true">
            <div className="cg-ui">
              <div className="cg-ui-head">
                <strong>Named accounts · This quarter</strong>
                <span>3 contacts · Email · Call · LinkedIn</span>
              </div>
              <div className="cg-people">
                {QUEUE.map((row, index) => (
                  <div key={row.name} className={`cg-person ${index === 0 ? 'on' : ''}`}>
                    <div>
                      <div className="cg-name">{row.name}</div>
                      <div className="cg-meta">{row.meta}</div>
                    </div>
                    <span className="cg-pill">{row.next}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="signup-section" id="ask">
          <div className="signup-section-head">
            <p className="eyebrow">What you’d ask</p>
            <h2>Find who’s closest, write the cadence, and work today’s calls.</h2>
          </div>
          <ul className="signup-prompts">
            {PROMPTS.map((prompt) => (
              <li key={prompt}>{prompt}</li>
            ))}
          </ul>
          <a className="btn primary large" href="#create-account">
            Create your account
          </a>
        </section>
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
