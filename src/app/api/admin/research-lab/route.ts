import { NextResponse } from 'next/server'
import {
  normalizeResearchLabArenaSnapshot,
  type ResearchLabArenaSnapshot,
} from '@/lib/research-lab-arena'
import {
  fetchGatewayDeployment,
  type GatewayDeployment,
} from '@/lib/gateway-deployment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GATEWAY_URL = (
  process.env.LEADPOET_GATEWAY_URL?.trim() || 'https://gateway.subnet71.com'
).replace(/\/+$/, '')

export type AdminResearchLabPayload = {
  arena: ResearchLabArenaSnapshot
  gateway: GatewayDeployment
  fetchedAt: string
}

export async function GET(): Promise<NextResponse> {
  try {
    const [arena, gateway] = await Promise.all([
      fetchArena(),
      fetchGatewayDeployment({ gatewayUrl: GATEWAY_URL }),
    ])
    return NextResponse.json(
      { arena, gateway, fetchedAt: new Date().toISOString() } satisfies AdminResearchLabPayload,
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch Arena status' },
      { status: 502, headers: { 'Cache-Control': 'private, no-store' } },
    )
  }
}

async function fetchArena(): Promise<ResearchLabArenaSnapshot> {
  const current = await fetchJson(`${GATEWAY_URL}/arena/v1/current`)
  const root = record(current)
  if (!root) throw new Error('Arena current response did not match the expected contract')
  const running = Array.isArray(root.running_rounds)
    ? root.running_rounds.map(record).filter((row): row is Record<string, unknown> => Boolean(row))
    : []
  const active = running.at(-1) ?? record(root.round)
  const published = record(root.published_round)
  const activeId = stringOr(active?.round_id)
  const publishedId = stringOr(published?.round_id)
  const ids = [...new Set([activeId, publishedId].filter((id): id is string => Boolean(id)))]
  const rounds = await Promise.all(ids.map(async (id) => {
    try {
      return [id, await fetchJson(`${GATEWAY_URL}/arena/v1/rounds/${encodeURIComponent(id)}`)] as const
    } catch {
      return null
    }
  }))
  const byId = new Map(rounds.filter((entry): entry is readonly [string, unknown] => Boolean(entry)))
  return normalizeResearchLabArenaSnapshot(
    current,
    activeId ? byId.get(activeId) ?? active : null,
    publishedId ? byId.get(publishedId) : null,
  )
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) throw new Error(`Arena request failed (${response.status})`)
  return response.json()
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringOr(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
