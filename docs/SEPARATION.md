# Product vs internal ops

| | This repo (`jargonlabs-co/jargon`) | Private ops (`jargonlabs-co/outbound-ops`) |
|--|-----------------------------------|-------------------------------------------|
| Visibility | Public product | Private |
| Audience | Customers | Internal team |
| Surfaces | CLI + website dashboard + tool UIs | Desktop + API |
| Customer data | HubSpot and/or **Railway OAuth → Postgres prospects** | Internal lists / Crustdata |
| Auth / login | **Supabase Auth only** (passwords never on Railway) | Local / ops-specific |
| Outbound | Platform Gmail, Twilio, HeyReach | Crustdata queue + Gmail/Twilio |
| Prospect search / seed | Customer-connected warehouse (read) | Crustdata → seed `jargon_prospects` (write) |
| Billing | None | None |
| Deploy | Product Railway + Vercel | Separate Railway |

## Dogfood pattern

Outbound-ops **seeds** Railway `jargon_prospects` via Crustdata. Public Jargon **reads** that same table when the customer connects Railway via OAuth and selects that project (product resolves `DATABASE_PUBLIC_URL` / TCP proxy). Product `DATABASE_URL` (app state) stays separate from the warehouse.

## Rules

1. Never point both stacks at the same product `DATABASE_URL` for app state.
2. Prefer separate Google / Twilio / HeyReach credentials.
3. Do not import code across the two repos.
4. Share links and Electron packaging are not part of the public product.
5. Prefer a **read-only** role / minimal project scope for the prospects warehouse.
