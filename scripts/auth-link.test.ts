import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  EMAIL_CONFIRMED_NOTICE,
  authRedirectError,
  loginNotice,
  normalizeAuthRedirect,
  recoveryAccessToken
} from '../landing/src/authLink.ts'

describe('auth email redirects', () => {
  it('reads a recovery access token from the hash', () => {
    assert.equal(recoveryAccessToken('#access_token=abc&type=recovery'), 'abc')
    assert.equal(recoveryAccessToken('', '?access_token=from-query'), 'from-query')
  })

  it('shows the Supabase error instead of a missing-link message', () => {
    const hash = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb='
    assert.equal(authRedirectError(hash), 'Email link is invalid or has expired')
  })

  it('does not treat a burned confirmation link as a successful verify', () => {
    const notice = loginNotice({
      search: '?verified=1',
      hash: '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb='
    })
    assert.equal(notice.info, null)
    assert.equal(notice.error, 'Email link is invalid or has expired')
    assert.equal(notice.needsConfirm, true)
  })

  it('keeps the confirmed message when the link succeeded', () => {
    const notice = loginNotice({
      search: '?verified=1',
      hash: '#access_token=abc&type=signup'
    })
    assert.equal(notice.info, EMAIL_CONFIRMED_NOTICE)
    assert.equal(notice.error, null)
  })

  it('moves a recovery redirect that landed on the site root onto the reset page', () => {
    assert.equal(
      normalizeAuthRedirect('/', '#access_token=abc&type=recovery'),
      '/reset-password#access_token=abc&type=recovery'
    )
    assert.equal(normalizeAuthRedirect('/reset-password', '#access_token=abc&type=recovery'), null)
  })

  it('moves a signup redirect that missed /login onto the sign-in page', () => {
    assert.equal(
      normalizeAuthRedirect('/', '#access_token=abc&type=signup'),
      '/login?verified=1#access_token=abc&type=signup'
    )
  })

  it('moves a Supabase error dumped on the site root onto the reset page', () => {
    const hash = '#error=access_denied&error_description=Email+link+is+invalid+or+has+expired&sb='
    assert.equal(normalizeAuthRedirect('/', hash), `/reset-password${hash}`)
    assert.equal(normalizeAuthRedirect('/login', hash), null)
  })
})
