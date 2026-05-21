import { NextRequest, NextResponse } from 'next/server'
import {
  getAdminSupabase,
  AdminConsensusRow,
  AdminFulfillmentRequest,
  LeadDataInner,
  LeadDataEntry,
} from '@/lib/admin-supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUBMISSION_BATCH_SIZE = 1000
const CONSENSUS_BATCH_SIZE = 1000
const MAX_CHAIN_WALK = 250

type SubmittedLeadStatus = 'approved' | 'fulfilled' | 'pending' | 'denied'
type SubmittedLeadFilter = SubmittedLeadStatus | 'all'

type SubmissionRow = {
  submission_id: string
  request_id: string
  miner_hotkey: string | null
  revealed: boolean | null
  revealed_at: string | null
  lead_hashes: Array<{ lead_id?: string }> | null
  lead_data: LeadDataEntry[] | null
}

type ScoreRow = {
  request_id: string
  lead_id: string
  failure_reason: string | null
  failure_detail: string | null
  final_score: number | null
}

type SubmittedLeadIndexRow = {
  lead_id: string
  submission_id: string
  request_id: string
  miner_hotkey: string
  revealed: boolean
  submitted_at: string | null
  activity_at: string | null
  status: SubmittedLeadStatus
  fulfilled: boolean
  consensus: AdminConsensusRow | undefined
}

async function walkChain(
  supabase: ReturnType<typeof getAdminSupabase>,
  startId: string,
): Promise<AdminFulfillmentRequest[]> {
  const collected = new Map<string, AdminFulfillmentRequest>()

  async function fetchOne(id: string): Promise<AdminFulfillmentRequest | null> {
    const { data, error } = await supabase
      .from('fulfillment_requests')
      .select(
        'request_id, internal_label, company, status, num_leads, icp_details, required_attributes, created_at, window_start, window_end, successor_request_id',
      )
      .eq('request_id', id)
      .limit(1)
      .maybeSingle()
    if (error) {
      console.error('[admin] request leads fetchOne failed', id, error)
      return null
    }
    return data as AdminFulfillmentRequest | null
  }

  const startRow = await fetchOne(startId)
  if (!startRow) return []
  collected.set(startRow.request_id, startRow)

  let cur: AdminFulfillmentRequest | null = startRow
  for (let i = 0; cur && i < MAX_CHAIN_WALK; i++) {
    const { data: predData } = await supabase
      .from('fulfillment_requests')
      .select(
        'request_id, internal_label, company, status, num_leads, icp_details, required_attributes, created_at, window_start, window_end, successor_request_id',
      )
      .eq('successor_request_id', cur.request_id)
      .limit(1)
      .maybeSingle()
    const pred = predData as AdminFulfillmentRequest | null
    if (!pred || collected.has(pred.request_id)) break
    collected.set(pred.request_id, pred)
    cur = pred
  }

  cur = startRow
  for (let i = 0; cur && i < MAX_CHAIN_WALK; i++) {
    if (!cur.successor_request_id) break
    if (collected.has(cur.successor_request_id)) break
    const next = await fetchOne(cur.successor_request_id)
    if (!next) break
    collected.set(next.request_id, next)
    cur = next
  }

  return Array.from(collected.values()).sort((a, b) =>
    a.created_at < b.created_at ? -1 : 1,
  )
}

function classifyLead(
  submission: Pick<SubmissionRow, 'revealed'>,
  consensus: AdminConsensusRow | undefined,
): SubmittedLeadStatus {
  if (consensus?.is_winner) return 'fulfilled'
  if (consensus?.is_chain_held) return 'approved'
  if (!submission.revealed || !consensus) return 'pending'
  return 'denied'
}

function rejectionReason(score: ScoreRow | undefined): string | null {
  const reason = score?.failure_reason?.trim()
  if (reason) return reason

  const detail = score?.failure_detail?.toLowerCase() ?? ''
  if (detail.includes('email verification failed')) {
    const match = detail.match(/\(([^)]+)\)/)
    return match?.[1] ? `email_${match[1]}` : 'email_verification_failed'
  }
  return null
}

