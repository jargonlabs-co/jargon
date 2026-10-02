import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildGmailRawMime,
  plainTextToEmailHtml,
  restoreCopiedSpaces
} from '../src/server/providers/gmail.ts'
import { interpolateTemplate } from '../src/shared/fieldCatalog.ts'

const COPY = `Hi Tara,

Congratulations on launching Jargon this summer.
Going from GTM Engineer at Clay to founder means you know exactly how much research goes into each touch.

Worth 15 minutes next week?`

describe('restoreCopiedSpaces', () => {
  it('survives a transport that strips U+0020 from JSON', () => {
    const wired = {
      subject: 'from GTM engineer to founder'.replace(/ /g, '\u00A0'),
      body: 'Hi Tara,'.replace(/ /g, '\u00A0')
    }
    const json = JSON.stringify(wired).replace(/ /g, '')
    const parsed = JSON.parse(json) as { subject: string; body: string }
    assert.equal(restoreCopiedSpaces(parsed.subject), 'from GTM engineer to founder')
    assert.equal(restoreCopiedSpaces(parsed.body), 'Hi Tara,')
  })
})

describe('plainTextToEmailHtml', () => {
  it('keeps word spaces and turns blank lines into paragraphs', () => {
    const html = plainTextToEmailHtml(COPY)
    assert.match(html, /Hi Tara,/)
    assert.match(html, /Congratulations on launching Jargon this summer\.<br>\nGoing from GTM Engineer/)
    assert.equal((html.match(/<p /g) || []).length, 3)
    assert.doesNotMatch(html, /HiTara/)
  })

  it('escapes HTML in the body', () => {
    const html = plainTextToEmailHtml('Hi <script>alert(1)</script>')
    assert.match(html, /&lt;script&gt;/)
    assert.doesNotMatch(html, /<script>/)
  })

  it('restores NBSP before wrapping in HTML', () => {
    const html = plainTextToEmailHtml('Hi\u00A0Tara,')
    assert.match(html, /Hi Tara,/)
  })
})

describe('buildGmailRawMime', () => {
  it('sends multipart HTML+plain and preserves spaces in both parts', () => {
    const raw = buildGmailRawMime({
      to: 'tara@jargonlabs.co',
      subject: 'from GTM engineer to founder',
      body: COPY
    })
    assert.match(raw, /Content-Type: multipart\/alternative/)
    assert.match(raw, /Content-Type: text\/html/)
    assert.match(raw, /Subject: from GTM engineer to founder/)

    const chunks = raw.split('Content-Transfer-Encoding: base64')
    assert.equal(chunks.length, 3)
    const decodePart = (chunk: string) => {
      const b64 = chunk.split('--jargon_alt_001')[0].replace(/\s+/g, '')
      return Buffer.from(b64, 'base64').toString('utf8')
    }
    const plain = decodePart(chunks[1])
    const html = decodePart(chunks[2])
    assert.equal(plain.includes('Hi Tara,'), true)
    assert.equal(plain.includes('Congratulations on launching'), true)
    assert.equal(html.includes('Hi Tara,'), true)
    assert.equal(html.includes('<p '), true)
    assert.equal(plain.includes('HiTara'), false)
  })
})

describe('interpolateTemplate', () => {
  it('restores NBSP after filling merge fields', () => {
    const out = interpolateTemplate('Hi\u00A0{{first_name}},\u00A0welcome', { name: 'Tara Debek' })
    assert.equal(out, 'Hi Tara, welcome')
  })
})
