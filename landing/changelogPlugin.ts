import { execFileSync } from 'node:child_process'
import type { Connect, Plugin } from 'vite'
import type { ServerResponse } from 'node:http'
import { toReleases, type ChangelogRelease } from './customerChangelog'

const VIRTUAL_ID = 'virtual:changelog'
const RESOLVED_ID = '\0' + VIRTUAL_ID

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
}

export function releasesFromGit(repoRoot: string): ChangelogRelease[] {
  if (process.env.VERCEL === '1') {
    try {
      git(repoRoot, ['fetch', '--deepen=80'])
    } catch {
      // A shallow clone may not allow a deeper fetch.
    }
  }

  let raw = ''
  try {
    raw = git(repoRoot, ['log', '-n', '40', '--date=short', '--pretty=format:%ad%x09%s'])
  } catch {
    return []
  }

  const commits = raw
    .split('\n')
    .map((line) => {
      const [date, subject] = line.split('\t')
      return { date: date ?? '', subject: subject ?? '' }
    })
    .filter((commit) => commit.date && commit.subject)

  return toReleases(commits)
}

function sendReleases(repoRoot: string, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(releasesFromGit(repoRoot)))
}

function attachChangelog(repoRoot: string, middlewares: Connect.Server) {
  middlewares.use('/api/changelog', (_req, res) => {
    sendReleases(repoRoot, res as ServerResponse)
  })
}

export function changelogPlugin(repoRoot: string): Plugin {
  return {
    name: 'jargon-changelog',
    resolveId(source) {
      if (source === VIRTUAL_ID) return RESOLVED_ID
    },
    load(id) {
      if (id !== RESOLVED_ID) return
      return `export default ${JSON.stringify(releasesFromGit(repoRoot))}`
    },
    configureServer(server) {
      attachChangelog(repoRoot, server.middlewares)
    },
    configurePreviewServer(server) {
      attachChangelog(repoRoot, server.middlewares)
    }
  }
}
