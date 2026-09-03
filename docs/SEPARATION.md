# Product vs internal ops

| | This repo (`jargonlabs-co/jargon`) | Private ops (`jargonlabs-co/outbound-ops`) |
|--|-----------------------------------|-------------------------------------------|
| Visibility | Public product | Private |
| Audience | Customers / early testers | Internal team only |
| Surfaces | Desktop + landing + portal + CLI | Desktop + API only |
| Billing | Stripe / portal | None |
| Deploy | Product Railway + Vercel | Separate Railway (or local only) |
| Data | Product Postgres / JSON DB | **Different** database |
| Secrets | Product OAuth / Stripe / keys | Prefer separate OAuth clients + keys |

## Rules

1. Never point both stacks at the same `DATABASE_URL`.
2. Never reuse production OAuth redirect URIs across both (use separate Google/Twilio apps when practical).
3. Do not import code across the two repos — copy deliberately if needed, then diverge.
4. Customer-facing packaging (landing, portal, CLI publish, GH Releases) stays **only** in this product repo.
