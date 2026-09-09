import { invalidPublicArenaId, proxyPublicArenaJson, publicArenaId } from '@/lib/arena-public-proxy'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ submissionId: string }> }) {
  const submissionId = publicArenaId((await context.params).submissionId)
  if (!submissionId) return invalidPublicArenaId('submission')
  return proxyPublicArenaJson(`/arena/v1/submissions/${encodeURIComponent(submissionId)}/code`)
}
