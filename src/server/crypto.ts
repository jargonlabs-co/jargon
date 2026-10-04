import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from 'crypto'

export const DEV_ENCRYPTION_KEY = 'jargon-dev-encryption-key-change-me'

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest()
}

function keyBytes(): Buffer {
  return deriveKey(process.env.JARGON_ENCRYPTION_KEY?.trim() || DEV_ENCRYPTION_KEY)
}

/** Old keys still accepted for decrypt while rotating (comma-separated). */
function previousKeyBytes(): Buffer[] {
  return (process.env.JARGON_ENCRYPTION_KEY_PREVIOUS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(deriveKey)
}

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyBytes(), iv)
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`
}

export function decryptJson<T>(cipherText: string): T {
  const [ivB64, tagB64, dataB64] = cipherText.split('.')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid cipher text')
  let lastError: unknown
  for (const key of [keyBytes(), ...previousKeyBytes()]) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'))
      decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(dataB64, 'base64url')),
        decipher.final()
      ])
      return JSON.parse(decrypted.toString('utf8')) as T
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

function tokenMac(key: Buffer, purpose: string, body: string): string {
  return createHmac('sha256', key).update(`${purpose}.${body}`).digest('base64url')
}

/** Tamper-proof, non-expiring token (e.g. unsubscribe links). Not encrypted: don't put secrets in it. */
export function signToken(purpose: string, payload: unknown): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${tokenMac(keyBytes(), purpose, body)}`
}

export function verifyToken<T>(purpose: string, token: string): T | null {
  const [body, mac] = token.split('.')
  if (!body || !mac) return null
  const valid = [keyBytes(), ...previousKeyBytes()].some((key) =>
    safeEqual(mac, tokenMac(key, purpose, body))
  )
  if (!valid) return null
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T
  } catch {
    return null
  }
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** `Authorization: Bearer <JARGON_ADMIN_TOKEN>`; always false when the token is unset. */
export function adminTokenMatches(header: string | undefined): boolean {
  const expected = process.env.JARGON_ADMIN_TOKEN?.trim()
  if (!expected || !header?.startsWith('Bearer ')) return false
  return safeEqual(header.slice(7).trim(), expected)
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}
