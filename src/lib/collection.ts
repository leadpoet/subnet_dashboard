export const ENROLLMENT_GUIDE = 'https://github.com/leadpoet/leadpoet/blob/main/docs/locked-collection.md#enrollment'
export const SALES_AGENT = 'https://github.com/leadpoet/leadpoet-sales-agent'

export interface CollectionStatus {
  paid_enrollment_open: boolean
  champion_rewards_off: boolean
  running_runs: number
  verified_runs: number
  as_of: string
}

export function isCollectionStatus(value: unknown): value is CollectionStatus {
  if (typeof value !== 'object' || value === null) return false
  const data = value as Record<string, unknown>
  const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
  return typeof data.paid_enrollment_open === 'boolean'
    && typeof data.champion_rewards_off === 'boolean'
    && count(data.running_runs) && count(data.verified_runs)
    && typeof data.as_of === 'string' && Number.isFinite(Date.parse(data.as_of))
}

export const MINER_HOTKEY = /^[1-9A-HJ-NP-Za-km-z]{46,48}$/

export interface MinerContribution {
  hotkey: string
  joined_at: string
  last_funded_at: string | null
  funded_runs: number
  earned_quote_microusd: string
  payout_status: 'confirmed' | 'pending' | 'unavailable'
}

export type LatestPayout =
  | { status: 'confirmed'; epoch: number; closed_at: string; shares: Record<string, number> }
  | { status: 'none' | 'unavailable' }

export interface MinerPage {
  latest_payout?: LatestPayout
  miners: MinerContribution[]
  next: string | null
}

const units = (value: unknown) => typeof value === 'string' && /^\d+$/.test(value)
const instant = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))

function isLatestPayout(value: unknown): value is LatestPayout {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  if (p.status === 'none' || p.status === 'unavailable') return true
  return p.status === 'confirmed' && Number.isSafeInteger(p.epoch) && Number(p.epoch) >= 0
    && instant(p.closed_at) && !!p.shares && typeof p.shares === 'object' && !Array.isArray(p.shares)
    && Object.entries(p.shares).every(([key, pct]) => MINER_HOTKEY.test(key)
      && typeof pct === 'number' && Number.isFinite(pct) && pct >= 0 && pct <= 100)
}

export function formatShare(percent: number): string {
  if (percent > 0 && percent < 0.000001) return '<0.000001%'
  return percent.toLocaleString('en-US', { maximumSignificantDigits: 4 }) + '%'
}

export function isMinerPage(value: unknown): value is MinerPage {
  if (!value || typeof value !== 'object') return false
  const page = value as Record<string, unknown>
  if (!Array.isArray(page.miners) || page.miners.length > 25) return false
  if (page.latest_payout !== undefined && !isLatestPayout(page.latest_payout)) return false
  const valid = page.miners.every((r: MinerContribution) => r && typeof r.hotkey === 'string'
    && MINER_HOTKEY.test(r.hotkey) && instant(r.joined_at)
    && (r.last_funded_at === null || instant(r.last_funded_at))
    && Number.isSafeInteger(r.funded_runs) && r.funded_runs >= 0 && units(r.earned_quote_microusd)
    && (r.payout_status === 'unavailable' || r.payout_status === 'confirmed' || r.payout_status === 'pending'))
  return valid && new Set(page.miners.map(r => r.hotkey)).size === page.miners.length
    && (page.next === null || (typeof page.next === 'string' && page.next === page.miners.at(-1)?.hotkey))
}

// Format the original integer units without converting large rewards to floating point.
export function displayUnits(raw: string, decimals: number, minimumDecimals = 0): string {
  const padded = raw.padStart(decimals + 1, '0')
  const fraction = padded.slice(-decimals).replace(/0+$/, '').padEnd(minimumDecimals, '0')
  return padded.slice(0, -decimals) + (fraction ? '.' + fraction : '')
}
