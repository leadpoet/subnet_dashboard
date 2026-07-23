// Pure reshaping of the batched get_chain_summaries response into the per-request
// structures the fulfillment API consumes. Kept dependency-free so it can be unit
// tested without a database (see scripts/test-chain-summaries.mjs).

export type ChainSummaryRow = {
  request_id: string
  winners: Array<Record<string, unknown>> | null
  root_num_leads: number | null
  held_count: number | null
}

export type ReshapedChainSummaries = {
  // Per-request arrays aligned to allRequestIds (downstream indexes by position).
  chainWinnersResults: Array<{ data: Array<Record<string, unknown>>; error: unknown }>
  rootLeadsResults: Array<{ data: number | null; error: unknown }>
  heldResults: Array<{ data: number; error: unknown }>
  // Derived directly from the full winner rows -- no supplemental lead_id query.
  chainWinnerKeys: Set<string>
  leadIdToVisibleRid: Map<string, string>
  chainCanonicalRows: Array<Record<string, unknown>>
}

export function reshapeChainSummaries(
  allRequestIds: string[],
  rawSummaries: ChainSummaryRow[] | null | undefined,
): ReshapedChainSummaries {
  const byRid = new Map<string, ChainSummaryRow>()
  for (const row of rawSummaries ?? []) {
    if (row && typeof row.request_id === 'string') byRid.set(row.request_id, row)
  }

  const chainWinnersResults = allRequestIds.map((rid) => ({
    data: (byRid.get(rid)?.winners ?? []) as Array<Record<string, unknown>>,
    error: null as unknown,
  }))
  const rootLeadsResults = allRequestIds.map((rid) => ({
    data: byRid.get(rid)?.root_num_leads ?? null,
    error: null as unknown,
  }))
  const heldResults = allRequestIds.map((rid) => ({
    data: byRid.get(rid)?.held_count ?? 0,
    error: null as unknown,
  }))

  const chainWinnerKeys = new Set<string>()
  const leadIdToVisibleRid = new Map<string, string>()
  const chainCanonicalRows: Array<Record<string, unknown>> = []
  for (let i = 0; i < allRequestIds.length; i++) {
    const rid = allRequestIds[i]
    for (const row of chainWinnersResults[i].data) {
      const leadId = (row.lead_id as string | undefined) ?? ''
      if (!leadId) continue
      chainWinnerKeys.add(`${rid}|${leadId}`)
      // First-claim wins: a lead_id attaches to one visible request.
      if (!leadIdToVisibleRid.has(leadId)) leadIdToVisibleRid.set(leadId, rid)
      chainCanonicalRows.push(row)
    }
  }

  return {
    chainWinnersResults,
    rootLeadsResults,
    heldResults,
    chainWinnerKeys,
    leadIdToVisibleRid,
    chainCanonicalRows,
  }
}
