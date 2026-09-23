'use client'

import { useCallback, useState } from 'react'
import { useVisiblePolling } from '@/lib/hooks/useVisiblePolling'
import type { AdminResearchLabPayload } from '@/app/api/admin/research-lab/route'
export type { AdminResearchLabPayload } from '@/app/api/admin/research-lab/route'

export function AdminResearchLab({
  payload: initialPayload = null,
  error: initialError = null,
}: {
  payload?: AdminResearchLabPayload | null
  error?: string | null
} = {}) {
  const [payload, setPayload] = useState<AdminResearchLabPayload | null>(initialPayload)
  const [error, setError] = useState(initialError)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/research-lab?t=${Date.now()}`, { cache: 'no-store' })
      const body = await response.json() as AdminResearchLabPayload & { error?: string }
      if (!response.ok) throw new Error(body.error || `Arena status API returned ${response.status}`)
      setPayload(body)
      setError(null)
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Failed to load Arena status')
    }
  }, [])

  useVisiblePolling(refresh, 30_000)

  if (error && !payload) {
    return <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-200">{error}</div>
  }
  if (!payload) {
    return <div className="rounded-xl border border-white/[0.08] p-4 text-sm text-white/50">Loading Arena status…</div>
  }

  const { arena, gateway } = payload
  return (
    <div className="space-y-5">
      {error ? <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-100">{error}</div> : null}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatusCard
          title="Arena round"
          value={arena.activeRound?.status ?? 'Unavailable'}
          detail={arena.activeRound ? `Round ${arena.activeRound.roundId}` : 'The gateway did not return an active round.'}
        />
        <StatusCard
          title="Public baseline"
          value={arena.publishedBaseline ? arena.publishedBaseline.score.toFixed(2) : 'Unavailable'}
          detail={arena.publishedBaseline ? `Published round ${arena.publishedBaseline.roundId}; rank ${arena.publishedBaseline.rank ?? '—'}.` : 'No published baseline result is available.'}
        />
        <StatusCard
          title="Current king"
          value={arena.publishedWinner ? arena.publishedWinner.score.toFixed(2) : 'Unavailable'}
          detail={arena.publishedWinner ? `${arena.publishedWinner.submissionId}; rank ${arena.publishedWinner.rank ?? '—'}.` : 'No published competition winner is available.'}
        />
        <StatusCard
          title="Gateway release"
          value={gateway.commitSha?.slice(0, 12) ?? 'Unavailable'}
          detail={gateway.sourceAvailable ? `Branch ${gateway.branch ?? 'unknown'} · checked ${gateway.checkedAt}` : gateway.unavailableReason ?? 'Gateway release metadata is unavailable.'}
        />
      </section>
    </div>
  )
}

function StatusCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <div className="rounded-xl border border-white/[0.08] p-4"><div className="text-xs uppercase tracking-wide text-white/45">{title}</div><div className="mt-2 text-xl font-semibold text-white">{value}</div><div className="mt-1 text-xs text-white/50">{detail}</div></div>
}
