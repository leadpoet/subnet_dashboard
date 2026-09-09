import { proxyPublicArenaJson } from '@/lib/arena-public-proxy'

export const dynamic = 'force-dynamic'

export async function GET() {
  return proxyPublicArenaJson('/arena/v1/competition')
}
