import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    results: [],
    total: 0,
    returned: 0,
    hasMore: false,
  })
}
