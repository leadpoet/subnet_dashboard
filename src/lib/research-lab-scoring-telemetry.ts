export type ResearchLabScoringTelemetryMode = 'v2' | 'legacy' | 'missing'

export type ResearchLabBenchmarkCorrelation =
  | 'event_bundle_id'
  | 'exact_artifacts'
  | 'unlinked'

export type ResearchLabScoringRunRow = {
  scoring_run_id?: unknown
  scoring_id?: unknown
  run_type?: unknown
  run_attempt?: unknown
  source_run_id?: unknown
  ticket_id?: unknown
  candidate_id?: unknown
  benchmark_id?: unknown
  benchmark_date?: unknown
  rolling_window_hash?: unknown
  reference_artifact_hash?: unknown
  expected_icp_count?: unknown
  scheduler_type?: unknown
  worker_ref?: unknown
  current_run_status?: unknown
  current_status_at?: unknown
  current_retryable?: unknown
  current_failure_category?: unknown
  current_telemetry_degraded?: unknown
  benchmark_bundle_id?: unknown
  assigned_at?: unknown
  started_at?: unknown
  last_heartbeat_at?: unknown
  finished_at?: unknown
  observed_runtime_seconds?: unknown
  created_at?: unknown
}

export type ResearchLabScoringTelemetryRow = {
  telemetry_mode?: unknown
  scoring_id?: unknown
  scoring_run_id?: unknown
  source_run_id?: unknown
  candidate_id?: unknown
  icp_execution_id?: unknown
  icp_ref?: unknown
  model_role?: unknown
  phase?: unknown
  execution_kind?: unknown
  retry_round?: unknown
  status?: unknown
  score?: unknown
  sourced_company_count?: unknown
  scored_company_count?: unknown
  cumulative_spend_usd?: unknown
  cap_usd?: unknown
  failure_category?: unknown
  retryable?: unknown
  telemetry_degraded?: unknown
  started_at?: unknown
  last_heartbeat_at?: unknown
  finished_at?: unknown
  observed_runtime_seconds?: unknown
  checkpoint_ref?: unknown
  expected_units?: unknown
  current_status_at?: unknown
}

export type ResearchLabBenchmarkBundleRow = {
  benchmark_bundle_id?: unknown
  benchmark_date?: unknown
  rolling_window_hash?: unknown
  private_model_artifact_hash?: unknown
  aggregate_score?: unknown
  current_benchmark_status?: unknown
  current_event_type?: unknown
  current_status_at?: unknown
  created_at?: unknown
}

export type ResearchLabScoringExecutionSummary = {
  telemetryMode: ResearchLabScoringTelemetryMode
  scoringId: string | null
  scoringRunId: string | null
  relatedScoringRunIds: string[]
  sourceRunId: string | null
  candidateId: string | null
  executionStatus: string | null
  expectedUnits: number | null
  resolvedUnits: number | null
  completedUnits: number | null
  skippedUnits: number | null
  failedUnits: number | null
  cancelledUnits: number | null
  progressPercent: number | null
  phase: string | null
  modelRole: string | null
  maxRetryRound: number
  checkpointReuseCount: number
  sourcedCompanyCount: number | null
  scoredCompanyCount: number | null
  spendUsd: number | null
  capUsd: number | null
  failureCategory: string | null
  retryable: boolean | null
  workerRef: string | null
  schedulerType: string | null
  startedAt: string | null
  lastHeartbeatAt: string | null
  completedAt: string | null
  durationSeconds: number | null
  telemetryDegraded: boolean
}

export type ResearchLabPublicBenchmarkTelemetry = {
  publicationStatus: string
  executionStatus: string | null
  expectedUnits: number | null
  resolvedUnits: number | null
  completedUnits: number | null
  skippedUnits: number | null
  failedUnits: number | null
  progressPercent: number | null
  startedAt: string | null
  completedAt: string | null
  durationSeconds: number | null
  canonicalPublishedScore: number | null
}

