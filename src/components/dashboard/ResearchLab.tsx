'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MetagraphData } from '@/lib/types'
import { formatLabAllocationPercent } from '@/lib/research-lab-emissions'

type ResearchLabData = {
  arena: ResearchLabArenaSnapshot
  labMinerSpend: LabMinerSpendRollup
  fetchedAt: string
}

type ResearchLabArenaSnapshot = {
  activeRound: { roundId: string; status: string } | null
  publishedBaseline: {
    roundId: string
    submissionId: string
    score: number
    rank: number | null
    publishedAt: string | null
  } | null
  publishedWinner: {
    roundId: string
    submissionId: string
    score: number
    rank: number | null
    publishedAt: string | null
  } | null
}

type LabMinerSpendRollup = {
  byHotkey: Record<string, LabMinerSpendEntry>
  allTime: { byHotkey: Record<string, LabMinerAllTimeEntry> }
  currentAllocation: {
    epoch: number | null
    source: string
    byHotkey: Record<string, LabMinerCurrentAllocationEntry>
  }
}

type LabMinerSpendEntry = {
  computeSpendUsd: number
  scheduledReimbursementUsd: number
  activeAwardCount: number
  reimbursementEpochs: number | null
}

type LabMinerAllTimeEntry = {
  alphaEarned: number
  computeSpendUsd: number
  scheduledReimbursementUsd: number
  awardCount: number
  reimbursementEpochs: number | null
  alphaAllocationCount: number
}

type LabMinerCurrentAllocationEntry = {
  paidAlphaPercent: number
  intendedAlphaPercent: number
  overpaidAlphaPercent: number
  spendUsd: number
  labBucketSharePercent: number
  allocationCount: number
  reasons: string[]
}

