import express from 'express'
import cors from 'cors'
import type { Server } from 'http'
import { JsonStore } from './store'
import { seedProject } from './seed'
import { analyticsFor, bundleProject } from './queries'
import type { ContactStatus, ProjectKind } from './types'

function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export function createApi(store: JsonStore) {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '2mb' }))

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.get('/projects', (_req, res) => {
    const projects = [...store.db.projects].sort((a, b) => b.updatedAt - a.updatedAt)
    res.json(projects)
  })

  app.post('/projects', (req, res) => {
    const { prompt, kind, answers } = req.body as {
      prompt?: string
      kind?: ProjectKind
      answers?: Record<string, string>
    }
    if (!prompt || !kind) {
      res.status(400).json({ error: 'prompt and kind required' })
      return
    }
    let projectId = ''
    store.update((db) => {
      const project = seedProject(db, {
        prompt,
        kind,
        answers: answers ?? {}
      })
      projectId = project.id
    })
    const bundle = bundleProject(store.db, projectId)
    res.status(201).json(bundle)
  })

  app.get('/projects/:id', (req, res) => {
    const bundle = bundleProject(store.db, req.params.id)
    if (!bundle) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    // bump updatedAt on open
    store.update((db) => {
      const p = db.projects.find((x) => x.id === req.params.id)
      if (p) p.updatedAt = Date.now()
    })
    res.json(bundleProject(store.db, req.params.id))
  })

  app.delete('/projects/:id', (req, res) => {
    const id = req.params.id
    store.update((db) => {
      db.projects = db.projects.filter((p) => p.id !== id)
      db.campaigns = db.campaigns.filter((c) => c.projectId !== id)
      db.sequences = db.sequences.filter((s) => s.projectId !== id)
      db.steps = db.steps.filter((s) => s.projectId !== id)
      db.contacts = db.contacts.filter((c) => c.projectId !== id)
      db.calls = db.calls.filter((c) => c.projectId !== id)
      db.messages = db.messages.filter((m) => m.projectId !== id)
      db.activities = db.activities.filter((a) => a.projectId !== id)
    })
    res.status(204).end()
  })

  app.get('/projects/:id/analytics', (req, res) => {
    res.json(analyticsFor(store.db, req.params.id))
  })

  app.get('/projects/:id/activities', (req, res) => {
    const items = store.db.activities
      .filter((a) => a.projectId === req.params.id)
      .sort((a, b) => b.createdAt - a.createdAt)
    res.json(items)
  })

  app.post('/campaigns/:id/pause', (req, res) => {
    const campaign = mutateCampaign(store, req.params.id, 'PAUSED')
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' })
      return
    }
    res.json(campaign)
  })

  app.post('/campaigns/:id/run', (req, res) => {
    const campaign = mutateCampaign(store, req.params.id, 'ACTIVE')
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' })
      return
    }
    res.json(campaign)
  })

  app.patch('/contacts/:id', (req, res) => {
    let contact = store.db.contacts.find((c) => c.id === req.params.id)
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }
    store.update((db) => {
      const c = db.contacts.find((x) => x.id === req.params.id)
      if (!c) return
      Object.assign(c, req.body, { updatedAt: Date.now() })
      contact = c
      const project = db.projects.find((p) => p.id === c.projectId)
      if (project) project.updatedAt = Date.now()
    })
    res.json(contact)
  })

  app.post('/contacts/:id/calls', (req, res) => {
    const contact = store.db.contacts.find((c) => c.id === req.params.id)
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }
    const now = Date.now()
    const callId = uid('call')
    store.update((db) => {
      db.contacts.forEach((c) => {
        if (c.projectId !== contact.projectId) return
        if (c.id === contact.id) {
          c.status = 'active'
          c.updatedAt = now
        } else if (c.status === 'active') {
          c.status = 'queued'
          c.updatedAt = now
        }
      })
      db.calls.unshift({
        id: callId,
        projectId: contact.projectId,
        contactId: contact.id,
        phase: 'dialing',
        startedAt: now
      })
      db.activities.unshift({
        id: uid('act'),
        projectId: contact.projectId,
        contactId: contact.id,
        kind: 'call',
        summary: `Dialing ${contact.name}`,
        createdAt: now
      })
      const project = db.projects.find((p) => p.id === contact.projectId)
      if (project) project.updatedAt = now
    })

    // simulate connect
    setTimeout(() => {
      store.update((db) => {
        const call = db.calls.find((c) => c.id === callId)
        if (!call || call.phase !== 'dialing') return
        call.phase = 'connected'
        call.connectedAt = Date.now()
        db.activities.unshift({
          id: uid('act'),
          projectId: call.projectId,
          contactId: call.contactId,
          kind: 'call',
          summary: `Connected with ${contact.name}`,
          createdAt: Date.now()
        })
      })
    }, 1100)

    res.status(201).json(store.db.calls.find((c) => c.id === callId))
  })

  app.post('/calls/:id/complete', (req, res) => {
    const { disposition } = req.body as { disposition?: ContactStatus }
    if (!disposition) {
      res.status(400).json({ error: 'disposition required' })
      return
    }
    const call = store.db.calls.find((c) => c.id === req.params.id)
    if (!call) {
      res.status(404).json({ error: 'Call not found' })
      return
    }
    const now = Date.now()
    store.update((db) => {
      const c = db.calls.find((x) => x.id === req.params.id)
      if (!c) return
      c.phase = 'completed'
      c.disposition = disposition
      c.endedAt = now
      const contact = db.contacts.find((x) => x.id === c.contactId)
      if (contact) {
        contact.status = disposition
        contact.updatedAt = now
        if (disposition === 'interested' || disposition === 'completed' || disposition === 'replied') {
          contact.stepIndex = Math.min(contact.stepIndex + 1, 99)
        }
      }
      const campaign = db.campaigns.find(
        (camp) => camp.projectId === c.projectId && camp.state === 'ACTIVE'
      )
      if (campaign) {
        campaign.done = Math.min(campaign.total, campaign.done + 1)
        campaign.updatedAt = now
        const completed = db.calls.filter(
          (x) => x.projectId === c.projectId && x.phase === 'completed'
        )
        const answered = completed.filter(
          (x) => x.disposition && x.disposition !== 'no_answer'
        ).length
        campaign.answerRatio = completed.length ? (answered / completed.length) * 100 : 0
      }
      // activate next queued
      const next = db.contacts.find(
        (x) => x.projectId === c.projectId && x.status === 'queued' && x.id !== c.contactId
      )
      if (next) {
        next.status = 'active'
        next.updatedAt = now
      }
      db.activities.unshift({
        id: uid('act'),
        projectId: c.projectId,
        contactId: c.contactId,
        kind: 'call',
        summary: `Call completed · ${disposition.replace('_', ' ')}`,
        createdAt: now
      })
      const project = db.projects.find((p) => p.id === c.projectId)
      if (project) project.updatedAt = now
    })
    res.json({
      call: store.db.calls.find((c) => c.id === req.params.id),
      bundle: bundleProject(store.db, call.projectId)
    })
  })

  app.post('/contacts/:id/messages', (req, res) => {
    const contact = store.db.contacts.find((c) => c.id === req.params.id)
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }
    const { subject, body, status, channel } = req.body as {
      subject?: string
      body?: string
      status?: 'draft' | 'queued' | 'sent'
      channel?: 'email' | 'linkedin'
    }
    const now = Date.now()
    const messageId = uid('msg')
    const finalStatus = status ?? 'draft'
    store.update((db) => {
      db.messages.unshift({
        id: messageId,
        projectId: contact.projectId,
        contactId: contact.id,
        subject: subject ?? '(no subject)',
        body: body ?? '',
        status: finalStatus,
        channel: channel ?? 'email',
        createdAt: now,
        updatedAt: now,
        sentAt: finalStatus === 'sent' ? now : undefined
      })
      const c = db.contacts.find((x) => x.id === contact.id)
      if (c && finalStatus === 'sent') {
        c.status = c.status === 'queued' ? 'active' : c.status
        c.stepIndex = c.stepIndex + 1
        c.updatedAt = now
      }
      db.activities.unshift({
        id: uid('act'),
        projectId: contact.projectId,
        contactId: contact.id,
        kind: finalStatus === 'sent' ? 'email' : channel === 'linkedin' ? 'linkedin' : 'draft',
        summary:
          finalStatus === 'sent'
            ? `Sent email to ${contact.name}`
            : `Saved ${channel ?? 'email'} draft for ${contact.name}`,
        createdAt: now
      })
      const project = db.projects.find((p) => p.id === contact.projectId)
      if (project) project.updatedAt = now
    })
    res.status(201).json({
      message: store.db.messages.find((m) => m.id === messageId),
      bundle: bundleProject(store.db, contact.projectId)
    })
  })

  app.post('/contacts/:id/notes', (req, res) => {
    const { note } = req.body as { note?: string }
    if (!note?.trim()) {
      res.status(400).json({ error: 'note required' })
      return
    }
    const contact = store.db.contacts.find((c) => c.id === req.params.id)
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }
    const now = Date.now()
    store.update((db) => {
      const c = db.contacts.find((x) => x.id === req.params.id)
      if (!c) return
      const stamped = `${new Date(now).toLocaleString()}: ${note.trim()}`
      c.notes = c.notes ? `${c.notes}\n${stamped}` : stamped
      c.updatedAt = now
      db.activities.unshift({
        id: uid('act'),
        projectId: c.projectId,
        contactId: c.id,
        kind: 'note',
        summary: note.trim(),
        createdAt: now
      })
    })
    res.json(store.db.contacts.find((c) => c.id === req.params.id))
  })

  app.get('/calls/:id', (req, res) => {
    const call = store.db.calls.find((c) => c.id === req.params.id)
    if (!call) {
      res.status(404).json({ error: 'Call not found' })
      return
    }
    res.json(call)
  })

  return app
}

function mutateCampaign(store: JsonStore, id: string, state: 'ACTIVE' | 'PAUSED') {
  let campaign = store.db.campaigns.find((c) => c.id === id)
  if (!campaign) return null
  store.update((db) => {
    const c = db.campaigns.find((x) => x.id === id)
    if (!c) return
    c.state = state
    c.updatedAt = Date.now()
    db.activities.unshift({
      id: uid('act'),
      projectId: c.projectId,
      kind: 'campaign',
      summary: `${c.name} marked ${state}`,
      createdAt: Date.now()
    })
    campaign = c
  })
  return campaign
}

export async function startApiServer(
  store: JsonStore,
  preferredPort = 8787
): Promise<{ server: Server; port: number }> {
  const app = createApi(store)

  async function listen(port: number): Promise<{ server: Server; port: number }> {
    return await new Promise((resolve, reject) => {
      const server = app.listen(port, '127.0.0.1', () => resolve({ server, port }))
      server.on('error', reject)
    })
  }

  try {
    return await listen(preferredPort)
  } catch {
    return await listen(0)
  }
}
