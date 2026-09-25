import { commitDay, toReleases } from '../landing/customerChangelog'

const REPO = 'jargonlabs-co/jargon'

interface GitHubCommit {
  commit?: {
    message?: string
    committer?: { date?: string }
  }
}

export default async function handler(
  _req: unknown,
  res: {
    setHeader: (name: string, value: string) => void
    status: (code: number) => { json: (body: unknown) => void }
  }
) {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'jargon-changelog'
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO}/commits?sha=main&per_page=40`,
      { headers }
    )
    if (!response.ok) {
      res.status(200).json([])
      return
    }
    const payload = (await response.json()) as GitHubCommit[]
    const commits = payload.map((item) => ({
      date: item.commit?.committer?.date ? commitDay(item.commit.committer.date) : '',
      subject: (item.commit?.message ?? '').split('\n')[0] ?? ''
    }))
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json(toReleases(commits))
  } catch {
    res.status(200).json([])
  }
}
