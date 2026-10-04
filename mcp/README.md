# @jargon_labs/mcp (deprecated)

This stdio server no longer gets new tools. Use the hosted Jargon connector instead. It has every tool, the in-chat workspace, and OAuth.

## Claude (claude.ai or Desktop)

Settings → Connectors → Add custom connector → `https://api.jargonlabs.co/mcp`, then sign in.

## Claude Code

```bash
claude mcp add --scope user --transport http jargon https://api.jargonlabs.co/mcp \
  --header "Authorization: Bearer jarg_test_YOUR_KEY"
```

Use a **sandbox** key (`jarg_test_…`) for analysis. A live `jarg_…` key can send real email and place real calls.

## Maintainers

Publish this final version so `npx` users see the notice, then mark it deprecated on npm:

```bash
cd mcp
npm run build
npm publish --access public
npm deprecate @jargon_labs/mcp "Deprecated: use the hosted connector at https://api.jargonlabs.co/mcp"
```
