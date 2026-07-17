import { getRuntimeSecretValue } from './runtime-secret-environment'

const ADMIN_SESSION_VERSION = 1

export const ADMIN_SESSION_COOKIE = 'leadpoet_admin_session'
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

type AdminSessionPayload = {
  v: number
  sub: string
  iat: number
  exp: number
}

function configuredCredentials(): { username: string; password: string } | null {
  const username = getRuntimeSecretValue('ADMIN_USER')
  const password = getRuntimeSecretValue('ADMIN_PASS')
  if (!username || !password) return null
  return { username, password }
}

function sessionSecret(): string | null {
  const credentials = configuredCredentials()
  if (!credentials) return null

  // A separate secret is recommended, but falling back to the existing long
  // admin password keeps deployments backwards-compatible. Rotating either
  // value invalidates every active admin session.
  return getRuntimeSecretValue('ADMIN_SESSION_SECRET') || credentials.password
}

export function isAdminAuthConfigured(): boolean {
  return configuredCredentials() !== null
}

function safeEquals(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)
  const len = Math.max(aBytes.length, bBytes.length, 1)
  let diff = aBytes.length ^ bBytes.length

  for (let i = 0; i < len; i++) {
    const x = i < aBytes.length ? aBytes[i] : 0
    const y = i < bBytes.length ? bBytes[i] : 0
    diff |= x ^ y
  }

  return diff === 0
}

export function verifyAdminCredentials(username: string, password: string): boolean {
  const expected = configuredCredentials()
  if (!expected) return false

  // Evaluate both comparisons so a username mismatch does not skip the
  // password comparison and create an avoidable timing signal.
  const usernameMatches = safeEquals(username, expected.username)
  const passwordMatches = safeEquals(password, expected.password)
  return usernameMatches && passwordMatches
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function createAdminSessionToken(
  username: string,
  now = Date.now(),
): Promise<string | null> {
  const expected = configuredCredentials()
  const secret = sessionSecret()
  if (!expected || !secret || !safeEquals(username, expected.username)) return null

  const issuedAt = Math.floor(now / 1000)
  const payload: AdminSessionPayload = {
    v: ADMIN_SESSION_VERSION,
    sub: expected.username,
    iat: issuedAt,
    exp: issuedAt + ADMIN_SESSION_MAX_AGE_SECONDS,
  }
  const encodedPayload = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    new TextEncoder().encode(encodedPayload),
  )

  return `${encodedPayload}.${bytesToBase64Url(new Uint8Array(signature))}`
}

export async function verifyAdminSessionToken(
  token: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!token) return false

  const expected = configuredCredentials()
  const secret = sessionSecret()
  if (!expected || !secret) return false

  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [encodedPayload, encodedSignature] = parts
  const signature = base64UrlToBytes(encodedSignature)
  const payloadBytes = base64UrlToBytes(encodedPayload)
  if (!signature || !payloadBytes) return false

  const signatureMatches = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    signature,
    new TextEncoder().encode(encodedPayload),
  )
  if (!signatureMatches) return false

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(payloadBytes),
    ) as Partial<AdminSessionPayload>
    const nowSeconds = Math.floor(now / 1000)

    return (
      payload.v === ADMIN_SESSION_VERSION &&
      typeof payload.sub === 'string' &&
      safeEquals(payload.sub, expected.username) &&
      typeof payload.iat === 'number' &&
      Number.isInteger(payload.iat) &&
      payload.iat <= nowSeconds + 60 &&
      typeof payload.exp === 'number' &&
      Number.isInteger(payload.exp) &&
      payload.exp > nowSeconds &&
      payload.exp - payload.iat === ADMIN_SESSION_MAX_AGE_SECONDS
    )
  } catch {
    return false
  }
}

export function safeAdminRedirectPath(value: FormDataEntryValue | string | null): string {
  if (typeof value !== 'string') return '/admin'
  if (!value.startsWith('/') || value.startsWith('//')) return '/admin'

  try {
    const url = new URL(value, 'https://admin.local')
    const isAdminPath = url.pathname === '/admin' || url.pathname.startsWith('/admin/')
    const isLoginPath = url.pathname === '/admin/login' || url.pathname.startsWith('/admin/login/')
    if (url.origin !== 'https://admin.local' || !isAdminPath || isLoginPath) return '/admin'
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/admin'
  }
}
