/**
 * GET /api/admin/requests/[request_id]/csv
 *
 * Streams every winning lead in the chain as an XLSX workbook. The column set
 * mirrors the admin dashboard "Winning leads" table 1:1 — the operator
 * sends this file to the client, so we deliberately exclude every
 * internal / operational column (consensus_final_score,
 * intent_signal_score, rep_score, reward_pct, miner_hotkey,
 * computed_at, lead_id).  Those still exist in Supabase for ops; they
 * just don't belong in a client-facing artifact.
 *
 * Full-data exports explode intent signals into per-signal columns
 * (one set of columns per credited signal) instead of collapsing them
 * into a single JSON-ish cell.  Client-ready exports keep the compact
 * client-facing column set and append EVERY signal in the mapping
 * (credited or not) with its full field set to the Intent Details
 * cell — post-processing downstream finalizes leads from this file,
 * so no signal data may be dropped.
 *
 * We do NOT use a streaming response because
 * the row count is bounded by `num_leads` (single digits in
 * practice), so the payload is small and the synchronous path is
 * simpler.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/admin-supabase'
import type {
  IntentSignalMappingEntry,
  IntentBreakdown,
} from '@/lib/admin-supabase'
import { buildXlsxArrayBuffer, type XlsxCell } from '@/lib/xlsx-export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface LeadDataLite {
  business?: string
  full_name?: string
  email?: string
  phone?: string | null
  role?: string
  linkedin_url?: string
  company_website?: string
  company_linkedin?: string
  industry?: string
  sub_industry?: string
  employee_count?: string
  city?: string
  state?: string
  country?: string
  company_hq_state?: string
  company_hq_country?: string
  description?: string
}

interface LeadDataEntry {
  lead_id: string
  data?: LeadDataLite
}

// Mirror of admin-format.ts::creditedSignals — kept inline so this
// route has no dependency on the React-side helpers.
function creditedSignals(
  mapping: IntentSignalMappingEntry[] | null | undefined,
): IntentSignalMappingEntry[] {
  if (!Array.isArray(mapping)) return []
  return mapping.filter(
    (s) => (s.after_decay_score ?? s.raw_score ?? 0) > 0,
  )
}

// Mirror the dashboard's "use LLM breakdown text when present, fall
// back to raw description" resolution.  Keep the lookup identical to
// IntentSignalsList in AdminRequestDetail.tsx (index into credited[]).
function resolveSignalDescription(
  credited: IntentSignalMappingEntry[],
  breakdown: IntentBreakdown | null,
  i: number,
): string {
  const byIdx = new Map<number, string>()
  for (const b of breakdown?.per_signal ?? []) {
    if (typeof b.source_index === 'number' && b.details) {
      byIdx.set(b.source_index, b.details)
    }
  }
  return byIdx.get(i) || credited[i]?.description || ''
}

function appendField(lines: string[], label: string, value: string | null | undefined) {
  const cleaned = value?.trim()
  if (cleaned) lines.push(`${label}: ${cleaned}`)
}

function formatNumber(value: number | undefined, decimals = 2): string {
  return typeof value === 'number' ? value.toFixed(decimals) : ''
}

/**
 * Render EVERY signal in the mapping (credited or not) with the
 * complete field set.  Client-ready exports feed downstream
 * post-processing that finalizes leads, so nothing may be dropped.
 *
 * ``breakdown.per_signal[].source_index`` indexes into the *credited*
 * subset (mirrors IntentSignalsList in AdminRequestDetail.tsx), so we
 * map each full-mapping index to its credited index before looking up
 * the LLM-written per-signal details.
 */
function formatIntentSignalsForDetails(
  mapping: IntentSignalMappingEntry[] | null | undefined,
  breakdown: IntentBreakdown | null,
): string {
  if (!Array.isArray(mapping) || mapping.length === 0) return ''

  const credited = creditedSignals(mapping)
  const creditedIdxOf = new Map<IntentSignalMappingEntry, number>()
  credited.forEach((s, i) => creditedIdxOf.set(s, i))

  return mapping
    .map((signal, i) => {
      const creditedIdx = creditedIdxOf.get(signal)
      const isCredited = creditedIdx !== undefined
      const lines = [`Intent Signal ${i + 1}:`]
      appendField(lines, 'Source', signal.source || 'web')
      appendField(lines, 'Date', signal.date ?? undefined)
      appendField(lines, 'Date Status', signal.date_status)
      appendField(lines, 'Matched ICP Signal', signal.matched_icp_signal ?? undefined)
      if (typeof signal.matched_icp_signal_required === 'boolean') {
        lines.push(`Required: ${signal.matched_icp_signal_required ? 'yes' : 'no'}`)
      }
      lines.push(`Credited: ${isCredited ? 'yes' : 'no'}`)
      appendField(lines, 'Raw Score', formatNumber(signal.raw_score))
      appendField(lines, 'Decay Multiplier', formatNumber(signal.decay_multiplier))
      appendField(lines, 'Score (after decay)', formatNumber(signal.after_decay_score))
      appendField(lines, 'Confidence', formatNumber(signal.confidence))
      appendField(
        lines,
        'Description',
        isCredited
          ? resolveSignalDescription(credited, breakdown, creditedIdx)
          : signal.description || '',
      )
      appendField(lines, 'URL', signal.url)
      appendField(lines, 'Snippet', signal.snippet)
      return lines.join('\n')
    })
    .join('\n\n')
}

