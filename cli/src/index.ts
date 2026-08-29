#!/usr/bin/env node
import { clearConfig, defaultApiUrl, loadConfig, requireConfig, saveConfig } from './config.js'
import {
  createApiKey,
  createShare,
  deployTool,
  health,
  listProjects,
  loginWithPassword
} from './api.js'

const args = process.argv.slice(2)
const command = args[0]

function flag(name: string): boolean {
  return args.includes(name)
}

function opt(name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const idx = args.indexOf(name)
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('-')) return args[idx + 1]
  return undefined
}

function restAfterCommand(): string[] {
  return args.slice(1).filter((a) => !a.startsWith('-') && !opt('--email') && !opt('--password') && !opt('--api-key') && !opt('--api-url') && !opt('--label') && !opt('--name'))
}

async function cmdLogin() {
  const apiUrl = (opt('--api-url') || defaultApiUrl()).replace(/\/$/, '')
  const apiKey = opt('--api-key')
  const email = opt('--email')
  const password = opt('--password')

  await health(apiUrl)

  if (apiKey) {
    saveConfig({ apiUrl, token: apiKey, email: email ?? 'api-key' })
    console.log(`Saved API key to ~/.jargon/config.json (${apiUrl})`)
    return
  }

  if (!email || !password) {
    console.error('Usage: jargon login --email you@co.com --password secret')
    console.error('   or: jargon login --api-key jarg_...')
    process.exit(1)
  }

  const result = await loginWithPassword(apiUrl, email, password)
  saveConfig({ apiUrl, token: result.token, email: result.email })
  console.log(`Logged in as ${result.email}`)
  console.log(`API: ${apiUrl}`)
}

async function cmdDeploy() {
  const cfg = requireConfig()
  const json = flag('--json')
  const noShare = flag('--no-share')
  const label = opt('--label')
  const promptParts = restAfterCommand()
  const prompt = promptParts.join(' ').trim() || opt('--prompt')
  if (!prompt) {
    console.error('Usage: jargon deploy "Find 20 prospects to contact today"')
    console.error('   or: jargon deploy --prompt "..." [--label "Team queue"] [--json]')
    process.exit(1)
  }

  const result = await deployTool(cfg, { prompt, label, share: !noShare })

  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.log(`✓ Deployed ${result.project?.name ?? result.projectId}`)
  console.log(`  Prospects: ${result.contactCount} (${result.prospectSource ?? 'unknown source'})`)
  if (result.shareUrl) {
    console.log(`  Share URL: ${result.shareUrl}`)
    console.log('  Paste in Slack — reps open in browser, no install needed.')
  }
}

async function cmdList() {
  const cfg = requireConfig()
  const json = flag('--json')
  const projects = await listProjects(cfg)
  if (json) {
    console.log(JSON.stringify(projects, null, 2))
    return
  }
  if (!projects.length) {
    console.log('No projects yet. Run: jargon deploy "Find 20 prospects to contact today"')
    return
  }
  for (const p of projects) {
    const when = new Date(p.updatedAt).toLocaleString()
    console.log(`${p.id}  ${p.name}  (${p.kind})  · ${when}`)
  }
}

async function cmdShare() {
  const cfg = requireConfig()
  const json = flag('--json')
  const projectId = restAfterCommand()[0] || opt('--project')
  const label = opt('--label')
  if (!projectId) {
    console.error('Usage: jargon share <project-id> [--label "Queue name"]')
    process.exit(1)
  }
  const result = await createShare(cfg, projectId, label)
  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  console.log(result.url)
}

async function cmdApiKeysCreate() {
  const cfg = requireConfig()
  const name = opt('--name') || 'CLI'
  const result = await createApiKey(cfg, name)
  console.log('Save this key — it is shown once:')
  console.log(result.key)
  console.log(`\nThen: jargon login --api-key ${result.key}`)
}

async function cmdWhoami() {
  const cfg = loadConfig()
  if (!cfg?.token) {
    console.log('Not logged in')
    return
  }
  console.log(`API:   ${cfg.apiUrl}`)
  console.log(`Email: ${cfg.email ?? '(api key)'}`)
  console.log(`Token: ${cfg.token.slice(0, 12)}…`)
}

async function cmdLogout() {
  clearConfig()
  console.log('Cleared ~/.jargon/config.json')
}

function help() {
  console.log(`Jargon CLI — deploy outbound tools from the terminal

Usage:
  jargon login --email you@co.com --password secret [--api-url URL]
  jargon login --api-key jarg_...
  jargon deploy "Find 20 prospects to contact today" [--label NAME] [--json]
  jargon list [--json]
  jargon share <project-id> [--label NAME]
  jargon api-keys create --name "Claude Code"
  jargon whoami
  jargon logout

Environment:
  JARGON_API_URL   Default API base (default http://127.0.0.1:8787)

Claude Code example:
  jargon deploy "Find 20 VP Sales in Austin" --json
`)
}

async function main() {
  try {
    switch (command) {
      case 'login':
        await cmdLogin()
        break
      case 'deploy':
        await cmdDeploy()
        break
      case 'list':
      case 'ls':
        await cmdList()
        break
      case 'share':
        await cmdShare()
        break
      case 'api-keys':
        if (args[1] === 'create') await cmdApiKeysCreate()
        else {
          console.error('Usage: jargon api-keys create --name "Claude Code"')
          process.exit(1)
        }
        break
      case 'whoami':
        await cmdWhoami()
        break
      case 'logout':
        await cmdLogout()
        break
      case 'help':
      case '--help':
      case '-h':
      case undefined:
        help()
        break
      default:
        console.error(`Unknown command: ${command}`)
        help()
        process.exit(1)
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

void main()
