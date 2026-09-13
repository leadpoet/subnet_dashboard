import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const response = NextResponse.json({ leads: [], count: 0, fetchedAt: Date.now() })
  response.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=30')
  return response
}
