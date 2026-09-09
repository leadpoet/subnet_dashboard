import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  buildFulfillmentRewardRollup,
  buildResearchLabAllocationRollup,
  researchLabAllocationEntries,
  type FulfillmentRewardRollup,
  type FulfillmentRewardRow,
  type ResearchLabEmissionAllocationDoc,
  type ResearchLabEmissionAllocationRollup,
  type ResearchLabEmissionAllocationSnapshot,
} from '@/lib/research-lab-emissions'
import { microusdToUsd, receiptEventCostMicrousd, roundUsd } from '@/lib/research-lab-compute-spend'
import { runSingleFlight, type SingleFlightState } from '@/lib/single-flight'
import { createAppendOnlyCache } from '@/lib/append-only-cache'
import { normalizeResearchLabArenaSnapshot, type ResearchLabArenaSnapshot } from '@/lib/research-lab-arena'

export const dynamic = 'force-dynamic'

const CACHE_TTL = 30_000
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' } as const
const LAB_MINER_SPEND_BATCH_SIZE = 1_000
const SUPABASE_IN_FILTER_BATCH_SIZE = 100
const LAB_MINER_SPEND_WINDOW_MS = 24 * 60 * 60 * 1000
const FULFILLMENT_LEADERBOARD_WINDOW_MS = 140 * 360 * 12 * 1000
const FULFILLMENT_LEADERBOARD_SIZE = 3
const ARENA_GATEWAY_URL = (process.env.LEADPOET_GATEWAY_URL?.trim() || process.env.FULFILLMENT_GATEWAY_URL?.trim() || 'https://gateway.subnet71.com').replace(/\/+$/, '')

type CachedResponse = { data: ResearchLabPayload; ts: number }

type ResearchLabPayload = {
  arena: ResearchLabArenaSnapshot
  labMinerSpend: LabMinerSpendRollup
  fetchedAt: string
}

type LabMinerSpendRollup = {
  window: LabMinerSpendWindow
  byHotkey: Record<string, LabMinerSpendEntry>
  allTime: LabMinerAllTimeRollup
  currentAllocation: ResearchLabEmissionAllocationRollup
  fulfillmentRewards: FulfillmentRewardRollup | null
}

type LabMinerSpendWindow = {
  latestEpoch: number | null
  epochCount: number | null
  activeScheduleCount: number
}

type LabMinerSpendEntry = {
  computeSpendUsd: number
  scheduledReimbursementUsd: number
  activeAwardCount: number
  reimbursementEpochs: number | null
}

type LabMinerAllTimeRollup = {
  firstEpoch: number | null
  latestEpoch: number | null
  allocationSnapshotCount: number
  byHotkey: Record<string, LabMinerAllTimeEntry>
}

type LabMinerAllTimeEntry = {
  alphaEarned: number
  computeSpendUsd: number
  scheduledReimbursementUsd: number
  awardCount: number
  reimbursementEpochs: number | null
  alphaAllocationCount: number
}

type ReimbursementScheduleRow = {
  award_id: string | null
  schedule_status: string | null
  start_epoch: number | null
  epoch_count: number | null
  total_microusd: number | string | null
}

type ReimbursementAwardRow = {
  award_id: string
  miner_hotkey: string | null
  target_reimbursement_microusd: number | string | null
  reimbursement_epochs: number | null
}

type ResearchLoopReceiptEventRow = {
  ticket_id: string | null
  receipt_id: string | null
  run_id: string | null
  cost_microusd: number | string | null
  openrouter_usd: number | string | null
  total_usd: number | string | null
  created_at: string | null
}

type ResearchLoopTicketSpendRow = {
  ticket_id: string
  miner_hotkey: string | null
}

type ResearchLoopReceiptRunRow = {
  receipt_id: string
  run_id: string | null
}

type LabMinerComputeSpendRollup = {
  allTime: Record<string, number>
  last24h: Record<string, number>
}

type LabMinerTerminalSpendEvent = {
  minerHotkey: string
  runId: string
  createdAtMs: number
  costMicrousd: number
}

type EmissionAllocationSnapshotRow = {
  epoch: number | null
  allocation_doc: ResearchLabEmissionAllocationDoc | null
  created_at: string | null
  lab_cap_alpha_percent?: number | string | null
}

type AllocationHistory = {
  firstEpoch: number | null
  latestEpoch: number | null
  snapshotCount: number
  byHotkey: Record<string, { alphaEarned: number; alphaAllocationCount: number }>
  latestSnapshot: EmissionAllocationSnapshotRow | null
}

