import { invalidPublicArenaId, proxyPublicArenaJson, publicArenaId } from '@/lib/arena-public-proxy'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ roundId: string }> }) {
  const roundId = publicArenaId((await context.params).roundId)
  if (!roundId) return invalidPublicArenaId('round')
  return proxyPublicArenaJson(`/arena/v1/rounds/${encodeURIComponent(roundId)}/benchmark`)
}
