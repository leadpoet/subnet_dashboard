export type CompetitionParticipant = {
  submissionId: string
  minerHotkey: string
  finalScore: number | null
}

export type CompetitionRoundSummary = {
  roundId: string
  status: string
  mode: string
  networkName: string
  netuid: number
  publishedAt: string | null
  createdAt: string | null
  icpSetDate: string | null
  evaluationDate: string | null
  publicAt: string | null
  submissionOpen: string | null
  submissionCutoff: string | null
  cancelReason: string | null
  baseline: CompetitionParticipant | null
  champion: (CompetitionParticipant & { outcome: string | null }) | null
  promotionStatus: string | null
}

export type CompetitionSnapshot = {
  mode: string
  networkName: string
  netuid: number
  repoUrl: string
  openRound: CompetitionRoundSummary | null
  latestRound: CompetitionRoundSummary | null
  latestCompletedRound: CompetitionRoundSummary | null
  rounds: CompetitionRoundSummary[]
}

export type CompetitionSubmission = {
  submissionId: string
  minerHotkey: string
  isBaseline: boolean
  status: string
  failureReason?: 'credential_error' | null
  submittedAt: string | null
  stage1Score: number | null
  finalScore: number | null
  isChampion: boolean
  code: {
    available: boolean
    availableAt: string | null
    url: string | null
  }
}

export type CompetitionBenchmark = {
  roundId: string
  icpSetDate: string
  publicAt: string
  icps: CompetitionIcp[]
  publicIcpCount: number
  privateIcpCount: number
  disclosurePolicy: string
}

export type CompetitionIcp = {
  position: number
  id: string
  prompt: string
  baselineScore: number | null
  industry: string | null
  subIndustry: string | null
  geography: string | null
  country: string | null
  employeeCount: string[]
  companyStage: string | null
  productService: string | null
  requiredAttribute: string | null
  intentSignal: string | null
  intentCategory: string | null
}

export type CompetitionSubmissionResults = {
  roundId: string
  submissionId: string
  incomplete: boolean
  stage1Score: number | null
  finalScore: number | null
  publicIcpStatus: string
  publicScores: Map<number, number>
}

export type CompetitionCode = {
  submissionId: string
  files: Array<{ path: string; content: string; language: string | null }>
  truncated: boolean
}

type JsonRecord = Record<string, unknown>

export const DEFAULT_REPO_URL = 'https://github.com/leadpoet/pydantic-harness/tree/lab'

export function normalizeCompetitionSnapshot(value: unknown): CompetitionSnapshot | null {
  const source = record(value)
  if (!source) return null
  const rounds = records(source.rounds).map(normalizeRound).filter(isPresent)
  const byId = new Map(rounds.map((round) => [round.roundId, round]))
  const resolveRound = (candidate: unknown) => {
    const normalized = normalizeRound(record(candidate))
    return normalized ? byId.get(normalized.roundId) ?? normalized : null
  }
  const mode = text(source.mode)
  const networkName = text(source.network_name)
  const netuid = integer(source.netuid)
  if (!mode || !networkName || netuid === null) return null
  return {
    mode,
    networkName,
    netuid,
    repoUrl: safeHttpUrl(source.repo_url) ?? DEFAULT_REPO_URL,
    openRound: resolveRound(source.open_round),
    latestRound: resolveRound(source.latest_round),
    latestCompletedRound: resolveRound(source.latest_completed_round),
    rounds,
  }
}

export function normalizeCompetitionSubmissions(value: unknown): CompetitionSubmission[] {
  const source = record(value)
  return records(source?.submissions).map((row) => {
    const submissionId = text(row.submission_id)
    const minerHotkey = text(row.miner_hotkey)
    if (!submissionId || !minerHotkey) return null
    const code = record(row.code)
    return {
      submissionId,
      minerHotkey,
      isBaseline: row.is_baseline === true,
      status: text(row.status) || 'queued',
      failureReason: row.failure_reason === 'credential_error' ? 'credential_error' as const : null,
      submittedAt: nullableText(row.submitted_at),
      stage1Score: score(row.stage1_score),
      finalScore: score(row.final_score),
      isChampion: row.is_champion === true,
      code: {
        available: code?.available === true,
        availableAt: nullableText(code?.available_at),
        url: nullableText(code?.url),
      },
    }
  }).filter(isPresent)
}

