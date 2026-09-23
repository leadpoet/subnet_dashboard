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
  benchmarkIcpCount: number
  promotionMargin: number
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
  codeReview: CompetitionCodeReview
  code: {
    available: boolean
    availableAt: string | null
    url: string | null
  }
}

export type CompetitionCodeReview = {
  status: string | null
  errorCode: string | null
  providerHttpStatus: number | null
  retryable: boolean | null
  attempts: number | null
}

export type CompetitionBenchmark = {
  roundId: string
  icpSetDate: string
  publicAt: string
  icps: CompetitionIcp[]
  publicIcpCount: number
  benchmarkIcpCount: number
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
  benchmarkIcpCount: number
  publicScores: Map<number, number>
  scoringAttribution: CompetitionScoringAttribution | null
  companyDiagnostics: CompetitionCompanyDiagnostic[] | null
}

export const COMPANY_CHECK_LABELS = {
  identity: 'Company identity', industry: 'Industry', employee_size: 'Company size',
  geography: 'Country', stage: 'Company stage', required_attribute: 'Required attribute',
  intent: 'Intent evidence', intent_details: 'Intent Details', contact: 'Contact', email: 'Email verification',
} as const

const COMPANY_ONLY_CHECK_NAMES = [
  'identity', 'industry', 'employee_size', 'geography', 'stage',
  'required_attribute', 'intent', 'intent_details',
] as const

const CONTACT_CHECK_NAMES = ['contact', 'email'] as const

export const COMPANY_CHECK_STATUS_LABELS = {
  passed: 'Passed', failed: 'Failed', unavailable: 'Could not verify',
  not_evaluated: 'Not evaluated', not_required: 'Not required',
} as const

type CompanyOnlyCheckName = typeof COMPANY_ONLY_CHECK_NAMES[number]
type ContactCheckName = typeof CONTACT_CHECK_NAMES[number]
type CompanyCheckStatus = keyof typeof COMPANY_CHECK_STATUS_LABELS

export type CompetitionCompanyDiagnostic = {
  icpPosition: number
  companyIndex: number
  companyName: string
  qualified: boolean
  duplicateCompany: boolean
  missingContact: boolean | null
  checks: Record<CompanyOnlyCheckName, CompanyCheckStatus> & Partial<Record<ContactCheckName, CompanyCheckStatus>>
  contactFailure: string | null
}

function normalizeCompanyDiagnostics(value: unknown, benchmarkIcpCount: number): CompetitionCompanyDiagnostic[] | null {
  if (!Array.isArray(value) || value.length > benchmarkIcpCount * 20) return null
  const seen = new Set<string>()
  const rows = value.map((item) => {
    const row = record(item)
    const icpPosition = integer(row?.icp_position)
    const companyIndex = integer(row?.company_index)
    const companyName = text(row?.company_name)
    const rawChecks = record(row?.checks)
    if (!row || icpPosition === null || icpPosition >= benchmarkIcpCount || companyIndex === null || companyIndex < 0
      || !companyName || companyName.length > 200 || !rawChecks
      || typeof row.qualified !== 'boolean' || typeof row.duplicate_company !== 'boolean') return null
    const key = `${icpPosition}:${companyIndex}`
    if (seen.has(key)) return null
    seen.add(key)
    const checks = {} as CompetitionCompanyDiagnostic['checks']
    for (const name of COMPANY_ONLY_CHECK_NAMES) {
      const status = text(rawChecks[name])
      if (!Object.hasOwn(COMPANY_CHECK_STATUS_LABELS, status)) return null
      checks[name] = status as keyof typeof COMPANY_CHECK_STATUS_LABELS
    }
    const hasContactDiagnostics = Object.hasOwn(row, 'missing_contact')
      || Object.hasOwn(row, 'contact_failure')
      || CONTACT_CHECK_NAMES.some((name) => Object.hasOwn(rawChecks, name))
    let missingContact: boolean | null = null
    if (hasContactDiagnostics) {
      if (typeof row.missing_contact !== 'boolean') return null
      missingContact = row.missing_contact
      for (const name of CONTACT_CHECK_NAMES) {
        const status = text(rawChecks[name])
        if (!Object.hasOwn(COMPANY_CHECK_STATUS_LABELS, status)) return null
        checks[name] = status as keyof typeof COMPANY_CHECK_STATUS_LABELS
      }
    }
    const failureLabels: Record<string, string> = {
      claim: 'Contact fields', identity: 'Contact identity', source: 'Contact source', company: 'Current employer',
      role: 'Role', location: 'Contact location', email_attribution: 'Email ownership', email_verification: 'Email verification',
    }
    return { icpPosition, companyIndex, companyName, qualified: row.qualified, duplicateCompany: row.duplicate_company,
      missingContact, checks, contactFailure: hasContactDiagnostics ? failureLabels[text(row.contact_failure)] ?? null : null }
  })
  return rows.every(isPresent) ? rows : null
}

