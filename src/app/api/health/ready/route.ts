import os from 'node:os'
import { NextResponse } from 'next/server'
import { fetchPublicArenaJson } from '@/lib/arena-public-proxy'
import { fetchMetagraph, getMetagraphCacheHealth } from '@/lib/metagraph'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_CACHE_AGE_MS = 10 * 60 * 1000
const DEFAULT_MAX_RSS_MB = 1_300
const DEFAULT_MIN_FREE_MEMORY_MB = 192

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export async function GET() {
  const checkedAt = new Date().toISOString()
  const rssMb = process.memoryUsage().rss / (1024 * 1024)
  const freeMemoryMb = os.freemem() / (1024 * 1024)
  const maxRssMb = positiveNumber(process.env.HEALTH_MAX_RSS_MB, DEFAULT_MAX_RSS_MB)
  const minFreeMemoryMb = positiveNumber(
    process.env.HEALTH_MIN_FREE_MEMORY_MB,
    DEFAULT_MIN_FREE_MEMORY_MB,
  )

  let arenaOk = false
  let arenaStatus: number | null = null
  let arenaDetail: string | null = null
  try {
    const result = await fetchPublicArenaJson('/arena/v1/current', 3_000)
    arenaStatus = result.status
    arenaOk = result.status >= 200 && result.status < 300
    if (!arenaOk) arenaDetail = `Arena returned HTTP ${result.status}`
  } catch (error) {
    arenaDetail = error instanceof Error ? error.message : 'Arena readiness check failed'
  }

  try {
    await fetchMetagraph()
  } catch {
    // The cache health below supplies the bounded readiness result.
  }
  const metagraph = getMetagraphCacheHealth()
  const metagraphOk = metagraph.available && (metagraph.ageMs ?? Infinity) <= MAX_CACHE_AGE_MS
  const memoryOk = rssMb <= maxRssMb && freeMemoryMb >= minFreeMemoryMb
  const ok = arenaOk && metagraphOk && memoryOk

  return NextResponse.json(
    {
      ok,
      status: ok ? 'ready' : 'degraded',
      buildVersion: process.env.BUILD_TIME ?? null,
      checks: {
        arena: { ok: arenaOk, status: arenaStatus, detail: arenaDetail },
        metagraphCache: {
          ok: metagraphOk,
          ageMs: metagraph.ageMs,
          refreshing: metagraph.refreshing,
          totalNeurons: metagraph.totalNeurons,
        },
        memory: {
          ok: memoryOk,
          rssMb: Math.round(rssMb),
          maxRssMb,
          freeMemoryMb: Math.round(freeMemoryMb),
          minFreeMemoryMb,
        },
      },
      checkedAt,
    },
    {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
