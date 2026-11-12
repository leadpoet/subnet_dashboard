/** Keeps the reward seats' decay clock across an epoch boundary.
 *
 * At each new epoch the gateway reports `epoch_eligible: null` and no
 * `weekly_slot_decay` until validators accept that epoch's weight state, so a
 * first page load in that window cannot show decay. The clock's start epochs
 * only change when a seat changes hands, which also changes the signed seats,
 * so the last accepted clock stays exact while the seats and policy are the
 * same. It is reused for the next epoch only: a gateway that reports the epoch
 * ineligible, or stays without a state longer, is shown as it is. */

export type SlotDecayCache = { epoch: number; seatsKey: string; clock: unknown }

type CurrentBody = Record<string, unknown>

function isRecord(value: unknown): value is CurrentBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function epochOf(body: CurrentBody): number | null {
  return Number.isSafeInteger(body.current_epoch) && (body.current_epoch as number) >= 0 ? body.current_epoch as number : null
}

function seatsKey(body: CurrentBody): string | null {
  if (!isRecord(body.reward_slot_policy) || !Array.isArray(body.reward_slots)) return null
  return JSON.stringify([body.reward_slot_policy, body.reward_slots])
}

/** Returns the body to serve and the cache to keep. */
export function withCachedSlotDecay(body: unknown, cache: SlotDecayCache | null): { body: unknown; cache: SlotDecayCache | null } {
  if (!isRecord(body)) return { body, cache }
  const epoch = epochOf(body)
  const key = seatsKey(body)
  if (epoch === null || key === null) return { body, cache }
  if (body.epoch_eligible === true && isRecord(body.weekly_slot_decay)) {
    return { body, cache: cache && cache.epoch > epoch ? cache : { epoch, seatsKey: key, clock: body.weekly_slot_decay } }
  }
  const pending = body.epoch_eligible === null && body.weekly_slot_decay === undefined
  if (pending && cache && cache.seatsKey === key && (epoch === cache.epoch || epoch === cache.epoch + 1)) {
    return { body: { ...body, epoch_eligible: true, weekly_slot_decay: cache.clock, weekly_slot_decay_epoch: cache.epoch }, cache }
  }
  return { body, cache }
}