export type CompetitionScoringValidator = {
  hotkey: string
  icpCount: number
  reusedIcpCount: number
}

export type CompetitionIcpScoringAttribution = {
  icpPosition: number
  validatorHotkeys: string[]
  reusedJudgment: boolean
}

export type CompetitionScoringAttribution = {
  validators: CompetitionScoringValidator[]
  icps: CompetitionIcpScoringAttribution[]
  unattributedIcpCount: number
}

export type CompetitionCode = {
  submissionId: string
  files: Array<{ path: string; content: string; language: string | null }>
  truncated: boolean
}

type JsonRecord = Record<string, unknown>

export const DEFAULT_REPO_URL = 'https://github.com/leadpoet/leadpoet-sales-agent/tree/lab'

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
    const status = text(row.status) || 'queued'
    const reviewExcluded = isReviewExcludedStatus(status)
    const code = record(row.code)
    const codeReview = record(row.code_review)
    return {
      submissionId,
      minerHotkey,
      isBaseline: row.is_baseline === true,
      status,
      failureReason: row.failure_reason === 'credential_error' ? 'credential_error' as const : null,
      submittedAt: nullableText(row.submitted_at),
      stage1Score: reviewExcluded ? null : score(row.stage1_score),
      finalScore: reviewExcluded ? null : score(row.final_score),
      isChampion: reviewExcluded ? false : row.is_champion === true,
      codeReview: {
        status: nullableText(codeReview?.status),
        errorCode: nullableText(codeReview?.error_code),
        providerHttpStatus: httpStatus(codeReview?.provider_http_status),
        retryable: typeof codeReview?.retryable === 'boolean' ? codeReview.retryable : null,
        attempts: integer(codeReview?.attempts),
      },
      code: {
        available: reviewExcluded ? false : code?.available === true,
        availableAt: reviewExcluded ? null : nullableText(code?.available_at),
        url: reviewExcluded ? null : nullableText(code?.url),
      },
    }
  }).filter(isPresent)
}

