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

`get_me` · `get_credits` · `get_usage` · `create_billing_link` · `import_list` · `deploy_tool` · `add_contacts` · `list_prospects` · `get_prospect` · `list_projects` · `get_project` · `list_contacts` · `queue_next` · `get_sequence` · `show_email_workspace` · `show_tasks` · `list_tasks` · `update_sequence` · `start_sequence` · `save_draft` · `list_drafts` · `update_draft` · `send_draft` · `send_message` · `start_call` · `complete_call` · `disposition` · `add_note`

**Allow card.** Claude shows a JSON fence whenever a write tool takes nested objects (`contacts[]`, `spec`). Model-facing writes only take strings: `summary` (the sentence on Allow) and `workspace` (the motion plus a markdown people table). The write runs when the user clicks Allow. In-chat buttons still call `run_*`. Read tools stay `readOnlyHint: true`.

`import_list` / `deploy_tool` / `show_email_workspace` / `show_tasks` / `start_sequence` open the **outbound workspace in Claude**. It is one app with three jobs: **Contacts** (the list), **Sequence** (build/edit the cadence), **Tasks** (today's work). A **Queue** tab appears for dialer / work-the-list prompts. **Inbox** is the message log (replies / sent), not the send path for a cadence. Extra contact fields stay as `attrs`. `start_sequence` enrolls everyone by step `day` and opens Tasks — use it for cadences, not one-offs. `dashboardUrl` (`https://jargonlabs.co/tools/…`) is the full web tool. Schedule with `send_message` `status: queued` + `sendAt`.

**Tasks.** Once contacts are enrolled, every step becomes one dated task per contact: day 0 email, day 0 call, day 2 LinkedIn, and so on. `show_tasks` opens Tasks — overdue / due today / upcoming. Skip persists; sending, logging a call, or sending a LinkedIn note advances to the next task. `list_tasks` returns the same tasks as JSON (`bucket` defaults to `open`, i.e. overdue + due today). Email and LinkedIn tasks are also sent automatically on their send day — Tasks is for working ahead, calls, and anything the scheduler cannot do.

`import_list` is how Claude turns any researched list into an outbound workspace. Put the people in `workspace` as a markdown table. `deploy_tool` without a table hydrates the connected CRM/warehouse. `add_contacts` appends people to an existing workspace (`people` as a table, `workspaceId`).

Contract: [`../openapi.json`](../openapi.json)
