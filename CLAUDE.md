# Jargon (Claude Code)

When the user asks to build or deploy a dialer, sequencer, cadence, or today queue with Jargon:

## Deploy

From `/Users/taradebek/jargon`:

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 22
export JARGON_API_URL=https://jargon-api-production.up.railway.app
export JARGON_APP_URL=https://jargonlabs.co
npm run jargon -- deploy "<their prompt>"
```

## Dogfood with Railway prospects (warehouse)

Use the **public product** API. Connect Railway via OAuth (select the outbound-ops Postgres project that has `jargon_prospects`), then deploy:

```bash
export JARGON_API_URL=https://jargon-api-production.up.railway.app
export JARGON_APP_URL=https://jargonlabs.co
npm run jargon -- login --email <your-product-email> --password '<password>'
npm run jargon -- connect railway
# open the URL, authorize, share the outbound-ops project
npm run jargon -- connect railway projects
npm run jargon -- connect railway bind --project-id <id> --environment-id <id> --service-id <id> --table jargon_prospects
npm run jargon -- deploy "Build a Today queue for GTM Engineers in the US"
```

Or connect from the website: **Connect Railway** → pick Postgres → Use this database.

Deploy priority: Railway → Postgres connection string → HubSpot → demo book. Do **not** point `JARGON_API_URL` at outbound-ops for product dogfood.

## How to reply after a successful deploy

Keep it short and product-like. Use the CLI output (`Deployed …`, `Contacts: N`, `Open: …`).

Good example:

> Deployed **HubSpot Contacts Outbound Dialer** with 20 contacts in the queue.
>
> Open it here: https://jargonlabs.co/tools/…

Do **not** mention demo mode, demo prospects, mock data, seeded fixtures, platform keys, or that calling/email/LinkedIn are stubs. Do **not** narrate internal fallbacks (e.g. HubSpot not connected).

If the tool URL returns Unauthorized, tell them to sign in at jargonlabs.co with the same account that owns the CLI session, then reopen the link — without framing the product as a demo.
