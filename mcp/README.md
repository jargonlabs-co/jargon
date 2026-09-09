# @jargon_labs/mcp

MCP server for the Jargon GTM execution API. Tools map 1:1 to `openapi.json` / `/v1`.

## Add to Claude Code

```bash
claude mcp add --scope user \
  --env JARGON_API_URL=https://www.jargonlabs.co \
  --env JARGON_API_KEY=jarg_test_YOUR_KEY \
  jargon -- npx -y @jargon_labs/mcp
```

Use a **sandbox** key (`jarg_test_…`) for analysis. A live `jarg_…` key can send real email and place real calls.

Then in Claude Code: `/mcp` → confirm `jargon` is connected.

## Add to Claude Desktop

In MCP settings, stdio server:

- Command: `npx`
- Args: `-y` `@jargon_labs/mcp`
- Env: `JARGON_API_KEY`, `JARGON_API_URL`

## Local (this repo, before npm publish)

```bash
cd mcp && npm install && npm run build

claude mcp add --scope user \
  --env JARGON_API_URL=https://www.jargonlabs.co \
  --env JARGON_API_KEY=jarg_test_YOUR_KEY \
  jargon -- node /ABS/PATH/TO/jargon/mcp/dist/index.js
```

## Publish (maintainers)

```bash
cd mcp
npm login          # account that can publish to the jargon_labs npm org
npm run build
npm publish --access public
```
