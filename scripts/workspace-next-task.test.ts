import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import vm from 'node:vm'
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
  it('keeps the soonest open task of each channel for each contact', () => {
    const tasks = [
      task({ id: 'keith-email', contactId: 'keith', dueAt: 20, stepOrder: 0, channel: 'email' }),
      task({ id: 'keith-email-2', contactId: 'keith', dueAt: 40, stepOrder: 3, channel: 'email' }),
      task({ id: 'keith-call', contactId: 'keith', dueAt: 22, stepOrder: 1, channel: 'call' }),
      task({ id: 'keith-li', contactId: 'keith', dueAt: 25, stepOrder: 2, channel: 'linkedin' }),
      task({ id: 'priya-call', contactId: 'priya', dueAt: 18, stepOrder: 1, channel: 'call' }),
      task({ id: 'priya-email', contactId: 'priya', dueAt: 10, stepOrder: 0, channel: 'email', state: 'done', bucket: 'done' })
    ]
    const next = nextOpenTasksByContact(tasks)
    assert.deepEqual(next.map((t) => t.id).sort(), ['keith-call', 'keith-email', 'keith-li', 'priya-call'])
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

describe('to-do list advances after a task is finished', () => {
  const html = readFileSync(new URL('../src/server/apps/emailWorkspace.html', import.meta.url), 'utf8')
  const start = html.indexOf('function nextTodoId')
  const end = html.indexOf('(async () => {')
  const ctx: { nextTodoId: Function; orderAfterFinish: Function } = {
    nextTodoId: () => null,
    orderAfterFinish: () => []
  }
  vm.runInNewContext(`${html.slice(start, end)}\nthis.nextTodoId = nextTodoId;\nthis.orderAfterFinish = orderAfterFinish;`, ctx)

  it('checks off the finished row and opens the following one', () => {
    const ordered = ctx.orderAfterFinish(['keith-email', 'priya-call', 'sam-email'], 'keith-email', ['priya-call', 'sam-email'], ['keith-email', 'priya-call', 'sam-email'])
    assert.deepEqual(ordered, ['keith-email', 'priya-call', 'sam-email'])
    assert.equal(ctx.nextTodoId(ordered, 'keith-email', ['priya-call', 'sam-email']), 'priya-call')
  })

  it('inserts the same contact’s next step directly after the one just finished', () => {
    const ordered = ctx.orderAfterFinish(
      ['keith-email', 'priya-call'],
      'keith-email',
      ['keith-call', 'priya-call'],
      ['keith-email', 'priya-call']
    )
    assert.deepEqual(ordered, ['keith-email', 'keith-call', 'priya-call'])
    assert.equal(ctx.nextTodoId(ordered, 'keith-email', ['keith-call', 'priya-call']), 'keith-call')
  })

  it('does not jump backward when the finished task was last', () => {
    const ordered = ctx.orderAfterFinish(['priya-call', 'keith-email'], 'keith-email', ['priya-call'], ['priya-call', 'keith-email'])
    assert.equal(ctx.nextTodoId(ordered, 'keith-email', ['priya-call']), null)
  })

  it('leaves tasks hidden by a channel filter where they were', () => {
    const ordered = ctx.orderAfterFinish(
      ['ada-email', 'bea-email'],
      'ada-email',
      ['ada-call', 'bea-email'],
      ['ada-email', 'ada-call', 'bea-email']
    )
    assert.deepEqual(ordered, ['ada-email', 'bea-email'])
    assert.equal(ctx.nextTodoId(ordered, 'ada-email', ['ada-call', 'bea-email']), 'bea-email')
  })

  it('wires send, call, LinkedIn, and skip to check off and advance', () => {
    for (const name of ['async function sendNow', 'async function skipCurrentTask', 'async function logCallOutcome', 'async function sendLinkedIn']) {
      const from = html.indexOf(name)
      const body = html.slice(from, html.indexOf('async function ', from + name.length))
      assert.match(body, /finishAndAdvance\(/)
      assert.match(body, /reload\(\{ silent: true \}\)/)
    }
    assert.match(html, /\.todo\.done \.box/)
    assert.match(html, /\.todo\.done \.title[\s\S]*text-decoration: line-through/)
    assert.match(html, /class="todo \$\{done \? 'done' : ''\}/)
    assert.match(html, /Just completed/)
    assert.match(html, /justCompletedId = snapshot\.finishedId/)
    assert.match(html, /\$\{task\.contactId\}:\$\{task\.channel\}/)
  })
})
