#!/usr/bin/env node
import { clearConfig, defaultApiUrl, loadConfig, requireConfig, saveConfig } from './config.js'
import {
  bindRailway,
  connectPostgres,
  createApiKey,
  deployTool,
  health,
  listConnections,
  listProjects,
  listRailwayResources,
  loginWithPassword,
  startRailwayOAuth,
  syncPostgres,
  syncRailway
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
  return args.slice(1).filter((a) => !a.startsWith('-'))
}

function appUrl(): string {
  return (process.env.JARGON_APP_URL ?? 'http://127.0.0.1:5180').replace(/\/$/, '')
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
  const promptParts = restAfterCommand().filter(
    (a) => a !== opt('--email') && a !== opt('--password') && a !== opt('--api-key')
  )
  const prompt = promptParts.join(' ').trim() || opt('--prompt')
  if (!prompt) {
    console.error('Usage: jargon deploy "Build a dialer for VP Sales"')
    process.exit(1)
  }

  const result = await deployTool(cfg, { prompt, label: opt('--label') })

  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  const open = `${appUrl()}${result.dashboardPath ?? `/tools/${result.projectId}`}`
  console.log(`Deployed ${result.project?.name ?? result.projectId}`)
  console.log(`  Queue: ${result.contactCount} contacts`)
  console.log(`  Open: ${open}`)
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
    console.log('No projects yet. Run: jargon deploy "Build a dialer"')
    return
  }
  for (const p of projects) {
    const when = new Date(p.updatedAt).toLocaleString()
    console.log(`${p.id}  ${p.name}  (${p.kind})  · ${when}`)
  }
}

async function cmdConnect() {
  const provider = args[1]
  const cfg = requireConfig()

  if (provider === 'railway') {
    const sub = args[2]
    if (sub === 'bind') {
      const projectId = opt('--project-id')
      const environmentId = opt('--environment-id')
      const serviceId = opt('--service-id')
      const table = opt('--table') || 'jargon_prospects'
      const projectName = opt('--project-name')
      const serviceName = opt('--service-name')
      if (!projectId || !environmentId) {
        console.error(
          'Usage: jargon connect railway bind --project-id ID --environment-id ID [--service-id ID] [--table jargon_prospects]'
        )
        process.exit(1)
      }
      const result = await bindRailway(cfg, {
        projectId,
        environmentId,
        serviceId,
        table,
        projectName,
        serviceName
      })
      if (flag('--json')) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      console.log('Bound Railway Postgres')
      console.log(`  ${result.connection.accountLabel ?? result.table}`)
      console.log(`  Table: ${result.table}`)
      return
    }

    if (sub === 'projects' || flag('--list')) {
      const { projects } = await listRailwayResources(cfg)
      if (flag('--json')) {
        console.log(JSON.stringify(projects, null, 2))
        return
      }
      if (!projects.length) {
        console.log('No Railway projects shared. Run: jargon connect railway')
        return
      }
      for (const p of projects) {
        console.log(`${p.projectName}  (${p.environmentName})`)
        console.log(`  project-id: ${p.projectId}`)
        console.log(`  environment-id: ${p.environmentId}`)
        for (const s of p.postgresServices) {
          console.log(`  service: ${s.serviceName}  --service-id ${s.serviceId}`)
        }
      }
      return
    }

    const { url } = await startRailwayOAuth(cfg)
    if (flag('--json')) {
      console.log(JSON.stringify({ url }, null, 2))
      return
    }
    console.log('Open this URL to authorize Railway:')
    console.log(url)
    console.log('')
    console.log('After authorizing, list projects and bind:')
    console.log('  jargon connect railway projects')
    console.log(
      '  jargon connect railway bind --project-id … --environment-id … --service-id … --table jargon_prospects'
    )
    return
  }

  if (provider !== 'postgres') {
    console.error('Usage:')
    console.error('  jargon connect railway')
    console.error('  jargon connect railway projects')
    console.error(
      '  jargon connect railway bind --project-id ID --environment-id ID [--service-id ID]'
    )
    console.error('  jargon connect postgres --database-url URL [--table jargon_prospects]')
    process.exit(1)
  }
  const databaseUrl = opt('--database-url') || opt('--url')
  const table = opt('--table') || 'jargon_prospects'
  if (!databaseUrl) {
    console.error('Usage: jargon connect postgres --database-url URL [--table jargon_prospects]')
    process.exit(1)
  }
  const result = await connectPostgres(cfg, { databaseUrl, table })
  if (flag('--json')) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  console.log(`Connected Postgres prospects`)
  console.log(`  ${result.connection.accountLabel ?? result.table}`)
  console.log(`  Rows: ${result.rowCount}`)
  console.log(`  Table: ${result.table}`)
}

async function cmdConnections() {
  const cfg = requireConfig()
  const list = await listConnections(cfg)
  if (flag('--json')) {
    console.log(JSON.stringify(list, null, 2))
    return
  }
  if (!list.length) {
    console.log('No data connections. Connect HubSpot or:')
    console.log('  jargon connect railway')
    return
  }
  for (const c of list) {
    const rows = c.meta?.rowCount ? ` · ${c.meta.rowCount} rows` : ''
    const label = c.accountLabel || c.meta?.table || ''
    console.log(`${c.provider.padEnd(10)} ${c.status.padEnd(12)} ${label}${rows}`)
  }
}

async function cmdSync() {
  const provider = args[1] || 'railway'
  if (provider !== 'postgres' && provider !== 'railway') {
    console.error('Usage: jargon sync railway|postgres [--limit 50]')
    process.exit(1)
  }
  const cfg = requireConfig()
  const limit = opt('--limit') ? Number(opt('--limit')) : undefined
  const result =
    provider === 'railway'
      ? await syncRailway(cfg, { limit })
      : await syncPostgres(cfg, { limit })
  console.log(
    `Synced ${result.count} contacts from ${result.source}${result.table ? ` (${result.table})` : ''}`
  )
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
  jargon connect railway
  jargon connect railway projects
  jargon connect railway bind --project-id ID --environment-id ID [--service-id ID] [--table jargon_prospects]
  jargon connect postgres --database-url URL [--table jargon_prospects]
  jargon connections
  jargon sync railway [--limit 50]
  jargon deploy "Build a dialer for VP Sales" [--json]
  jargon list [--json]
  jargon api-keys create --name "Claude Code"
  jargon whoami
  jargon logout

Environment:
  JARGON_API_URL   API base (default http://127.0.0.1:8787)
  JARGON_APP_URL   Website to open tools (default http://127.0.0.1:5180)
`)
}

async function main() {
  try {
    switch (command) {
      case 'login':
        await cmdLogin()
        break
      case 'connect':
        await cmdConnect()
        break
      case 'connections':
        await cmdConnections()
        break
      case 'sync':
        await cmdSync()
        break
      case 'deploy':
        await cmdDeploy()
        break
      case 'list':
      case 'ls':
        await cmdList()
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
