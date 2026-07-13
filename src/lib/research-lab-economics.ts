export type EconomicsMetric = {
  value: number | null
  unit: 'alpha_percent' | 'usd' | 'microusd' | 'points' | 'count'
  source: string
  authoritative: boolean
  epoch?: number | null
  formula?: string
}

export type EconomicsAllocationEntry = {
  uid?: unknown
  miner_hotkey?: unknown
  source_id?: unknown
  reason?: unknown
  replay_status?: unknown
  nominal_end_epoch?: unknown
  improvement_points?: unknown
  intended_alpha_percent?: unknown
  paid_alpha_percent?: unknown
  deferred_alpha_percent?: unknown
  total_due_alpha_percent?: unknown
  paid_alpha_percent_to_date?: unknown
  remaining_alpha_percent_before_epoch?: unknown
  remaining_alpha_percent_after_epoch?: unknown
}

export type EconomicsAllocationDoc = {
  champion_allocations?: unknown
  queued_champion_allocations?: unknown
  reimbursement_allocations?: unknown
}

export type EconomicsAllocationSummary = {
  epoch: number
  netuid: number | null
  snapshotStatus: string
  createdAt: string
  allocationHash: string | null
  labCap: EconomicsMetric
  sourceAdd: EconomicsMetric
  reimbursements: EconomicsMetric
  champions: EconomicsMetric
  queuedChampions: EconomicsMetric
  unallocated: EconomicsMetric
  reconciliationTotal: EconomicsMetric
  reconciliationDifference: number
  reconciled: boolean
  minerCounts: {
    reimbursements: number
    champions: number
    queuedChampions: number
    sourceAdd: number
  }
}

export type EconomicsChampion = {
  rewardId: string
  minerHotkey: string
  minerUid: number | null
  candidateId: string
  scoreBundleId: string
  evaluationEpoch: number | null
  rewardStartEpoch: number | null
  rewardDuration: number | null
  rewardStatus: string
  improvementPoints: EconomicsMetric
  improvementThreshold: EconomicsMetric
  desiredPerEpoch: EconomicsMetric
  intendedLifetimeReward: EconomicsMetric
  paidThisEpoch: EconomicsMetric
  paidToDate: EconomicsMetric
  remainingReward: EconomicsMetric
  deferredThisEpoch: EconomicsMetric
  nominalEndEpoch: number | null
  replayState: string | null
  promotionTimestamp: string | null
  latestStatusReason: string | null
  epochState: 'earning' | 'partial' | 'waiting' | 'not_paid'
  scoring: EconomicsScoringDetail | null
}

export type EconomicsScoringDetail = {
  promotionDecision: string | null
  candidateStatus: string | null
  candidateParentArtifact: string | null
  activeParentArtifact: string | null
  parentsMatched: boolean | null
  metricBasis: string
  publicHoldoutResult: string | null
  privateHoldoutResult: string | null
  rejectionReason: string | null
  providerExcludedIcpCount: number
  candidateScore: number | null
  baselineScore: number | null
  candidateDeltaVsDailyBaseline: number | null
  meanDelta: number | null
  deltaLcb: number | null
  evaluatedIcpCount: number
  successfulIcpCount: number
  failedOrExcludedIcpCount: number
  totalScoringCostUsd: number | null
  icps: EconomicsIcpScore[]
}

export type EconomicsIcpScore = {
  icpRef: string
  status: string
  baselineScore: number | null
  candidateScore: number | null
  delta: number | null
  companyCount: number
  excluded: boolean
  diagnostics: string | null
}

export type EconomicsChampionQueueItem = {
  position: number
  rewardId: string
  minerUid: number | null
  minerHotkey: string
  candidateId: string
  improvementPoints: EconomicsMetric
  intendedThisEpoch: EconomicsMetric
  paidThisEpoch: EconomicsMetric
  deferredThisEpoch: EconomicsMetric
  paidToDate: EconomicsMetric
  remainingLifetimeReward: EconomicsMetric
  startEpoch: number | null
  nominalEndEpoch: number | null
  queueReason: string
  replayState: string | null
  state: 'partial' | 'waiting' | 'placeholder' | 'complete'
}

