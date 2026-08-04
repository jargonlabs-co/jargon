import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Database } from './types'

const EMPTY: Database = {
  projects: [],
  campaigns: [],
  sequences: [],
  steps: [],
  contacts: [],
  calls: [],
  messages: [],
  activities: []
}

export class JsonStore {
  private filePath: string
  private data: Database

  constructor(filePath: string) {
    this.filePath = filePath
    this.data = this.load()
  }

  get db(): Database {
    return this.data
  }

  private load(): Database {
    try {
      if (!existsSync(this.filePath)) {
        mkdirSync(dirname(this.filePath), { recursive: true })
        this.persist(EMPTY)
        return structuredClone(EMPTY)
      }
      const raw = readFileSync(this.filePath, 'utf8')
      return { ...structuredClone(EMPTY), ...JSON.parse(raw) } as Database
    } catch {
      return structuredClone(EMPTY)
    }
  }

  persist(next?: Database): void {
    if (next) this.data = next
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8')
  }

  update(mutator: (db: Database) => void): Database {
    mutator(this.data)
    this.persist()
    return this.data
  }
}

export function defaultDbPath(userDataPath: string): string {
  return join(userDataPath, 'jargon-db.json')
}
