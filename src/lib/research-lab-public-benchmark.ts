export type BenchmarkServingModelVersion = {
  runId: string | null
  gitCommitSha: string | null
  modelArtifactHash: string | null
  manifestHash: string | null
  benchmarkAttempt: number | null
  evaluationEpoch: number | null
  versionStampHash: string | null
  publicStampHash: string | null
}

export type PublicBenchmarkCounts = {
  itemCount: number
  publicIcpCount: number
  privateHoldoutIcpCount: number
  conditionalHoldoutIcpCount: number
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function nonNegativeIntegerOrNull(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null
}

export function normalizeBenchmarkServingModelVersion(
  value: unknown,
): BenchmarkServingModelVersion | null {
  const source = objectRecord(value)
  if (!source) return null

  const normalized: BenchmarkServingModelVersion = {
    runId: stringOrNull(source.run_id),
    gitCommitSha: stringOrNull(source.git_commit_sha),
    modelArtifactHash: stringOrNull(source.model_artifact_hash),
    manifestHash: stringOrNull(source.manifest_hash),
    benchmarkAttempt: nonNegativeIntegerOrNull(source.benchmark_attempt),
    evaluationEpoch: nonNegativeIntegerOrNull(source.evaluation_epoch),
    versionStampHash: stringOrNull(source.version_stamp_hash),
    publicStampHash: stringOrNull(source.public_stamp_hash),
  }

  return Object.values(normalized).some((field) => field !== null) ? normalized : null
}

export function publicBenchmarkServingModelVersion(
  reportDoc: unknown,
): BenchmarkServingModelVersion | null {
  const report = objectRecord(reportDoc)
  if (!report) return null

  const serving = normalizeBenchmarkServingModelVersion(report.serving_model_version)
  if (serving) return serving

  // Promoted reports predate the nested serving stamp and expose only these
  // three public activation fields. Keep the fallback as explicit as the
  // nested allowlist so source-candidate and private pointer fields never pass.
  return normalizeBenchmarkServingModelVersion({
    git_commit_sha: report.activation_git_commit_sha,
    model_artifact_hash: report.activation_model_artifact_hash,
    manifest_hash: report.activation_manifest_hash,
  })
}

export function normalizePublicBenchmarkCounts(
  reportDoc: unknown,
  publicIcpFallback = 0,
): PublicBenchmarkCounts {
  const report = objectRecord(reportDoc) ?? {}
  const visibility = objectRecord(report.visibility_split) ?? {}
  const publicIcpCount = nonNegativeIntegerOrNull(report.public_icp_count)
    ?? nonNegativeIntegerOrNull(visibility.public_count)
    ?? nonNegativeIntegerOrNull(publicIcpFallback)
    ?? 0
  const privateHoldoutIcpCount = nonNegativeIntegerOrNull(report.private_holdout_icp_count)
    ?? nonNegativeIntegerOrNull(visibility.private_count)
    ?? 0
  const conditionalHoldoutIcpCount = nonNegativeIntegerOrNull(report.conditional_holdout_icp_count)
    ?? nonNegativeIntegerOrNull(visibility.conditional_count)
    ?? 0
  const itemCount = nonNegativeIntegerOrNull(report.item_count)
    ?? publicIcpCount + privateHoldoutIcpCount + conditionalHoldoutIcpCount

  return {
    itemCount,
    publicIcpCount,
    privateHoldoutIcpCount,
    conditionalHoldoutIcpCount,
  }
}