export type EconomicsReimbursement = {
  awardId: string
  minerHotkey: string
  minerUid: number | null
  runId: string | null
  receiptId: string | null
  island: string | null
  runDay: string | null
  status: string
  eligibleComputeCost: EconomicsMetric
  rebateRate: number | null
  participationScore: number | null
  participationFraction: number | null
  targetReimbursement: EconomicsMetric
  duration: number | null
  scheduledStartEpoch: number | null
  scheduledEndEpoch: number | null
  intendedThisEpoch: EconomicsMetric
  paidThisEpoch: EconomicsMetric
  paidToDate: EconomicsMetric
  remaining: EconomicsMetric
  overpayment: EconomicsMetric
  deferred: EconomicsMetric
  capReason: string | null
  failedRunReimbursement: boolean
  loopStartFeeIncluded: boolean
  createdAt: string
  capsApplied: string[]
  ineligibilityReasons: string[]
  scheduleEntries: Array<{ epoch: number; amountUsd: number | null; alphaPercent: number | null }>
}

export type EconomicsCandidate = {
  candidateId: string
  minerHotkey: string
  runId: string | null
  status: string
  group: string
  latestPromotionEvent: string | null
  scoreBundleAvailable: boolean
  publicHoldoutStatus: string | null
  privateHoldoutStatus: string | null
  improvementPoints: number | null
  threshold: number | null
  rebaseStatus: string | null
  reason: string | null
  updatedAt: string
}

export type EconomicsWeightHealth = {
  state: 'healthy' | 'warning' | 'critical' | 'pending' | 'unknown'
  latestAllocationEpoch: number
  latestPublishedWeightEpoch: number | null
  publishedBlock: number | null
  weightHash: string | null
  allocationHash: string | null
  validatorHotkey: string | null
  protocol: 'Authoritative V2' | 'Legacy V1' | 'Evidence unavailable'
  gatewayStatus: string
  finalizationStatus: string
  extrinsicHash: string | null
  finalizedBlock: number | null
  missingEpoch: boolean
  publicationDelayMs: number | null
}

export type EconomicsEpochHistory = {
  epoch: number
  createdAt: string
  labCap: number
  reimbursements: number
  champions: number
  queuedChampions: number
  sourceAdd: number
  unallocated: number
  paidMinerCount: number
  queuedRewardCount: number
  gatewayPublished: boolean
  chainFinalized: boolean
}

