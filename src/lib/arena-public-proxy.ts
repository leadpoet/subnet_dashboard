import { NextResponse } from 'next/server'

const ARENA_GATEWAY_URL = (
  process.env.LEADPOET_GATEWAY_URL?.trim()
  || 'https://gateway.subnet71.com'
).replace(/\/+$/, '')

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' } as const
const PUBLIC_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/

export function publicArenaId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return PUBLIC_ID.test(normalized) ? normalized : null
}

export async function fetchPublicArenaJson(
  path: string,
  timeoutMs = 8_000,
): Promise<{ body: unknown; status: number }> {
  const response = await fetch(`${ARENA_GATEWAY_URL}${path}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = await response.json().catch(() => null)
  if (body === null) throw new Error('Arena returned an invalid response.')
  return { body, status: response.status }
}

export async function proxyPublicArenaJson(path: string): Promise<NextResponse> {
  try {
    const { body, status } = await fetchPublicArenaJson(path)
    return NextResponse.json(body, { status, headers: NO_STORE_HEADERS })
  } catch {
    return NextResponse.json({ error: 'Arena is temporarily unavailable.' }, { status: 502, headers: NO_STORE_HEADERS })
  }
}

export function invalidPublicArenaId(label: 'round' | 'submission'): NextResponse {
  return NextResponse.json({ error: `Invalid ${label} identifier.` }, { status: 400, headers: NO_STORE_HEADERS })
}
