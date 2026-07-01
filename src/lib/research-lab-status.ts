export type ResearchLabLoopStatusTone = 'info' | 'warning' | 'error'

export type ResearchLabLoopStatusNote = {
  tone: ResearchLabLoopStatusTone
  label: string
  detail: string
}

export type ResearchLabLoopStatusInput = {
  outcomeLabel?: string | null
  outcomeBand?: string | null
  runId?: string | null
  receiptId?: string | null
  candidateCount?: number | null
  scoredCandidateCount?: number | null
  candidateStatus?: string | null
  currentCandidateStatus?: string | null
  reason?: string | null
  currentReason?: string | null
  queueStatus?: string | null
  currentQueueStatus?: string | null
  receiptStatus?: string | null
  currentReceiptStatus?: string | null
  currentStatus?: string | null
}

export type ResearchLabLoopStatus = {
  key: string
  label: string
  band: string
  note?: ResearchLabLoopStatusNote
  active: boolean
  scoring: boolean
  completed: boolean
  scored: boolean
  promising: boolean
  noGainOrFailed: boolean
  pendingOrBlocking: boolean
}

export type ResearchLabActivityFilterInput = {
  minerHotkey?: string | null
  topicSignatureHash?: string | null
  topicTags?: string[] | null
  researchArea?: string | null
  outcomeLabel?: string | null
  statusKey?: string | null
  statusLabel?: string | null
  lastActivityAt?: string | null
}

export type ResearchLabActivityFilters = {
  minerQuery?: string
  direction?: string
  outcome?: string
}

export type ResearchLabOutcomeFilterOption = {
  value: string
  label: string
  count?: number
}

const FAILED_VALUES = new Set([
  'failed',
  'failure',
  'error',
  'errored',
  'cancelled',
  'canceled',
  'timeout',
  'timed_out',
])

const ACTIVE_VALUES = new Set([
  'queued',
  'assigned',
  'running',
  'scoring',
  'evaluating',
  'evaluation_running',
  'in_progress',
  'processing',
  'started',
])

const SCORING_VALUES = new Set([
  'assigned',
  'running',
  'scoring',
  'evaluating',
  'evaluation_running',
  'processing',
])

const BASELINE_NOT_READY_VALUES = new Set([
  'baseline_not_ready',
  'benchmark_baseline_not_ready',
  'parent_baseline_not_ready',
  'waiting_for_baseline',
])

const ACTIVE_STATUS_KEYS = new Set(['queued', 'running', 'scoring'])
const SCORED_STATUS_KEYS = new Set([
  'scored',
  'scored_no_gain',
  'scored_promising',
  'promotion_passed',
  'promoted',
  'winner',
  'high_gain',
])
const COMPLETED_STATUS_KEYS = new Set([
  'candidate_generation_complete',
  'completed',
  'scored',
  'scored_no_gain',
  'scored_promising',
  'promotion_passed',
  'promoted',
  'winner',
  'high_gain',
  'failed',
])
const PROMISING_STATUS_KEYS = new Set([
  'scored_promising',
  'promotion_passed',
  'promoted',
  'winner',
  'high_gain',
])
const PROMISING_BANDS = new Set(['small_gain', 'passed_threshold', 'promoted', 'high_gain', 'winner'])
const NO_GAIN_OR_FAILED_KEYS = new Set(['scored_no_gain', 'failed'])
const PENDING_OR_BLOCKING_STATUS_KEYS = new Set([
  'queued',
  'waiting_for_baseline',
  'blocked_for_credit',
  'needs_rescore',
  'not_started',
  'failed',
])

export const RESEARCH_LAB_OUTCOME_FILTER_OPTIONS: ResearchLabOutcomeFilterOption[] = [
  { value: 'all', label: 'All outcomes' },
  { value: 'scoring', label: 'Scoring' },
  { value: 'waiting_for_baseline', label: 'Waiting for baseline' },
  { value: 'not_started', label: 'Not started' },
  { value: 'completed_no_candidate', label: 'Completed no candidate' },
  { value: 'failed', label: 'Failed' },
  { value: 'scored', label: 'Scored' },
  { value: 'scored_no_gain', label: 'Scored, no gain' },
  { value: 'blocked_for_credit', label: 'Waiting for credits' },
  { value: 'needs_rescore', label: 'Needs rescore' },
]