type FulfillmentLeaderboardRow = {
  miner_hotkey: string | null
  reward_pct: number | string | null
}

let cache: CachedResponse | null = null
const publicSnapshotFlight: SingleFlightState<ResearchLabPayload> = { current: null }
// This public route has one configured database/role and no caller-specific
// filters, just like its response cache. The database rejects updates/deletes
// on these histories and on the receipt/ticket parents used for normalization.
const readTerminalSpendHistory = createAppendOnlyCache<LabMinerTerminalSpendEvent[]>()
const readAllocationHistory = createAppendOnlyCache<AllocationHistory>()

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase environment variables are not configured')
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function GET() {
  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      return NextResponse.json({ success: true, data: cache.data }, { headers: NO_STORE_HEADERS })
    }
    const data = await runSingleFlight(publicSnapshotFlight, async () => {
      if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.data
      const supabase = getSupabase()
      const [arena, labMinerSpend] = await Promise.all([
        fetchResearchLabArena(),
        fetchLabMinerSpend(supabase),
      ])
      const snapshot: ResearchLabPayload = {
        arena,
        labMinerSpend,
        fetchedAt: new Date().toISOString(),
      }
      cache = { data: snapshot, ts: Date.now() }
      return snapshot
    })
    return NextResponse.json({ success: true, data }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error('[Research Lab API] failed:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch Research Lab data' }, { status: 500 })
  }
}

async function fetchResearchLabArena(): Promise<ResearchLabArenaSnapshot> {
  const unavailable: ResearchLabArenaSnapshot = { activeRound: null, publishedBaseline: null, publishedWinner: null }
  try {
    const current = await fetchArenaJson(`${ARENA_GATEWAY_URL}/arena/v1/current`)
    const currentRecord = asRecord(current)
    if (!currentRecord) return unavailable

    const runningRounds = Array.isArray(currentRecord.running_rounds)
      ? currentRecord.running_rounds.map(asRecord).filter((row): row is Record<string, unknown> => row !== null)
      : []
    const activeSummary = runningRounds.at(-1) ?? asRecord(currentRecord.round)
    const activeRoundId = stringOrNull(activeSummary?.round_id)
    const publishedRound = asRecord(currentRecord.published_round)
    const publishedRoundId = stringOrNull(publishedRound?.round_id)
    const roundIds = [...new Set([activeRoundId, publishedRoundId].filter((id): id is string => id !== null))]
    const roundResults = await Promise.allSettled(roundIds.map(async (roundId) => [
      roundId,
      await fetchArenaJson(`${ARENA_GATEWAY_URL}/arena/v1/rounds/${encodeURIComponent(roundId)}`),
    ] as const))
    const rounds = new Map(roundResults.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : []
    ))

    return normalizeResearchLabArenaSnapshot(
      current,
      activeRoundId ? rounds.get(activeRoundId) ?? activeSummary : null,
      publishedRoundId ? rounds.get(publishedRoundId) : null,
    )
  } catch (error) {
    console.warn('[Research Lab API] Arena snapshot unavailable:', error instanceof Error ? error.message : 'request failed')
    return unavailable
  }
}