export function normalizeResearchLabScoringExecution(
  runRows: ResearchLabScoringRunRow[],
  telemetryRows: ResearchLabScoringTelemetryRow[],
): ResearchLabScoringExecutionSummary | null {
  if (runRows.length === 0) return null

  const latestRun = [...runRows].sort(compareRunsNewestFirst)[0]
  const scoringId = textOrNull(latestRun.scoring_id)
  const relatedRuns = runRows.filter((row) =>
    scoringId ? textOrNull(row.scoring_id) === scoringId : row === latestRun,
  )
  const relatedRunIds = uniqueStrings(
    relatedRuns.map((row) => textOrNull(row.scoring_run_id)),
  )
  const allowedRunIds = new Set(relatedRunIds)
  const relatedTelemetry = telemetryRows.filter((row) => {
    const rowScoringId = textOrNull(row.scoring_id)
    const rowRunId = textOrNull(row.scoring_run_id)
    return scoringId
      ? rowScoringId === scoringId && (
          allowedRunIds.size === 0 || Boolean(rowRunId && allowedRunIds.has(rowRunId))
        )
      : Boolean(rowRunId && allowedRunIds.has(rowRunId))
  })
  const canonicalRows = canonicalizeResearchLabTelemetryRows(relatedTelemetry)
  const telemetryMode = telemetryModeFor(canonicalRows)
  const expectedUnits = nonNegativeIntegerOrNull(latestRun.expected_icp_count)
    ?? maxNullable(canonicalRows.map((row) => nonNegativeIntegerOrNull(row.expected_units)))
  const progressKnown = canonicalRows.length > 0
  const completedUnits = progressKnown ? countStatus(canonicalRows, 'completed') : null
  const skippedUnits = progressKnown ? countStatus(canonicalRows, 'skipped') : null
  const failedUnits = progressKnown ? countStatus(canonicalRows, 'failed') : null
  const cancelledUnits = progressKnown ? countStatus(canonicalRows, 'cancelled') : null
  const resolvedUnits = progressKnown
    ? (completedUnits ?? 0) + (skippedUnits ?? 0) + (failedUnits ?? 0) + (cancelledUnits ?? 0)
    : null
  const progressPercent = expectedUnits !== null && expectedUnits > 0 && resolvedUnits !== null
    ? Math.min(100, roundTo((resolvedUnits / expectedUnits) * 100, 1))
    : null
  const sourcedCounts = canonicalRows.map((row) => nonNegativeIntegerOrNull(row.sourced_company_count))
  const scoredCounts = canonicalRows.map((row) => nonNegativeIntegerOrNull(row.scored_company_count))
  const spendValues = canonicalRows.map((row) => finiteNumberOrNull(row.cumulative_spend_usd))
  const capValues = canonicalRows.map((row) => finiteNumberOrNull(row.cap_usd))
  const failureRow = [...canonicalRows]
    .filter((row) => ['failed', 'cancelled'].includes(normalizedStatus(row.status)))
    .sort(compareTelemetryNewestFirst)[0]
  const phases = uniqueStrings(canonicalRows.map((row) => textOrNull(row.phase)))
  const modelRoles = uniqueStrings(canonicalRows.map((row) => textOrNull(row.model_role)))
  const telemetryDegraded = telemetryMode !== 'v2'
    || booleanOrFalse(latestRun.current_telemetry_degraded)
    || canonicalRows.some((row) => booleanOrFalse(row.telemetry_degraded))
    || (
      normalizedStatus(latestRun.current_run_status) === 'completed'
      && expectedUnits !== null
      && resolvedUnits !== null
      && resolvedUnits < expectedUnits
    )

  return {
    telemetryMode,
    scoringId,
    scoringRunId: textOrNull(latestRun.scoring_run_id),
    relatedScoringRunIds: relatedRunIds,
    sourceRunId: textOrNull(latestRun.source_run_id),
    candidateId: textOrNull(latestRun.candidate_id),
    executionStatus: textOrNull(latestRun.current_run_status),
    expectedUnits,
    resolvedUnits,
    completedUnits,
    skippedUnits,
    failedUnits,
    cancelledUnits,
    progressPercent,
    phase: phases.length > 0 ? phases.join(' + ') : null,
    modelRole: modelRoles.length > 0 ? modelRoles.join(' + ') : null,
    maxRetryRound: maxNullable(canonicalRows.map((row) => nonNegativeIntegerOrNull(row.retry_round))) ?? 0,
    checkpointReuseCount: canonicalRows.filter((row) =>
      normalizedStatus(row.execution_kind) === 'checkpoint_reuse' || Boolean(textOrNull(row.checkpoint_ref)),
    ).length,
    sourcedCompanyCount: sumNullable(sourcedCounts),
    scoredCompanyCount: sumNullable(scoredCounts),
    spendUsd: sumNullable(spendValues, 6),
    capUsd: sumNullable(capValues, 6),
    failureCategory:
      textOrNull(latestRun.current_failure_category)
      ?? textOrNull(failureRow?.failure_category),
    retryable:
      booleanOrNull(latestRun.current_retryable)
      ?? booleanOrNull(failureRow?.retryable),
    workerRef: textOrNull(latestRun.worker_ref),
    schedulerType: textOrNull(latestRun.scheduler_type),
    startedAt: isoOrNull(latestRun.started_at),
    lastHeartbeatAt: isoOrNull(latestRun.last_heartbeat_at),
    completedAt: isoOrNull(latestRun.finished_at),
    durationSeconds: finiteNumberOrNull(latestRun.observed_runtime_seconds),
    telemetryDegraded,
  }
}

