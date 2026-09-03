# Claude Code → Jargon demo

When the user asks to build/deploy a dialer, sequencer, or today queue with Jargon:

1. From `/Users/taradebek/jargon`, with Node via nvm:

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 22
export JARGON_API_URL=https://jargon-api-production.up.railway.app
export JARGON_APP_URL=https://jargonlabs.co
npm run jargon -- deploy "<their prompt>"
```

2. Return the printed `Open:` URL (https://jargonlabs.co/tools/...).

3. Remind them to be logged into jargonlabs.co as the same account that owns the CLI API key / login.

Deploy creates a tool with **20 demo prospects** if HubSpot is not connected. Email/call/LinkedIn run in demo mode until platform keys are live.