async function fetchArenaJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) throw new Error(`Arena request failed (${response.status})`)
  return response.json()
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function fetchLabMinerSpend(supabase: ReturnType<typeof getSupabase>): Promise<LabMinerSpendRollup> {
  const empty = emptyLabMinerSpend()
  const [computeSpend, scheduleResult, allAwardsResult, allocationHistory] = await Promise.all([
    fetchLabMinerComputeSpend(supabase),
    supabase
      .from('research_reimbursement_schedules')
      .select('award_id, schedule_status, start_epoch, epoch_count, total_microusd')
      .eq('schedule_status', 'scheduled')
      .order('start_epoch', { ascending: false, nullsFirst: false })
      .limit(5_000),
    supabase
      .from('research_reimbursement_awards')
      .select('award_id, miner_hotkey, target_reimbursement_microusd, reimbursement_epochs')
      .limit(5_000),
    fetchAllocationHistory(supabase),
  ])

  if (scheduleResult.error) {
    console.error('[Research Lab API] reimbursement schedule query failed:', scheduleResult.error)
  }
  if (allAwardsResult.error) {
    console.error('[Research Lab API] all-time reimbursement award query failed:', allAwardsResult.error)
  }

  const allTime = buildLabMinerAllTimeRollup(
    (allAwardsResult.data ?? []) as ReimbursementAwardRow[],
    allocationHistory,
    computeSpend.allTime
  )
  const byHotkey = buildLabMinerSpendEntriesFromCompute(computeSpend.last24h)
  const latestPublishedWeightEpoch = await fetchLatestPublishedWeightEpoch(supabase)
  const currentAllocation = await fetchCurrentLabAllocation(
    supabase,
    latestPublishedWeightEpoch,
    allocationHistory.latestSnapshot ? [allocationHistory.latestSnapshot] : [],
  )
  const fulfillmentRewards = await fetchCurrentFulfillmentRewards(
    supabase,
    latestPublishedWeightEpoch,
    currentAllocation.epoch === latestPublishedWeightEpoch
      ? currentAllocation.labCapAlphaPercent
      : null,
  )

  if (scheduleResult.error) {
    return {
      ...empty,
      byHotkey: finalizeLabMinerSpendEntries(byHotkey),
      allTime,
      currentAllocation,
      fulfillmentRewards,
    }
  }

  const schedules = ((scheduleResult.data ?? []) as ReimbursementScheduleRow[])
    .filter((row) => row.award_id && Number.isFinite(Number(row.start_epoch)))
  if (schedules.length === 0) {
    return {
      ...empty,
      byHotkey: finalizeLabMinerSpendEntries(byHotkey),
      allTime,
      currentAllocation,
      fulfillmentRewards,
    }
  }

  const latestEpoch = Math.max(...schedules.map((row) => numberOr(row.start_epoch, 0)))
  const activeSchedules = schedules.filter((row) => {
    const startEpoch = numberOr(row.start_epoch, 0)
    const epochCount = Math.max(1, Math.round(numberOr(row.epoch_count, 1)))
    return startEpoch <= latestEpoch && latestEpoch <= startEpoch + epochCount - 1
  })
  if (activeSchedules.length === 0) {
    return {
      window: { latestEpoch, epochCount: null, activeScheduleCount: 0 },
      byHotkey: finalizeLabMinerSpendEntries(byHotkey),
      allTime,
      currentAllocation,
      fulfillmentRewards,
    }
  }

  const awardIds = Array.from(new Set(activeSchedules.map((row) => row.award_id).filter(Boolean))) as string[]
  const awardRows: ReimbursementAwardRow[] = []
  for (let i = 0; i < awardIds.length; i += 100) {
    const batch = awardIds.slice(i, i + 100)
    const { data: awardData, error: awardError } = await supabase
      .from('research_reimbursement_award_current')
      .select('award_id, miner_hotkey, target_reimbursement_microusd, reimbursement_epochs')
      .in('award_id', batch)

    if (awardError) {
      console.error('[Research Lab API] reimbursement award query failed:', awardError)
      return {
        window: spendWindowForSchedules(latestEpoch, activeSchedules),
        byHotkey: finalizeLabMinerSpendEntries(byHotkey),
        allTime,
        currentAllocation,
        fulfillmentRewards,
      }
    }
    awardRows.push(...((awardData ?? []) as ReimbursementAwardRow[]))
  }

  const awardsById = new Map(awardRows.map((award) => [award.award_id, award]))
  for (const schedule of activeSchedules) {
    if (!schedule.award_id) continue
    const award = awardsById.get(schedule.award_id)
    if (!award) continue
    const hotkey = award.miner_hotkey ? String(award.miner_hotkey) : ''
    if (!hotkey) continue

    const current = byHotkey[hotkey] ?? emptyLabMinerSpendEntry()
    current.scheduledReimbursementUsd += microusdToUsd(
      award.target_reimbursement_microusd ?? schedule.total_microusd
    )
    current.activeAwardCount += 1
    current.reimbursementEpochs = Math.max(
      current.reimbursementEpochs ?? 0,
      Math.round(numberOr(award.reimbursement_epochs ?? schedule.epoch_count, 0))
    ) || current.reimbursementEpochs
    byHotkey[hotkey] = current
  }

  return {
    window: spendWindowForSchedules(latestEpoch, activeSchedules),
    byHotkey: finalizeLabMinerSpendEntries(byHotkey),
    allTime,
    currentAllocation,
    fulfillmentRewards,
  }
}