export function deriveResearchLabLoopStatus(input: ResearchLabLoopStatusInput): ResearchLabLoopStatus {
  const projectedLabel = normalize(input.outcomeLabel) || 'submitted'
  const projectedBand = normalize(input.outcomeBand) || 'pending'
  const candidateStatus = normalize(input.currentCandidateStatus ?? input.candidateStatus)
  const reason = normalize(input.currentReason ?? input.reason)
  const queueStatus = normalize(input.currentQueueStatus ?? input.queueStatus)
  const receiptStatus = normalize(input.currentReceiptStatus ?? input.receiptStatus)
  const currentStatus = normalize(input.currentStatus)
  const operationalValues = [candidateStatus, queueStatus, receiptStatus, currentStatus].filter(Boolean)
  const scoredOpsNote = scoredOutcomeOpsFailureNote(
    projectedLabel,
    candidateStatus,
    queueStatus,
    receiptStatus
  )

  const promotion = promotionStatus(projectedLabel, projectedBand, candidateStatus, scoredOpsNote)
  if (promotion) return promotion

  if (projectedLabel === 'scored_no_gain' || projectedBand === 'no_gain' || candidateStatus === 'scored_no_gain') {
    return status('scored_no_gain', 'Scored, no gain', 'no_gain', scoredOpsNote)
  }

  if (projectedLabel === 'scored') {
    return status('scored', 'Scored', canonicalBand(projectedBand, 'completed'), scoredOpsNote)
  }

  if (FAILED_VALUES.has(projectedLabel)) {
    return status('failed', 'Failed', 'failed', {
      tone: 'error',
      label: 'Failed',
      detail: 'The canonical public outcome is terminal failed.',
    })
  }

  if (isNeedsRescore(projectedLabel, candidateStatus, reason)) {
    return status('needs_rescore', 'Needs rescore', 'stale', {
      tone: 'warning',
      label: 'Needs rescore',
      detail: 'Candidate was created against an older parent model and needs to be rebased or rescored against the current parent.',
    })
  }

  if (isBaselineNotReady(projectedLabel, reason, operationalValues)) {
    const completedGeneration = queueStatus === 'completed' || projectedLabel === 'completed'
    return status('waiting_for_baseline', labelForStatus('waiting_for_baseline'), 'pending', {
      tone: 'warning',
      label: labelForStatus('waiting_for_baseline'),
      detail: completedGeneration
        ? 'Candidate generation completed, but scoring is waiting for the benchmark baseline.'
        : 'Scoring is waiting for the benchmark baseline to become ready.',
    })
  }

  if (ACTIVE_STATUS_KEYS.has(projectedLabel) && (!operationalValues.length || hasAny(operationalValues, ACTIVE_VALUES))) {
    if (projectedLabel === 'scoring') return status('scoring', 'Scoring', 'running')
    if (projectedLabel === 'running') return status('running', 'Running', 'running')
    return status('queued', 'Queued', 'pending')
  }

  return status(projectedLabel, labelForStatus(projectedLabel), projectedBand)
}

export function isActiveResearchLabLoopStatus(key: string): boolean {
  return ACTIVE_STATUS_KEYS.has(normalize(key))
}

export function isScoredResearchLabLoopStatus(key: string): boolean {
  return SCORED_STATUS_KEYS.has(normalize(key))
}

export function isCompletedResearchLabLoopStatus(key: string): boolean {
  return COMPLETED_STATUS_KEYS.has(normalize(key))
}

export function isPromisingResearchLabLoopStatus(key: string, band?: string | null): boolean {
  return PROMISING_STATUS_KEYS.has(normalize(key)) || PROMISING_BANDS.has(normalize(band))
}

export function isNoGainOrFailedResearchLabLoopStatus(key: string): boolean {
  return NO_GAIN_OR_FAILED_KEYS.has(normalize(key))
}

export function isPendingOrBlockingResearchLabLoopStatus(key: string): boolean {
  return PENDING_OR_BLOCKING_STATUS_KEYS.has(normalize(key))
}

export function researchLabStatusLabel(value: string | null | undefined): string {
  return labelForStatus(normalize(value) || 'submitted')
}

export function researchLabOutcomeFilterKey(value: string | null | undefined): string {
  const normalized = normalize(value)
  if (normalized === 'scored_promising') return 'scored'
  return normalized
}

export function researchLabLoopDirectionKey(loop: ResearchLabActivityFilterInput): string {
  const tags = Array.isArray(loop.topicTags) ? loop.topicTags.filter(Boolean) : []
  return normalize(loop.topicSignatureHash) || tags.join('|') || normalize(loop.researchArea) || 'generalist'
}

