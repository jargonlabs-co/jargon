# Jargon MCP

Users on jargonlabs.co add Jargon to Claude. They **sign in with their Jargon account**. They do not paste an API key.

Hosted endpoint: `https://www.jargonlabs.co/mcp`

## What a customer does

1. Create an account on [jargonlabs.co](https://jargonlabs.co).
2. Click **Connect Claude** on the dashboard.
3. In Claude: **Add**, then **Connect**, and sign in with the same Jargon account.
4. Bring your list however Claude already has it (another connector, CSV, pasted table). Call `import_list` with people as a markdown table or CSV.

Outbound (email, phone, LinkedIn) runs on **Jargon managed infrastructure**. Customers do not connect Gmail, Twilio, or HeyReach.

## Tools

`get_me` · `get_credits` · `get_usage` · `create_billing_link` · `import_list` · `deploy_tool` · `add_contacts` · `list_prospects` · `get_prospect` · `list_projects` · `get_project` · `resume_workspace` · `list_crm_contacts` · `list_contacts` · `queue_next` · `get_sequence` · `show_email_workspace` · `show_tasks` · `list_tasks` · `update_sequence` · `start_sequence` · `enroll_hubspot` · `note_schedule_choice` · `save_research` · `save_draft` · `list_drafts` · `update_draft` · `send_draft` · `send_message` · `start_call` · `complete_call` · `disposition` · `add_note`

`import_list` is the primary path: put people in `workspace` as a markdown table or CSV. Claude researches each contact and calls `save_research` — that enrolls everyone and opens Tasks.

Contract: [`../openapi.json`](../openapi.json)
