import type { SalesTool } from '../types'

const STORAGE_KEY = 'jargon.projects.v1'

export function loadProjects(): SalesTool[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SalesTool[]
    if (!Array.isArray(parsed)) return []
    return parsed.map((tool) => ({
      ...tool,
      updatedAt: tool.updatedAt ?? tool.createdAt ?? Date.now()
    }))
  } catch {
    return []
  }
}

export function saveProjects(tools: SalesTool[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tools))
  } catch {
    // ignore quota / private mode failures
  }
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const delta = Math.max(0, now - timestamp)
  const sec = Math.floor(delta / 1000)
  if (sec < 45) return 'now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  const week = Math.floor(day / 7)
  if (week < 5) return `${week}w`
  return `${Math.floor(day / 30)}mo`
}