export type EconomicsPagination = {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type ResearchLabEconomicsPayload = {
  allocation: EconomicsAllocationSummary
  configuredSplit: {
    researchLab: number
    fulfillmentPool: number
    fulfillmentLeaderboard: number
    legacyQualificationChampion: number
    legacySourcing: number
  }
  champions: EconomicsChampion[]
  championQueue: EconomicsChampionQueueItem[]
  reimbursements: EconomicsReimbursement[]
  candidates: EconomicsCandidate[]
  weightHealth: EconomicsWeightHealth
  history: EconomicsEpochHistory[]
  epochs: number[]
  pagination: {
    champions: EconomicsPagination
    reimbursements: EconomicsPagination
    candidates: EconomicsPagination
  }
  fetchedAt: string
}

export function economicsMetric(
  value: unknown,
  unit: EconomicsMetric['unit'],
  source: string,
  authoritative = true,
  epoch?: number | null,
  formula?: string,
): EconomicsMetric {
  return {
    value: finiteNumber(value),
    unit,
    source,
    authoritative,
    ...(epoch === undefined ? {} : { epoch }),
    ...(formula ? { formula } : {}),
  }
}

export function buildEconomicsAllocationSummary(row: Record<string, unknown>): EconomicsAllocationSummary {
  const epoch = Math.round(finiteNumber(row.epoch) ?? 0)
  const doc = record(row.allocation_doc) as EconomicsAllocationDoc | null
  const championEntries = records(doc?.champion_allocations)
  const queuedEntries = records(doc?.queued_champion_allocations)
  const reimbursementEntries = records(doc?.reimbursement_allocations)
  const labCap = finiteNumber(row.lab_cap_alpha_percent) ?? 0
  const sourceAdd = finiteNumber(row.source_add_alpha_percent) ?? 0
  const reimbursements = finiteNumber(row.reimbursement_alpha_percent) ?? 0
  const champions = finiteNumber(row.champion_alpha_percent) ?? 0
  const queuedChampions = finiteNumber(row.queued_champion_alpha_percent) ?? 0
  const unallocated = finiteNumber(row.unallocated_alpha_percent) ?? 0
  const total = sourceAdd + reimbursements + champions + queuedChampions + unallocated
  const difference = round6(total - labCap)

  return {
    epoch,
    netuid: finiteNumber(row.netuid),
    snapshotStatus: text(row.snapshot_status) ?? 'unknown',
    createdAt: text(row.created_at) ?? new Date(0).toISOString(),
    allocationHash: text(row.allocation_hash),
    labCap: economicsMetric(labCap, 'alpha_percent', 'research_lab_emission_allocation_current', true, epoch),
    sourceAdd: economicsMetric(sourceAdd, 'alpha_percent', 'research_lab_emission_allocation_current', true, epoch),
    reimbursements: economicsMetric(reimbursements, 'alpha_percent', 'research_lab_emission_allocation_current', true, epoch),
    champions: economicsMetric(champions, 'alpha_percent', 'research_lab_emission_allocation_current', true, epoch),
    queuedChampions: economicsMetric(queuedChampions, 'alpha_percent', 'research_lab_emission_allocation_current', true, epoch),
    unallocated: economicsMetric(unallocated, 'alpha_percent', 'research_lab_emission_allocation_current', true, epoch),
    reconciliationTotal: economicsMetric(round6(total), 'alpha_percent', 'derived', false, epoch, 'SOURCE_ADD + reimbursements + champions + queued champions + unallocated'),
    reconciliationDifference: difference,
    reconciled: Math.abs(difference) <= 0.000001,
    minerCounts: {
      reimbursements: uniqueMinerCount(reimbursementEntries),
      champions: uniqueMinerCount(championEntries),
      queuedChampions: uniqueMinerCount(queuedEntries),
      sourceAdd: sourceAdd > 0 ? 1 : 0,
    },
  }
}

export function authoritativeImprovementPoints(scoreBundleDoc: unknown): {
  value: number | null
  basis: string
} {
  const doc = record(scoreBundleDoc)
  const aggregates = record(doc?.aggregates)
  const privateGate = record(doc?.private_holdout_gate)
  const decision = text(privateGate?.decision)
  const evaluated = Boolean(privateGate?.private_holdout_evaluated)
  if (decision === 'private_holdout_approved' && evaluated) {
    return {
      value: finiteNumber(privateGate?.candidate_delta_vs_daily_baseline),
      basis: 'Private holdout approved · candidate delta vs daily baseline',
    }
  }
  return {
    value: finiteNumber(aggregates?.mean_delta),
    basis: privateGate ? 'Legacy/fallback · aggregate mean delta' : 'Legacy bundle · aggregate mean delta',
  }
}

export function queueReasonLabel(reason: unknown): string {
  const value = text(reason) ?? 'unknown'
  if (value === 'queued_with_partial_capacity') return 'Partially funded — Lab cap reached'
  if (value === 'queued_no_capacity') return 'Waiting — no remaining champion capacity'
  if (value === 'queued_with_placeholder') return 'Placeholder allocation'
  return value
}

export function candidatePipelineGroup(status: unknown, eventType?: unknown, reason?: unknown): string {
  const value = `${text(status) ?? ''} ${text(eventType) ?? ''} ${text(reason) ?? ''}`.toLowerCase()
  if (value.includes('reward_created')) return 'Reward created'
  if (value.includes('promotion_pass') || value.includes('promoted')) return 'Promotion passed'
  if (value.includes('private_holdout') && value.includes('reject')) return 'Private holdout rejected'
  if (value.includes('public_holdout') && value.includes('reject')) return 'Public holdout rejected'
  if (value.includes('below_threshold')) return 'Below threshold'
  if (value.includes('promotion') && (value.includes('pending') || value.includes('check'))) return 'Promotion check pending'
  if (value.includes('rebase')) return 'Rebase queued'
  if (value.includes('scoring') || value.includes('dispatch')) return 'Scoring'
  if (value.includes('queued') || value.includes('pending')) return 'Waiting for scoring'
  if (value.includes('fail') || value.includes('reject')) return 'Failed'
  return 'Scoring'
}

export function finiteNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(record).filter(Boolean) as Array<Record<string, unknown>> : []
}

export function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function uniqueMinerCount(entries: Array<Record<string, unknown>>): number {
  return new Set(entries.map((entry) => text(entry.miner_hotkey)).filter(Boolean)).size
}