export function normalizeCompetitionBenchmark(
  value: unknown,
  expectedRound?: Pick<CompetitionRoundSummary, 'roundId' | 'icpSetDate' | 'publicAt'>,
): CompetitionBenchmark | null {
  const source = record(value)
  const roundId = text(source?.round_id)
  const icpSetDate = calendarDate(source?.icp_set_date)
  const publicAt = utcTimestamp(source?.public_at)
  if (!source || !roundId || !icpSetDate || !publicAt || !Array.isArray(source.icps)) return null
  if (
    expectedRound
    && (roundId !== expectedRound.roundId
      || (expectedRound.icpSetDate !== null && icpSetDate !== expectedRound.icpSetDate)
      || (expectedRound.publicAt !== null && publicAt !== expectedRound.publicAt))
  ) return null
  const icps = source.icps.map((item) => {
    const row = record(item)
    const position = integer(row?.icp_position)
    if (!row || position === null || position >= 20) return null
    return {
      position,
      id: text(row.icp_id) || `ICP ${position + 1}`,
      prompt: text(row.prompt) || 'ICP details are not available.',
      baselineScore: score(row.baseline_score),
      industry: nullableText(row.industry),
      subIndustry: nullableText(row.sub_industry),
      geography: nullableText(row.geography),
      country: nullableText(row.country),
      employeeCount: stringArray(row.employee_count),
      companyStage: nullableText(row.company_stage),
      productService: nullableText(row.product_service),
      requiredAttribute: nullableText(row.required_attribute),
      intentSignal: nullableText(row.intent_signal),
      intentCategory: nullableText(row.intent_category),
    }
  }).filter(isPresent).sort((left, right) => left.position - right.position)
  const publicIcpCount = integer(source.public_icp_count)
  const privateIcpCount = integer(source.private_icp_count)
  const disclosurePolicy = text(source.disclosure_policy)
  if (
    publicIcpCount !== 20
    || privateIcpCount !== 0
    || disclosurePolicy !== 'all_20_next_day'
    || icps.length !== 20
    || new Set(icps.map((icp) => icp.position)).size !== 20
  ) return null
  return {
    roundId,
    icpSetDate,
    publicAt,
    icps,
    publicIcpCount,
    privateIcpCount,
    disclosurePolicy,
  }
}

export function normalizeCompetitionResults(value: unknown): CompetitionSubmissionResults | null {
  const source = record(value)
  const roundId = text(source?.round_id)
  const submissionId = text(source?.submission_id)
  if (!source || !roundId || !submissionId) return null
  const scores = record(source.scores)
  const submissionScores = record(source.submission_scores)
  const incomplete = source.incomplete === true || text(source.round_status) === 'cancelled'
  const publicIcpStatus = text(source.public_icp_status) || 'pending'
  const publicScores = incomplete ? new Map<number, number>() : mergeScores(perIcpScores(scores?.stage_1), perIcpScores(scores?.stage_2))
  if (!incomplete && publicIcpStatus === 'ready' && publicScores.size !== 20) return null
  return {
    roundId,
    submissionId,
    incomplete,
    stage1Score: incomplete ? null : score(submissionScores?.stage_1),
    finalScore: incomplete ? null : score(submissionScores?.final),
    publicIcpStatus,
    publicScores,
  }
}

export function normalizeCompetitionCode(value: unknown): CompetitionCode | null {
  const source = record(value)
  const submissionId = text(source?.submission_id)
  if (!source || !submissionId || !Array.isArray(source.files)) return null
  const files = source.files.map((item) => {
    const file = record(item)
    const path = text(file?.path)
    if (!file || !path || typeof file.content !== 'string') return null
    return { path, content: file.content, language: nullableText(file.language) }
  }).filter(isPresent)
  return { submissionId, files, truncated: source.truncated === true }
}

export function competitionRoundOptions(snapshot: CompetitionSnapshot): CompetitionRoundSummary[] {
  const priority = [snapshot.latestRound, snapshot.latestCompletedRound, snapshot.openRound].filter(isPresent)
  const seen = new Set<string>()
  return [...priority, ...snapshot.rounds].filter((round) => {
    if (seen.has(round.roundId)) return false
    seen.add(round.roundId)
    return true
  })
}

