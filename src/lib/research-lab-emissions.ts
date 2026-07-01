export type ResearchLabAllocationSource =
  | 'latest_weight_epoch'
  | 'latest_allocation_current'
  | 'latest_allocation_snapshot'
  | 'none'

export type ResearchLabEmissionAllocationEntry = {
  miner_hotkey?: string | null
  uid?: number | string | null
  paid_alpha_percent?: number | string | null
  intended_alpha_percent?: number | string | null
  overpaid_alpha_percent?: number | string | null
  spend_usd?: number | string | null
  reason?: string | null
  alpha_percent?: number | string | null
}

export type ResearchLabEmissionAllocationDoc = {
  lab_cap_alpha_percent?: number | string | null
  lab_cap_percent?: number | string | null
  reimbursement_allocations?: ResearchLabEmissionAllocationEntry[]
  champion_allocations?: ResearchLabEmissionAllocationEntry[]
  queued_champion_allocations?: ResearchLabEmissionAllocationEntry[]
}

export type ResearchLabEmissionAllocationSnapshot = {
  epoch?: number | string | null
  allocation_doc?: ResearchLabEmissionAllocationDoc | null
  created_at?: string | null
  lab_cap_alpha_percent?: number | string | null
}

export type ResearchLabMinerAllocationEntry = {
  paidAlphaPercent: number
  intendedAlphaPercent: number
  overpaidAlphaPercent: number
  spendUsd: number
  labBucketSharePercent: number
  allocationCount: number
  reasons: string[]
}

export type ResearchLabEmissionAllocationRollup = {
  epoch: number | null
  source: ResearchLabAllocationSource
  labCapAlphaPercent: number | null
  byHotkey: Record<string, ResearchLabMinerAllocationEntry>
}

export function researchLabAllocationEntries(
  doc: ResearchLabEmissionAllocationDoc | null | undefined,
): ResearchLabEmissionAllocationEntry[] {
  if (!doc) return []
  return [
    ...(Array.isArray(doc.reimbursement_allocations) ? doc.reimbursement_allocations : []),
    ...(Array.isArray(doc.champion_allocations) ? doc.champion_allocations : []),
    ...(Array.isArray(doc.queued_champion_allocations) ? doc.queued_champion_allocations : []),
  ]
}

export function buildResearchLabAllocationRollup(
  snapshot: ResearchLabEmissionAllocationSnapshot | null | undefined,
  source: ResearchLabAllocationSource,
): ResearchLabEmissionAllocationRollup {
  const doc = snapshot?.allocation_doc ?? null
  const labCapAlphaPercent = nullableNumber(
    doc?.lab_cap_alpha_percent ?? doc?.lab_cap_percent ?? snapshot?.lab_cap_alpha_percent
  )
  const byHotkey: Record<string, ResearchLabMinerAllocationEntry> = {}

  for (const allocation of researchLabAllocationEntries(doc)) {
    const hotkey = allocation.miner_hotkey ? String(allocation.miner_hotkey) : ''
    if (!hotkey) continue

    const current = byHotkey[hotkey] ?? {
      paidAlphaPercent: 0,
      intendedAlphaPercent: 0,
      overpaidAlphaPercent: 0,
      spendUsd: 0,
      labBucketSharePercent: 0,
      allocationCount: 0,
      reasons: [],
    }
    current.paidAlphaPercent += numberOrZero(allocation.paid_alpha_percent ?? allocation.alpha_percent)
    current.intendedAlphaPercent += numberOrZero(allocation.intended_alpha_percent)
    current.overpaidAlphaPercent += numberOrZero(allocation.overpaid_alpha_percent)
    current.spendUsd += numberOrZero(allocation.spend_usd)
    current.allocationCount += 1
    if (allocation.reason) current.reasons.push(String(allocation.reason))
    byHotkey[hotkey] = current
  }

  return {
    epoch: nullableNumber(snapshot?.epoch),
    source,
    labCapAlphaPercent,
    byHotkey: Object.fromEntries(
      Object.entries(byHotkey).map(([hotkey, entry]) => [
        hotkey,
        {
          ...entry,
          paidAlphaPercent: roundAllocation(entry.paidAlphaPercent),
          intendedAlphaPercent: roundAllocation(entry.intendedAlphaPercent),
          overpaidAlphaPercent: roundAllocation(entry.overpaidAlphaPercent),
          spendUsd: roundAllocation(entry.spendUsd),
          labBucketSharePercent: labCapAlphaPercent && labCapAlphaPercent > 0
            ? roundAllocation((entry.paidAlphaPercent / labCapAlphaPercent) * 100)
            : 0,
          reasons: Array.from(new Set(entry.reasons)),
        },
      ])
    ),
  }
}

export function formatLabAllocationPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%'
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })}%`
}

function nullableNumber(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function numberOrZero(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function roundAllocation(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