export function correlateResearchLabBenchmarkRun(
  runRows: ResearchLabScoringRunRow[],
  bundles: ResearchLabBenchmarkBundleRow[],
  bundleIdByScoringRunId: ReadonlyMap<string, string>,
): {
  correlation: ResearchLabBenchmarkCorrelation
  bundle: ResearchLabBenchmarkBundleRow | null
} {
  if (runRows.length === 0) return { correlation: 'unlinked', bundle: null }
  const latestRun = [...runRows].sort(compareRunsNewestFirst)[0]

  for (const run of [...runRows].sort(compareRunsNewestFirst)) {
    const runId = textOrNull(run.scoring_run_id)
    const eventBundleId = runId ? bundleIdByScoringRunId.get(runId) : null
    const currentBundleId = textOrNull(run.benchmark_bundle_id)
    const durableBundleId = eventBundleId ?? currentBundleId
    if (!durableBundleId) continue
    const bundle = bundles.find((candidate) =>
      textOrNull(candidate.benchmark_bundle_id) === durableBundleId,
    )
    if (bundle) return { correlation: 'event_bundle_id', bundle }
  }

  const benchmarkDate = dateOrNull(latestRun.benchmark_date)
  const rollingWindowHash = textOrNull(latestRun.rolling_window_hash)
  const referenceArtifactHash = textOrNull(latestRun.reference_artifact_hash)
  if (!benchmarkDate || !rollingWindowHash || !referenceArtifactHash) {
    return { correlation: 'unlinked', bundle: null }
  }
  const exactMatches = bundles.filter((bundle) =>
    dateOrNull(bundle.benchmark_date) === benchmarkDate
    && textOrNull(bundle.rolling_window_hash) === rollingWindowHash
    && textOrNull(bundle.private_model_artifact_hash) === referenceArtifactHash,
  )
  return exactMatches.length === 1
    ? { correlation: 'exact_artifacts', bundle: exactMatches[0] }
    : { correlation: 'unlinked', bundle: null }
}

export function sanitizeResearchLabPublicBenchmarkTelemetry(input: {
  publicationStatus: string | null
  canonicalPublishedScore: number | null
  execution: ResearchLabScoringExecutionSummary | null
}): ResearchLabPublicBenchmarkTelemetry {
  const execution = input.execution
  return {
    publicationStatus: input.publicationStatus ?? 'unavailable',
    executionStatus: execution?.executionStatus ?? null,
    expectedUnits: execution?.expectedUnits ?? null,
    resolvedUnits: execution?.resolvedUnits ?? null,
    completedUnits: execution?.completedUnits ?? null,
    skippedUnits: execution?.skippedUnits ?? null,
    failedUnits: execution?.failedUnits ?? null,
    progressPercent: execution?.progressPercent ?? null,
    startedAt: execution?.startedAt ?? null,
    completedAt: execution?.completedAt ?? null,
    durationSeconds: execution?.durationSeconds ?? null,
    canonicalPublishedScore: input.canonicalPublishedScore,
  }
}

export function groupResearchLabScoringRuns(
  rows: ResearchLabScoringRunRow[],
): ResearchLabScoringRunRow[][] {
  const groups = new Map<string, ResearchLabScoringRunRow[]>()
  for (const row of rows) {
    const key = textOrNull(row.scoring_id) ?? textOrNull(row.scoring_run_id)
    if (!key) continue
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => {
    const latestA = [...a].sort(compareRunsNewestFirst)[0]
    const latestB = [...b].sort(compareRunsNewestFirst)[0]
    return timestampOrZero(latestB.current_status_at ?? latestB.created_at)
      - timestampOrZero(latestA.current_status_at ?? latestA.created_at)
  })
}

