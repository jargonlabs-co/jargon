# Product vs internal ops

| | This repo (`jargonlabs-co/jargon`) | Private ops (`jargonlabs-co/outbound-ops`) |
|--|-----------------------------------|-------------------------------------------|
| Visibility | Public product | Private |
| Audience | Customers | Internal team |
| Surfaces | CLI + website dashboard + tool UIs | Desktop + API |
| Customer data | HubSpot and/or **Postgres prospects table** | Internal lists / Crustdata |
| Auth / login | **Supabase Auth only** (passwords never on Railway) | Local / ops-specific |
| Outbound | Platform Gmail, Twilio, HeyReach | Crustdata queue + Gmail/Twilio |
| Prospect search / seed | Customer-connected warehouse (read) | Crustdata → seed `jargon_prospects` (write) |
| Billing | None | None |
| Deploy | Product Railway + Vercel | Separate Railway |

## Dogfood pattern

Outbound-ops **seeds** Railway `jargon_prospects` via Crustdata. Public Jargon **reads** that same table when you connect it as a customer Postgres source (public TCP proxy URL). Product `DATABASE_URL` (app state) stays separate from the prospects connection string stored on the org.

## Rules

1. Never point both stacks at the same product `DATABASE_URL` for app state.
2. Prefer separate Google / Twilio / HeyReach credentials.
3. Do not import code across the two repos.
4. Share links and Electron packaging are not part of the public product.
5. Prefer a **read-only** Postgres role for the product prospects connection.
