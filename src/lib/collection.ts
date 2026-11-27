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
