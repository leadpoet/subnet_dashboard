import { proxyPublicArenaJson } from '@/lib/arena-public-proxy'
import { type SlotDecayCache, withCachedSlotDecay } from '@/lib/research-lab-current-cache'

export const dynamic = 'force-dynamic'

// One per server process (PM2 runs a single fork worker); kept on globalThis so a module reload keeps it.
const store = globalThis as typeof globalThis & { __subnetSlotDecayCache?: SlotDecayCache | null }

export async function GET() {
  return proxyPublicArenaJson('/arena/v1/current', undefined, (body) => {
    const result = withCachedSlotDecay(body, store.__subnetSlotDecayCache ?? null)
    store.__subnetSlotDecayCache = result.cache
    return result.body
  })
}
