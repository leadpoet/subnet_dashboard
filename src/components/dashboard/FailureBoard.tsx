'use client'

import { useState, useEffect, useMemo } from 'react'
import { cn } from '@/lib/utils'

// =================================================================
//  Failure Board — sanitized weakness map + per-miner performance.
//  Surface for v5-2 autoresearch.
//
//  Public view (no hotkey):     day benchmark + weakness clusters
//  Miner view (hotkey query):   their submissions today + distance
//                               to threshold + per-ICP delta hint
// =================================================================

type DayBenchmark = {
  set_id: number
  reference_baseline: number
  champion_threshold: number
  best_miner_score_today: number | null
  best_miner_hotkey_prefix: string | null
  n_submissions_today: number
  is_active: boolean
}

type FailureCluster = {
  cluster_id: string
  weakness_summary: string
  n_recent_cases: number
  mean_score_this_intent: number
  mean_score_all_intents: number
  delta_vs_avg: number
}

type MinerPerformance = {
  miner_hotkey: string
  n_submissions_today: number
  best_score_today: number | null
  best_submission_id: string | null
  distance_to_threshold: number | null
  per_icp_delta_vs_reference: number[]
  weak_icp_positions: number[]
  recent_submissions: Array<{
    id: string
    score: number
    status: string
    evaluated_at: string
    model_name: string
  }>
}

type FailureBoardData = {
  generated_at: string
  day_benchmark: DayBenchmark
  failure_clusters: FailureCluster[]
  miner_performance: MinerPerformance | null
}

interface Props {
  minerHotkey?: string
}

export function FailureBoard({ minerHotkey }: Props) {
  const [data, setData] = useState<FailureBoardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const qs = minerHotkey ? `?miner_hotkey=${encodeURIComponent(minerHotkey)}` : ''
    fetch(`/api/failure-board${qs}`)
      .then((r) => r.json())
      .then((r) => {
        if (!r.success) throw new Error(r.error || 'failed')
        setData(r.data as FailureBoardData)
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false))
  }, [minerHotkey])

  if (loading) return <div className="text-sm text-neutral-400">Loading failure board…</div>
  if (error) return <div className="text-sm text-red-400">Failed: {error}</div>
  if (!data) return null

  const { day_benchmark: bench, failure_clusters: clusters, miner_performance: perf } = data

  return (
    <div className="space-y-6">
      {/* Day benchmark */}
      <section>
        <h3 className="text-sm font-medium text-neutral-200 mb-2">Today&apos;s Benchmark</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric label="Set ID" value={`#${bench.set_id}`} />
          <Metric
            label="Reference Baseline"
            value={bench.reference_baseline.toFixed(2)}
            hint="open-source ref model"
          />
          <Metric
            label="Champion Threshold"
            value={bench.champion_threshold.toFixed(2)}
            hint="max(ref+10, 20)"
            highlight
          />
          <Metric
            label="Best Today"
            value={bench.best_miner_score_today?.toFixed(2) ?? '—'}
            hint={bench.best_miner_hotkey_prefix ? `${bench.best_miner_hotkey_prefix}…` : 'no subs'}
          />
        </div>
      </section>

      {/* Miner performance — only if hotkey was provided */}
      {perf && (
        <section>
          <h3 className="text-sm font-medium text-neutral-200 mb-2">
            Your Performance — {perf.miner_hotkey.slice(0, 12)}…
          </h3>
          {perf.n_submissions_today === 0 ? (
            <div className="rounded border border-neutral-800 bg-neutral-900/40 p-3 text-sm text-neutral-400">
              No submissions today. Focus the highest-delta clusters below to maximize score.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Metric
                  label="Submissions today"
                  value={perf.n_submissions_today.toString()}
                />
                <Metric
                  label="Best score today"
                  value={perf.best_score_today?.toFixed(2) ?? '—'}
                />
                <Metric
                  label="Distance to threshold"
                  value={
                    perf.distance_to_threshold !== null
                      ? perf.distance_to_threshold > 0
                        ? `−${perf.distance_to_threshold.toFixed(2)}`
                        : `+${Math.abs(perf.distance_to_threshold).toFixed(2)} (over)`
                      : '—'
                  }
                  highlight={perf.distance_to_threshold !== null && perf.distance_to_threshold <= 0}
                />
              </div>
              {perf.weak_icp_positions.length > 0 && (
                <div className="text-xs text-neutral-400">
                  ICPs where you scored below reference: positions{' '}
                  {perf.weak_icp_positions.join(', ')}
                </div>
              )}
              {perf.recent_submissions.length > 0 && (
                <div className="rounded border border-neutral-800 bg-neutral-900/40 p-3">
                  <div className="text-xs font-medium text-neutral-300 mb-2">
                    Recent submissions
                  </div>
                  <table className="w-full text-xs">
                    <thead className="text-neutral-500">
                      <tr>
                        <th className="text-left py-1">Name</th>
                        <th className="text-right">Score</th>
                        <th className="text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perf.recent_submissions.map((s) => (
                        <tr key={s.id} className="border-t border-neutral-800/60">
                          <td className="py-1 text-neutral-200">{s.model_name}</td>
                          <td className="text-right text-neutral-100">{s.score.toFixed(2)}</td>
                          <td className="text-right text-neutral-400">{s.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Failure clusters */}
      <section>
        <h3 className="text-sm font-medium text-neutral-200 mb-2">
          Weakness Clusters{' '}
          <span className="text-xs text-neutral-500">
            ({clusters.length} below cross-intent average)
          </span>
        </h3>
        <div className="space-y-2">
          {clusters.length === 0 ? (
            <div className="text-sm text-neutral-400">
              No clusters available yet. Need ≥3 baseline runs per intent.
            </div>
          ) : (
            clusters.map((c) => (
              <div
                key={c.cluster_id}
                className="rounded border border-neutral-800 bg-neutral-900/40 p-3"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs text-neutral-500">{c.cluster_id}</span>
                  <span
                    className={cn(
                      'text-xs font-medium',
                      c.delta_vs_avg < -10 ? 'text-red-400' : 'text-amber-400'
                    )}
                  >
                    Δ {c.delta_vs_avg.toFixed(1)}
                  </span>
                </div>
                <div className="text-sm text-neutral-200">{c.weakness_summary}</div>
                <div className="text-xs text-neutral-500 mt-1">
                  {c.n_recent_cases} recent cases
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <div className="text-xs text-neutral-600 pt-2">
        Generated at {new Date(data.generated_at).toLocaleString()} · sanitized — no ICP IDs or
        company names included
      </div>
    </div>
  )
}

interface MetricProps {
  label: string
  value: string
  hint?: string
  highlight?: boolean
}

function Metric({ label, value, hint, highlight }: MetricProps) {
  return (
    <div
      className={cn(
        'rounded border border-neutral-800 bg-neutral-900/40 p-3',
        highlight && 'border-amber-700/50 bg-amber-900/10'
      )}
    >
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-lg font-medium text-neutral-100 mt-1">{value}</div>
      {hint && <div className="text-xs text-neutral-500 mt-1">{hint}</div>}
    </div>
  )
}