export function canonicalizeResearchLabTelemetryRows(
  rows: ResearchLabScoringTelemetryRow[],
): ResearchLabScoringTelemetryRow[] {
  const byUnit = new Map<string, ResearchLabScoringTelemetryRow>()
  for (const row of rows) {
    const role = textOrNull(row.model_role) ?? 'unknown'
    const ref = textOrNull(row.icp_ref) ?? textOrNull(row.icp_execution_id)
    if (!ref) continue
    const key = `${role}\u0000${ref}`
    const current = byUnit.get(key)
    if (!current || compareCanonicalTelemetry(row, current) < 0) byUnit.set(key, row)
  }
  return [...byUnit.values()]
}

function compareCanonicalTelemetry(
  a: ResearchLabScoringTelemetryRow,
  b: ResearchLabScoringTelemetryRow,
): number {
  const tierDiff = canonicalTier(a) - canonicalTier(b)
  if (tierDiff !== 0) return tierDiff
  const retryDiff = numberOr(b.retry_round, 0) - numberOr(a.retry_round, 0)
  if (retryDiff !== 0) return retryDiff
  return timestampOrZero(b.finished_at ?? b.current_status_at ?? b.started_at)
    - timestampOrZero(a.finished_at ?? a.current_status_at ?? a.started_at)
}

function canonicalTier(row: ResearchLabScoringTelemetryRow): number {
  const status = normalizedStatus(row.status)
  const checkpointBacked = Boolean(textOrNull(row.checkpoint_ref))
    || ['checkpoint_reuse', 'gate_skip', 'latch_skip'].includes(normalizedStatus(row.execution_kind))
  if (['completed', 'skipped'].includes(status) && checkpointBacked) return 1
  if (['held', 'queued', 'started', 'heartbeat', 'sourcing_completed', 'scoring_started'].includes(status)) return 2
  if (['failed', 'cancelled', 'skipped'].includes(status)) return 3
  if (status === 'completed') return 4
  return 5
}

function telemetryModeFor(rows: ResearchLabScoringTelemetryRow[]): ResearchLabScoringTelemetryMode {
  if (rows.some((row) => normalizedStatus(row.telemetry_mode) === 'v2')) return 'v2'
  if (rows.some((row) => normalizedStatus(row.telemetry_mode) === 'legacy')) return 'legacy'
  return 'missing'
}

function compareRunsNewestFirst(
  a: ResearchLabScoringRunRow,
  b: ResearchLabScoringRunRow,
): number {
  const attemptDiff = numberOr(b.run_attempt, 0) - numberOr(a.run_attempt, 0)
  if (attemptDiff !== 0) return attemptDiff
  return timestampOrZero(b.current_status_at ?? b.created_at)
    - timestampOrZero(a.current_status_at ?? a.created_at)
}

function compareTelemetryNewestFirst(
  a: ResearchLabScoringTelemetryRow,
  b: ResearchLabScoringTelemetryRow,
): number {
  return timestampOrZero(b.finished_at ?? b.last_heartbeat_at ?? b.started_at)
    - timestampOrZero(a.finished_at ?? a.last_heartbeat_at ?? a.started_at)
}

function countStatus(rows: ResearchLabScoringTelemetryRow[], status: string): number {
  return rows.filter((row) => normalizedStatus(row.status) === status).length
}

function uniqueStrings(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function sumNullable(values: Array<number | null>, decimals = 0): number | null {
  const present = values.filter((value): value is number => value !== null)
  return present.length > 0 ? roundTo(present.reduce((sum, value) => sum + value, 0), decimals) : null
}

function maxNullable(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null)
  return present.length > 0 ? Math.max(...present) : null
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function dateOrNull(value: unknown): string | null {
  const text = textOrNull(value)
  if (!text) return null
  const date = text.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}

function isoOrNull(value: unknown): string | null {
  const text = textOrNull(value)
  return text && Number.isFinite(new Date(text).getTime()) ? text : null
}

function normalizedStatus(value: unknown): string {
  return textOrNull(value)?.toLowerCase() ?? ''
}

function finiteNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function nonNegativeIntegerOrNull(value: unknown): number | null {
  const number = finiteNumberOrNull(value)
  return number !== null && Number.isInteger(number) && number >= 0 ? number : null
}

function numberOr(value: unknown, fallback: number): number {
  return finiteNumberOrNull(value) ?? fallback
}

function booleanOrNull(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true
    if (value.toLowerCase() === 'false') return false
  }
  return null
}

function booleanOrFalse(value: unknown): boolean {
  return booleanOrNull(value) ?? false
}

function timestampOrZero(value: unknown): number {
  const text = textOrNull(value)
  if (!text) return 0
  const timestamp = new Date(text).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}
