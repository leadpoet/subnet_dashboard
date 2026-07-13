import { NextRequest, NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/admin-supabase'
import {
  authoritativeImprovementPoints,
  buildEconomicsAllocationSummary,
  candidatePipelineGroup,
  economicsMetric,
  finiteNumber,
  queueReasonLabel,
  record,
  records,
  round6,
  text,
  type EconomicsCandidate,
  type EconomicsChampion,
  type EconomicsChampionQueueItem,
  type EconomicsEpochHistory,
  type EconomicsIcpScore,
  type EconomicsPagination,
  type EconomicsReimbursement,
  type EconomicsScoringDetail,
  type EconomicsWeightHealth,
  type ResearchLabEconomicsPayload,
} from '@/lib/research-lab-economics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAGE_SIZE_DEFAULT = 25
const PAGE_SIZE_MAX = 100
const DATABASE_PAGE_SIZE = 500
const NETUID = 71

type Row = Record<string, unknown>
type QueryError = { message: string; code?: string }

export async function GET(request: NextRequest) {
  const errorTag = `admin-economics:${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
  try {
    const supabase = getAdminSupabase()
    const championPage = positiveInt(request.nextUrl.searchParams.get('championPage'), 1)
    const reimbursementPage = positiveInt(request.nextUrl.searchParams.get('reimbursementPage'), 1)
    const candidatePage = positiveInt(request.nextUrl.searchParams.get('candidatePage'), 1)
    const pageSize = Math.min(
      PAGE_SIZE_MAX,
      positiveInt(request.nextUrl.searchParams.get('pageSize'), PAGE_SIZE_DEFAULT),
    )
    const requestedEpoch = nullableInt(request.nextUrl.searchParams.get('epoch'))

    const payload = await buildEconomicsPayload({
      supabase,
      requestedEpoch,
      championPage,
      reimbursementPage,
      candidatePage,
      pageSize,
      errorTag,
    })
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Admin-Economics-Epoch': String(payload.allocation.epoch),
      },
    })
  } catch (error) {
    console.error(`[${errorTag}] Research Lab economics request failed`, error)
    return NextResponse.json(
      { error: 'Research Lab economics data is temporarily unavailable.', errorTag },
      { status: 502, headers: { 'Cache-Control': 'private, no-store' } },
    )
  }
}

async function buildEconomicsPayload({
  supabase,
  requestedEpoch,
  championPage,
  reimbursementPage,
  candidatePage,
  pageSize,
  errorTag,
}: {
  supabase: ReturnType<typeof getAdminSupabase>
  requestedEpoch: number | null
  championPage: number
  reimbursementPage: number
  candidatePage: number
  pageSize: number
  errorTag: string
}): Promise<ResearchLabEconomicsPayload> {
  const allocationRows = await fetchPagedRows('allocation history', (from, to) =>
    supabase
      .from('research_lab_emission_allocation_current')
      .select('epoch,netuid,snapshot_status,lab_cap_alpha_percent,reimbursement_alpha_percent,champion_alpha_percent,queued_champion_alpha_percent,unallocated_alpha_percent,source_add_alpha_percent,allocation_hash,allocation_doc,created_at')
      .order('epoch', { ascending: false, nullsFirst: false })
      .range(from, Math.min(to, 99)),
    100,
  )
  let selectedAllocation = requestedEpoch === null
    ? allocationRows[0]
    : allocationRows.find((row) => finiteNumber(row.epoch) === requestedEpoch)
  if (!selectedAllocation && requestedEpoch !== null) {
    const { data, error } = await supabase
      .from('research_lab_emission_allocation_current')
      .select('epoch,netuid,snapshot_status,lab_cap_alpha_percent,reimbursement_alpha_percent,champion_alpha_percent,queued_champion_alpha_percent,unallocated_alpha_percent,source_add_alpha_percent,allocation_hash,allocation_doc,created_at')
      .eq('epoch', requestedEpoch)
      .limit(1)
    throwIfQueryError('selected allocation', error)
    selectedAllocation = (data?.[0] as Row | undefined)
  }
  if (!selectedAllocation) throw new Error('No completed Research Lab allocation snapshot is available')

  const allocation = buildEconomicsAllocationSummary(selectedAllocation)
  const selectedPayouts = await fetchPagedRows('selected epoch payouts', (from, to) =>
    supabase
      .from('research_lab_epoch_payouts')
      .select('epoch,payout_kind,miner_hotkey,source_id,spend_usd,intended_alpha_percent,paid_alpha_percent,overpaid_alpha_percent,deferred_alpha_percent,entry_doc,created_at')
      .eq('epoch', allocation.epoch)
      .order('created_at', { ascending: true })
      .range(from, to),
  )

  const [championResult, reimbursementResult, candidateResult, publishedRows, v2Bundles, v2Finalizations] = await Promise.all([
    fetchChampionPage(supabase, championPage, pageSize),
    fetchReimbursementPage(supabase, reimbursementPage, pageSize),
    fetchCandidatePage(supabase, candidatePage, pageSize),
    fetchPagedRows('published weights', (from, to) =>
      supabase
        .from('published_weight_bundles')
        .select('epoch_id,block,netuid,weights_hash,validator_hotkey,weight_submission_event_hash,created_at')
        .eq('netuid', NETUID)
        .order('epoch_id', { ascending: false, nullsFirst: false })
        .range(from, Math.min(to, 199)),
      200,
    ),
    fetchOptionalRows(supabase, 'research_lab_attested_weight_bundles_v2', errorTag),
    fetchOptionalRows(supabase, 'research_lab_attested_weight_finalizations_v2', errorTag),
  ])

  const allocationDoc = record(selectedAllocation.allocation_doc)
  const fullyFundedEntries = records(allocationDoc?.champion_allocations)
  const queuedEntries = records(allocationDoc?.queued_champion_allocations)
  const allocationEntries = [...fullyFundedEntries, ...queuedEntries]
  const queueRewardIds = uniqueStrings(queuedEntries.map((entry) => text(entry.source_id)))
  const championRows = await appendRowsByIds(
    supabase,
    championResult.rows,
    queueRewardIds,
    'research_lab_champion_reward_current',
    'champion_reward_id',
    'champion_reward_id,score_bundle_id,candidate_id,miner_hotkey,miner_uid,evaluation_epoch,start_epoch,epoch_count,improvement_points,threshold_points,desired_alpha_percent,current_reward_status,current_reason,current_status_at,created_at',
  )
  const rewardIds = uniqueStrings(championRows.map((row) => text(row.champion_reward_id)))
  const scoreBundleIds = uniqueStrings(championRows.map((row) => text(row.score_bundle_id)))
  const championCandidateIds = uniqueStrings(championRows.map((row) => text(row.candidate_id)))
  const [scoreBundles, promotionRows, championCandidateRows, championPayoutHistory] = await Promise.all([
    fetchByIds(supabase, 'research_evaluation_score_bundle_current', 'score_bundle_id', scoreBundleIds,
      'score_bundle_id,score_bundle_doc,current_event_status,current_reason,current_status_at,created_at'),
    fetchByIds(supabase, 'research_lab_candidate_promotion_events', 'candidate_id', championCandidateIds,
      'promotion_event_id,candidate_id,source_score_bundle_id,event_type,promotion_status,active_parent_artifact_hash,candidate_parent_artifact_hash,improvement_points,threshold_points,event_doc,created_at'),
    fetchByIds(supabase, 'research_lab_candidate_evaluation_current', 'candidate_id', championCandidateIds,
      'candidate_id,current_candidate_status,current_reason,current_status_at'),
    fetchPayoutHistory(supabase, rewardIds),
  ])
  const champions = buildChampions({
    rows: championResult.rows,
    selectedEpoch: allocation.epoch,
    selectedPayouts,
    payoutHistory: championPayoutHistory,
    allocationEntries,
    scoreBundles,
    promotionRows,
    candidateRows: championCandidateRows,
  })
  const championQueue = buildChampionQueue({
    entries: queuedEntries,
    rewardRows: championRows,
    selectedEpoch: allocation.epoch,
  })

  const awardIds = uniqueStrings(reimbursementResult.rows.map((row) => text(row.award_id)))
  const schedules = await fetchByIds(
    supabase,
    'research_reimbursement_schedules',
    'award_id',
    awardIds,
    'schedule_id,award_id,schedule_status,start_epoch,epoch_count,total_microusd,entries,schedule_doc,created_at',
  )
  const reimbursementSourceIds = uniqueStrings([
    ...awardIds,
    ...schedules.map((row) => text(row.schedule_id)),
  ])
  const reimbursementHistory = await fetchPayoutHistory(supabase, reimbursementSourceIds)
  const reimbursements = buildReimbursements({
    awards: reimbursementResult.rows,
    schedules,
    selectedPayouts,
    payoutHistory: reimbursementHistory,
    selectedEpoch: allocation.epoch,
  })

  const candidateIds = uniqueStrings(candidateResult.rows.map((row) => text(row.candidate_id)))
  const candidateScoreBundleIds = uniqueStrings(candidateResult.rows.map((row) => text(row.current_score_bundle_id)))
  const [candidatePromotions, candidateBundles] = await Promise.all([
    fetchByIds(supabase, 'research_lab_candidate_promotion_events', 'candidate_id', candidateIds,
      'promotion_event_id,candidate_id,source_score_bundle_id,event_type,promotion_status,improvement_points,threshold_points,event_doc,created_at'),
    fetchByIds(supabase, 'research_evaluation_score_bundle_current', 'score_bundle_id', candidateScoreBundleIds,
      'score_bundle_id,score_bundle_doc,current_event_status,current_reason,current_status_at,created_at'),
  ])
  const candidates = buildCandidates(candidateResult.rows, candidatePromotions, candidateBundles)
  const weightHealth = buildWeightHealth({
    allocation,
    publishedRows,
    v2Bundles,
    v2Finalizations,
  })
  const history = buildHistory(allocationRows, publishedRows, v2Finalizations)

  return {
    allocation,
    configuredSplit: {
      researchLab: 30,
      fulfillmentPool: 60.5,
      fulfillmentLeaderboard: 9.5,
      legacyQualificationChampion: 0,
      legacySourcing: 0,
    },
    champions,
    championQueue,
    reimbursements,
    candidates,
    weightHealth,
    history,
    epochs: allocationRows.map((row) => Math.round(finiteNumber(row.epoch) ?? 0)).filter(Boolean),
    pagination: {
      champions: pagination(championPage, pageSize, championResult.total),
      reimbursements: pagination(reimbursementPage, pageSize, reimbursementResult.total),
      candidates: pagination(candidatePage, pageSize, candidateResult.total),
    },
    fetchedAt: new Date().toISOString(),
  }
}

async function fetchChampionPage(
  supabase: ReturnType<typeof getAdminSupabase>,
  page: number,
  pageSize: number,
) {
  const from = (page - 1) * pageSize
  const { data, error, count } = await supabase
    .from('research_lab_champion_reward_current')
    .select('champion_reward_id,score_bundle_id,candidate_id,miner_hotkey,miner_uid,evaluation_epoch,start_epoch,epoch_count,improvement_points,threshold_points,desired_alpha_percent,current_reward_status,current_reason,current_status_at,created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1)
  throwIfQueryError('champion rewards', error)
  return { rows: (data ?? []) as Row[], total: count ?? 0 }
}

async function fetchReimbursementPage(
  supabase: ReturnType<typeof getAdminSupabase>,
  page: number,
  pageSize: number,
) {
  const from = (page - 1) * pageSize
  const { data, error, count } = await supabase
    .from('research_reimbursement_award_current')
    .select('award_id,receipt_id,run_id,miner_hotkey,island,run_day,participation_score,participation_fraction,rebate_rate,eligible_cost_microusd,target_reimbursement_microusd,reimbursement_epochs,loop_start_fee_included,award_status,current_award_status,award_doc,created_at,current_status_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1)
  throwIfQueryError('reimbursement awards', error)
  return { rows: (data ?? []) as Row[], total: count ?? 0 }
}

async function fetchCandidatePage(
  supabase: ReturnType<typeof getAdminSupabase>,
  page: number,
  pageSize: number,
) {
  const from = (page - 1) * pageSize
  const { data, error, count } = await supabase
    .from('research_lab_candidate_evaluation_current')
    .select('candidate_id,run_id,miner_hotkey,current_candidate_status,current_event_type,current_reason,current_score_bundle_id,current_status_at,created_at', { count: 'exact' })
    .order('current_status_at', { ascending: false })
    .range(from, from + pageSize - 1)
  throwIfQueryError('candidate pipeline', error)
  return { rows: (data ?? []) as Row[], total: count ?? 0 }
}

async function fetchPayoutHistory(
  supabase: ReturnType<typeof getAdminSupabase>,
  sourceIds: string[],
): Promise<Row[]> {
  const rows: Row[] = []
  for (const ids of chunks(sourceIds, 80)) {
    if (ids.length === 0) continue
    rows.push(...await fetchPagedRows('payout history', (from, to) =>
      supabase
        .from('research_lab_epoch_payouts')
        .select('epoch,payout_kind,source_id,paid_alpha_percent,deferred_alpha_percent,overpaid_alpha_percent,intended_alpha_percent,created_at')
        .in('source_id', ids)
        .order('epoch', { ascending: true })
        .range(from, to),
    ))
  }
  return rows
}

async function fetchByIds(
  supabase: ReturnType<typeof getAdminSupabase>,
  table: string,
  column: string,
  ids: string[],
  select: string,
): Promise<Row[]> {
  const rows: Row[] = []
  for (const batch of chunks(ids, 80)) {
    if (batch.length === 0) continue
    rows.push(...await fetchPagedRows(`${table} join`, (from, to) =>
      supabase.from(table).select(select).in(column, batch).range(from, to),
    ))
  }
  return rows
}

async function appendRowsByIds(
  supabase: ReturnType<typeof getAdminSupabase>,
  existing: Row[],
  ids: string[],
  table: string,
  column: string,
  select: string,
): Promise<Row[]> {
  const existingIds = new Set(existing.map((row) => text(row[column])).filter(Boolean))
  const missing = ids.filter((id) => !existingIds.has(id))
  return [...existing, ...await fetchByIds(supabase, table, column, missing, select)]
}

async function fetchPagedRows(
  label: string,
  fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: QueryError | null }>,
  hardLimit = 20_000,
): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = 0; from < hardLimit; from += DATABASE_PAGE_SIZE) {
    const result = await fetchPage(from, Math.min(from + DATABASE_PAGE_SIZE - 1, hardLimit - 1))
    throwIfQueryError(label, result.error)
    const batch = (result.data ?? []) as Row[]
    rows.push(...batch)
    if (batch.length < DATABASE_PAGE_SIZE) break
  }
  return rows
}

async function fetchOptionalRows(
  supabase: ReturnType<typeof getAdminSupabase>,
  table: string,
  errorTag: string,
): Promise<Row[]> {
  const { data, error } = await supabase.from(table).select('*').limit(200)
  if (error) {
    console.warn(`[${errorTag}:${table}] Optional weight evidence source unavailable`, error.message)
    return []
  }
  return (data ?? []) as Row[]
}

function buildChampions({
  rows,
  selectedEpoch,
  selectedPayouts,
  payoutHistory,
  allocationEntries,
  scoreBundles,
  promotionRows,
  candidateRows,
}: {
  rows: Row[]
  selectedEpoch: number
  selectedPayouts: Row[]
  payoutHistory: Row[]
  allocationEntries: Row[]
  scoreBundles: Row[]
  promotionRows: Row[]
  candidateRows: Row[]
}): EconomicsChampion[] {
  return rows.map((row) => {
    const rewardId = text(row.champion_reward_id) ?? ''
    const candidateId = text(row.candidate_id) ?? ''
    const scoreBundleId = text(row.score_bundle_id) ?? ''
    const allocationEntry = allocationEntries.find((entry) => text(entry.source_id) === rewardId)
    const selectedPayout = selectedPayouts.find((entry) => text(entry.source_id) === rewardId)
    const rewardHistory = payoutHistory.filter((entry) => text(entry.source_id) === rewardId)
    const persistedPaidBeforeEpoch = finiteNumber(allocationEntry?.paid_alpha_percent_to_date)
    const historyPaid = round6(rewardHistory.reduce((sum, item) => sum + (finiteNumber(item.paid_alpha_percent) ?? 0), 0))
    const desired = finiteNumber(row.desired_alpha_percent) ?? 0
    const duration = finiteNumber(row.epoch_count)
    const intendedLifetime = desired * (duration ?? 0)
    const paidThisEpoch = finiteNumber(allocationEntry?.paid_alpha_percent)
      ?? finiteNumber(selectedPayout?.paid_alpha_percent)
      ?? 0
    const deferred = finiteNumber(allocationEntry?.deferred_alpha_percent)
      ?? finiteNumber(selectedPayout?.deferred_alpha_percent)
      ?? 0
    const persistedTotalDue = finiteNumber(allocationEntry?.total_due_alpha_percent)
    const persistedRemainingAfter = finiteNumber(allocationEntry?.remaining_alpha_percent_after_epoch)
    const persistedPaidToDate = persistedTotalDue !== null && persistedRemainingAfter !== null
      ? Math.max(0, persistedTotalDue - persistedRemainingAfter)
      : persistedPaidBeforeEpoch === null ? null : persistedPaidBeforeEpoch + paidThisEpoch
    const paidToDate = persistedPaidToDate ?? historyPaid
    const remaining = finiteNumber(allocationEntry?.remaining_alpha_percent_after_epoch)
      ?? Math.max(0, intendedLifetime - paidToDate)
    const promotion = latestRow(promotionRows.filter((item) => text(item.candidate_id) === candidateId))
    const scoreBundle = scoreBundles.find((item) => text(item.score_bundle_id) === scoreBundleId)
    const candidate = candidateRows.find((item) => text(item.candidate_id) === candidateId)
    const intendedThisEpoch = finiteNumber(allocationEntry?.intended_alpha_percent) ?? desired
    const epochState = deferred > 0
      ? paidThisEpoch > 0 ? 'partial' : 'waiting'
      : paidThisEpoch > 0 ? 'earning' : 'not_paid'
    const startEpoch = finiteNumber(row.start_epoch)

    return {
      rewardId,
      minerHotkey: text(row.miner_hotkey) ?? '',
      minerUid: finiteNumber(row.miner_uid),
      candidateId,
      scoreBundleId,
      evaluationEpoch: finiteNumber(row.evaluation_epoch),
      rewardStartEpoch: startEpoch,
      rewardDuration: duration,
      rewardStatus: text(row.current_reward_status) ?? 'unknown',
      improvementPoints: economicsMetric(row.improvement_points, 'points', 'research_lab_champion_reward_current'),
      improvementThreshold: economicsMetric(row.threshold_points, 'points', 'research_lab_champion_reward_current'),
      desiredPerEpoch: economicsMetric(desired, 'alpha_percent', 'research_lab_champion_reward_current'),
      intendedLifetimeReward: economicsMetric(intendedLifetime, 'alpha_percent', 'derived', false, selectedEpoch, 'desired_alpha_percent * epoch_count'),
      paidThisEpoch: economicsMetric(paidThisEpoch, 'alpha_percent', allocationEntry ? 'research_lab_emission_allocation_current' : 'research_lab_epoch_payouts', true, selectedEpoch),
      paidToDate: economicsMetric(paidToDate, 'alpha_percent', persistedPaidToDate === null ? 'derived' : 'research_lab_emission_allocation_current', persistedPaidToDate !== null, selectedEpoch, persistedPaidToDate === null ? 'sum(research_lab_epoch_payouts.paid_alpha_percent)' : 'total_due_alpha_percent - remaining_alpha_percent_after_epoch'),
      remainingReward: economicsMetric(remaining, 'alpha_percent', allocationEntry?.remaining_alpha_percent_after_epoch === undefined ? 'derived' : 'research_lab_emission_allocation_current', allocationEntry?.remaining_alpha_percent_after_epoch !== undefined, selectedEpoch),
      deferredThisEpoch: economicsMetric(deferred, 'alpha_percent', allocationEntry ? 'research_lab_emission_allocation_current' : 'research_lab_epoch_payouts', true, selectedEpoch),
      nominalEndEpoch: finiteNumber(allocationEntry?.nominal_end_epoch) ?? (startEpoch !== null && duration !== null ? startEpoch + duration - 1 : null),
      replayState: text(allocationEntry?.replay_status),
      promotionTimestamp: text(promotion?.created_at),
      latestStatusReason: text(row.current_reason),
      epochState,
      scoring: scoreBundle ? buildScoringDetail(scoreBundle, promotion, candidate) : null,
      // Ensure the selected allocation, not an active obligation flag, proves payment.
      ...(intendedThisEpoch === 0 && paidThisEpoch === 0 ? { epochState: 'not_paid' as const } : {}),
    }
  })
}

function buildScoringDetail(bundle: Row, promotion?: Row, candidate?: Row): EconomicsScoringDetail {
  const doc = record(bundle.score_bundle_doc)
  const aggregates = record(doc?.aggregates)
  const privateGate = record(doc?.private_holdout_gate)
  const improvementGate = record(doc?.improvement_gate)
  const metric = authoritativeImprovementPoints(doc)
  const perIcpRows = records(aggregates?.per_icp_results)
  const icps: EconomicsIcpScore[] = perIcpRows.map((row, index) => ({
    icpRef: text(row.icp_ref) ?? text(row.icp_hash) ?? `ICP ${index + 1}`,
    status: text(row.status) ?? 'unknown',
    baselineScore: finiteNumber(row.base_per_icp_score),
    candidateScore: finiteNumber(row.candidate_per_icp_score),
    delta: finiteNumber(row.delta_vs_base),
    companyCount: Array.isArray(row.candidate_company_scores) ? row.candidate_company_scores.length : 0,
    excluded: Boolean(row.provider_excluded),
    diagnostics: text(row.failure_reason),
  }))
  const excludedCount = icps.filter((icp) => icp.excluded || icp.status === 'failed').length
  return {
    promotionDecision: text(promotion?.promotion_status) ?? text(promotion?.event_type),
    candidateStatus: text(candidate?.current_candidate_status),
    candidateParentArtifact: text(promotion?.candidate_parent_artifact_hash),
    activeParentArtifact: text(promotion?.active_parent_artifact_hash),
    parentsMatched: promotion?.candidate_parent_artifact_hash && promotion?.active_parent_artifact_hash
      ? promotion.candidate_parent_artifact_hash === promotion.active_parent_artifact_hash
      : null,
    metricBasis: metric.basis,
    publicHoldoutResult: text(improvementGate?.decision),
    privateHoldoutResult: text(privateGate?.decision),
    rejectionReason: text(promotion?.event_type)?.includes('rejected')
      ? text(record(promotion?.event_doc)?.reason) ?? text(candidate?.current_reason)
      : null,
    providerExcludedIcpCount: Array.isArray(privateGate?.provider_excluded_icp_ids)
      ? privateGate.provider_excluded_icp_ids.length
      : icps.filter((icp) => icp.excluded).length,
    candidateScore: finiteNumber(aggregates?.candidate_score),
    baselineScore: finiteNumber(aggregates?.base_score),
    candidateDeltaVsDailyBaseline: finiteNumber(privateGate?.candidate_delta_vs_daily_baseline),
    meanDelta: finiteNumber(aggregates?.mean_delta),
    deltaLcb: finiteNumber(aggregates?.delta_lcb),
    evaluatedIcpCount: Math.round(finiteNumber(aggregates?.icp_count) ?? icps.length),
    successfulIcpCount: Math.round(finiteNumber(aggregates?.successful_icp_count) ?? Math.max(0, icps.length - excludedCount)),
    failedOrExcludedIcpCount: excludedCount,
    totalScoringCostUsd: finiteNumber(aggregates?.total_cost_usd),
    icps,
  }
}

function buildChampionQueue({
  entries,
  rewardRows,
  selectedEpoch,
}: {
  entries: Row[]
  rewardRows: Row[]
  selectedEpoch: number
}): EconomicsChampionQueueItem[] {
  return entries.map((entry, index) => {
    const rewardId = text(entry.source_id) ?? ''
    const reward = rewardRows.find((row) => text(row.champion_reward_id) === rewardId)
    const paid = finiteNumber(entry.paid_alpha_percent) ?? 0
    const deferred = finiteNumber(entry.deferred_alpha_percent) ?? 0
    const reason = text(entry.reason) ?? 'unknown'
    const startEpoch = finiteNumber(reward?.start_epoch)
    const duration = finiteNumber(reward?.epoch_count)
    return {
      position: index + 1,
      rewardId,
      minerUid: finiteNumber(entry.uid) ?? finiteNumber(reward?.miner_uid),
      minerHotkey: text(entry.miner_hotkey) ?? text(reward?.miner_hotkey) ?? '',
      candidateId: text(reward?.candidate_id) ?? '',
      improvementPoints: economicsMetric(entry.improvement_points ?? reward?.improvement_points, 'points', 'research_lab_emission_allocation_current', true, selectedEpoch),
      intendedThisEpoch: economicsMetric(entry.intended_alpha_percent, 'alpha_percent', 'research_lab_emission_allocation_current', true, selectedEpoch),
      paidThisEpoch: economicsMetric(paid, 'alpha_percent', 'research_lab_emission_allocation_current', true, selectedEpoch),
      deferredThisEpoch: economicsMetric(deferred, 'alpha_percent', 'research_lab_emission_allocation_current', true, selectedEpoch),
      paidToDate: economicsMetric(
        finiteNumber(entry.total_due_alpha_percent) !== null && finiteNumber(entry.remaining_alpha_percent_after_epoch) !== null
          ? Math.max(0, (finiteNumber(entry.total_due_alpha_percent) ?? 0) - (finiteNumber(entry.remaining_alpha_percent_after_epoch) ?? 0))
          : (finiteNumber(entry.paid_alpha_percent_to_date) ?? 0) + paid,
        'alpha_percent',
        'research_lab_emission_allocation_current',
        true,
        selectedEpoch,
        'total_due_alpha_percent - remaining_alpha_percent_after_epoch',
      ),
      remainingLifetimeReward: economicsMetric(entry.remaining_alpha_percent_after_epoch ?? entry.remaining_alpha_percent_before_epoch, 'alpha_percent', 'research_lab_emission_allocation_current', true, selectedEpoch),
      startEpoch,
      nominalEndEpoch: finiteNumber(entry.nominal_end_epoch) ?? (startEpoch !== null && duration !== null ? startEpoch + duration - 1 : null),
      queueReason: queueReasonLabel(reason),
      replayState: text(entry.replay_status),
      state: reason === 'queued_with_placeholder'
        ? 'placeholder'
        : deferred <= 0 ? 'complete' : paid > 0 ? 'partial' : 'waiting',
    }
  })
}

function buildReimbursements({
  awards,
  schedules,
  selectedPayouts,
  payoutHistory,
  selectedEpoch,
}: {
  awards: Row[]
  schedules: Row[]
  selectedPayouts: Row[]
  payoutHistory: Row[]
  selectedEpoch: number
}): EconomicsReimbursement[] {
  return awards.map((award) => {
    const awardId = text(award.award_id) ?? ''
    const schedule = schedules.find((row) => text(row.award_id) === awardId)
    const scheduleId = text(schedule?.schedule_id)
    const matchingSource = (row: Row) => {
      const source = text(row.source_id)
      return source === scheduleId || source === awardId || Boolean(source?.endsWith(awardId))
    }
    const selected = selectedPayouts.filter(matchingSource)
    const history = payoutHistory.filter(matchingSource)
    const entryDoc = record(selected[0]?.entry_doc)
    const awardDoc = record(award.award_doc)
    const scheduleDoc = record(schedule?.schedule_doc)
    const scheduleEntries = records(schedule?.entries ?? record(scheduleDoc?.schedule)?.entries)
    const startEpoch = finiteNumber(schedule?.start_epoch)
    const duration = finiteNumber(schedule?.epoch_count ?? award.reimbursement_epochs)
    const paidThisEpoch = round6(selected.reduce((sum, row) => sum + (finiteNumber(row.paid_alpha_percent) ?? 0), 0))
    const paidToDate = round6(history.reduce((sum, row) => sum + (finiteNumber(row.paid_alpha_percent) ?? 0), 0))
    const intendedThisEpoch = round6(selected.reduce((sum, row) => sum + (finiteNumber(row.intended_alpha_percent) ?? 0), 0))
    const deferred = round6(selected.reduce((sum, row) => sum + (finiteNumber(row.deferred_alpha_percent) ?? 0), 0))
    const overpaid = round6(selected.reduce((sum, row) => sum + (finiteNumber(row.overpaid_alpha_percent) ?? 0), 0))
    const scheduleTotalAlpha = scheduleEntries.reduce((sum, row) => sum + (finiteNumber(row.alpha_percent) ?? 0), 0)
    const capUsage = record(awardDoc?.cap_usage)
    const failedRun = Boolean(scheduleDoc?.failed_run_reimbursement)
      || (text(awardDoc?.source) ?? '').includes('failed')
    return {
      awardId,
      minerHotkey: text(award.miner_hotkey) ?? '',
      minerUid: finiteNumber(entryDoc?.uid),
      runId: text(award.run_id),
      receiptId: text(award.receipt_id),
      island: text(award.island),
      runDay: text(award.run_day),
      status: text(award.current_award_status) ?? text(award.award_status) ?? 'unknown',
      eligibleComputeCost: economicsMetric(award.eligible_cost_microusd, 'microusd', 'research_reimbursement_award_current'),
      rebateRate: finiteNumber(award.rebate_rate),
      participationScore: finiteNumber(award.participation_score),
      participationFraction: finiteNumber(award.participation_fraction),
      targetReimbursement: economicsMetric(award.target_reimbursement_microusd, 'microusd', 'research_reimbursement_award_current'),
      duration,
      scheduledStartEpoch: startEpoch,
      scheduledEndEpoch: startEpoch !== null && duration !== null ? startEpoch + duration - 1 : null,
      intendedThisEpoch: economicsMetric(intendedThisEpoch, 'alpha_percent', 'research_lab_epoch_payouts', true, selectedEpoch),
      paidThisEpoch: economicsMetric(paidThisEpoch, 'alpha_percent', 'research_lab_epoch_payouts', true, selectedEpoch),
      paidToDate: economicsMetric(paidToDate, 'alpha_percent', 'research_lab_epoch_payouts', true, selectedEpoch),
      remaining: economicsMetric(Math.max(0, scheduleTotalAlpha - paidToDate), 'alpha_percent', 'derived', false, selectedEpoch, 'scheduled alpha - sum(actual epoch payments)'),
      overpayment: economicsMetric(overpaid, 'alpha_percent', 'research_lab_epoch_payouts', true, selectedEpoch),
      deferred: economicsMetric(deferred, 'alpha_percent', 'research_lab_epoch_payouts', true, selectedEpoch),
      capReason: text(entryDoc?.reason) ?? text(capUsage?.reason),
      failedRunReimbursement: failedRun,
      loopStartFeeIncluded: Boolean(award.loop_start_fee_included),
      createdAt: text(award.created_at) ?? new Date(0).toISOString(),
      capsApplied: objectTruthyKeys(capUsage),
      ineligibilityReasons: stringArray(awardDoc?.ineligibility_reasons),
      scheduleEntries: scheduleEntries.map((row) => ({
        epoch: Math.round(finiteNumber(row.epoch) ?? 0),
        amountUsd: finiteNumber(row.amount_usd),
        alphaPercent: finiteNumber(row.alpha_percent),
      })),
    }
  })
}

function buildCandidates(rows: Row[], promotionRows: Row[], bundleRows: Row[]): EconomicsCandidate[] {
  return rows.map((row) => {
    const candidateId = text(row.candidate_id) ?? ''
    const promotion = latestRow(promotionRows.filter((item) => text(item.candidate_id) === candidateId))
    const bundleId = text(row.current_score_bundle_id)
    const bundle = bundleRows.find((item) => text(item.score_bundle_id) === bundleId)
    const bundleDoc = record(bundle?.score_bundle_doc)
    const privateGate = record(bundleDoc?.private_holdout_gate)
    const improvementGate = record(bundleDoc?.improvement_gate)
    const metric = authoritativeImprovementPoints(bundleDoc)
    return {
      candidateId,
      minerHotkey: text(row.miner_hotkey) ?? '',
      runId: text(row.run_id),
      status: text(row.current_candidate_status) ?? 'unknown',
      group: candidatePipelineGroup(row.current_candidate_status, promotion?.event_type, row.current_reason),
      latestPromotionEvent: text(promotion?.event_type),
      scoreBundleAvailable: Boolean(bundle),
      publicHoldoutStatus: text(improvementGate?.decision),
      privateHoldoutStatus: text(privateGate?.decision),
      improvementPoints: metric.value,
      threshold: finiteNumber(promotion?.threshold_points) ?? finiteNumber(record(improvementGate?.policy)?.min_delta),
      rebaseStatus: `${text(row.current_reason) ?? ''} ${text(promotion?.event_type) ?? ''}`.includes('rebase') ? text(row.current_reason) ?? text(promotion?.event_type) : null,
      reason: text(row.current_reason) ?? text(bundle?.current_reason),
      updatedAt: text(row.current_status_at) ?? text(row.created_at) ?? new Date(0).toISOString(),
    }
  })
}

function buildWeightHealth({
  allocation,
  publishedRows,
  v2Bundles,
  v2Finalizations,
}: {
  allocation: ReturnType<typeof buildEconomicsAllocationSummary>
  publishedRows: Row[]
  v2Bundles: Row[]
  v2Finalizations: Row[]
}): EconomicsWeightHealth {
  const published = publishedRows.find((row) => rowEpoch(row) === allocation.epoch)
  const latestPublishedEpoch = publishedRows.reduce<number | null>((latest, row) => {
    const epoch = rowEpoch(row)
    return epoch === null ? latest : latest === null ? epoch : Math.max(latest, epoch)
  }, null)
  const v2Bundle = v2Bundles.find((row) => rowEpoch(row) === allocation.epoch)
  const finalization = v2Finalizations.find((row) => rowEpoch(row) === allocation.epoch)
  const allocationCreated = Date.parse(allocation.createdAt)
  const publishedAt = text(published?.created_at)
  const delay = publishedAt && Number.isFinite(allocationCreated)
    ? Math.max(0, Date.parse(publishedAt) - allocationCreated)
    : null
  const missingEpoch = !published && !v2Bundle
  const finalized = Boolean(finalization)
  return {
    state: finalized ? 'healthy' : published ? 'warning' : missingEpoch ? 'critical' : 'unknown',
    latestAllocationEpoch: allocation.epoch,
    latestPublishedWeightEpoch: latestPublishedEpoch,
    publishedBlock: finiteNumber(published?.block),
    weightHash: text(v2Bundle?.weights_hash) ?? text(v2Bundle?.weight_hash) ?? text(published?.weights_hash),
    allocationHash: allocation.allocationHash,
    validatorHotkey: text(v2Bundle?.validator_hotkey) ?? text(published?.validator_hotkey),
    protocol: finalization || v2Bundle ? 'Authoritative V2' : published ? 'Legacy V1' : 'Evidence unavailable',
    gatewayStatus: published || v2Bundle ? 'Gateway published' : 'Evidence unavailable',
    finalizationStatus: finalized ? 'Chain finalized' : published ? 'Legacy publication only — no V2 finalization evidence' : 'Evidence unavailable',
    extrinsicHash: text(finalization?.extrinsic_hash) ?? text(finalization?.tx_hash),
    finalizedBlock: finiteNumber(finalization?.finalized_block) ?? finiteNumber(finalization?.block),
    missingEpoch,
    publicationDelayMs: delay,
  }
}

function buildHistory(allocationRows: Row[], publishedRows: Row[], finalizationRows: Row[]): EconomicsEpochHistory[] {
  return allocationRows.slice(0, 100).map((row) => {
    const epoch = Math.round(finiteNumber(row.epoch) ?? 0)
    const doc = record(row.allocation_doc)
    const paidEntries = [
      ...records(doc?.champion_allocations),
      ...records(doc?.queued_champion_allocations),
      ...records(doc?.reimbursement_allocations),
    ]
    return {
      epoch,
      createdAt: text(row.created_at) ?? new Date(0).toISOString(),
      labCap: finiteNumber(row.lab_cap_alpha_percent) ?? 0,
      reimbursements: finiteNumber(row.reimbursement_alpha_percent) ?? 0,
      champions: finiteNumber(row.champion_alpha_percent) ?? 0,
      queuedChampions: finiteNumber(row.queued_champion_alpha_percent) ?? 0,
      sourceAdd: finiteNumber(row.source_add_alpha_percent) ?? 0,
      unallocated: finiteNumber(row.unallocated_alpha_percent) ?? 0,
      paidMinerCount: new Set(paidEntries.filter((entry) => (finiteNumber(entry.paid_alpha_percent) ?? 0) > 0).map((entry) => text(entry.miner_hotkey)).filter(Boolean)).size,
      queuedRewardCount: records(doc?.queued_champion_allocations).length,
      gatewayPublished: publishedRows.some((published) => rowEpoch(published) === epoch),
      chainFinalized: finalizationRows.some((finalization) => rowEpoch(finalization) === epoch),
    }
  })
}

function latestRow(rows: Row[]): Row | undefined {
  return rows.slice().sort((a, b) => Date.parse(text(b.created_at) ?? '') - Date.parse(text(a.created_at) ?? ''))[0]
}

function rowEpoch(row: Row | undefined): number | null {
  return finiteNumber(row?.epoch ?? row?.epoch_id ?? row?.allocation_epoch ?? row?.bundle_epoch)
}

function pagination(page: number, pageSize: number, total: number): EconomicsPagination {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

function uniqueStrings(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter(Boolean))) as string[]
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) as string[] : []
}

function objectTruthyKeys(value: Row | null): string[] {
  if (!value) return []
  return Object.entries(value)
    .filter(([, item]) => item === true || (typeof item === 'number' && item > 0))
    .map(([key]) => key)
}

function throwIfQueryError(label: string, error: QueryError | null | undefined): void {
  if (error) throw new Error(`${label} query failed: ${error.message}`)
}

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function nullableInt(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}