function buildClientIntentDetails(
  intentDetails: string | null,
  mapping: IntentSignalMappingEntry[] | null | undefined,
  breakdown: IntentBreakdown | null,
): string {
  const sections: string[] = []
  const details = intentDetails?.trim()
  if (details) sections.push(details)

  const signals = formatIntentSignalsForDetails(mapping, breakdown)
  if (signals) sections.push(`Intent Signals:\n${signals}`)

  return sections.join('\n\n')
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ request_id: string }> },
) {
  const { request_id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(request_id || '')) {
    return new NextResponse('invalid request_id', { status: 400 })
  }

  let supabase
  try {
    supabase = getAdminSupabase()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'admin supabase not configured'
    return new NextResponse(msg, { status: 503 })
  }

  // Walk the chain so the workbook always includes every winner the
  // client got, even when they came from a predecessor row.
  // We reuse the simple in-place walk rather than depending on
  // the JSON endpoint so this route stays standalone.
  const collected = new Set<string>([request_id])
  let head = request_id
  for (let i = 0; i < 50; i++) {
    const { data: pred } = await supabase
      .from('fulfillment_requests')
      .select('request_id')
      .eq('successor_request_id', head)
      .limit(1)
      .maybeSingle()
    if (!pred?.request_id || collected.has(pred.request_id)) break
    collected.add(pred.request_id)
    head = pred.request_id
  }
  let tail = request_id
  for (let i = 0; i < 50; i++) {
    const { data: cur } = await supabase
      .from('fulfillment_requests')
      .select('successor_request_id')
      .eq('request_id', tail)
      .limit(1)
      .maybeSingle()
    const next = cur?.successor_request_id
    if (!next || collected.has(next)) break
    collected.add(next)
    tail = next
  }
  const chainIds = Array.from(collected)

  // Pull root for the filename + verify chain exists.
  const { data: rootRow } = await supabase
    .from('fulfillment_requests')
    .select('request_id, internal_label, company')
    .in('request_id', chainIds)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!rootRow) {
    return new NextResponse('request not found', { status: 404 })
  }

  // consensus_final_score is still selected (for stable sort order
  // only); it is NOT emitted as a column.
  const { data: winnersData, error: winnersErr } = await supabase
    .from('fulfillment_score_consensus')
    .select(
      'consensus_id, request_id, submission_id, lead_id, ' +
        'consensus_final_score, intent_details, intent_breakdown, ' +
        'intent_signal_mapping',
    )
    .in('request_id', chainIds)
    .eq('is_winner', true)
    .order('consensus_final_score', { ascending: false })

  if (winnersErr) {
    return new NextResponse(`supabase error: ${winnersErr.message}`, { status: 502 })
  }

  interface WinnerRow {
    consensus_id: string
    request_id: string
    submission_id: string
    lead_id: string
    consensus_final_score: number | null
    intent_details: string | null
    intent_breakdown: IntentBreakdown | null
    intent_signal_mapping: IntentSignalMappingEntry[] | null
  }
  const winnerRows = (winnersData || []) as unknown as WinnerRow[]

  // Dedup by lead_id (highest score wins).
  const winnersByLead = new Map<string, WinnerRow>()
  for (const w of winnerRows) {
    const prev = winnersByLead.get(w.lead_id)
    if (!prev || (w.consensus_final_score ?? 0) > (prev.consensus_final_score ?? 0)) {
      winnersByLead.set(w.lead_id, w)
    }
  }
  const winners = Array.from(winnersByLead.values())

  // Hydrate lead_data for each winning submission.
  const winningSubIds = Array.from(new Set(winners.map((w) => w.submission_id)))
  const leadDataBySub = new Map<string, LeadDataEntry[]>()
  if (winningSubIds.length > 0) {
    const { data: subs } = await supabase
      .from('fulfillment_submissions')
      .select('submission_id, lead_data')
      .in('submission_id', winningSubIds)
    for (const s of subs || []) {
      leadDataBySub.set(s.submission_id, (s.lead_data || []) as LeadDataEntry[])
    }
  }

  const exportFormat = req.nextUrl.searchParams.get('format')
  const clientReady = exportFormat === 'client-ready'

  // First pass: figure out how many per-signal column blocks we
  // need.  This is the max credited-signal count across every
  // winning lead in the export.  Leads with fewer signals leave
  // trailing blocks blank.
  let maxSignals = 0
  const creditedByConsensus = new Map<string, IntentSignalMappingEntry[]>()
  for (const w of winners) {
    const credited = creditedSignals(w.intent_signal_mapping)
    creditedByConsensus.set(w.consensus_id, credited)
    if (credited.length > maxSignals) maxSignals = credited.length
  }

  // Base lead columns mirror the dashboard table in
  // src/app/admin/requests/[request_id]/_components/AdminRequestDetail.tsx
  // (TABLE_COLUMNS).  Keep the order identical so the workbook reads
  // left-to-right exactly like the UI.
  const baseColumns: string[] = [
    'Name',
    'Email',
    'Role',
    'Company',
    'LinkedIn',
    'Website',
    'Company LinkedIn',
    'Industry',
    'Sub Industry',
    'City',
    'State',
    'Country',
    'HQ State',
    'HQ Country',
    'Employee Count',
    'Description',
    'Intent Details',
    'Phone',
  ]

  // Per-signal column block.  Eight columns per credited signal,
  // matching the fields rendered in IntentSignalsList plus a
  // "Required" column that exposes whether the matched buyer spec was
  // flagged required ("yes"/"no"/"", blank when no spec matched).
  const signalSubColumns = [
    'Source',
    'Date',
    'Matched ICP Signal',
    'Required',
    'Description',
    'URL',
    'Snippet',
    'Score',
  ]
  const signalColumns: string[] = []
  for (let i = 1; i <= maxSignals; i++) {
    for (const sub of signalSubColumns) {
      signalColumns.push(`Intent Signal ${i} — ${sub}`)
    }
  }

  const header = clientReady ? baseColumns : [...baseColumns, ...signalColumns]
  const rows: XlsxCell[][] = []

  for (const w of winners) {
    const entry = (leadDataBySub.get(w.submission_id) || []).find(
      (e) => e.lead_id === w.lead_id,
    )
    const ld = entry?.data || {}
    const credited = creditedByConsensus.get(w.consensus_id) || []

    const baseRow: XlsxCell[] = [
      ld.full_name,
      ld.email,
      ld.role,
      ld.business,
      ld.linkedin_url,
      ld.company_website,
      ld.company_linkedin,
      ld.industry,
      ld.sub_industry,
      ld.city,
      ld.state,
      ld.country,
      ld.company_hq_state,
      ld.company_hq_country,
      ld.employee_count,
      ld.description,
      clientReady
        ? buildClientIntentDetails(
            w.intent_details,
            w.intent_signal_mapping,
            w.intent_breakdown,
          )
        : w.intent_details,
      ld.phone ?? '',
    ]

    const signalRow: XlsxCell[] = []
    for (let i = 0; i < maxSignals; i++) {
      const s = credited[i]
      if (!s) {
        // Lead has fewer signals than this column block; emit
        // one blank cell per sub-column so column alignment stays
        // sane regardless of the current signalSubColumns count.
        for (let j = 0; j < signalSubColumns.length; j++) signalRow.push('')
        continue
      }
      const desc = resolveSignalDescription(credited, w.intent_breakdown, i)
      // ``matched_icp_signal_required`` is tri-state on the wire:
      // true / false / null|undefined. Map booleans to "yes" / "no" and
      // leave blanks for legacy rows without the field.
      const requiredFlag =
        typeof s.matched_icp_signal_required === 'boolean'
          ? s.matched_icp_signal_required
            ? 'yes'
            : 'no'
          : ''
      signalRow.push(
        s.source ?? '',
        s.date ?? '',
        s.matched_icp_signal ?? '',
        requiredFlag,
        desc,
        s.url ?? '',
        s.snippet ?? '',
        typeof s.after_decay_score === 'number'
          ? s.after_decay_score.toFixed(2)
          : '',
      )
    }

    const row = clientReady ? baseRow : [...baseRow, ...signalRow]
    rows.push(row)
  }

  const labelSlug = (rootRow.internal_label || rootRow.company || 'request')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  const fname = `${labelSlug}-${rootRow.request_id.slice(0, 8)}-${
    clientReady ? 'client-ready' : 'winners'
  }.xlsx`
  const body = buildXlsxArrayBuffer(header, rows, clientReady ? 'Client ready' : 'Full data')

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Cache-Control': 'no-store',
    },
  })
}
