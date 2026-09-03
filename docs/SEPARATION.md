# Product vs internal ops

| | This repo (`jargonlabs-co/jargon`) | Private ops (`jargonlabs-co/outbound-ops`) |
|--|-----------------------------------|-------------------------------------------|
| Visibility | Public product | Private |
| Audience | Customers | Internal team |
| Surfaces | CLI + website dashboard + tool UIs | Desktop + API |
| Customer data | HubSpot (their portal) | Internal lists / Crustdata |
| Outbound | Platform Gmail, Twilio, HeyReach | Crustdata queue + Gmail/Twilio |
| Prospect search | Not in this product | Crustdata / Apollo / Supabase |
| Billing | None | None |
| Deploy | Product Railway + Vercel | Separate Railway |

## Rules

1. Never point both stacks at the same `DATABASE_URL`.
2. Prefer separate Google / Twilio / HeyReach credentials.
3. Do not import code across the two repos.
4. Share links and Electron packaging are not part of the public product.