export function competitionSubmissionStatusLabel(
  submission: Pick<CompetitionSubmission, 'isBaseline' | 'isChampion' | 'status' | 'failureReason'>,
  round: Pick<CompetitionRoundSummary, 'promotionStatus' | 'status'>,
): string {
  if (submission.isChampion || submission.status === 'champion') {
    if (round.promotionStatus === 'pending') return 'Champion · promotion pending'
    if (round.promotionStatus === 'promoted') return 'Champion · promoted'
    return 'Champion'
  }
  if (submission.status === 'scored' && round.status === 'published' && !submission.isBaseline) {
    return 'Scored · not promoted'
  }
  if (submission.status === 'scoring_failed' && submission.failureReason === 'credential_error') {
    return 'Provider credential error'
  }
  return humanizeStatus(submission.status)
}

export function formatCompetitionScore(value: number | null): string {
  return value === null ? '—' : value.toFixed(2)
}

function normalizeRound(source: JsonRecord | null): CompetitionRoundSummary | null {
  const roundId = text(source?.round_id)
  const status = text(source?.status)
  if (!source || !roundId || !status) return null
  const baseline = normalizeParticipant(record(source.baseline))
  const championSource = record(source.champion)
  const champion = normalizeParticipant(championSource)
  const icpSetDate = optionalCalendarDate(source.icp_set_date)
  const evaluationDate = optionalCalendarDate(source.evaluation_date)
  const publicAt = optionalUtcTimestamp(source.public_at)
  const submissionOpen = optionalUtcTimestamp(source.submission_open)
  const submissionCutoff = optionalUtcTimestamp(source.submission_cutoff)
  if ([icpSetDate, evaluationDate, publicAt, submissionOpen, submissionCutoff].includes(undefined)) return null
  return {
    roundId,
    status,
    mode: text(source.mode),
    networkName: text(source.network_name),
    netuid: integer(source.netuid) ?? 0,
    publishedAt: nullableText(source.published_at),
    createdAt: nullableText(source.created_at),
    icpSetDate: icpSetDate ?? null,
    evaluationDate: evaluationDate ?? null,
    publicAt: publicAt ?? null,
    submissionOpen: submissionOpen ?? null,
    submissionCutoff: submissionCutoff ?? null,
    cancelReason: nullableText(source.cancel_reason),
    baseline,
    champion: champion ? { ...champion, outcome: nullableText(championSource?.outcome) } : null,
    promotionStatus: nullableText(source.promotion_status),
  }
}

function normalizeParticipant(source: JsonRecord | null): CompetitionParticipant | null {
  const submissionId = text(source?.submission_id)
  const minerHotkey = text(source?.miner_hotkey)
  if (!source || !submissionId || !minerHotkey) return null
  return { submissionId, minerHotkey, finalScore: score(source.final_score) }
}

function perIcpScores(value: unknown): Map<number, number> {
  const result = new Map<number, number>()
  for (const row of records(value)) {
    const position = integer(row.icp_position)
    const valueScore = score(row.per_icp_score)
    if (position !== null && position >= 0 && position < 20 && valueScore !== null) result.set(position, valueScore)
  }
  return result
}

function mergeScores(...sources: Map<number, number>[]): Map<number, number> {
  const result = new Map<number, number>()
  for (const source of sources) for (const [position, value] of source) result.set(position, value)
  return result
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record).filter(isPresent) : []
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nullableText(value: unknown): string | null {
  return text(value) || null
}

function calendarDate(value: unknown): string | null {
  const normalized = text(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null
  const date = new Date(`${normalized}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === normalized ? normalized : null
}

function utcTimestamp(value: unknown): string | null {
  const normalized = text(value)
  if (!normalized.endsWith('Z')) return null
  return Number.isFinite(new Date(normalized).getTime()) ? normalized : null
}

function optionalCalendarDate(value: unknown): string | null | undefined {
  return value === null || value === undefined ? null : calendarDate(value) ?? undefined
}

function optionalUtcTimestamp(value: unknown): string | null | undefined {
  return value === null || value === undefined ? null : utcTimestamp(value) ?? undefined
}

function humanizeStatus(value: string): string {
  const normalized = value.trim().replaceAll('_', ' ')
  return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : 'Unavailable'
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function score(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : []
}

function safeHttpUrl(value: unknown): string | null {
  try {
    const parsed = new URL(text(value))
    return parsed.protocol === 'https:'
      && parsed.hostname === 'github.com'
      && parsed.pathname.startsWith('/leadpoet/pydantic-harness')
      ? parsed.toString()
      : null
  } catch {
    return null
  }
}

function isPresent<T>(value: T | null): value is T {
  return value !== null
}
