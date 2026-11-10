import { invalidPublicArenaId, proxyPublicArenaJson, publicArenaId } from '@/lib/arena-public-proxy'

export const dynamic = 'force-dynamic'

// A full result is about 100 KB and the gateway took 5-11 s to build one on Nov 9, 2026.
const RESULT_DEADLINE_MS = 20_000

export async function GET(
  _request: Request,
  context: { params: Promise<{ roundId: string; submissionId: string }> },
) {
  const params = await context.params
  const roundId = publicArenaId(params.roundId)
  const submissionId = publicArenaId(params.submissionId)
  if (!roundId) return invalidPublicArenaId('round')
  if (!submissionId) return invalidPublicArenaId('submission')
  return proxyPublicArenaJson(
    `/arena/v1/rounds/${encodeURIComponent(roundId)}/results/${encodeURIComponent(submissionId)}`,
    RESULT_DEADLINE_MS,
  )
}