export function researchLabOutcomeFilterOptionsWithCounts<T extends ResearchLabActivityFilterInput>(
  loops: T[],
  filters: Pick<ResearchLabActivityFilters, 'minerQuery' | 'direction'> = {},
): ResearchLabOutcomeFilterOption[] {
  const scopedLoops = filterResearchLabActivityLoops(loops, {
    minerQuery: filters.minerQuery,
    direction: filters.direction,
    outcome: 'all',
  })
  const counts = new Map<string, number>([['all', scopedLoops.length]])

  for (const loop of scopedLoops) {
    const key = researchLabOutcomeFilterKey(loop.statusKey || loop.outcomeLabel)
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return RESEARCH_LAB_OUTCOME_FILTER_OPTIONS
    .map((option) => ({
      ...option,
      count: counts.get(option.value) ?? 0,
    }))
    .filter((option) => option.value === 'all' || (option.count ?? 0) > 0)
}

export function filterResearchLabActivityLoops<T extends ResearchLabActivityFilterInput>(
  loops: T[],
  filters: ResearchLabActivityFilters,
): T[] {
  const q = normalize(filters.minerQuery)
  const direction = filters.direction || 'all'
  const outcome = filters.outcome || 'all'

  return loops
    .filter((loop) => {
      if (direction !== 'all' && researchLabLoopDirectionKey(loop) !== direction) return false
      if (outcome !== 'all' && researchLabOutcomeFilterKey(loop.statusKey || loop.outcomeLabel) !== outcome) return false
      if (!q) return true
      return normalize(loop.minerHotkey).includes(q)
    })
    .slice()
    .sort((a, b) => timeValue(b.lastActivityAt) - timeValue(a.lastActivityAt))
}

function promotionStatus(
  projectedLabel: string,
  projectedBand: string,
  candidateStatus: string,
  note?: ResearchLabLoopStatusNote,
): ResearchLabLoopStatus | null {
  if (projectedLabel === 'promoted' || candidateStatus === 'promoted') {
    return status('promoted', 'Promoted', canonicalBand(projectedBand, 'promoted'), note)
  }
  if (projectedLabel === 'winner' || candidateStatus === 'winner') {
    return status('winner', 'Winner', canonicalBand(projectedBand, 'promoted'), note)
  }
  if (projectedLabel === 'high_gain') {
    return status('high_gain', 'High gain', canonicalBand(projectedBand, 'high_gain'), note)
  }
  if (projectedLabel === 'promotion_passed') {
    return status('promotion_passed', 'Promotion passed', canonicalBand(projectedBand, 'passed_threshold'), note)
  }
  if (projectedLabel === 'scored_promising') {
    return status('scored_promising', 'Scored', canonicalBand(projectedBand, 'small_gain'), note)
  }
  return null
}

function canonicalBand(projectedBand: string, fallback: string): string {
  if (!projectedBand || projectedBand === 'pending' || projectedBand === 'failed') return fallback
  return projectedBand
}

function scoredOutcomeOpsFailureNote(
  projectedLabel: string,
  candidateStatus: string,
  queueStatus: string,
  receiptStatus: string,
): ResearchLabLoopStatusNote | undefined {
  if (!hasAny([queueStatus, receiptStatus].filter(Boolean), FAILED_VALUES)) return undefined
  if (candidateStatus !== 'scored' && !isCanonicalScoredOutcome(projectedLabel)) return undefined
  return {
    tone: 'warning',
    label: 'Ops warning',
    detail: 'Queue or receipt state is terminal failed, but the canonical model outcome is preserved.',
  }
}

function isCanonicalScoredOutcome(value: string): boolean {
  return SCORED_STATUS_KEYS.has(normalize(value))
}

function isBaselineNotReady(projectedLabel: string, reason: string, operationalValues: string[]): boolean {
  return BASELINE_NOT_READY_VALUES.has(projectedLabel) ||
    BASELINE_NOT_READY_VALUES.has(reason) ||
    hasAny(operationalValues, BASELINE_NOT_READY_VALUES)
}

function isNeedsRescore(projectedLabel: string, candidateStatus: string, reason: string): boolean {
  return (
    projectedLabel === 'needs_rescore' ||
    candidateStatus === 'needs_rescore' ||
    reason === 'needs_rescore' ||
    reason === 'stale_parent' ||
    reason === 'stale_parent_needs_rescore' ||
    reason === 'parent_stale'
  )
}

function status(
  key: string,
  label: string,
  band: string,
  note?: ResearchLabLoopStatusNote,
): ResearchLabLoopStatus {
  const normalizedKey = normalize(key)
  const normalizedBand = normalize(band) || 'pending'
  return {
    key: normalizedKey,
    label,
    band: normalizedBand,
    note,
    active: ACTIVE_STATUS_KEYS.has(normalizedKey),
    scoring: SCORING_VALUES.has(normalizedKey),
    completed: COMPLETED_STATUS_KEYS.has(normalizedKey),
    scored: SCORED_STATUS_KEYS.has(normalizedKey),
    promising: isPromisingResearchLabLoopStatus(normalizedKey, normalizedBand),
    noGainOrFailed: isNoGainOrFailedResearchLabLoopStatus(normalizedKey),
    pendingOrBlocking: PENDING_OR_BLOCKING_STATUS_KEYS.has(normalizedKey),
  }
}

function hasAny(values: string[], set: Set<string>): boolean {
  return values.some((value) => set.has(value))
}

function normalize(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

function timeValue(value: string | null | undefined): number {
  const time = new Date(value ?? '').getTime()
  return Number.isFinite(time) ? time : 0
}

function labelForStatus(value: string): string {
  const explicit: Record<string, string> = {
    submitted: 'Submitted',
    queued: 'Queued',
    running: 'Running',
    scoring: 'Scoring',
    pending: 'Pending',
    completed: 'Complete',
    completed_no_candidate: 'Completed no candidate',
    scored: 'Scored',
    scored_promising: 'Scored',
    scored_no_gain: 'Scored, no gain',
    blocked_for_credit: 'Waiting for credits',
    needs_rescore: 'Needs rescore',
    waiting_for_baseline: 'Waiting for baseline',
    not_started: 'Not started',
    failed: 'Failed',
  }
  if (explicit[value]) return explicit[value]
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}
