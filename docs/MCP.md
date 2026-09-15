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

**Confirmation cards.** Writes the model calls (`import_list`, `deploy_tool`, `send_message`, …) are **read-only previews**. They store a short-lived proposal and open an in-chat card in plain language (title, one-sentence summary, a couple of facts, Confirm / Don't). The actual write is `run_proposal` (or `run_<tool>` from the workspace UI), both hidden with `_meta.ui.visibility: ["app"]` so Claude never dumps a JSON approval block. After confirm, import/deploy/start_sequence morph the same card into the outbound workspace. Read tools stay `readOnlyHint: true`. Do not set `_meta["anthropic/requiresUserInteraction"]`.

`import_list` / `deploy_tool` / `show_email_workspace` / `show_tasks` / `start_sequence` open the **outbound UI in Claude**. The prompt picks the chrome: **queue** (email + phone + LinkedIn on a contact list), **sequence** (cadence / over N days), **tasks** (what's due today), **one-off emails**, or **inbox**. Extra contact fields stay as `attrs`. `start_sequence` queues every email for every contact using step `day` — use it for cadences, not one-offs. `dashboardUrl` (`https://jargonlabs.co/tools/…`) is the full web tool. Schedule with `send_message` `status: queued` + `sendAt`.

**Tasks.** Once contacts are enrolled, every step becomes one dated task per contact: day 0 email, day 0 call, day 2 LinkedIn, and so on. `show_tasks` opens the task view — overdue / due today / upcoming, with Previous and Skip so the rep clicks straight through; sending, logging a call, or sending a LinkedIn note advances to the next task. `list_tasks` returns the same tasks as JSON (`bucket` defaults to `open`, i.e. overdue + due today) so Claude can answer "what's due today" without opening the UI. Email and LinkedIn tasks are also sent automatically on their send day — the task view is for working ahead, calls, and anything the scheduler cannot do.

`import_list` is how Claude turns any researched list into an outbound workspace (LinkedIn, email, phone, or a mix) when that tool is visible. Describe the motion **and the interface** in `prompt`; optionally pass `spec.channels` and `spec.primarySurface`. If Claude only has `deploy_tool`, put the people in `prompt` as JSON or a markdown table — Jargon extracts that list and uses it as the queue.

`deploy_tool` without `contacts` hydrates the connected CRM/warehouse. `add_contacts` appends people to an existing workspace.

Contract: [`../openapi.json`](../openapi.json)