async function fetchLabMinerComputeSpend(
  supabase: ReturnType<typeof getSupabase>
): Promise<LabMinerComputeSpendRollup> {
  const terminalEvents = await readTerminalSpendHistory(
    () => fetchHistoryCount(supabase, 'research_loop_receipt_events'),
    (expectedCount) => fetchNormalizedTerminalSpend(supabase, expectedCount),
  )
  const allTimeLatest = new Map<string, LabMinerTerminalSpendEvent>()
  const last24hLatest = new Map<string, LabMinerTerminalSpendEvent>()
  // Recompute on each 30-second response refresh, even without a history append.
  const windowStartedAtMs = Date.now() - LAB_MINER_SPEND_WINDOW_MS
  for (const event of terminalEvents) {
    addLatestTerminalSpend(allTimeLatest, event)
    if (event.createdAtMs >= windowStartedAtMs) addLatestTerminalSpend(last24hLatest, event)
  }
  return {
    allTime: aggregateTerminalSpendByHotkey(allTimeLatest),
    last24h: aggregateTerminalSpendByHotkey(last24hLatest),
  }
}

async function fetchHistoryCount(
  supabase: ReturnType<typeof getSupabase>,
  table: 'research_loop_receipt_events' | 'research_lab_emission_allocation_snapshots',
): Promise<number> {
  const receipts = table === 'research_loop_receipt_events'
  let query = supabase.from(table).select(receipts ? 'event_id' : 'allocation_id', { count: 'exact', head: true })
  if (receipts) query = query.in('event_type', ['completed', 'failed'])
  const { count, error } = await query
  if (error || count === null) throw new Error(`Research Lab history count failed (${table})`)
  return count
}

async function fetchAllocationHistory(
  supabase: ReturnType<typeof getSupabase>,
): Promise<AllocationHistory> {
  return readAllocationHistory(
    () => fetchHistoryCount(supabase, 'research_lab_emission_allocation_snapshots'),
    async (expectedCount) => {
      // Keep the aggregate and one fallback document, rather than retaining
      // every historical allocation document in application memory.
      const history: AllocationHistory = {
        firstEpoch: null, latestEpoch: null, snapshotCount: 0, byHotkey: {}, latestSnapshot: null,
      }
      while (history.snapshotCount < expectedCount) {
        const { data, error } = await supabase
          .from('research_lab_emission_allocation_snapshots')
          .select('epoch, allocation_doc, created_at')
          .order('epoch', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true, nullsFirst: true })
          .order('allocation_id', { ascending: true })
          .range(history.snapshotCount, Math.min(history.snapshotCount + LAB_MINER_SPEND_BATCH_SIZE, expectedCount) - 1)
        if (error || !data?.length) throw new Error('Research Lab allocation history query failed')
        for (const snapshot of data as EmissionAllocationSnapshotRow[]) {
          history.snapshotCount += 1
          const epoch = numberOr(snapshot.epoch, NaN)
          if (Number.isFinite(epoch)) {
            history.firstEpoch = Math.min(history.firstEpoch ?? epoch, epoch)
            history.latestEpoch = Math.max(history.latestEpoch ?? epoch, epoch)
          }
          // Equal-epoch snapshots arrive oldest first, with a stable ID tie-break.
          if (!history.latestSnapshot || numberOr(snapshot.epoch, -Infinity) >= numberOr(history.latestSnapshot.epoch, -Infinity)) {
            history.latestSnapshot = snapshot
          }
          for (const allocation of researchLabAllocationEntries(snapshot.allocation_doc ?? {})) {
            const hotkey = allocation.miner_hotkey ? String(allocation.miner_hotkey) : ''
            if (!hotkey) continue
            const current = history.byHotkey[hotkey] ?? { alphaEarned: 0, alphaAllocationCount: 0 }
            current.alphaEarned += numberOr(allocation.paid_alpha_percent ?? allocation.alpha_percent, 0)
            current.alphaAllocationCount += 1
            history.byHotkey[hotkey] = current
          }
        }
      }
      return history
    },
  )
}

