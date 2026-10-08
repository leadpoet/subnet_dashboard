import { NextResponse } from 'next/server'
import { proxyPublicArenaJson } from '@/lib/arena-public-proxy'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const cursor = params.get('cursor') ?? ''
  const day = params.get('day') ?? ''
  const hotkey = (params.get('hotkey') ?? '').trim()
  if ((cursor && !/^[A-Za-z0-9_-]{1,1024}$/.test(cursor))
    || (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day))
    || !/^[A-Za-z0-9]{0,128}$/.test(hotkey)) {
    return NextResponse.json({ error: 'Invalid history filter.' }, { status: 400 })
  }
  const query = new URLSearchParams({ limit: '25', hotkey })
  if (day) query.set('day', day)
  if (cursor) query.set('cursor', cursor)
  return proxyPublicArenaJson(`/arena/v1/history?${query}`)
}
