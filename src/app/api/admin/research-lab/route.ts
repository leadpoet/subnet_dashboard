import { NextRequest, NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/admin-supabase'
import {
  buildResearchLabLoopTimeline,
  type ResearchLabLoopTimeline,
  type ResearchLabTimelinePhase,
  type ResearchLabTimelineRawRow,
  type ResearchLabTimelineSourceInput,
} from '@/lib/research-lab-timeline'
import {
  deriveResearchLabLoopStatus,
  isActiveResearchLabLoopStatus,
  isCompletedResearchLabLoopStatus,
  isNoGainOrFailedResearchLabLoopStatus,
  isPendingOrBlockingResearchLabLoopStatus,
  isPromisingResearchLabLoopStatus,
  isScoredResearchLabLoopStatus,
  type ResearchLabLoopStatusNote,
} from '@/lib/research-lab-status'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOOP_LIMIT = 250
const ACTIVE_RUN_LIMIT = 40
const STALE_ACTIVE_MS = 30 * 60 * 1000
const STALE_SCORING_MS = 15 * 60 * 1000
const FRESH_DATA_MS = 15 * 60 * 1000
const DEGRADED_DATA_MS = 60 * 60 * 1000
const SUPABASE_IN_FILTER_BATCH_SIZE = 100

type AdminHealthState = 'healthy' | 'degraded' | 'critical' | 'unknown'
type AdminScoringState = 'active' | 'paused' | 'stalled' | 'blocked' | 'idle' | 'unknown'

type AdminLabLoopRow = {
  card_id: string
  ticket_id: string
  miner_hotkey: string | null
  research_area: string | null
  research_focus_summary: string | null
  topic_tags: string[] | null
  topic_signature_hash: string | null
  current_topic_tags: string[] | null
  current_topic_signature_hash: string | null
  current_outcome_label: string | null
  current_outcome_band: string | null
  current_candidate_count: number | null
  current_scored_candidate_count: number | null
  current_best_candidate_public_summary: string | null
  current_last_activity_at: string | null
  current_run_id: string | null
  current_receipt_id: string | null
  current_event_doc: Record<string, unknown> | null
  current_status?: string | null
  public_status?: string | null
  payment_state?: string | null
  execution_state?: string | null
  candidate_state?: string | null
  result_state?: string | null
  ops_reason?: string | null
  status_detail?: string | null
  ops_warnings?: unknown
  current_public_status?: string | null
  current_payment_state?: string | null
  current_execution_state?: string | null
  current_candidate_state?: string | null
  current_result_state?: string | null
  current_ops_reason?: string | null
  current_status_detail?: string | null
  current_ops_warnings?: unknown
  current_candidate_status?: string | null
  current_reason?: string | null
  current_queue_status?: string | null
  current_receipt_status?: string | null
  improvement_gate_decision?: string | null
  current_improvement_gate_decision?: string | null
  promotion_status?: string | null
  current_promotion_status?: string | null
  promotion_event_type?: string | null
  current_promotion_event_type?: string | null
  promotion_event?: string | null
  current_promotion_event?: string | null
  event_type?: string | null
  current_event_type?: string | null
  created_at: string
}

export type AdminLabLoopSummary = {
  cardId: string
  ticketId: string
  runId: string | null
  receiptId: string | null
  minerHotkey: string
  researchArea: string
  researchFocusSummary: string
  topicTags: string[]
  topicSignatureHash: string
  outcomeLabel: string
  outcomeBand: string
  publicStatus?: string
  paymentState?: string
  executionState?: string
  candidateState?: string
  resultState?: string
  opsReason?: string
  statusDetail?: string
  opsWarnings?: string[]
  statusKey: string
  statusLabel: string
  statusNote?: AdminLoopStatusNote
  actionNote?: AdminLoopStatusNote
  candidateCount: number
  scoredCandidateCount: number
  bestCandidatePublicSummary: string
  lastActivityAt: string
  submittedAt: string
}

export type AdminLoopStatusNote = {
  tone: ResearchLabLoopStatusNote['tone']
  label: string
  detail: string
}

export type AdminLabHealthSignal = {
  id: string
  label: string
  value: string
  state: AdminHealthState
  detail: string
  updatedAt?: string | null
}

export type AdminLabScoringSummary = {
  state: AdminScoringState
  label: string
  detail: string
  source: 'explicit' | 'inferred' | 'missing'
  paused: boolean
  pauseReason: string | null
  controlUpdatedAt: string | null
  activeRuns: number
  scoringRuns: number
  queuedRuns: number
  blockedRuns: number
  staleRuns: number
  candidatesRemaining: number
  icpsRemaining: number | null
  scoreBundlesLastHour: number
  scoreBundlesLast24h: number
  lastScoringAt: string | null
  oldestActiveRunAt: string | null
}

export type AdminLabActiveRun = {
  ticketId: string
  runId: string | null
  receiptId: string | null
  minerHotkey: string
  researchFocusSummary: string
  topicTags: string[]
  statusKey: string
  statusLabel: string
  phase: string
  candidateCount: number
  scoredCandidateCount: number
  candidatesRemaining: number
  icpTotal: number | null
  icpsScored: number | null
  icpsRemaining: number | null
  scoreBundleId: string | null
  scoreBundleStatus: string | null
  blocker: string | null
  submittedAt: string
  lastActivityAt: string
  ageMs: number
  idleMs: number
  stale: boolean
}

export type AdminLabPipelineStage = {
  id: string
  label: string
  count: number
  staleCount: number
  percent: number
}

export type AdminLabBenchmarkSummary = {
  state: AdminHealthState
  reportId: string | null
  benchmarkDate: string | null
  rollingWindowHash: string | null
  aggregateScore: number | null
  itemCount: number
  publicIcpCount: number
  privateHoldoutIcpCount: number
  currentStatusAt: string | null
  ageMs: number | null
  issueCount: number
  topIssues: Array<{ key: string; count: number }>
  detail: string
}

export type AdminLabAlertSummary = {
  state: AdminHealthState
  sourceAvailable: boolean
  unavailableReason: string | null
  totalLast24h: number
  criticalLast24h: number
  warningLast24h: number
  activeCount: number
  recent: AdminLabAlert[]
}

export type AdminLabAlert = {
  id: string
  severity: string
  source: string
  title: string
  fingerprint: string
  status: string
  count: number
  firstSeenAt: string | null
  lastSeenAt: string | null
}

export type AdminLabAttestationSummary = {
  state: AdminHealthState
  sourceAvailable: boolean
  unavailableReason: string | null
  totalNodes: number
  matchedNodes: number
  mismatchedNodes: number
  missingNodes: number
  expectedPcr0: string | null
  latestAttestedAt: string | null
  nodes: AdminLabAttestationNode[]
}

export type AdminLabAttestationNode = {
  id: string
  component: string
  nodeId: string
  hotkey: string | null
  expectedPcr0: string | null
  observedPcr0: string | null
  matched: boolean | null
  buildId: string | null
  gitSha: string | null
  attestedAt: string | null
}

export type AdminLabDataFreshness = {
  state: AdminHealthState
  latestActivityAt: string | null
  ageMs: number | null
  loopCount: number
}

export type AdminLabOpsSummary = {
  state: AdminHealthState
  healthSignals: AdminLabHealthSignal[]
  dataFreshness: AdminLabDataFreshness
  scoring: AdminLabScoringSummary
  activeRuns: AdminLabActiveRun[]
  pipeline: AdminLabPipelineStage[]
  benchmark: AdminLabBenchmarkSummary
  alerts: AdminLabAlertSummary
  attestation: AdminLabAttestationSummary
}

export type AdminResearchLabPayload = {
  loops: AdminLabLoopSummary[]
  ops: AdminLabOpsSummary
  stats: {
    totalLoops: number
    runningLoops: number
    scoredLoops: number
    failedLoops: number
    uniqueMiners: number
  }
  fetchedAt: string
}

export type AdminResearchLabTimelinePayload = {
  loop: AdminLabLoopSummary
  timeline: ResearchLabLoopTimeline
  fetchedAt: string
}

export async function GET(request: NextRequest) {
  let supabase
  try {
    supabase = getAdminSupabase()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'admin supabase not configured'
    return NextResponse.json({ error: msg }, { status: 503 })
  }

  const ticketId = request.nextUrl.searchParams.get('ticketId')?.trim()
  if (ticketId) {
    let detail: AdminResearchLabTimelinePayload | null = null
    try {
      detail = await fetchAdminLabTimeline(supabase, ticketId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown Supabase error'
      return NextResponse.json({ error: msg }, { status: 502 })
    }
    if (!detail) {
      return NextResponse.json({ error: 'Research Lab loop not found' }, { status: 404 })
    }
    return NextResponse.json(detail, { headers: { 'Cache-Control': 'no-store' } })
  }

	  let loops: AdminLabLoopSummary[] = []
	  let ops: AdminLabOpsSummary
	  try {
	    loops = await fetchAdminLabLoops(supabase)
	    ops = await fetchAdminLabOps(supabase, loops)
	  } catch (e) {
	    const msg = e instanceof Error ? e.message : 'Unknown Supabase error'
	    return NextResponse.json({ error: msg }, { status: 502 })
  }
  const miners = new Set(loops.map((loop) => loop.minerHotkey).filter(Boolean))
  return NextResponse.json(
	    {
	      loops,
	      ops,
	      stats: {
	        totalLoops: loops.length,
	        runningLoops: loops.filter((loop) => isActiveResearchLabLoopStatus(loop.statusKey)).length,
	        scoredLoops: loops.filter((loop) => isScoredResearchLabLoopStatus(loop.statusKey)).length,
	        failedLoops: loops.filter((loop) => isNoGainOrFailedResearchLabLoopStatus(loop.statusKey) || isFailedOutcome(loop.outcomeLabel, loop.outcomeBand)).length,
	        uniqueMiners: miners.size,
	      },
      fetchedAt: new Date().toISOString(),
    } satisfies AdminResearchLabPayload,
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

async function fetchAdminLabLoops(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<AdminLabLoopSummary[]> {
  const { data, error } = await supabase
    .from('research_lab_public_loop_card_current')
    .select('*')
    .order('current_last_activity_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(LOOP_LIMIT)

  if (error) {
    throw new Error(`Supabase error: ${error.message}`)
  }

  return ((data ?? []) as AdminLabLoopRow[]).map(normalizeLoopRow)
}

async function fetchAdminLabTimeline(
  supabase: ReturnType<typeof getAdminSupabase>,
  ticketId: string,
): Promise<AdminResearchLabTimelinePayload | null> {
  const { data, error } = await supabase
    .from('research_lab_public_loop_card_current')
    .select('*')
    .eq('ticket_id', ticketId)
    .limit(1)

  if (error) {
    throw new Error(`Supabase error: ${error.message}`)
  }

  const row = ((data ?? []) as AdminLabLoopRow[])[0] ?? null
  if (!row) return null

  const loop = normalizeLoopRow(row)
  const currentRunId = row.current_run_id
  const currentReceiptId = row.current_receipt_id
  const fetches: Array<Promise<TimelineSourceResult>> = [
    fetchTimelineSourceByTicket(supabase, 'research_loop_ticket_events', 'ticket', ticketId),
    fetchTimelineSourceByTicket(supabase, 'research_loop_run_queue_events', 'queue', ticketId),
    fetchTimelineSourceByTicket(supabase, 'research_lab_auto_research_loop_events', 'auto_research', ticketId),
    fetchTimelineSourceByTicket(supabase, 'research_lab_candidate_evaluation_events', 'candidate', ticketId),
    fetchTimelineSourceByTicket(supabase, 'research_evaluation_score_bundle_events', 'scoring', ticketId),
    fetchTimelineSourceByTicket(supabase, 'research_lab_candidate_promotion_events', 'promotion', ticketId),
    fetchTimelineSourceByTicket(supabase, 'research_lab_public_loop_card_events', 'public_projection', ticketId),
  ]

  if (currentRunId) {
    fetches.push(
      fetchTimelineSourceByRun(supabase, 'research_loop_run_queue_events', 'queue', currentRunId),
      fetchTimelineSourceByRun(supabase, 'research_lab_auto_research_loop_events', 'auto_research', currentRunId),
      fetchTimelineSourceByRun(supabase, 'research_lab_candidate_evaluation_events', 'candidate', currentRunId),
      fetchTimelineSourceByRun(supabase, 'research_evaluation_score_bundle_events', 'scoring', currentRunId),
      fetchTimelineSourceByRun(supabase, 'research_lab_candidate_promotion_events', 'promotion', currentRunId),
    )
  }

  const results = await Promise.all(fetches)
  const sources = mergeTimelineSources(results)
  const timeline = buildResearchLabLoopTimeline({
    ticketId,
    currentRunId,
    currentReceiptId,
    currentLoop: {
      cardId: row.card_id,
      ticketId: row.ticket_id,
      runId: currentRunId,
      receiptId: currentReceiptId,
      minerHotkey: row.miner_hotkey,
      outcomeLabel: row.current_outcome_label,
      outcomeBand: row.current_outcome_band,
      statusLabel: row.current_status,
      submittedAt: row.created_at,
      lastActivityAt: row.current_last_activity_at,
      eventDoc: row.current_event_doc,
    },
    sources,
  })

  return { loop, timeline, fetchedAt: new Date().toISOString() }
}

type TimelineSourceResult = ResearchLabTimelineSourceInput

async function fetchTimelineSourceByTicket(
  supabase: ReturnType<typeof getAdminSupabase>,
  table: string,
  phase: ResearchLabTimelinePhase,
  ticketId: string,
): Promise<TimelineSourceResult> {
  return fetchTimelineSource(supabase, table, phase, 'ticket_id', ticketId)
}

async function fetchTimelineSourceByRun(
  supabase: ReturnType<typeof getAdminSupabase>,
  table: string,
  phase: ResearchLabTimelinePhase,
  runId: string,
): Promise<TimelineSourceResult> {
  return fetchTimelineSource(supabase, table, phase, 'run_id', runId)
}

async function fetchTimelineSource(
  supabase: ReturnType<typeof getAdminSupabase>,
  table: string,
  phase: ResearchLabTimelinePhase,
  column: 'ticket_id' | 'run_id',
  value: string,
): Promise<TimelineSourceResult> {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq(column, value)
    .limit(1000)

  if (error) {
    if (!isExpectedOptionalTimelineSourceMiss(error.message)) {
      console.warn(`[admin:research-lab] timeline source unavailable: ${table}.${column}`, error.message)
    }
    return { source: table, phase, rows: [] }
  }

  return {
    source: table,
    phase,
    rows: (data ?? []) as ResearchLabTimelineRawRow[],
  }
}

function mergeTimelineSources(results: TimelineSourceResult[]): ResearchLabTimelineSourceInput[] {
  const bySource = new Map<string, ResearchLabTimelineSourceInput>()
  for (const result of results) {
    const key = `${result.phase}:${result.source}`
    const current = bySource.get(key) ?? {
      source: result.source,
      phase: result.phase,
      rows: [],
    }
    current.rows.push(...result.rows)
    bySource.set(key, current)
  }
  return Array.from(bySource.values())
}

type ScoreBundleMetrics = {
  byTicket: Map<string, RunScoreMetrics>
  lastScoringAt: string | null
  scoreBundlesLastHour: number
  scoreBundlesLast24h: number
}

type RunScoreMetrics = {
  scoreBundleId: string | null
  scoreBundleStatus: string | null
  icpTotal: number | null
  icpsScored: number | null
  lastScoringAt: string | null
}

type ScoringControlSummary = {
  source: 'explicit' | 'missing'
  paused: boolean
  state: string | null
  pauseReason: string | null
  updatedAt: string | null
}

async function fetchAdminLabOps(
  supabase: ReturnType<typeof getAdminSupabase>,
  loops: AdminLabLoopSummary[],
): Promise<AdminLabOpsSummary> {
  const [
    scoreMetrics,
    scoringControl,
    benchmark,
    alerts,
    attestation,
  ] = await Promise.all([
    fetchScoreBundleMetrics(supabase, loops),
    fetchScoringControl(supabase),
    fetchBenchmarkSummary(supabase),
    fetchAlertSummary(supabase),
    fetchAttestationSummary(supabase),
  ])

  const dataFreshness = buildDataFreshness(loops)
  const activeRuns = buildActiveRuns(loops, scoreMetrics.byTicket)
  const pipeline = buildPipelineStages(loops)
  const scoring = buildScoringSummary({
    loops,
    activeRuns,
    metrics: scoreMetrics,
    control: scoringControl,
  })
  const healthSignals = buildHealthSignals({
    dataFreshness,
    scoring,
    benchmark,
    alerts,
    attestation,
  })

  return {
    state: worstHealthState(healthSignals.map((signal) => signal.state)),
    healthSignals,
    dataFreshness,
    scoring,
    activeRuns,
    pipeline,
    benchmark,
    alerts,
    attestation,
  }
}

async function fetchScoreBundleMetrics(
  supabase: ReturnType<typeof getAdminSupabase>,
  loops: AdminLabLoopSummary[],
): Promise<ScoreBundleMetrics> {
  const byTicket = new Map<string, RunScoreMetrics>()
  const interestingTicketIds = uniqueStrings(
    loops
      .filter((loop) =>
        isActiveResearchLabLoopStatus(loop.statusKey) ||
        isPendingOrBlockingResearchLabLoopStatus(loop.statusKey),
      )
      .map((loop) => loop.ticketId),
  )

  for (const batch of chunked(interestingTicketIds, SUPABASE_IN_FILTER_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('research_evaluation_score_bundle_current')
      .select('score_bundle_id, ticket_id, run_id, bundle_status, current_event_status, current_event_type, current_reason, current_status_at, score_bundle_doc, created_at')
      .in('ticket_id', batch)
      .order('current_status_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(5_000)

    if (error) {
      if (!isExpectedOptionalTimelineSourceMiss(error.message)) {
        console.warn('[admin:research-lab] score bundle metrics unavailable', error.message)
      }
      continue
    }

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const ticketId = stringOr(row.ticket_id)
      if (!ticketId) continue
      const previous = byTicket.get(ticketId)
      const currentAt = isoStringOr(row.current_status_at) ?? isoStringOr(row.created_at)
      if (previous && timestampOrZero(previous.lastScoringAt) >= timestampOrZero(currentAt)) continue
      byTicket.set(ticketId, scoreMetricsForBundleRow(row))
    }
  }

  const volume = await fetchScoreBundleVolume(supabase)
  return {
    byTicket,
    lastScoringAt: latestIso(
      volume.lastScoringAt,
      latestIso(...Array.from(byTicket.values()).map((metric) => metric.lastScoringAt)),
    ) ?? null,
    scoreBundlesLastHour: volume.scoreBundlesLastHour,
    scoreBundlesLast24h: volume.scoreBundlesLast24h,
  }
}

async function fetchScoreBundleVolume(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<Pick<ScoreBundleMetrics, 'lastScoringAt' | 'scoreBundlesLastHour' | 'scoreBundlesLast24h'>> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const since1h = Date.now() - 60 * 60 * 1000
  const { data, error } = await supabase
    .from('research_evaluation_score_bundle_events')
    .select('created_at')
    .gte('created_at', since24h)
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(5_000)

  if (error) {
    if (!isExpectedOptionalTimelineSourceMiss(error.message)) {
      console.warn('[admin:research-lab] score bundle volume unavailable', error.message)
    }
    return { lastScoringAt: null, scoreBundlesLastHour: 0, scoreBundlesLast24h: 0 }
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>
  const lastScoringAt = isoStringOr(rows[0]?.created_at) ?? null
  return {
    lastScoringAt,
    scoreBundlesLastHour: rows.filter((row) => timestampOrZero(row.created_at) >= since1h).length,
    scoreBundlesLast24h: rows.length,
  }
}

function scoreMetricsForBundleRow(row: Record<string, unknown>): RunScoreMetrics {
  const doc = objectRecord(row.score_bundle_doc) ?? {}
  const aggregates = objectRecord(doc.aggregates) ?? {}
  const summary = objectRecord(doc.summary) ?? objectRecord(aggregates.summary) ?? {}
  const perIcp = arrayOfRecords(aggregates.per_icp_results) ?? arrayOfRecords(doc.per_icp_results) ?? []
  const icpTotal = firstFiniteNumber([
    summary.total_icps,
    summary.icp_count,
    aggregates.total_icps,
    aggregates.icp_count,
    doc.total_icps,
    perIcp.length > 0 ? perIcp.length : null,
  ])
  const icpsScored = firstFiniteNumber([
    summary.icps_scored,
    summary.scored_icps,
    aggregates.icps_scored,
    aggregates.scored_icps,
    doc.icps_scored,
    perIcp.length > 0 ? perIcp.filter(isTerminalIcpResult).length : null,
  ])
  return {
    scoreBundleId: stringOr(row.score_bundle_id) ?? null,
    scoreBundleStatus:
      stringOr(row.current_event_status) ??
      stringOr(row.bundle_status) ??
      stringOr(row.current_event_type) ??
      null,
    icpTotal,
    icpsScored,
    lastScoringAt: isoStringOr(row.current_status_at) ?? isoStringOr(row.created_at) ?? null,
  }
}

async function fetchScoringControl(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<ScoringControlSummary> {
  const { rows, sourceAvailable, unavailableReason } = await fetchOptionalRows(
    supabase,
    'ops_scoring_control_current',
    1,
  )
  if (!sourceAvailable) {
    return {
      source: 'missing',
      paused: false,
      state: null,
      pauseReason: unavailableReason,
      updatedAt: null,
    }
  }

  const row = rows[0] ?? {}
  const state =
    stringOr(row.state) ??
    stringOr(row.status) ??
    stringOr(row.scoring_state) ??
    null
  const paused =
    booleanOr(row.paused) ??
    booleanOr(row.is_paused) ??
    (state ? ['paused', 'disabled', 'maintenance'].includes(state.toLowerCase()) : false)
  return {
    source: 'explicit',
    paused,
    state,
    pauseReason:
      stringOr(row.pause_reason) ??
      stringOr(row.reason) ??
      stringOr(row.status_detail) ??
      null,
    updatedAt:
      isoStringOr(row.updated_at) ??
      isoStringOr(row.created_at) ??
      isoStringOr(row.status_at) ??
      null,
  }
}

function buildActiveRuns(
  loops: AdminLabLoopSummary[],
  scoreMetricsByTicket: Map<string, RunScoreMetrics>,
): AdminLabActiveRun[] {
  const now = Date.now()
  return loops
    .filter((loop) =>
      isActiveResearchLabLoopStatus(loop.statusKey) ||
      isPendingOrBlockingResearchLabLoopStatus(loop.statusKey),
    )
    .map((loop) => {
      const scoreMetrics = scoreMetricsByTicket.get(loop.ticketId)
      const idleMs = Math.max(0, now - timestampOrZero(loop.lastActivityAt))
      const ageMs = Math.max(0, now - timestampOrZero(loop.submittedAt))
      const icpTotal = scoreMetrics?.icpTotal ?? null
      const icpsScored = scoreMetrics?.icpsScored ?? null
      const icpsRemaining =
        icpTotal === null
          ? null
          : Math.max(0, icpTotal - (icpsScored ?? 0))
      const candidatesRemaining = Math.max(0, loop.candidateCount - loop.scoredCandidateCount)
      const staleThreshold = loop.statusKey === 'scoring' ? STALE_SCORING_MS : STALE_ACTIVE_MS
      return {
        ticketId: loop.ticketId,
        runId: loop.runId,
        receiptId: loop.receiptId,
        minerHotkey: loop.minerHotkey,
        researchFocusSummary: loop.researchFocusSummary,
        topicTags: loop.topicTags,
        statusKey: loop.statusKey,
        statusLabel: loop.statusLabel,
        phase: phaseForLoop(loop),
        candidateCount: loop.candidateCount,
        scoredCandidateCount: loop.scoredCandidateCount,
        candidatesRemaining,
        icpTotal,
        icpsScored,
        icpsRemaining,
        scoreBundleId: scoreMetrics?.scoreBundleId ?? null,
        scoreBundleStatus: scoreMetrics?.scoreBundleStatus ?? null,
        blocker: loop.actionNote?.detail ?? loop.statusNote?.detail ?? loop.statusDetail ?? loop.opsReason ?? null,
        submittedAt: loop.submittedAt,
        lastActivityAt: loop.lastActivityAt,
        ageMs,
        idleMs,
        stale: idleMs >= staleThreshold,
      }
    })
    .sort((a, b) => {
      if (a.stale !== b.stale) return a.stale ? -1 : 1
      return b.idleMs - a.idleMs
    })
    .slice(0, ACTIVE_RUN_LIMIT)
}

function buildScoringSummary({
  loops,
  activeRuns,
  metrics,
  control,
}: {
  loops: AdminLabLoopSummary[]
  activeRuns: AdminLabActiveRun[]
  metrics: ScoreBundleMetrics
  control: ScoringControlSummary
}): AdminLabScoringSummary {
  const scoringRuns = activeRuns.filter((run) => run.statusKey === 'scoring' || run.phase === 'scoring').length
  const queuedRuns = activeRuns.filter((run) => run.statusKey === 'queued' || run.phase === 'queue').length
  const blockedRuns = loops.filter((loop) => isPendingOrBlockingResearchLabLoopStatus(loop.statusKey)).length
  const staleRuns = activeRuns.filter((run) => run.stale).length
  const candidatesRemaining = activeRuns.reduce((sum, run) => sum + run.candidatesRemaining, 0)
  const knownIcpRuns = activeRuns.filter((run) => run.icpsRemaining !== null)
  const icpsRemaining = knownIcpRuns.length > 0
    ? knownIcpRuns.reduce((sum, run) => sum + (run.icpsRemaining ?? 0), 0)
    : null
  const oldestActiveRunAt = activeRuns.reduce<string | null>((oldest, run) => {
    if (!oldest) return run.submittedAt
    return timestampOrZero(run.submittedAt) < timestampOrZero(oldest) ? run.submittedAt : oldest
  }, null)

  let state: AdminScoringState = 'idle'
  let label = 'Idle'
  let detail = 'No active scoring runs are currently visible.'
  let source: AdminLabScoringSummary['source'] = control.source === 'explicit' ? 'explicit' : 'inferred'

  if (control.paused) {
    state = 'paused'
    label = 'Paused'
    detail = control.pauseReason || 'Scoring is explicitly paused by ops control.'
  } else if (staleRuns > 0) {
    state = 'stalled'
    label = 'Stalled'
    detail = `${staleRuns} active run${staleRuns === 1 ? '' : 's'} have not emitted progress recently.`
  } else if (blockedRuns > 0 && activeRuns.length === 0) {
    state = 'blocked'
    label = 'Blocked'
    detail = `${blockedRuns} loop${blockedRuns === 1 ? '' : 's'} are waiting on funding, baseline, credits, or rescore recovery.`
  } else if (activeRuns.length > 0 || metrics.scoreBundlesLastHour > 0) {
    state = 'active'
    label = 'Active'
    detail = `${activeRuns.length} active run${activeRuns.length === 1 ? '' : 's'} and ${metrics.scoreBundlesLastHour} scoring event${metrics.scoreBundlesLastHour === 1 ? '' : 's'} in the last hour.`
  } else if (control.source === 'missing' && metrics.lastScoringAt === null) {
    source = 'missing'
    state = 'unknown'
    label = 'Unknown'
    detail = 'No scoring-control telemetry table is available and no recent score-bundle events were found.'
  }

  return {
    state,
    label,
    detail,
    source,
    paused: control.paused,
    pauseReason: control.pauseReason,
    controlUpdatedAt: control.updatedAt,
    activeRuns: activeRuns.length,
    scoringRuns,
    queuedRuns,
    blockedRuns,
    staleRuns,
    candidatesRemaining,
    icpsRemaining,
    scoreBundlesLastHour: metrics.scoreBundlesLastHour,
    scoreBundlesLast24h: metrics.scoreBundlesLast24h,
    lastScoringAt: metrics.lastScoringAt,
    oldestActiveRunAt,
  }
}

function buildPipelineStages(loops: AdminLabLoopSummary[]): AdminLabPipelineStage[] {
  const total = Math.max(loops.length, 1)
  const now = Date.now()
  const stages = [
    {
      id: 'queued',
      label: 'Queued / funded',
      loops: loops.filter((loop) =>
        ['queued', 'paid_not_started', 'awaiting_payment', 'waiting_for_baseline', 'blocked_for_credit'].includes(loop.statusKey),
      ),
    },
    {
      id: 'running',
      label: 'Running',
      loops: loops.filter((loop) => isActiveResearchLabLoopStatus(loop.statusKey) && loop.statusKey !== 'scoring'),
    },
    {
      id: 'scoring',
      label: 'Scoring',
      loops: loops.filter((loop) => loop.statusKey === 'scoring'),
    },
    {
      id: 'scored',
      label: 'Scored',
      loops: loops.filter((loop) => isScoredResearchLabLoopStatus(loop.statusKey)),
    },
    {
      id: 'promoted',
      label: 'Promoted',
      loops: loops.filter((loop) => isPromisingResearchLabLoopStatus(loop.statusKey, loop.outcomeBand)),
    },
    {
      id: 'failed',
      label: 'Needs attention',
      loops: loops.filter((loop) => isNoGainOrFailedResearchLabLoopStatus(loop.statusKey) || isFailedOutcome(loop.outcomeLabel, loop.outcomeBand)),
    },
  ]

  return stages.map((stage) => ({
    id: stage.id,
    label: stage.label,
    count: stage.loops.length,
    staleCount: stage.loops.filter((loop) => now - timestampOrZero(loop.lastActivityAt) >= STALE_ACTIVE_MS).length,
    percent: Math.round((stage.loops.length / total) * 100),
  }))
}

async function fetchBenchmarkSummary(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<AdminLabBenchmarkSummary> {
  const { data, error } = await supabase
    .from('research_lab_public_benchmark_report_current')
    .select('report_id, benchmark_date, rolling_window_hash, aggregate_score, report_doc, current_report_status, current_status_at, created_at')
    .eq('current_report_status', 'published')
    .order('benchmark_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    return emptyBenchmarkSummary('Could not read current benchmark report.')
  }

  const row = ((data ?? []) as Array<Record<string, unknown>>)[0]
  if (!row) return emptyBenchmarkSummary('No published benchmark report is available.')

  const doc = objectRecord(row.report_doc) ?? {}
  const currentStatusAt = isoStringOr(row.current_status_at) ?? isoStringOr(row.created_at) ?? null
  const ageMs = currentStatusAt ? Date.now() - timestampOrZero(currentStatusAt) : null
  const publicIcps = arrayOfRecords(doc.public_icps) ?? []
  const topIssues = Object.entries(objectRecord(doc.model_issue_counts) ?? {})
    .map(([key, value]) => ({ key, count: Math.max(0, Math.round(numberOr(value, 0))) }))
    .filter((issue) => issue.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  let state: AdminHealthState = 'healthy'
  if (ageMs === null) state = 'unknown'
  else if (ageMs > 48 * 60 * 60 * 1000) state = 'critical'
  else if (ageMs > 30 * 60 * 60 * 1000) state = 'degraded'

  const itemCount = numberOr(doc.item_count, publicIcps.length)
  const aggregateScore = nullableNumber(doc.aggregate_score ?? row.aggregate_score)
  return {
    state,
    reportId: stringOr(row.report_id) ?? null,
    benchmarkDate: stringOr(doc.benchmark_date) ?? stringOr(row.benchmark_date) ?? null,
    rollingWindowHash: stringOr(doc.rolling_window_hash) ?? stringOr(row.rolling_window_hash) ?? null,
    aggregateScore,
    itemCount,
    publicIcpCount: numberOr(doc.public_icp_count, numberOr(objectRecord(doc.visibility_split)?.public_count, publicIcps.length)),
    privateHoldoutIcpCount: numberOr(doc.private_holdout_icp_count, numberOr(objectRecord(doc.visibility_split)?.private_count, 0)),
    currentStatusAt,
    ageMs,
    issueCount: topIssues.reduce((sum, issue) => sum + issue.count, 0),
    topIssues,
    detail: state === 'healthy'
      ? 'Current published benchmark is fresh.'
      : 'Benchmark publication is stale or missing timing metadata.',
  }
}

function emptyBenchmarkSummary(detail: string): AdminLabBenchmarkSummary {
  return {
    state: 'unknown',
    reportId: null,
    benchmarkDate: null,
    rollingWindowHash: null,
    aggregateScore: null,
    itemCount: 0,
    publicIcpCount: 0,
    privateHoldoutIcpCount: 0,
    currentStatusAt: null,
    ageMs: null,
    issueCount: 0,
    topIssues: [],
    detail,
  }
}

async function fetchAlertSummary(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<AdminLabAlertSummary> {
  const current = await fetchOptionalRows(supabase, 'ops_alert_current', 500)
  const fallback = current.sourceAvailable
    ? current
    : await fetchOptionalRows(supabase, 'ops_alert_events', 500)

  if (!fallback.sourceAvailable) {
    return {
      state: 'unknown',
      sourceAvailable: false,
      unavailableReason: fallback.unavailableReason,
      totalLast24h: 0,
      criticalLast24h: 0,
      warningLast24h: 0,
      activeCount: 0,
      recent: [],
    }
  }

  const since24h = Date.now() - 24 * 60 * 60 * 1000
  const alerts = fallback.rows
    .map(normalizeAlertRow)
    .filter(Boolean) as AdminLabAlert[]
  alerts.sort((a, b) => timestampOrZero(b.lastSeenAt ?? b.firstSeenAt) - timestampOrZero(a.lastSeenAt ?? a.firstSeenAt))
  const last24h = alerts.filter((alert) => timestampOrZero(alert.lastSeenAt ?? alert.firstSeenAt) >= since24h)
  const criticalLast24h = last24h.filter((alert) => alert.severity.toLowerCase() === 'critical').length
  const warningLast24h = last24h.filter((alert) => ['warning', 'warn'].includes(alert.severity.toLowerCase())).length
  const activeCount = alerts.filter((alert) => !['resolved', 'closed', 'acked'].includes(alert.status.toLowerCase())).length
  const totalWeighted = last24h.reduce((sum, alert) => sum + Math.max(1, alert.count), 0)
  const state: AdminHealthState =
    criticalLast24h > 0 || totalWeighted >= 50
      ? 'critical'
      : warningLast24h > 0 || totalWeighted >= 10
        ? 'degraded'
        : 'healthy'

  return {
    state,
    sourceAvailable: true,
    unavailableReason: null,
    totalLast24h: totalWeighted,
    criticalLast24h,
    warningLast24h,
    activeCount,
    recent: alerts.slice(0, 8),
  }
}

function normalizeAlertRow(row: Record<string, unknown>): AdminLabAlert | null {
  const title = stringOr(row.title) ?? stringOr(row.message) ?? stringOr(row.alert_name) ?? stringOr(row.fingerprint)
  if (!title) return null
  return {
    id: stringOr(row.id) ?? stringOr(row.alert_id) ?? title,
    severity: stringOr(row.severity) ?? stringOr(row.level) ?? 'info',
    source: stringOr(row.source) ?? stringOr(row.component) ?? 'ops',
    title,
    fingerprint: stringOr(row.fingerprint) ?? stringOr(row.alert_key) ?? title,
    status: stringOr(row.status) ?? stringOr(row.alert_status) ?? 'active',
    count: Math.max(1, Math.round(numberOr(row.count ?? row.event_count, 1))),
    firstSeenAt: isoStringOr(row.first_seen_at) ?? isoStringOr(row.created_at) ?? null,
    lastSeenAt:
      isoStringOr(row.last_seen_at) ??
      isoStringOr(row.updated_at) ??
      isoStringOr(row.created_at) ??
      null,
  }
}

async function fetchAttestationSummary(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<AdminLabAttestationSummary> {
  const result = await fetchOptionalRows(supabase, 'ops_attestation_current', 200)
  if (!result.sourceAvailable) {
    return {
      state: 'unknown',
      sourceAvailable: false,
      unavailableReason: result.unavailableReason,
      totalNodes: 0,
      matchedNodes: 0,
      mismatchedNodes: 0,
      missingNodes: 0,
      expectedPcr0: null,
      latestAttestedAt: null,
      nodes: [],
    }
  }

  const nodes = result.rows.map(normalizeAttestationRow)
  const mismatchedNodes = nodes.filter((node) => node.matched === false).length
  const missingNodes = nodes.filter((node) => node.matched === null).length
  const matchedNodes = nodes.filter((node) => node.matched === true).length
  const latestAttestedAt = latestIso(...nodes.map((node) => node.attestedAt)) ?? null
  const expectedPcr0 = nodes.find((node) => node.expectedPcr0)?.expectedPcr0 ?? null
  const state: AdminHealthState =
    nodes.length === 0
      ? 'unknown'
      : mismatchedNodes > 0
        ? 'critical'
        : missingNodes > 0
          ? 'degraded'
          : 'healthy'

  return {
    state,
    sourceAvailable: true,
    unavailableReason: null,
    totalNodes: nodes.length,
    matchedNodes,
    mismatchedNodes,
    missingNodes,
    expectedPcr0,
    latestAttestedAt,
    nodes: nodes
      .sort((a, b) => {
        const aBad = a.matched === false ? 0 : a.matched === null ? 1 : 2
        const bBad = b.matched === false ? 0 : b.matched === null ? 1 : 2
        return aBad - bBad || timestampOrZero(b.attestedAt) - timestampOrZero(a.attestedAt)
      })
      .slice(0, 12),
  }
}

function normalizeAttestationRow(row: Record<string, unknown>): AdminLabAttestationNode {
  const expectedPcr0 = stringOr(row.expected_pcr0) ?? stringOr(row.expectedPCR0) ?? null
  const observedPcr0 =
    stringOr(row.observed_pcr0) ??
    stringOr(row.pcr0) ??
    stringOr(row.observedPCR0) ??
    null
  const explicitMatched = booleanOr(row.matched) ?? booleanOr(row.pcr0_matched)
  const matched = explicitMatched ?? (
    expectedPcr0 && observedPcr0
      ? expectedPcr0.toLowerCase() === observedPcr0.toLowerCase()
      : null
  )
  const nodeId =
    stringOr(row.node_id) ??
    stringOr(row.worker_id) ??
    stringOr(row.validator_id) ??
    stringOr(row.component_id) ??
    'unknown'
  const component = stringOr(row.component) ?? stringOr(row.service) ?? 'scoring'
  return {
    id: stringOr(row.id) ?? `${component}:${nodeId}`,
    component,
    nodeId,
    hotkey: stringOr(row.hotkey) ?? stringOr(row.miner_hotkey) ?? stringOr(row.validator_hotkey) ?? null,
    expectedPcr0,
    observedPcr0,
    matched,
    buildId: stringOr(row.build_id) ?? stringOr(row.image_digest) ?? null,
    gitSha: stringOr(row.git_sha) ?? stringOr(row.git_commit_sha) ?? null,
    attestedAt:
      isoStringOr(row.attested_at) ??
      isoStringOr(row.updated_at) ??
      isoStringOr(row.created_at) ??
      null,
  }
}

function buildDataFreshness(loops: AdminLabLoopSummary[]): AdminLabDataFreshness {
  const latestActivityAt = latestIso(...loops.map((loop) => loop.lastActivityAt)) ?? null
  const ageMs = latestActivityAt ? Date.now() - timestampOrZero(latestActivityAt) : null
  const state: AdminHealthState =
    ageMs === null
      ? 'unknown'
      : ageMs <= FRESH_DATA_MS
        ? 'healthy'
        : ageMs <= DEGRADED_DATA_MS
          ? 'degraded'
          : 'critical'
  return {
    state,
    latestActivityAt,
    ageMs,
    loopCount: loops.length,
  }
}

function buildHealthSignals(input: {
  dataFreshness: AdminLabDataFreshness
  scoring: AdminLabScoringSummary
  benchmark: AdminLabBenchmarkSummary
  alerts: AdminLabAlertSummary
  attestation: AdminLabAttestationSummary
}): AdminLabHealthSignal[] {
  return [
    {
      id: 'scoring',
      label: 'Scoring',
      value: input.scoring.label,
      state: healthStateForScoring(input.scoring.state),
      detail: input.scoring.detail,
      updatedAt: input.scoring.lastScoringAt ?? input.scoring.controlUpdatedAt,
    },
    {
      id: 'pcr0',
      label: 'PCR0',
      value: input.attestation.sourceAvailable
        ? `${input.attestation.matchedNodes}/${input.attestation.totalNodes} matched`
        : 'Not wired',
      state: input.attestation.state,
      detail: input.attestation.sourceAvailable
        ? input.attestation.mismatchedNodes > 0
          ? `${input.attestation.mismatchedNodes} node${input.attestation.mismatchedNodes === 1 ? '' : 's'} report PCR0 mismatch.`
          : input.attestation.missingNodes > 0
            ? `${input.attestation.missingNodes} node${input.attestation.missingNodes === 1 ? '' : 's'} are missing PCR0 data.`
            : 'All reporting nodes match expected PCR0.'
        : 'ops_attestation_current is not available yet.',
      updatedAt: input.attestation.latestAttestedAt,
    },
    {
      id: 'alerts',
      label: 'Alerts',
      value: input.alerts.sourceAvailable
        ? `${input.alerts.totalLast24h} / 24h`
        : 'Not wired',
      state: input.alerts.state,
      detail: input.alerts.sourceAvailable
        ? `${input.alerts.criticalLast24h} critical, ${input.alerts.warningLast24h} warning, ${input.alerts.activeCount} active.`
        : 'ops_alert_current or ops_alert_events is not available yet.',
      updatedAt: input.alerts.recent[0]?.lastSeenAt,
    },
    {
      id: 'benchmark',
      label: 'Benchmark',
      value: input.benchmark.aggregateScore === null ? 'Unknown' : input.benchmark.aggregateScore.toFixed(2),
      state: input.benchmark.state,
      detail: input.benchmark.detail,
      updatedAt: input.benchmark.currentStatusAt,
    },
    {
      id: 'freshness',
      label: 'Data',
      value: input.dataFreshness.ageMs === null ? 'No events' : `${Math.round(input.dataFreshness.ageMs / 60000)}m old`,
      state: input.dataFreshness.state,
      detail: input.dataFreshness.latestActivityAt
        ? `Latest Lab activity at ${input.dataFreshness.latestActivityAt}.`
        : 'No Lab activity rows were returned.',
      updatedAt: input.dataFreshness.latestActivityAt,
    },
  ]
}

async function fetchOptionalRows(
  supabase: ReturnType<typeof getAdminSupabase>,
  table: string,
  limit: number,
): Promise<{ rows: Array<Record<string, unknown>>; sourceAvailable: boolean; unavailableReason: string | null }> {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .limit(limit)

  if (error) {
    if (!isExpectedOptionalTimelineSourceMiss(error.message)) {
      console.warn(`[admin:research-lab] optional source unavailable: ${table}`, error.message)
    }
    return {
      rows: [],
      sourceAvailable: false,
      unavailableReason: error.message,
    }
  }

  return {
    rows: (data ?? []) as Array<Record<string, unknown>>,
    sourceAvailable: true,
    unavailableReason: null,
  }
}

function normalizeLoopRow(row: AdminLabLoopRow): AdminLabLoopSummary {
  const doc = objectRecord(row.current_event_doc) ?? {}
  const projectedOutcomeLabel = row.current_outcome_label || 'submitted'
  const projectedOutcomeBand = row.current_outcome_band || 'pending'
  const publicStatus =
    stringOr(row.public_status) ??
    stringOr(row.current_public_status) ??
    stringOr(doc.public_status) ??
    stringOr(doc.current_public_status)
  const paymentState =
    stringOr(row.payment_state) ??
    stringOr(row.current_payment_state) ??
    stringOr(doc.payment_state) ??
    stringOr(doc.current_payment_state)
  const executionState =
    stringOr(row.execution_state) ??
    stringOr(row.current_execution_state) ??
    stringOr(doc.execution_state) ??
    stringOr(doc.current_execution_state)
  const candidateState =
    stringOr(row.candidate_state) ??
    stringOr(row.current_candidate_state) ??
    stringOr(doc.candidate_state) ??
    stringOr(doc.current_candidate_state)
  const resultState =
    stringOr(row.result_state) ??
    stringOr(row.current_result_state) ??
    stringOr(doc.result_state) ??
    stringOr(doc.current_result_state)
  const opsReason =
    stringOr(row.ops_reason) ??
    stringOr(row.current_ops_reason) ??
    stringOr(doc.ops_reason) ??
    stringOr(doc.current_ops_reason)
  const statusDetail =
    stringOr(row.status_detail) ??
    stringOr(row.current_status_detail) ??
    stringOr(doc.status_detail) ??
    stringOr(doc.current_status_detail)
  const opsWarnings = warningStrings(
    row.ops_warnings ??
      row.current_ops_warnings ??
      doc.ops_warnings ??
      doc.current_ops_warnings,
  )
  const improvementGate = objectRecord(doc.improvement_gate) ?? objectRecord(doc.improvementGate)
  const promotionDoc = objectRecord(doc.promotion)
  const candidateCount = numberOr(row.current_candidate_count, 0)
  const scoredCandidateCount = numberOr(row.current_scored_candidate_count, 0)
  const displayStatus = deriveResearchLabLoopStatus({
    publicStatus,
    paymentState,
    executionState,
    candidateState,
    resultState,
    opsReason,
    statusDetail,
    opsWarnings,
    outcomeLabel: projectedOutcomeLabel,
    outcomeBand: projectedOutcomeBand,
    runId: row.current_run_id,
    receiptId: row.current_receipt_id,
    candidateCount,
    scoredCandidateCount,
    currentCandidateStatus:
      row.current_candidate_status ??
      stringOr(doc.current_candidate_status) ??
      stringOr(doc.candidate_status),
    currentReason:
      row.current_reason ??
      stringOr(doc.current_reason) ??
      stringOr(doc.candidate_reason) ??
      stringOr(doc.projection_reason),
    currentQueueStatus: row.current_queue_status ?? stringOr(doc.queue_status),
    currentReceiptStatus: row.current_receipt_status ?? stringOr(doc.receipt_status),
    currentStatus: row.current_status,
    improvementGateDecision:
      row.current_improvement_gate_decision ??
      row.improvement_gate_decision ??
      stringOr(doc.current_improvement_gate_decision) ??
      stringOr(doc.improvement_gate_decision) ??
      stringOr(improvementGate?.decision),
    promotionStatus:
      row.current_promotion_status ??
      row.promotion_status ??
      stringOr(doc.current_promotion_status) ??
      stringOr(doc.promotion_status) ??
      stringOr(promotionDoc?.status),
    promotionEventType:
      row.current_promotion_event_type ??
      row.promotion_event_type ??
      stringOr(doc.current_promotion_event_type) ??
      stringOr(doc.promotion_event_type) ??
      stringOr(promotionDoc?.event_type),
    promotionEvent:
      row.current_promotion_event ??
      row.promotion_event ??
      stringOr(doc.current_promotion_event) ??
      stringOr(doc.promotion_event) ??
      stringOr(promotionDoc?.event),
    eventType:
      row.current_event_type ??
      row.event_type ??
      stringOr(doc.current_event_type) ??
      stringOr(doc.event_type),
  })

  return {
    cardId: row.card_id,
    ticketId: row.ticket_id,
    runId: row.current_run_id,
    receiptId: row.current_receipt_id,
    minerHotkey: row.miner_hotkey ?? '',
    researchArea: row.research_area || 'generalist',
    researchFocusSummary: row.research_focus_summary || '',
    topicTags: arrayOfStrings(row.current_topic_tags ?? row.topic_tags),
    topicSignatureHash: row.current_topic_signature_hash || row.topic_signature_hash || '',
    outcomeLabel: row.current_status || displayStatus.label || projectedOutcomeLabel,
    outcomeBand: displayStatus.band || projectedOutcomeBand,
    publicStatus,
    paymentState,
    executionState,
    candidateState,
    resultState,
    opsReason,
    statusDetail,
    opsWarnings,
    statusKey: displayStatus.key,
    statusLabel: displayStatus.label,
    statusNote: displayStatus.note,
    actionNote: displayStatus.action,
    candidateCount,
    scoredCandidateCount,
    bestCandidatePublicSummary: row.current_best_candidate_public_summary || '',
    lastActivityAt: row.current_last_activity_at || row.created_at,
    submittedAt: row.created_at,
  }
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.filter((item): item is Record<string, unknown> =>
    Boolean(item) && typeof item === 'object' && !Array.isArray(item),
  )
  return out.length > 0 ? out : undefined
}

function numberOr(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function nullableNumber(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function firstFiniteNumber(values: unknown[]): number | null {
  for (const value of values) {
    const numeric = nullableNumber(value)
    if (numeric !== null) return numeric
  }
  return null
}

function booleanOr(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', 't', 'yes', '1', 'matched'].includes(normalized)) return true
    if (['false', 'f', 'no', '0', 'mismatch', 'missing'].includes(normalized)) return false
  }
  return undefined
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isoStringOr(value: unknown): string | undefined {
  const text = stringOr(value)
  if (!text) return undefined
  const time = new Date(text).getTime()
  return Number.isFinite(time) ? text : undefined
}

function timestampOrZero(value: unknown): number {
  const text = typeof value === 'string' ? value : undefined
  const time = text ? new Date(text).getTime() : Number(value)
  return Number.isFinite(time) ? time : 0
}

function latestIso(...values: Array<string | null | undefined>): string | undefined {
  let latest: string | undefined
  for (const value of values) {
    if (!value) continue
    if (!latest || timestampOrZero(value) > timestampOrZero(latest)) latest = value
  }
  return latest
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)))
}

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

function warningStrings(value: unknown): string[] | undefined {
  if (!value) return undefined
  if (Array.isArray(value)) {
    const out = value
      .map((item) => {
        if (typeof item === 'string') return item
        const record = objectRecord(item)
        return stringOr(record?.message) ?? stringOr(record?.detail) ?? stringOr(record?.reason)
      })
      .filter((item): item is string => Boolean(item))
    return out.length > 0 ? out : undefined
  }
  if (typeof value === 'string') return value.trim() ? [value.trim()] : undefined
  const record = objectRecord(value)
  if (!record) return undefined
  const out = Object.values(record)
    .map((item) => (typeof item === 'string' ? item : undefined))
    .filter((item): item is string => Boolean(item))
  return out.length > 0 ? out : undefined
}

function isTerminalIcpResult(row: Record<string, unknown>): boolean {
  const status = `${row.status ?? ''} ${row.result_status ?? ''} ${row.failure_reason ?? ''}`.toLowerCase()
  if (status.includes('pending') || status.includes('running') || status.includes('queued')) return false
  return Boolean(
    status.includes('scored') ||
      status.includes('pass') ||
      status.includes('fail') ||
      status.includes('reject') ||
      Number.isFinite(Number(row.final_score ?? row.score)),
  )
}

function phaseForLoop(loop: AdminLabLoopSummary): string {
  const status = loop.statusKey.toLowerCase()
  const text = [
    status,
    loop.publicStatus,
    loop.executionState,
    loop.candidateState,
    loop.resultState,
  ].filter(Boolean).join(' ').toLowerCase()
  if (status.includes('scoring') || text.includes('scoring') || text.includes('evaluation')) return 'scoring'
  if (status.includes('queued') || status.includes('payment') || status.includes('baseline') || text.includes('queued')) return 'queue'
  if (text.includes('candidate')) return 'candidate'
  if (isCompletedResearchLabLoopStatus(status)) return 'complete'
  if (isActiveResearchLabLoopStatus(status)) return 'auto research'
  return status || 'unknown'
}

function healthStateForScoring(state: AdminScoringState): AdminHealthState {
  if (state === 'active' || state === 'idle') return 'healthy'
  if (state === 'paused' || state === 'stalled' || state === 'blocked') return 'degraded'
  return 'unknown'
}

function worstHealthState(states: AdminHealthState[]): AdminHealthState {
  if (states.includes('critical')) return 'critical'
  if (states.includes('degraded')) return 'degraded'
  if (states.includes('healthy')) return 'healthy'
  return 'unknown'
}

function isFailedOutcome(label: string, band: string): boolean {
  const value = `${label} ${band}`.toLowerCase()
  return value.includes('failed') || value.includes('cancelled')
}

function isExpectedOptionalTimelineSourceMiss(message: string | undefined): boolean {
  const normalized = (message ?? '').toLowerCase()
  return normalized.includes('does not exist') || normalized.includes('could not find')
}
