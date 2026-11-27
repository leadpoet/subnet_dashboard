import { NextResponse } from 'next/server'
import { proxyPublicArenaJson } from '@/lib/arena-public-proxy'
import { MINER_HOTKEY } from '@/lib/collection'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const after = new URL(request.url).searchParams.get('after')
  if (after !== null && !MINER_HOTKEY.test(after)) {
    return NextResponse.json({ error: 'Invalid miner cursor.' }, { status: 400 })
  }
  return proxyPublicArenaJson('/arena/v1/collection/miners' + (after ? '?after=' + encodeURIComponent(after) : ''))
}