async function fetchNormalizedTerminalSpend(
  supabase: ReturnType<typeof getSupabase>,
  expectedCount: number,
): Promise<LabMinerTerminalSpendEvent[]> {
  const terminalEvents = await fetchTerminalReceiptEvents(supabase, expectedCount)

  const ticketIds = uniqueStrings(terminalEvents.map((event) => event.ticket_id))
  const receiptIds = uniqueStrings(terminalEvents.map((event) => event.receipt_id))
  const [ticketHotkeys, receiptRunIds] = await Promise.all([
    fetchTicketHotkeysById(supabase, ticketIds),
    fetchReceiptRunIdsById(supabase, receiptIds),
  ])

  const normalized: LabMinerTerminalSpendEvent[] = []

  for (const row of terminalEvents) {
    const ticketId = stringOr(row.ticket_id)
    const minerHotkey = ticketId ? ticketHotkeys.get(ticketId) : undefined
    if (!minerHotkey) throw new Error('Research Lab terminal receipt miner is missing')

    const receiptId = stringOr(row.receipt_id)
    const runId = stringOr(row.run_id) ?? (receiptId ? receiptRunIds.get(receiptId) : undefined)
    if (!runId) throw new Error('Research Lab terminal receipt run is missing')

    const createdAtMs = timestampOrZero(row.created_at)
    if (createdAtMs <= 0) throw new Error('Research Lab terminal receipt timestamp is invalid')

    normalized.push({
      minerHotkey,
      runId,
      createdAtMs,
      costMicrousd: receiptEventCostMicrousd({
        final_cost_ledger: {
          actual_openrouter_cost_microusd: row.cost_microusd,
          actual_openrouter_cost_usd: row.openrouter_usd,
          total_usd: row.total_usd,
        },
      }),
    })
  }

  return normalized
}

async function fetchTerminalReceiptEvents(
  supabase: ReturnType<typeof getSupabase>,
  expectedCount: number,
): Promise<ResearchLoopReceiptEventRow[]> {
  const rows: ResearchLoopReceiptEventRow[] = []
  while (rows.length < expectedCount) {
    const { data, error } = await supabase
      .from('research_loop_receipt_events')
      .select(
        'ticket_id, receipt_id, run_id:event_doc->>run_id, ' +
          'cost_microusd:event_doc->final_cost_ledger->>actual_openrouter_cost_microusd, ' +
          'openrouter_usd:event_doc->final_cost_ledger->>actual_openrouter_cost_usd, ' +
          'total_usd:event_doc->final_cost_ledger->>total_usd, created_at'
      )
      .in('event_type', ['completed', 'failed'])
      .order('created_at', { ascending: false, nullsFirst: false })
      .order('event_id', { ascending: true })
      .range(rows.length, Math.min(rows.length + LAB_MINER_SPEND_BATCH_SIZE, expectedCount) - 1)

    if (error || !data?.length) throw new Error('Research Lab terminal receipt event query failed')

    // PostgREST understands JSON-path aliases, but supabase-js's compile-time
    // select parser does not model this projection shape.
    const batch = (data ?? []) as unknown as ResearchLoopReceiptEventRow[]
    rows.push(...batch)
  }
  return rows
}

async function fetchTicketHotkeysById(
  supabase: ReturnType<typeof getSupabase>,
  ticketIds: string[]
): Promise<Map<string, string>> {
  const hotkeys = new Map<string, string>()
  for (let i = 0; i < ticketIds.length; i += SUPABASE_IN_FILTER_BATCH_SIZE) {
    const batch = ticketIds.slice(i, i + SUPABASE_IN_FILTER_BATCH_SIZE)
    if (batch.length === 0) continue

    const { data, error } = await supabase
      .from('research_loop_tickets')
      .select('ticket_id, miner_hotkey')
      .in('ticket_id', batch)

    if (error || data?.length !== batch.length) throw new Error('Research Lab terminal receipt ticket query failed')

    for (const row of (data ?? []) as ResearchLoopTicketSpendRow[]) {
      const ticketId = stringOr(row.ticket_id)
      const minerHotkey = stringOr(row.miner_hotkey)
      if (ticketId && minerHotkey) hotkeys.set(ticketId, minerHotkey)
    }
  }
  return hotkeys
}

async function fetchReceiptRunIdsById(
  supabase: ReturnType<typeof getSupabase>,
  receiptIds: string[]
): Promise<Map<string, string>> {
  const runIds = new Map<string, string>()
  for (let i = 0; i < receiptIds.length; i += SUPABASE_IN_FILTER_BATCH_SIZE) {
    const batch = receiptIds.slice(i, i + SUPABASE_IN_FILTER_BATCH_SIZE)
    if (batch.length === 0) continue

    const { data, error } = await supabase
      .from('research_loop_receipts')
      .select('receipt_id, run_id')
      .in('receipt_id', batch)

    if (error || data?.length !== batch.length) throw new Error('Research Lab terminal receipt run query failed')

    for (const row of (data ?? []) as ResearchLoopReceiptRunRow[]) {
      const receiptId = stringOr(row.receipt_id)
      const runId = stringOr(row.run_id)
      if (receiptId && runId) runIds.set(receiptId, runId)
    }
  }
  return runIds
}

