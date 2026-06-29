/**
 * Failure Board API — proxies to the autoresearch backend.
 *
 * Returns sanitized failure clusters + day's benchmark + optional
 * per-miner performance.
 *
 * Miner-performance view requires miner_hotkey query param (only the
 * submitter sees their own data).
 *
 * Backend wire-up: replace BACKEND_URL with the deployed autoresearch
 * endpoint once the backend is live. For now this route computes
 * locally from Supabase using the same logic as the Python backend.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

type FailureBoard = {
  generated_at: string
  day_benchmark: DayBenchmark
  failure_clusters: FailureCluster[]
  miner_performance: MinerPerformance | null
}

function todaySetId(): number {
  const now = new Date()
  return parseInt(
    `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`,
    10
  )
}

function hashClusterId(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i)
    h |= 0
  }
  return `intent_${(Math.abs(h) % 100000).toString().padStart(5, '0')}`
}

async function buildBoard(minerHotkey: string | null, setId: number): Promise<FailureBoard> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const sb = createClient(url, key, { auth: { persistSession: false } })

  // Day benchmark
  const { data: icpSet } = await sb
    .from('qualification_private_icp_sets')
    .select('is_active')
    .eq('set_id', setId)
    .limit(1)
  const isActive = Boolean(icpSet?.[0]?.is_active)

  const { data: baselineRow } = await sb
    .from('qualification_baselines')
    .select('baseline_score, per_icp_scores')
    .eq('set_id', setId)
    .limit(1)
  const referenceBaseline = Number(baselineRow?.[0]?.baseline_score ?? 0)
  const championThreshold = Math.max(referenceBaseline + 10, 20)

  const { data: bestSubs } = await sb
    .from('qualification_models')
    .select('miner_hotkey, score')
    .eq('icp_set_id', setId)
    .order('score', { ascending: false })
    .limit(50)
  const bestScoreToday = bestSubs?.[0]?.score ?? null
  const bestHkPrefix = bestSubs?.[0]?.miner_hotkey?.slice(0, 12) ?? null

  const dayBenchmark: DayBenchmark = {
    set_id: setId,
    reference_baseline: referenceBaseline,
    champion_threshold: championThreshold,
    best_miner_score_today: bestScoreToday,
    best_miner_hotkey_prefix: bestHkPrefix,
    n_submissions_today: bestSubs?.length ?? 0,
    is_active: isActive,
  }

  // Failure clusters — last 10 days, aggregated by intent
  const { data: recentBaselines } = await sb
    .from('qualification_baselines')
    .select('set_id, per_icp_scores')
    .order('set_id', { ascending: false })
    .limit(10)

  const intentScores = new Map<string, number[]>()
  for (const b of recentBaselines ?? []) {
    const sid = b.set_id as number
    const scores = (b.per_icp_scores as number[]) ?? []
    const { data: setRow } = await sb
      .from('qualification_private_icp_sets')
      .select('icps')
      .eq('set_id', sid)
      .limit(1)
    const icps = (setRow?.[0]?.icps as Array<Record<string, unknown>>) ?? []
    for (let i = 0; i < Math.min(icps.length, scores.length); i++) {
      const intents = (icps[i]?.intent_signals as string[]) ?? []
      if (intents.length === 0) continue
      const firstIntent = intents[0]
      if (!intentScores.has(firstIntent)) intentScores.set(firstIntent, [])
      intentScores.get(firstIntent)!.push(Number(scores[i]))
    }
  }

  const allScores = Array.from(intentScores.values()).flat()
  const meanAll = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0

  const failureClusters: FailureCluster[] = []
  for (const [intent, scores] of intentScores) {
    if (scores.length < 3) continue
    const m = scores.reduce((a, b) => a + b, 0) / scores.length
    const delta = m - meanAll
    if (delta >= 0) continue // only surface weaknesses
    failureClusters.push({
      cluster_id: hashClusterId(intent),
      weakness_summary: `Intent '${intent}' scores ${m.toFixed(1)} mean vs ${meanAll.toFixed(1)} cross-intent average (${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pts)`,
      n_recent_cases: scores.length,
      mean_score_this_intent: Math.round(m * 100) / 100,
      mean_score_all_intents: Math.round(meanAll * 100) / 100,
      delta_vs_avg: Math.round(delta * 100) / 100,
    })
  }
  failureClusters.sort((a, b) => a.delta_vs_avg - b.delta_vs_avg)

  // Miner performance (only if hotkey provided)
  let minerPerformance: MinerPerformance | null = null
  if (minerHotkey) {
    const { data: minerSubs } = await sb
      .from('qualification_models')
      .select('id, score, score_breakdown, evaluated_at, icp_set_id, status, model_name')
      .eq('miner_hotkey', minerHotkey)
      .eq('icp_set_id', setId)
      .order('score', { ascending: false })
      .limit(20)

    if (!minerSubs || minerSubs.length === 0) {
      minerPerformance = {
        miner_hotkey: minerHotkey,
        n_submissions_today: 0,
        best_score_today: null,
        best_submission_id: null,
        distance_to_threshold: null,
        per_icp_delta_vs_reference: [],
        weak_icp_positions: [],
        recent_submissions: [],
      }
    } else {
      const best = minerSubs[0]
      const bestScore = Number(best.score ?? 0)
      minerPerformance = {
        miner_hotkey: minerHotkey,
        n_submissions_today: minerSubs.length,
        best_score_today: bestScore,
        best_submission_id: String(best.id),
        distance_to_threshold: Math.round((championThreshold - bestScore) * 100) / 100,
        per_icp_delta_vs_reference: [],
        weak_icp_positions: [],
        recent_submissions: minerSubs.slice(0, 5).map((s) => ({
          id: String(s.id),
          score: Number(s.score ?? 0),
          status: s.status as string,
          evaluated_at: s.evaluated_at as string,
          model_name: (s.model_name as string) ?? 'Unnamed',
        })),
      }
    }
  }

  return {
    generated_at: new Date().toISOString(),
    day_benchmark: dayBenchmark,
    failure_clusters: failureClusters,
    miner_performance: minerPerformance,
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const minerHotkey = url.searchParams.get('miner_hotkey')
    const setIdParam = url.searchParams.get('set_id')
    const setId = setIdParam ? parseInt(setIdParam, 10) : todaySetId()
    const board = await buildBoard(minerHotkey, setId)
    return NextResponse.json({ success: true, data: board })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
