import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export type JargonConfig = {
  apiUrl: string
  token: string
  email?: string
}

const CONFIG_DIR = join(homedir(), '.jargon')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')

export function loadConfig(): JargonConfig | null {
  if (!existsSync(CONFIG_PATH)) return null
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as JargonConfig
  } catch {
    return null
  }
}

export function saveConfig(config: JargonConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { mode: 0o700, recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
}

export function clearConfig(): void {
  if (existsSync(CONFIG_PATH)) writeFileSync(CONFIG_PATH, '')
}

export function defaultApiUrl(): string {
  return (
    process.env.JARGON_API_URL?.trim() ||
    process.env.JARGON_PUBLIC_URL?.trim() ||
    'http://127.0.0.1:8787'
  ).replace(/\/$/, '')
}

export function requireConfig(): JargonConfig {
  const cfg = loadConfig()
  if (!cfg?.token) {
    console.error('Not logged in. Run: jargon login --email you@co.com --password ...')
    console.error('Or:     jargon login --api-key jarg_...')
    process.exit(1)
  }
  return cfg
}
