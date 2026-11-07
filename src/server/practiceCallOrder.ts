import type { DeployContactInput } from './deployContacts'
import type { DataStore } from './store'
import { ATTR_CALL_WINDOW, type CallWindow } from '../shared/callWindow'
import {
  practiceByCompany,
  practiceContext,
  VETERINARY_PRACTICES,
  type VeterinaryPractice
} from '../shared/veterinaryPractices'
import { ATTR_TALK_TRACK, ATTR_TALK_TRACKS } from './workspaceTasks'

export function veterinaryDeployContacts(): DeployContactInput[] {
  return VETERINARY_PRACTICES.map((practice) => ({
    name: practice.name,
    company: practice.company,
    title: practice.title,
    email: practice.email,
    phone: practice.phone,
    city: practice.city,
    companyIndustry: 'Veterinary',
    context: practiceContext(practice),
    attrs: {
      hs_timezone: practice.timezone,
      timezone: practice.timezone,
      google_hours: practice.hours
    }
  }))
}

/** Write each practice's call window and talk track, and fill the follow-up email. */
export function finishPracticeCallOrder(store: DataStore, orgId: string, projectId: string): void {
  store.update((db) => {
    const now = Date.now()
    const sequence = db.sequences.find((row) => row.projectId === projectId && row.orgId === orgId)
    const callSteps = sequence
      ? db.steps
          .filter((step) => step.sequenceId === sequence.id && step.channel === 'call')
          .sort((a, b) => a.day - b.day || a.order - b.order)
      : []
    for (const row of db.contacts) {
      if (row.orgId !== orgId || row.projectId !== projectId) continue
      const practice = practiceByCompany(row.company)
      if (!practice) continue
      const window = windowFor(practice)
      const first = row.name.trim().split(/\s+/)[0] || row.name
      const intro = `Hi ${first} — calling for ${practice.company}. ${practice.reason} Who handles new patient referrals?`
      const followUp = `Hi ${first} — following up with ${practice.company}. ${practice.reason} Is there a better person for new patient referrals?`
      const tracks: Record<string, string> = {}
      if (callSteps[0]) tracks[callSteps[0].id] = intro
      if (callSteps[1]) tracks[callSteps[1].id] = followUp
      row.companyIndustry = row.companyIndustry || 'Veterinary'
      row.context = practiceContext(practice)
      row.attrs = {
        ...(row.attrs ?? {}),
        hs_timezone: practice.timezone,
        timezone: practice.timezone,
        google_hours: practice.hours,
        [ATTR_CALL_WINDOW]: window,
        [ATTR_TALK_TRACK]: intro,
        ...(Object.keys(tracks).length ? { [ATTR_TALK_TRACKS]: tracks } : {})
      }
      row.enrichedAt = now
      row.updatedAt = now
    }
    for (const message of db.messages) {
      if (message.orgId !== orgId || message.projectId !== projectId || message.channel !== 'email') continue
      if (message.status === 'sent' || message.status === 'cancelled') continue
      const contact = db.contacts.find((row) => row.id === message.contactId)
      const practice = contact ? practiceByCompany(contact.company) : undefined
      if (!contact || !practice) continue
      const first = contact.name.trim().split(/\s+/)[0] || contact.name
      message.subject = `A better time to reach ${practice.company}`
      message.body = `Hi ${first},\n\nI called for ${practice.company}. ${practice.reason}\n\nHappy to try again when the front desk is free.\n`
      message.updatedAt = now
    }
  })
}

function windowFor(practice: VeterinaryPractice): CallWindow {
  return {
    startLocal: practice.startLocal,
    endLocal: practice.endLocal,
    timezone: practice.timezone,
    clock: 'account',
    businessType: 'Veterinary',
    reason: practice.reason,
    inferred: false
  }
}
