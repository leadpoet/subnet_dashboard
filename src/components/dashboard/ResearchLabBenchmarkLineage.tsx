import type { BenchmarkServingModelVersion } from '../../lib/research-lab-public-benchmark'

type Props = {
  lineage: BenchmarkServingModelVersion | null
  currentStatusLabel: string | null
}

function shortLineageId(value: string): string {
  const normalized = value.startsWith('sha256:') ? value.slice('sha256:'.length) : value
  return normalized.length > 12 ? normalized.slice(0, 12) : normalized
}

export function ResearchLabBenchmarkLineage({ lineage, currentStatusLabel }: Props) {
  if (!lineage && !currentStatusLabel) return null

  return (
    <div className="mt-2 flex max-w-[760px] flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-[var(--muted-2)]">
      {lineage?.modelArtifactHash && (
        <span title={lineage.modelArtifactHash}>
          Model {shortLineageId(lineage.modelArtifactHash)}
        </span>
      )}
      {lineage?.gitCommitSha && (
        <span title={lineage.gitCommitSha}>
          Commit {shortLineageId(lineage.gitCommitSha)}
        </span>
      )}
      {lineage?.runId && (
        <span title={lineage.runId}>Run {shortLineageId(lineage.runId)}</span>
      )}
      {lineage?.benchmarkAttempt !== null && lineage?.benchmarkAttempt !== undefined && (
        <span>Attempt {lineage.benchmarkAttempt}</span>
      )}
      {lineage?.evaluationEpoch !== null && lineage?.evaluationEpoch !== undefined && (
        <span>Epoch {lineage.evaluationEpoch}</span>
      )}
      {currentStatusLabel && <span>Current {currentStatusLabel}</span>}
    </div>
  )
}
