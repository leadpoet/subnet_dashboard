import { invalidPublicArenaId, proxyPublicArenaJson, publicArenaId } from '@/lib/arena-public-proxy'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ roundId: string }> }) {
  const roundId = publicArenaId((await context.params).roundId)
  if (!roundId) return invalidPublicArenaId('round')
  const response = await proxyPublicArenaJson(`/arena/v1/rounds/${encodeURIComponent(roundId)}/submissions`)
  if (!response.ok) return response
  const body = await response.clone().json()
  if (body?.round_id !== roundId || !Array.isArray(body.submissions)) return response

  // Add display context only; keep the gateway's competition status unchanged.
  await Promise.all(body.submissions.map(async (submission: { status?: string; submission_id?: string; failure_reason?: string } | null) => {
    if (submission?.status !== 'scoring_failed' || typeof submission.submission_id !== 'string') return
    const submissionId = publicArenaId(submission.submission_id)
    if (!submissionId) return
    const result = await proxyPublicArenaJson(`/arena/v1/rounds/${encodeURIComponent(roundId)}/results/${encodeURIComponent(submissionId)}`)
    if (!result.ok) return
    const detail = await result.json()
    if (detail?.round_id !== roundId || detail?.submission_id !== submissionId) return
    if (Array.isArray(detail.run_results) && detail.run_results.some((run: { terminal_status?: string } | null) => run?.terminal_status === 'credential_error')) {
      submission.failure_reason = 'credential_error'
    }
  }))
  return NextResponse.json(body, { status: response.status, headers: response.headers })
}