export function normalizeCompetitionBenchmark(
  value: unknown,
  expectedRound?: Pick<CompetitionRoundSummary, 'roundId' | 'icpSetDate' | 'publicAt' | 'benchmarkIcpCount'>,
): CompetitionBenchmark | null {
  const source = record(value)
  const roundId = text(source?.round_id)
  const icpSetDate = calendarDate(source?.icp_set_date)
  const publicAt = utcTimestamp(source?.public_at)
  const benchmarkIcpCount = source ? benchmarkCount(source) : null
  if (!source || !roundId || !icpSetDate || !publicAt || benchmarkIcpCount === null || !Array.isArray(source.icps)) return null
  if (
    expectedRound
    && (roundId !== expectedRound.roundId
      || (expectedRound.icpSetDate !== null && icpSetDate !== expectedRound.icpSetDate)
      || (expectedRound.publicAt !== null && publicAt !== expectedRound.publicAt)
      || benchmarkIcpCount !== expectedRound.benchmarkIcpCount)
  ) return null
  const icps = source.icps.map((item) => {
    const row = record(item)
    const position = integer(row?.icp_position)
    if (!row || position === null || position >= benchmarkIcpCount) return null
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
    publicIcpCount !== benchmarkIcpCount
    || privateIcpCount !== 0
    || !['all_20_next_day', 'after_scoring_day2_v1', 'cutoff_public_v1'].includes(disclosurePolicy)
    || icps.length !== benchmarkIcpCount
    || new Set(icps.map((icp) => icp.position)).size !== benchmarkIcpCount
  ) return null
  return {
    roundId,
    icpSetDate,
    publicAt,
    icps,
    publicIcpCount,
    benchmarkIcpCount,
    privateIcpCount,
    disclosurePolicy,
  }
}

export function normalizeCompetitionResults(
  value: unknown,
  expectedRound?: Pick<CompetitionRoundSummary, 'roundId' | 'benchmarkIcpCount'>,
): CompetitionSubmissionResults | null {
  const source = record(value)
  const roundId = text(source?.round_id)
  const submissionId = text(source?.submission_id)
  const benchmarkIcpCount = source ? benchmarkCount(source) : null
  if (!source || !roundId || !submissionId || benchmarkIcpCount === null
    || (expectedRound && (roundId !== expectedRound.roundId || benchmarkIcpCount !== expectedRound.benchmarkIcpCount))) return null
  const scores = record(source.scores)
  const submissionScores = record(source.submission_scores)
  const incomplete = source.incomplete === true || text(source.round_status) === 'cancelled'
  const publicIcpStatus = text(source.public_icp_status) || 'pending'
  const publicScores = incomplete ? new Map<number, number>() : mergeScores(perIcpScores(scores?.stage_1, benchmarkIcpCount), perIcpScores(scores?.stage_2, benchmarkIcpCount))
  const scoringAttribution = normalizeScoringAttribution(source.scoring_attribution, benchmarkIcpCount)
  if (!incomplete && publicIcpStatus === 'ready' && publicScores.size !== benchmarkIcpCount) return null
  return {
    roundId,
    submissionId,
    incomplete,
    stage1Score: incomplete ? null : score(submissionScores?.stage_1),
    finalScore: incomplete ? null : score(submissionScores?.final),
    publicIcpStatus,
    benchmarkIcpCount,
    publicScores,
    scoringAttribution,
    companyDiagnostics: !incomplete && publicIcpStatus === 'ready' ? normalizeCompanyDiagnostics(source.company_diagnostics, benchmarkIcpCount) : null,
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

export function latestPublishedBaselineRound(
  snapshot: CompetitionSnapshot,
  selectedRound: CompetitionRoundSummary | null,
): CompetitionRoundSummary | null {
  const publishedRound = snapshot.latestCompletedRound
  if (
    !selectedRound
    || !publishedRound
    || publishedRound.roundId === selectedRound.roundId
    || publishedRound.status !== 'published'
    || !publishedRound.baseline
    || publishedRound.baseline.finalScore === null
  ) return null
  return publishedRound
}

export function competitionSubmissionStatusLabel(
  submission: Pick<CompetitionSubmission, 'isBaseline' | 'isChampion' | 'status' | 'failureReason' | 'codeReview'>,
  round: Pick<CompetitionRoundSummary, 'promotionStatus' | 'status'>,
): string {
  if (submission.status === 'review_failed') return 'Code review could not complete'
  if (submission.status === 'review_rejected') return 'Code review rejected'
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
  if (submission.status === 'queued' || submission.status === 'accepted') {
    const reviewIssue = codeReviewIssueLabel(submission.codeReview)
    if (reviewIssue) return reviewIssue
  }
  return humanizeStatus(submission.status)
}

export function isCompetitionReviewExcluded(
  submission: Pick<CompetitionSubmission, 'status'>,
): boolean {
  return isReviewExcludedStatus(submission.status)
}

export function competitionSubmissionEvaluationNotice(
  submission: Pick<CompetitionSubmission, 'isBaseline' | 'isChampion' | 'status' | 'failureReason' | 'codeReview'>,
  round: Pick<CompetitionRoundSummary, 'promotionStatus' | 'status'>,
): string | null {
  if (isCompetitionReviewExcluded(submission)) {
    return `${competitionSubmissionStatusLabel(submission, round)}. This submission was not evaluated.`
  }
  if (submission.status === 'queued' || submission.status === 'accepted') {
    const reviewIssue = codeReviewIssueLabel(submission.codeReview)
    return reviewIssue ? `${reviewIssue}. This submission has not been evaluated yet.` : null
  }
  return null
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
  const benchmarkIcpCount = benchmarkCount(source)
  const promotionMargin = source.promotion_margin === undefined ? 1 : score(source.promotion_margin)
  if (benchmarkIcpCount === null || promotionMargin === null) return null
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
    benchmarkIcpCount,
    promotionMargin,
  }
}

function normalizeParticipant(source: JsonRecord | null): CompetitionParticipant | null {
  const submissionId = text(source?.submission_id)
  const minerHotkey = text(source?.miner_hotkey)
  if (!source || !submissionId || !minerHotkey) return null
  return { submissionId, minerHotkey, finalScore: score(source.final_score) }
}

function perIcpScores(value: unknown, benchmarkIcpCount: number): Map<number, number> {
  const result = new Map<number, number>()
  for (const row of records(value)) {
    const position = integer(row.icp_position)
    const valueScore = score(row.per_icp_score)
    if (position !== null && position < benchmarkIcpCount && valueScore !== null) result.set(position, valueScore)
  }
  return result
}

function mergeScores(...sources: Map<number, number>[]): Map<number, number> {
  const result = new Map<number, number>()
  for (const source of sources) for (const [position, value] of source) result.set(position, value)
  return result
}

function normalizeScoringAttribution(value: unknown, benchmarkIcpCount: number): CompetitionScoringAttribution | null {
  const source = record(value)
  if (!source || !Array.isArray(source.validators) || !Array.isArray(source.icps)) return null
  const unattributedIcpCount = boundedIcpCount(source.unattributed_icp_count, benchmarkIcpCount)
  if (unattributedIcpCount === null) return null

  const validators = source.validators.map((value) => {
    const row = record(value)
    const hotkey = text(row?.hotkey)
    const icpCount = boundedIcpCount(row?.icp_count, benchmarkIcpCount)
    const reusedIcpCount = boundedIcpCount(row?.reused_icp_count, benchmarkIcpCount)
    if (!row || !hotkey || icpCount === null || reusedIcpCount === null || reusedIcpCount > icpCount) return null
    return { hotkey, icpCount, reusedIcpCount }
  })
  const icps = source.icps.map((value) => {
    const row = record(value)
    const icpPosition = integer(row?.icp_position)
    if (!row || icpPosition === null || icpPosition >= benchmarkIcpCount || !Array.isArray(row.validator_hotkeys) || typeof row.reused_judgment !== 'boolean') return null
    const validatorHotkeys = row.validator_hotkeys.map(text)
    if (validatorHotkeys.some((hotkey) => !hotkey) || new Set(validatorHotkeys).size !== validatorHotkeys.length) return null
    return { icpPosition, validatorHotkeys, reusedJudgment: row.reused_judgment }
  })
  if (
    validators.some((row) => row === null)
    || icps.some((row) => row === null)
    || new Set(validators.map((row) => row?.hotkey)).size !== validators.length
    || new Set(icps.map((row) => row?.icpPosition)).size !== icps.length
  ) return null
  return {
    validators: validators.filter(isPresent),
    icps: icps.filter(isPresent),
    unattributedIcpCount,
  }
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

function isReviewExcludedStatus(value: string): boolean {
  return value === 'review_failed' || value === 'review_rejected'
}

function codeReviewIssueLabel(review: CompetitionCodeReview): string | null {
  if (review.status === 'reviewing') return 'Code review in progress'
  if (review.status !== 'error') return null
  if (
    review.errorCode === 'code_review_provider_authentication'
    || review.providerHttpStatus === 401
    || review.providerHttpStatus === 403
  ) return 'Provider credential error'
  if (review.errorCode === 'code_review_provider_credit' || review.providerHttpStatus === 402) {
    return 'Insufficient provider credit'
  }
  if (review.retryable === true) return 'Code review unavailable · retrying'
  if (review.status === 'error' || review.errorCode) return 'Code review unavailable'
  return null
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function benchmarkCount(source: JsonRecord): number | null {
  if (!Object.hasOwn(source, 'benchmark_icp_count')) return 20
  const count = integer(source.benchmark_icp_count)
  return count !== null && count > 0 && count <= 100 ? count : null
}

function boundedIcpCount(value: unknown, benchmarkIcpCount: number): number | null {
  const normalized = integer(value)
  return normalized !== null && normalized <= benchmarkIcpCount ? normalized : null
}

function httpStatus(value: unknown): number | null {
  const normalized = integer(value)
  return normalized !== null && normalized >= 100 && normalized <= 599 ? normalized : null
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
      && (parsed.pathname === '/leadpoet/leadpoet-sales-agent'
        || parsed.pathname.startsWith('/leadpoet/leadpoet-sales-agent/'))
      ? parsed.toString()
      : null
  } catch {
    return null
  }
}

function isPresent<T>(value: T | null): value is T {
  return value !== null
}