function parsePageParam(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function parseFilter(value: string | null): SubmittedLeadFilter {
  return value === 'approved' ||
    value === 'fulfilled' ||
    value === 'pending' ||
    value === 'denied'
    ? value
    : 'all'
}

function countRows(rows: SubmittedLeadIndexRow[]): Record<SubmittedLeadFilter, number> {
  return {
    all: rows.length,
    approved: rows.filter((row) => row.status === 'approved').length,
    fulfilled: rows.filter((row) => row.status === 'fulfilled').length,
    pending: rows.filter((row) => row.status === 'pending').length,
    denied: rows.filter((row) => row.status === 'denied').length,
  }
}

function csvValue(value: unknown): string {
  if (value == null) return ''
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : JSON.stringify(value)
  return `"${text.replace(/"/g, '""')}"`
}

function csvLine(values: unknown[]): string {
  return values.map(csvValue).join(',')
}

function leadString(lead: LeadDataInner | null, key: keyof LeadDataInner): string {
  const value = lead?.[key]
  return typeof value === 'string' ? value : ''
}

function buildCsv(leads: Array<{
  lead_id: string
  submission_id: string
  request_id: string
  miner_hotkey: string
  revealed: boolean
  submitted_at: string | null
  status: SubmittedLeadStatus
  fulfilled: boolean
  consensus: AdminConsensusRow | null
  lead: LeadDataInner | null
  score: number | null
  rejection_reason: string | null
  rejection_detail: string | null
}>): string {
  const headers = [
    'status',
    'fulfilled',
    'lead_id',
    'submission_id',
    'request_id',
    'miner_hotkey',
    'submitted_at',
    'score',
    'rejection_reason',
    'rejection_detail',
    'full_name',
    'email',
    'phone',
    'role',
    'role_type',
    'seniority',
    'business',
    'industry',
    'sub_industry',
    'employee_count',
    'city',
    'state',
    'country',
    'company_hq_city',
    'company_hq_state',
    'company_hq_country',
    'linkedin_url',
    'company_website',
    'company_linkedin',
    'description',
    'intent_details',
    'intent_signal_mapping_json',
    'intent_breakdown_json',
    'lead_data_json',
    'consensus_json',
  ]

  const rows = leads.map((lead) =>
    csvLine([
      lead.status,
      lead.fulfilled,
      lead.lead_id,
      lead.submission_id,
      lead.request_id,
      lead.miner_hotkey,
      lead.submitted_at,
      lead.score,
      lead.rejection_reason,
      lead.rejection_detail,
      leadString(lead.lead, 'full_name'),
      leadString(lead.lead, 'email'),
      leadString(lead.lead, 'phone'),
      leadString(lead.lead, 'role'),
      leadString(lead.lead, 'role_type'),
      leadString(lead.lead, 'seniority'),
      leadString(lead.lead, 'business'),
      leadString(lead.lead, 'industry'),
      leadString(lead.lead, 'sub_industry'),
      leadString(lead.lead, 'employee_count'),
      leadString(lead.lead, 'city'),
      leadString(lead.lead, 'state'),
      leadString(lead.lead, 'country'),
      leadString(lead.lead, 'company_hq_city'),
      leadString(lead.lead, 'company_hq_state'),
      leadString(lead.lead, 'company_hq_country'),
      leadString(lead.lead, 'linkedin_url'),
      leadString(lead.lead, 'company_website'),
      leadString(lead.lead, 'company_linkedin'),
      leadString(lead.lead, 'description'),
      lead.consensus?.intent_details,
      lead.consensus?.intent_signal_mapping,
      lead.consensus?.intent_breakdown,
      lead.lead,
      lead.consensus,
    ]),
  )

  return [csvLine(headers), ...rows].join('\n')
}

async function fetchAllConsensusRows(
  supabase: ReturnType<typeof getAdminSupabase>,
  chainIds: string[],
): Promise<{ data: AdminConsensusRow[]; error: { message: string } | null }> {
  const all: AdminConsensusRow[] = []
  for (let offset = 0; ; offset += CONSENSUS_BATCH_SIZE) {
    const { data, error } = await supabase
      .from('fulfillment_score_consensus')
      .select(
        'consensus_id, request_id, submission_id, lead_id, miner_hotkey, ' +
          'consensus_final_score, consensus_intent_signal_final, consensus_rep_score, ' +
          'consensus_icp_fit, consensus_tier2_passed, consensus_email_verified, ' +
          'consensus_person_verified, consensus_company_verified, consensus_decision_maker, ' +
          'any_fabricated, is_winner, is_chain_held, reward_pct, reward_expires_epoch, ' +
          'intent_details, intent_breakdown, intent_signal_mapping, num_validators, computed_at',
      )
      .in('request_id', chainIds)
      .range(offset, offset + CONSENSUS_BATCH_SIZE - 1)

    if (error) return { data: all, error }
    const batch = (data ?? []) as unknown as AdminConsensusRow[]
    all.push(...batch)
    if (batch.length < CONSENSUS_BATCH_SIZE) break
  }
  return { data: all, error: null }
}

async function fetchAllSubmissions(
  supabase: ReturnType<typeof getAdminSupabase>,
  chainIds: string[],
): Promise<{ data: SubmissionRow[]; error: { message: string } | null }> {
  const all: SubmissionRow[] = []
  for (let offset = 0; ; offset += SUBMISSION_BATCH_SIZE) {
    const { data, error } = await supabase
      .from('fulfillment_submissions')
      .select('submission_id, request_id, miner_hotkey, revealed, revealed_at, lead_hashes, lead_data')
      .in('request_id', chainIds)
      .order('revealed_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + SUBMISSION_BATCH_SIZE - 1)

    if (error) return { data: all, error }
    const batch = (data ?? []) as SubmissionRow[]
    all.push(...batch)
    if (batch.length < SUBMISSION_BATCH_SIZE) break
  }
  return { data: all, error: null }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ request_id: string }> },
) {
  const { request_id } = await ctx.params
  if (!request_id || typeof request_id !== 'string') {
    return NextResponse.json({ error: 'invalid request_id' }, { status: 400 })
  }
  if (!/^[0-9a-f-]{36}$/i.test(request_id)) {
    return NextResponse.json({ error: 'invalid request_id format' }, { status: 400 })
  }

  const search = req.nextUrl.searchParams
  const statusFilter = parseFilter(search.get('status'))
  const exportMode = search.get('export') === 'csv'
  const pageSize = parsePageParam(search.get('pageSize'), 50, 10, 100)
  const page = parsePageParam(search.get('page'), 1, 1, 100000)

  let supabase
  try {
    supabase = getAdminSupabase()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'admin supabase not configured'
    return NextResponse.json({ error: msg }, { status: 503 })
  }

  const cycles = await walkChain(supabase, request_id)
  if (cycles.length === 0) {
    return NextResponse.json({ error: 'request not found' }, { status: 404 })
  }
  const chainIds = cycles.map((cycle) => cycle.request_id)

  const { data: consensusRows, error: consensusErr } = await fetchAllConsensusRows(
    supabase,
    chainIds,
  )

  if (consensusErr) {
    return NextResponse.json(
      { error: `Supabase error: ${consensusErr.message}` },
      { status: 502 },
    )
  }

  const { data: submissions, error: submissionErr } = await fetchAllSubmissions(
    supabase,
    chainIds,
  )

  if (submissionErr) {
    return NextResponse.json(
      { error: `Supabase error: ${submissionErr.message}` },
      { status: 502 },
    )
  }

  const consensusByLead = new Map<string, AdminConsensusRow>()
  const consensusBySubmission = new Map<string, AdminConsensusRow[]>()
  for (const row of consensusRows) {
    consensusByLead.set(`${row.submission_id}:${row.lead_id}`, row)
    const rows = consensusBySubmission.get(row.submission_id) ?? []
    rows.push(row)
    consensusBySubmission.set(row.submission_id, rows)
  }

  const indexRows = submissions.flatMap((submission): SubmittedLeadIndexRow[] => {
    const leadIds = new Set<string>()
    for (const entry of submission.lead_hashes ?? []) {
      if (entry.lead_id) leadIds.add(entry.lead_id)
    }
    for (const entry of submission.lead_data ?? []) {
      if (entry.lead_id) leadIds.add(entry.lead_id)
    }
    for (const consensus of consensusBySubmission.get(submission.submission_id) ?? []) {
      leadIds.add(consensus.lead_id)
    }

    return Array.from(leadIds).map((leadId) => {
      const consensus = consensusByLead.get(`${submission.submission_id}:${leadId}`)
      const status = classifyLead(submission, consensus)
      const submittedAt = submission.revealed_at
      const activityAt =
        status === 'approved' || status === 'denied' || status === 'fulfilled'
          ? consensus?.computed_at ?? submittedAt
          : submittedAt

      return {
        lead_id: leadId,
        submission_id: submission.submission_id,
        request_id: submission.request_id,
        miner_hotkey: submission.miner_hotkey ?? consensus?.miner_hotkey ?? '',
        revealed: Boolean(submission.revealed),
        submitted_at: submittedAt,
        activity_at: activityAt,
        status,
        fulfilled: Boolean(consensus?.is_winner),
        consensus,
      }
    })
  })

  indexRows.sort((a, b) => {
    const at = a.activity_at ?? ''
    const bt = b.activity_at ?? ''
    return at < bt ? 1 : -1
  })

  const counts = countRows(indexRows)
  const filteredRows =
    statusFilter === 'all'
      ? indexRows
      : indexRows.filter((row) => row.status === statusFilter)

  const total = filteredRows.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, totalPages)
  const from = (safePage - 1) * pageSize
  const pageRows = exportMode ? filteredRows : filteredRows.slice(from, from + pageSize)

  const pageSubmissionIds = Array.from(new Set(pageRows.map((row) => row.submission_id)))
  const pageLeadIds = Array.from(new Set(pageRows.map((row) => row.lead_id)))

  const submissionsById = new Map(submissions.map((submission) => [submission.submission_id, submission]))
  const leadDataBySubmission = new Map<string, LeadDataEntry[]>()
  for (const submissionId of pageSubmissionIds) {
    const leadData = submissionsById.get(submissionId)?.lead_data
    if (leadData) leadDataBySubmission.set(submissionId, leadData)
  }
  const missingPageSubmissionIds = pageSubmissionIds.filter(
    (submissionId) => !leadDataBySubmission.has(submissionId),
  )
  if (missingPageSubmissionIds.length > 0) {
    const { data: pageSubmissionData, error: pageSubmissionErr } = await supabase
      .from('fulfillment_submissions')
      .select('submission_id, lead_data')
      .in('submission_id', missingPageSubmissionIds)

    if (pageSubmissionErr) {
      console.warn('[admin] request leads page hydration failed', pageSubmissionErr.message)
    } else {
      for (const submission of pageSubmissionData ?? []) {
        leadDataBySubmission.set(
          submission.submission_id,
          ((submission.lead_data ?? []) as LeadDataEntry[]),
        )
      }
    }
  }

  const scoreByLead = new Map<string, ScoreRow>()
  if (pageLeadIds.length > 0) {
    const { data: scoreData, error: scoreErr } = await supabase
      .from('fulfillment_scores')
      .select('request_id, lead_id, failure_reason, failure_detail, final_score')
      .in('request_id', chainIds)
      .in('lead_id', pageLeadIds)
      .limit(10000)

    if (scoreErr) {
      console.warn('[admin] request leads scores failed', scoreErr.message)
    } else {
      for (const row of (scoreData ?? []) as ScoreRow[]) {
        const key = `${row.request_id}:${row.lead_id}`
        const prev = scoreByLead.get(key)
        const prevHasDetail = Boolean(prev?.failure_reason || prev?.failure_detail)
        const rowHasDetail = Boolean(row.failure_reason || row.failure_detail)
        if (!prev || (!prevHasDetail && rowHasDetail)) scoreByLead.set(key, row)
      }
    }
  }

  const leads = pageRows.map((row) => {
    const leadData =
      leadDataBySubmission
        .get(row.submission_id)
        ?.find((entry) => entry.lead_id === row.lead_id)?.data ?? null
    const scoreRow = scoreByLead.get(`${row.request_id}:${row.lead_id}`)

    return {
      lead_id: row.lead_id,
      submission_id: row.submission_id,
      request_id: row.request_id,
      miner_hotkey: row.miner_hotkey,
      revealed: row.revealed,
      submitted_at: row.submitted_at,
      status: row.status,
      fulfilled: row.fulfilled,
      consensus: row.consensus ?? null,
      lead: leadData,
      score: row.consensus?.consensus_final_score ?? scoreRow?.final_score ?? null,
      rejection_reason: row.status === 'denied' ? rejectionReason(scoreRow) : null,
      rejection_detail: row.status === 'denied' ? scoreRow?.failure_detail ?? null : null,
    }
  })

  if (exportMode) {
    const filename = `request-${request_id.slice(0, 8)}-leads-${statusFilter}.csv`
    return new NextResponse(buildCsv(leads), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  return NextResponse.json(
    {
      leads,
      counts,
      page: safePage,
      pageSize,
      total,
      totalPages,
      status: statusFilter,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
