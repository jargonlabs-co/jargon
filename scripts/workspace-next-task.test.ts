import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { annotateOpenCallNotes, nextOpenTasksByContact, type WorkspaceTask } from '../src/server/workspaceTasks.ts'

function task(partial: Partial<WorkspaceTask> & Pick<WorkspaceTask, 'id' | 'contactId' | 'dueAt'>): WorkspaceTask {
  return {
    contactName: partial.contactId,
    contactMeta: '',
    stepId: partial.id,
    stepLabel: 'Email',
    stepOrder: 0,
    day: 0,
    channel: 'email',
    state: 'due',
    bucket: 'today',
    owner: 'user',
    ...partial
  }
}

describe('nextOpenTasksByContact', () => {
  it('keeps one soonest open task per contact', () => {
    const tasks = [
      task({ id: 'keith-email', contactId: 'keith', dueAt: 20, stepOrder: 0, channel: 'email' }),
      task({ id: 'keith-call', contactId: 'keith', dueAt: 22, stepOrder: 1, channel: 'call' }),
      task({ id: 'keith-li', contactId: 'keith', dueAt: 25, stepOrder: 2, channel: 'linkedin' }),
      task({ id: 'priya-call', contactId: 'priya', dueAt: 18, stepOrder: 1, channel: 'call' }),
      task({ id: 'priya-email', contactId: 'priya', dueAt: 10, stepOrder: 0, channel: 'email', state: 'done', bucket: 'done' })
    ]
    const next = nextOpenTasksByContact(tasks)
    assert.deepEqual(next.map((t) => t.id).sort(), ['keith-email', 'priya-call'])
  })

  it('ignores auto and skipped steps', () => {
    const tasks = [
      task({ id: 'auto', contactId: 'a', dueAt: 1, owner: 'auto' }),
      task({ id: 'skip', contactId: 'a', dueAt: 2, state: 'skipped', bucket: 'skipped' }),
      task({ id: 'open', contactId: 'a', dueAt: 9, stepOrder: 2 })
    ]
    assert.equal(nextOpenTasksByContact(tasks)[0]?.id, 'open')
  })
})

describe('annotateOpenCallNotes', () => {
  it('keeps the phone on a due call and adds the do-not-call note', () => {
    const tasks = [
      task({
        id: 'call',
        contactId: 'ada',
        dueAt: 1,
        channel: 'call',
        target: '+14155550100',
        stepLabel: 'Call'
      })
    ]
    const next = annotateOpenCallNotes(tasks, new Map([['ada', 'Number is on the do-not-call list']]))
    assert.equal(next[0]?.state, 'due')
    assert.equal(next[0]?.target, '+14155550100')
    assert.equal(next[0]?.reason, 'Number is on the do-not-call list')
  })
})
