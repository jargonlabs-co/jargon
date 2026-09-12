# Jargon MCP

Users on jargonlabs.co add Jargon to Claude. They **sign in with their Jargon account**. They do not paste an API key.

Hosted endpoint: `https://www.jargonlabs.co/mcp`

## What a customer does

1. Create an account and connect HubSpot or Railway on [jargonlabs.co](https://jargonlabs.co).
2. Click **Connect Claude** on the dashboard. That opens Claude’s Connectors dialog with Jargon prefilled (`https://claude.ai/customize/connectors?modal=add-custom-connector&…`).
3. In Claude: **Add**, then **Connect**, and sign in with the same Jargon account.

Claude Code (optional):

```bash
claude mcp add --transport http --scope user \
  jargon https://www.jargonlabs.co/mcp
```

Then `/mcp` → Connect → same Jargon login.

## Power-user fallback (API key)

```bash
claude mcp add --scope user \
  --env JARGON_API_URL=https://www.jargonlabs.co \
  --env JARGON_API_KEY=jarg_test_... \
  jargon -- npx -y @jargon_labs/mcp
```

Or HTTP with a key:

```bash
claude mcp add --transport http --scope user \
  --header "Authorization: Bearer jarg_..." \
  jargon https://www.jargonlabs.co/mcp
```

## Tools

`get_me` · `get_credits` · `get_usage` · `create_billing_link` · `import_list` · `deploy_tool` · `add_contacts` · `list_prospects` · `get_prospect` · `list_projects` · `get_project` · `list_contacts` · `queue_next` · `get_sequence` · `update_sequence` · `save_draft` · `list_drafts` · `update_draft` · `send_draft` · `send_message` · `start_call` · `complete_call` · `disposition` · `add_note`

`import_list` keeps extra contact fields as `attrs` (sequence variables). `get_sequence` returns the field catalog and steps — show that in Claude. Draft copy with `save_draft`, let the user edit, then `send_draft`. Schedule with `send_message` `status: queued` + `sendAt`.

`import_list` is how Claude turns any researched list into an outbound workspace (LinkedIn, email, phone, or a mix) when that tool is visible. Describe the motion in `prompt`; optionally pass `spec.channels` and `spec.primarySurface`. If Claude only has `deploy_tool`, put the people in `prompt` as JSON or a markdown table — Jargon extracts that list and uses it as the queue.

`deploy_tool` without `contacts` hydrates the connected CRM/warehouse. `add_contacts` appends people to an existing workspace.

Contract: [`../openapi.json`](../openapi.json)