function addLatestTerminalSpend(
  latestByMinerRun: Map<string, LabMinerTerminalSpendEvent>,
  event: LabMinerTerminalSpendEvent,
) {
  const key = `${event.minerHotkey}\u0000${event.runId}`
  const current = latestByMinerRun.get(key)
  if (!current || event.createdAtMs > current.createdAtMs) {
    latestByMinerRun.set(key, event)
  }
}

function aggregateTerminalSpendByHotkey(
  latestByMinerRun: Map<string, LabMinerTerminalSpendEvent>
): Record<string, number> {
  const byHotkey: Record<string, number> = {}
  for (const event of latestByMinerRun.values()) {
    byHotkey[event.minerHotkey] = (byHotkey[event.minerHotkey] ?? 0) + microusdToUsd(event.costMicrousd)
  }
  return Object.fromEntries(
    Object.entries(byHotkey).map(([hotkey, computeSpendUsd]) => [
      hotkey,
      roundUsd(computeSpendUsd),
    ])
  )
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => stringOr(value)).filter(Boolean))) as string[]
}

function buildLabMinerSpendEntriesFromCompute(
  computeSpendByHotkey: Record<string, number>
): Record<string, LabMinerSpendEntry> {
  const byHotkey: Record<string, LabMinerSpendEntry> = {}
  for (const [hotkey, computeSpendUsd] of Object.entries(computeSpendByHotkey)) {
    if (!hotkey) continue
    byHotkey[hotkey] = {
      ...emptyLabMinerSpendEntry(),
      computeSpendUsd,
    }
  }
  return byHotkey
}

function emptyLabMinerSpendEntry(): LabMinerSpendEntry {
  return {
    computeSpendUsd: 0,
    scheduledReimbursementUsd: 0,
    activeAwardCount: 0,
    reimbursementEpochs: null,
  }
}

function finalizeLabMinerSpendEntries(
  byHotkey: Record<string, LabMinerSpendEntry>
): Record<string, LabMinerSpendEntry> {
  return Object.fromEntries(
    Object.entries(byHotkey).map(([hotkey, entry]) => [
      hotkey,
      {
        ...entry,
        computeSpendUsd: roundUsd(entry.computeSpendUsd),
        scheduledReimbursementUsd: roundUsd(entry.scheduledReimbursementUsd),
      },
    ])
  )
}

async function fetchLatestPublishedWeightEpoch(
  supabase: ReturnType<typeof getSupabase>,
): Promise<number | null> {
  // Compact V2 is the live authority. Keep V1 only for pre-cutover history.
  const { data: finalizedData, error: finalizedError } = await supabase
    .from('research_lab_compact_weight_authorities_v2')
    .select('epoch_id')
    .eq('netuid', 71)
    .eq('authority_stage', 'finalized')
    .order('epoch_id', { ascending: false, nullsFirst: false })
    .limit(1)

  if (finalizedError) {
    console.error('[Research Lab API] finalized compact weight epoch query failed:', finalizedError)
  } else {
    const finalizedEpoch = numberOr(
      (finalizedData?.[0] as { epoch_id?: unknown } | undefined)?.epoch_id,
      NaN,
    )
    if (Number.isFinite(finalizedEpoch)) return finalizedEpoch
  }

  const { data: legacyData, error: legacyError } = await supabase
    .from('published_weight_bundles')
    .select('epoch_id')
    .eq('netuid', 71)
    .order('epoch_id', { ascending: false, nullsFirst: false })
    .limit(1)

  if (legacyError) {
    console.error('[Research Lab API] legacy published weight epoch query failed:', legacyError)
    return null
  }
  const epoch = numberOr(
    (legacyData?.[0] as { epoch_id?: unknown } | undefined)?.epoch_id,
    NaN,
  )
  return Number.isFinite(epoch) ? epoch : null
}