export function ResearchLab({
  onSync,
  metagraph,
}: { onSync?: () => void; metagraph?: MetagraphData | null } = {}) {
  const [data, setData] = useState<ResearchLabData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch(`/api/research-lab?t=${Date.now()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`Request failed (${response.status})`)
      const body = await response.json()
      if (!body.success) throw new Error(body.error || 'Research Lab data unavailable')
      setData(body.data as ResearchLabData)
      setError(null)
      onSync?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to fetch Research Lab data')
    } finally {
      setLoading(false)
    }
  }, [onSync])

  useEffect(() => {
    void fetchData()
    const interval = window.setInterval(() => void fetchData(), 60_000)
    return () => window.clearInterval(interval)
  }, [fetchData])

  if (loading && !data) return <ResearchLabLoading />
  if (error && !data) {
    return (
      <div className="border-l-2 border-l-[var(--line-3)] py-6 pl-5">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--muted-2)]">Research Lab</div>
        <p className="mt-3 text-[14px] text-[var(--muted)]">{error}</p>
      </div>
    )
  }

  return (
    <div className="w-full">
      <header>
        <h2 className="max-w-[700px] font-display text-[26px] font-medium leading-[1.12] tracking-[-0.025em] text-[var(--platinum)] md:text-[30px]">
          Public baseline and Arena competition
        </h2>
        <p className="mt-3 max-w-[620px] text-[14px] leading-[1.7] text-[var(--muted)]">
          Research Lab publishes the open baseline, rebenchmarks it daily, and compares miner submissions on the same ICPs through Arena.
        </p>
      </header>

      <ArenaHero arena={data?.arena ?? { activeRound: null, publishedBaseline: null, publishedWinner: null }} />
      <LabEmissionSplit spend={data?.labMinerSpend ?? null} metagraph={metagraph} />
      {error ? <p className="mt-5 text-[12px] text-[var(--muted-2)]">Latest refresh failed: {error}</p> : null}
    </div>
  )
}

function ResearchLabLoading() {
  return (
    <div className="w-full">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--muted-2)]">Research Lab</div>
      <div className="mt-10 space-y-4"><div className="h-20 w-48 shimmer rounded-md" /><div className="h-4 w-96 max-w-full shimmer rounded" /></div>
    </div>
  )
}

function ArenaHero({ arena }: { arena: ResearchLabArenaSnapshot }) {
  const baseline = arena.publishedBaseline
  const winner = arena.publishedWinner
  const activeRound = arena.activeRound
  const scoreTone = baseline ? (baseline.score >= 80 ? 'var(--white)' : baseline.score >= 60 ? 'var(--platinum)' : 'var(--muted)') : 'var(--platinum)'
  const activeLabel = activeRound ? activeRound.status.trim().replaceAll('_', ' ') : null

  return (
    <section className="border-b border-[var(--line)] py-12 md:py-14">
      <div className="mb-5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--muted-2)]">Public open-model baseline · Arena</div>
      <div className="font-display text-[clamp(48px,8vw,96px)] font-medium leading-[0.84] tracking-[-0.045em]" style={{ color: scoreTone }}>
        {baseline ? baseline.score.toFixed(1) : activeRound?.status === 'open' ? 'Waiting' : activeRound ? 'In progress' : 'Unavailable'}
        {baseline ? <span className="ml-3.5 align-baseline text-[22px] tracking-normal text-[var(--faint)] md:text-[26px]">/100</span> : null}
      </div>
      <p className="mt-7 max-w-[560px] text-[14px] leading-[1.7] text-[var(--muted)]">
        {baseline
          ? 'The persisted final score for the public baseline in the latest published Arena round.'
          : activeRound?.status === 'open'
            ? 'The Arena round is open for submissions and waiting to start.'
            : activeRound
              ? 'The public baseline is running in Arena. Its score appears after final ranking is published.'
              : 'Arena did not return a published baseline score. No score is inferred.'}
      </p>
      <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[11px] text-[var(--muted-2)]">
        {activeLabel ? <span>Active stage: {activeLabel}</span> : null}
        {baseline ? <><span>Published round {shortId(baseline.roundId)}</span>{baseline.rank !== null ? <span>Final rank {baseline.rank}</span> : null}{baseline.publishedAt ? <span>{formatDateTime(baseline.publishedAt)}</span> : null}</> : null}
        {winner ? <span>Current king: {shortId(winner.submissionId)} · {winner.score.toFixed(1)}</span> : null}
      </div>
    </section>
  )
}

function LabEmissionSplit({ spend, metagraph }: { spend: LabMinerSpendRollup | null; metagraph?: MetagraphData | null }) {
  const rows = useMemo(() => {
    const current = spend?.currentAllocation?.byHotkey ?? {}
    const recent = spend?.byHotkey ?? {}
    const allTime = spend?.allTime?.byHotkey ?? {}
    const keys = new Set([...Object.keys(current), ...Object.keys(recent), ...Object.keys(allTime), ...Object.keys(metagraph?.incentives ?? {})])
    return Array.from(keys).map((hotkey) => ({
      hotkey,
      metagraphPct: Math.max(0, Number(metagraph?.incentives?.[hotkey] ?? 0) * 100),
      paidAlphaPct: Math.max(0, Number(current[hotkey]?.paidAlphaPercent ?? 0)),
      computeSpendUsd: Math.max(0, Number(recent[hotkey]?.computeSpendUsd ?? 0)),
      reimbursementUsd: Math.max(0, Number(recent[hotkey]?.scheduledReimbursementUsd ?? 0)),
      alphaEarned: Math.max(0, Number(allTime[hotkey]?.alphaEarned ?? 0)),
    })).filter((row) => row.metagraphPct > 0 || row.paidAlphaPct > 0 || row.computeSpendUsd > 0 || row.alphaEarned > 0).sort((a, b) => b.metagraphPct - a.metagraphPct || b.alphaEarned - a.alphaEarned || a.hotkey.localeCompare(b.hotkey))
  }, [metagraph?.incentives, spend])

  return (
    <section className="pt-10">
      <div className="mb-5">
        <div className="font-display text-[22px] font-medium tracking-[-0.025em] text-[var(--platinum)]">Miner settlement and emissions</div>
        <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-[var(--muted-2)]">Current Lab allocation, metagraph emissions, reimbursement, and compute spend remain visible for active settlement workflows.</p>
      </div>
      {rows.length === 0 ? <p className="text-[13px] text-[var(--muted-2)]">No current Lab allocation or settlement data is available.</p> : (
        <div className="overflow-hidden rounded-md border border-[var(--line)]">
          <div className="hidden grid-cols-[minmax(0,1fr)_130px_130px_130px_130px] gap-3 border-b border-[var(--line)] bg-[rgba(236,234,230,0.018)] px-3 py-2 font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--muted-2)] md:grid"><span>Hotkey</span><span className="text-right">Metagraph</span><span className="text-right">Lab allocation</span><span className="text-right">Compute / repay</span><span className="text-right">Alpha earned</span></div>
          {rows.map((row) => <div key={row.hotkey} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-[var(--line)] px-3 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_130px_130px_130px_130px] md:items-center"><span className="font-mono text-[11px] text-[var(--platinum)]">{shortHotkey(row.hotkey)}</span><span className="text-right font-mono text-[11px] text-[var(--muted)]">{formatLabAllocationPercent(row.metagraphPct)}</span><span className="hidden text-right font-mono text-[11px] text-[var(--muted)] md:block">{formatLabAllocationPercent(row.paidAlphaPct)}</span><span className="text-right font-mono text-[11px] text-[var(--muted)]">{formatUsd(row.computeSpendUsd)} / {formatUsd(row.reimbursementUsd)}</span><span className="hidden text-right font-mono text-[11px] text-[var(--muted)] md:block">{formatAlpha(row.alphaEarned)}</span></div>)}
        </div>
      )}
    </section>
  )
}

function shortId(value: string): string { return value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value }
function shortHotkey(value: string): string { return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value }
function formatDateTime(value: string): string { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : value }
function formatUsd(value: number): string { if (!Number.isFinite(value) || value <= 0) return '$0.00'; if (value >= 1) return `$${value.toFixed(2)}`; return '<$0.01' }
function formatAlpha(value: number): string { if (!Number.isFinite(value) || value <= 0) return '0.0000'; return value >= 1 ? value.toFixed(2) : value.toFixed(4) }
