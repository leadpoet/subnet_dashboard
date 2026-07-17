'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { MetagraphData } from '@/lib/types'

const REFRESH_INTERVAL_MS = 30_000
// A single best-head RPC miss is common enough that it should not page an
// operator. Two consecutive misses still surface a real outage within ~30s.
const CONSECUTIVE_FAILURES_BEFORE_ALERT = 2
const EPOCH_LENGTH = 360
// A validator that sets weights every epoch shows at most ~374 blocks
// between sets (pos 345 one epoch, pos 359 the next). Anything past 380
// means the previous submission window was missed. Mirrors the Discord
// weights watch running on the validator host.
const STALE_BLOCKS = 380

const WATCHED_UIDS: Array<{ uid: number; label: string }> = [
  { uid: 0, label: 'primary (Leadpoet)' },
  { uid: 202, label: 'auditor (TAO.com)' },
  { uid: 142, label: 'auditor (Yuma)' },
  { uid: 179, label: 'auditor (Rizzo)' },
  { uid: 62, label: 'auditor (Opentensor Fdn)' },
]

type MetagraphPayload = MetagraphData & { cachedAt?: number }

interface WatchRow {
  uid: number
  label: string
  lastSetEpoch: number | null
  blocksSince: number | null
  stale: boolean
  unavailable: boolean
}

function buildRows(data: MetagraphPayload | null): WatchRow[] {
  if (!data || data.currentBlock === null) return []
  const block = data.currentBlock
  return WATCHED_UIDS.map(({ uid, label }) => {
    const hotkey = data.uidToHotkey?.[uid]
    const lastUpdate = hotkey !== undefined ? data.lastUpdates?.[hotkey] : undefined
    if (lastUpdate === undefined || !Number.isFinite(lastUpdate)) {
      return {
        uid,
        label,
        lastSetEpoch: null,
        blocksSince: null,
        stale: false,
        unavailable: true,
      }
    }
    const blocksSince = block - lastUpdate
    return {
      uid,
      label,
      lastSetEpoch: Math.floor(lastUpdate / EPOCH_LENGTH),
      blocksSince,
      stale: blocksSince > STALE_BLOCKS,
      unavailable: false,
    }
  })
}

export function AdminWeightsAlerts() {
  const [data, setData] = useState<MetagraphPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [consecutiveFailures, setConsecutiveFailures] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/metagraph?t=${Date.now()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`Metagraph API returned ${response.status}`)
      const payload = (await response.json()) as MetagraphPayload
      if (payload.error) throw new Error(payload.error)
      setData(payload)
      setError(null)
      setConsecutiveFailures((count) => payload.currentBlock === null ? count + 1 : 0)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load weights watch')
      setConsecutiveFailures((count) => count + 1)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const rows = buildRows(data)
  const issues = rows.filter((row) => row.stale || row.unavailable)
  const epoch = data?.currentBlock !== null && data?.currentBlock !== undefined
    ? Math.floor(data.currentBlock / EPOCH_LENGTH)
    : null
  const currentMonitorError = error ?? (data?.currentBlock === null
    ? 'Live chain block unavailable; weight freshness cannot be verified.'
    : null)
  const monitorError = consecutiveFailures >= CONSECUTIVE_FAILURES_BEFORE_ALERT
    ? currentMonitorError
    : null

  if (monitorError) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-500/40 bg-red-500/[0.06] px-4 py-3 text-xs text-red-300/90"
      >
        <div className="flex items-center gap-1.5 font-semibold">
          <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
          Weights watch unavailable
        </div>
        <div className="mt-1">{monitorError}</div>
      </div>
    )
  }

  // This area is reserved for actionable system faults, not healthy telemetry.
  if (issues.length === 0) return null

  return (
    <div
      role="alert"
      className="rounded-xl border border-red-500/40 bg-red-500/[0.06] px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-red-300/90">
          <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
          Weights watch
          {epoch !== null && (
            <span style={{ color: 'var(--text-tertiary)' }}>· epoch {epoch}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {issues.map((row) => (
            <span
              key={row.uid}
              title={
                row.unavailable
                  ? 'No on-chain last_update for this UID'
                  : `Last set epoch ${row.lastSetEpoch}, ${row.blocksSince} blocks since last update`
              }
              className="inline-flex items-center gap-1 rounded-full border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-300"
            >
              UID {row.uid}
              <span className="text-red-300/70">
                {row.unavailable ? 'no data' : `${row.blocksSince} blk`}
              </span>
            </span>
          ))}
        </div>
      </div>
      <div className="mt-2 space-y-1 text-xs text-red-300/90">
        <div className="font-semibold">
          Weight set issue (epoch {epoch !== null ? epoch - 1 : '—'})
        </div>
        {issues.map((row) => (
          <div key={row.uid}>
            UID {row.uid} {row.label}:{' '}
            {row.unavailable
              ? 'no on-chain last_update is available'
              : `last set epoch ${row.lastSetEpoch}, ${row.blocksSince} blocks since last update`}
          </div>
        ))}
        <div style={{ color: 'var(--text-tertiary)' }}>
          Primary miss means auditors have no bundle to copy — check gateway /weights/submit
          responses and the validator log.
        </div>
      </div>
    </div>
  )
}