async function fetchCurrentLabAllocation(
  supabase: ReturnType<typeof getSupabase>,
  latestPublishedWeightEpoch: number | null,
  snapshots: EmissionAllocationSnapshotRow[],
): Promise<ResearchLabEmissionAllocationRollup> {
  if (latestPublishedWeightEpoch !== null) {
    const row = await fetchCurrentLabAllocationRow(supabase, latestPublishedWeightEpoch)
    if (row) return buildResearchLabAllocationRollup(row, 'latest_weight_epoch')
  }

  const latestCurrentRow = await fetchCurrentLabAllocationRow(supabase, null)
  if (latestCurrentRow) return buildResearchLabAllocationRollup(latestCurrentRow, 'latest_allocation_current')

  const latestSnapshot = snapshots
    .slice()
    .sort((a, b) => numberOr(b.epoch, -Infinity) - numberOr(a.epoch, -Infinity))[0]
  if (latestSnapshot) {
    return buildResearchLabAllocationRollup(latestSnapshot, 'latest_allocation_snapshot')
  }

  return buildResearchLabAllocationRollup(null, 'none')
}

async function fetchCurrentLabAllocationRow(
  supabase: ReturnType<typeof getSupabase>,
  epoch: number | null,
): Promise<ResearchLabEmissionAllocationSnapshot | null> {
  let query = supabase
    .from('research_lab_emission_allocation_current')
    .select('*')
    .order('epoch', { ascending: false, nullsFirst: false })
    .limit(1)

  if (epoch !== null) query = query.eq('epoch', epoch)

  const { data, error } = await query
  if (error) {
    console.error('[Research Lab API] current emission allocation query failed:', error)
    return null
  }

  const row = data?.[0] as ResearchLabEmissionAllocationSnapshot | undefined
  return row ?? null
}

async function fetchCurrentFulfillmentRewards(
  supabase: ReturnType<typeof getSupabase>,
  epoch: number | null,
  labCapAlphaPercent: number | null,
): Promise<FulfillmentRewardRollup | null> {
  if (epoch === null || labCapAlphaPercent === null) return null

  const rewards: FulfillmentRewardRow[] = []
  for (let offset = 0; ; offset += LAB_MINER_SPEND_BATCH_SIZE) {
    const { data, error } = await supabase
      .from('fulfillment_score_consensus')
      .select('consensus_id, miner_hotkey, reward_pct, reward_expires_epoch')
      .not('reward_pct', 'is', null)
      .gt('reward_expires_epoch', epoch)
      .order('consensus_id', { ascending: true })
      .range(offset, offset + LAB_MINER_SPEND_BATCH_SIZE - 1)

    if (error) {
      console.error('[Research Lab API] active fulfillment reward query failed:', error)
      return null
    }
    const batch = (data ?? []) as FulfillmentRewardRow[]
    rewards.push(...batch)
    if (batch.length < LAB_MINER_SPEND_BATCH_SIZE) break
  }

  const leaderboardRows = await fetchFulfillmentLeaderboardRows(supabase)
  if (leaderboardRows === null) return null

  const { data: bannedData, error: bannedError } = await supabase
    .from('banned_hotkeys')
    .select('hotkey')
    .limit(20_000)
  if (bannedError) {
    console.warn('[Research Lab API] banned hotkeys unavailable for fulfillment leaderboard:', bannedError)
  }
  const bannedHotkeys = new Set(
    ((bannedData ?? []) as Array<{ hotkey?: string | null }>)
      .map((row) => row.hotkey ? String(row.hotkey) : '')
      .filter(Boolean),
  )
  const leaderboardByHotkey = new Map<string, { wins: number; totalRewardPct: number }>()
  for (const row of leaderboardRows) {
    const hotkey = row.miner_hotkey ? String(row.miner_hotkey) : ''
    if (!hotkey || bannedHotkeys.has(hotkey)) continue
    const current = leaderboardByHotkey.get(hotkey) ?? { wins: 0, totalRewardPct: 0 }
    current.wins += 1
    current.totalRewardPct += numberOr(row.reward_pct, 0)
    leaderboardByHotkey.set(hotkey, current)
  }
  const leaderboardHotkeys = Array.from(leaderboardByHotkey.entries())
    .sort((a, b) =>
      b[1].wins - a[1].wins ||
      b[1].totalRewardPct - a[1].totalRewardPct ||
      a[0].localeCompare(b[0])
    )
    .slice(0, FULFILLMENT_LEADERBOARD_SIZE)
    .map(([hotkey]) => hotkey)

  return buildFulfillmentRewardRollup({
    epoch,
    labCapAlphaPercent,
    rewards,
    leaderboardHotkeys,
  })
}

