import { invalidPublicArenaId, proxyPublicArenaJson, publicArenaId } from '@/lib/arena-public-proxy'

export const dynamic = 'force-dynamic'

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
  )
}