async function fetchFulfillmentLeaderboardRows(
  supabase: ReturnType<typeof getSupabase>,
): Promise<FulfillmentLeaderboardRow[] | null> {
  const rows: FulfillmentLeaderboardRow[] = []
  const windowStartedAt = new Date(Date.now() - FULFILLMENT_LEADERBOARD_WINDOW_MS).toISOString()
  for (let offset = 0; ; offset += LAB_MINER_SPEND_BATCH_SIZE) {
    const { data, error } = await supabase
      .from('fulfillment_score_consensus')
      .select('consensus_id, miner_hotkey, reward_pct, computed_at')
      .eq('is_winner', true)
      .gte('computed_at', windowStartedAt)
      .order('consensus_id', { ascending: true })
      .range(offset, offset + LAB_MINER_SPEND_BATCH_SIZE - 1)

    if (error) {
      console.error('[Research Lab API] fulfillment leaderboard reward query failed:', error)
      return null
    }
    const batch = (data ?? []) as FulfillmentLeaderboardRow[]
    rows.push(...batch)
    if (batch.length < LAB_MINER_SPEND_BATCH_SIZE) break
  }
  return rows
}

function buildLabMinerAllTimeRollup(
  awards: ReimbursementAwardRow[],
  allocationHistory: AllocationHistory,
  computeSpendByHotkey: Record<string, number>,
): LabMinerAllTimeRollup {
  const byHotkey: Record<string, LabMinerAllTimeEntry> = Object.fromEntries(
    Object.entries(allocationHistory.byHotkey).map(([hotkey, entry]) => [
      hotkey, { ...emptyLabMinerAllTimeEntry(), ...entry },
    ]),
  )
  for (const award of awards) {
    const hotkey = award.miner_hotkey ? String(award.miner_hotkey) : ''
    if (!hotkey) continue
    const current = byHotkey[hotkey] ?? emptyLabMinerAllTimeEntry()
    current.scheduledReimbursementUsd += microusdToUsd(award.target_reimbursement_microusd)
    current.awardCount += 1
    current.reimbursementEpochs = Math.max(
      current.reimbursementEpochs ?? 0,
      Math.round(numberOr(award.reimbursement_epochs, 0))
    ) || current.reimbursementEpochs
    byHotkey[hotkey] = current
  }

  for (const [hotkey, computeSpendUsd] of Object.entries(computeSpendByHotkey)) {
    if (!hotkey) continue
    const current = byHotkey[hotkey] ?? emptyLabMinerAllTimeEntry()
    current.computeSpendUsd = computeSpendUsd
    byHotkey[hotkey] = current
  }

  return {
    firstEpoch: allocationHistory.firstEpoch,
    latestEpoch: allocationHistory.latestEpoch,
    allocationSnapshotCount: allocationHistory.snapshotCount,
    byHotkey: Object.fromEntries(
      Object.entries(byHotkey).map(([hotkey, entry]) => [
        hotkey,
        {
          ...entry,
          alphaEarned: roundAlpha(entry.alphaEarned),
          computeSpendUsd: roundUsd(entry.computeSpendUsd),
          scheduledReimbursementUsd: roundUsd(entry.scheduledReimbursementUsd),
        },
      ])
    ),
  }
}

function emptyLabMinerAllTimeEntry(): LabMinerAllTimeEntry {
  return {
    alphaEarned: 0,
    computeSpendUsd: 0,
    scheduledReimbursementUsd: 0,
    awardCount: 0,
    reimbursementEpochs: null,
    alphaAllocationCount: 0,
  }
}

function emptyLabMinerSpend(): LabMinerSpendRollup {
  return {
    window: {
      latestEpoch: null,
      epochCount: null,
      activeScheduleCount: 0,
    },
    byHotkey: {},
    allTime: {
      firstEpoch: null,
      latestEpoch: null,
      allocationSnapshotCount: 0,
      byHotkey: {},
    },
    currentAllocation: buildResearchLabAllocationRollup(null, 'none'),
    fulfillmentRewards: null,
  }
}

function spendWindowForSchedules(
  latestEpoch: number,
  schedules: ReimbursementScheduleRow[],
): LabMinerSpendWindow {
  const epochCounts = schedules
    .map((row) => Math.max(1, Math.round(numberOr(row.epoch_count, 0))))
    .filter((value) => value > 0)
  return {
    latestEpoch,
    epochCount: epochCounts.length > 0 ? Math.max(...epochCounts) : null,
    activeScheduleCount: schedules.length,
  }
}

function roundAlpha(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function numberOr(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function timestampOrZero(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
