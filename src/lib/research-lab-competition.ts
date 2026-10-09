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
  evaluation?: CompetitionEvaluation | null
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

const EVALUATION_FAILURE_REASONS = ['provider_credentials', 'execution_window', 'review', 'provider', 'execution', 'unknown'] as const
type EvaluationFailureReason = typeof EVALUATION_FAILURE_REASONS[number]

export type CompetitionEvaluation = {
  state: 'queued' | 'evaluating' | 'retrying' | 'completed' | 'failed' | 'finalizing' | 'unavailable'
  validators: Array<{ hotkey: string; phase: 'executing' | 'scoring'; commit?: string | null; workingTree?: 'clean' | 'dirty' | 'unknown' }>
  counts?: { queued: number; active: number; completed: number; failed: number; retrying: number }
  failureReasons?: EvaluationFailureReason[]
  codeVersions?: Array<{ validatorHotkey: string; phase: 'executing' | 'scoring'; commit: string | null; workingTree: 'clean' | 'dirty' | 'unknown' }>
}

export function normalizeValidatorNames(value: unknown): Record<string, string> {
  const source = record(value)
  const registered = record(source?.hotkeyToUid)
  return Object.fromEntries(Object.entries(record(source?.names) ?? {}).flatMap(([hotkey, name]) => {
    const label = text(name).trim().slice(0, 80)
    return label && integer(registered?.[hotkey]) !== null ? [[hotkey, label]] : []
  }))
}

function normalizeEvaluation(value: unknown): CompetitionEvaluation | null {
  const source = record(value)
  const state = source?.state
  if (!source || !['queued', 'evaluating', 'retrying', 'completed', 'failed', 'finalizing', 'unavailable'].includes(text(state)) || !Array.isArray(source.validators)) return null
  const validators: CompetitionEvaluation['validators'] = []
  for (const value of source.validators) {
    const row = record(value)
    const hotkey = text(row?.hotkey)
    const phase = text(row?.phase)
    if (!row || !hotkey || (phase !== 'executing' && phase !== 'scoring')) return null
    const version = Object.hasOwn(row, 'commit') || Object.hasOwn(row, 'working_tree')
      ? { commit: validatorCommit(row?.commit), workingTree: validatorWorkingTree(row?.working_tree) } : {}
    if (validators.some((item) => item.hotkey === hotkey && item.phase === phase
      && (item.commit ?? null) === (version.commit ?? null)
      && (item.workingTree ?? 'unknown') === (version.workingTree ?? 'unknown'))) return null
    validators.push({ hotkey, phase, ...version })
  }
  if ((state === 'evaluating') !== (validators.length > 0)) return null
  const evaluation: CompetitionEvaluation = { state: state as CompetitionEvaluation['state'], validators }
  if (Array.isArray(source.failure_reasons) && source.failure_reasons.length <= EVALUATION_FAILURE_REASONS.length
    && source.failure_reasons.every((reason) => EVALUATION_FAILURE_REASONS.includes(reason as EvaluationFailureReason))) {
    evaluation.failureReasons = [...new Set(source.failure_reasons)] as EvaluationFailureReason[]
  }
  const counts = record(source.counts)
  if (counts && ['queued', 'active', 'completed', 'failed', 'retrying'].every((key) => Number.isSafeInteger(counts[key]) && integer(counts[key]) !== null)) {
    evaluation.counts = { queued: Number(counts.queued), active: Number(counts.active), completed: Number(counts.completed), failed: Number(counts.failed), retrying: Number(counts.retrying) }
  }
  if (Array.isArray(source.code_versions)) {
    evaluation.codeVersions = source.code_versions.flatMap((value) => {
      const row = record(value)
      const validatorHotkey = text(row?.validator_hotkey)
      const phase = row?.phase
      if (!validatorHotkey || (phase !== 'executing' && phase !== 'scoring')) return []
      return [{ validatorHotkey, phase, commit: validatorCommit(row?.commit), workingTree: validatorWorkingTree(row?.working_tree) }]
    })
  }
  return evaluation
}

function validatorCommit(value: unknown): string | null { const commit = text(value); return /^[a-f0-9]{40}$/.test(commit) ? commit : null }
function validatorWorkingTree(value: unknown): 'clean' | 'dirty' | 'unknown' { return value === 'clean' || value === 'dirty' ? value : 'unknown' }

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
  codeVersions?: Array<{ validatorHotkey: string; commit: string; workingTree: 'clean' | 'dirty' | 'unknown'; icpPositions: number[] }>
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
      evaluation: !reviewExcluded ? normalizeEvaluation(row.evaluation) : null,
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

export type CompetitionHistoryPage = {
  entries: Array<{ round: CompetitionRoundSummary; submission: CompetitionSubmission }>
  nextCursor: string | null
}

export function normalizeCompetitionHistory(value: unknown): CompetitionHistoryPage | null {
  const source = record(value)
  if (!source || !Array.isArray(source.rounds) || !Array.isArray(source.submissions)) return null
  const rounds = new Map(records(source.rounds).map((row) => normalizeRound(row)).filter(isPresent).map((round) => [round.roundId, round]))
  const entries: CompetitionHistoryPage['entries'] = []
  for (const row of records(source.submissions)) {
    const round = rounds.get(text(row.round_id))
    const submission = normalizeCompetitionSubmissions({ submissions: [row] })[0]
    if (!round || round.status !== 'published' || !submission) return null
    entries.push({ round, submission })
  }
  const nextCursor = source.next_cursor === null ? null : text(source.next_cursor)
  if (nextCursor !== null && !/^[A-Za-z0-9_-]{1,1024}$/.test(nextCursor)) return null
  return { entries, nextCursor }
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
  const versions = records(record(source.scoring_attribution)?.code_versions)
  if (scoringAttribution && versions.length) {
    scoringAttribution.codeVersions = versions.flatMap((row) => {
      const validatorHotkey = text(row.validator_hotkey)
      const commit = text(row.commit)
      const positions = Array.isArray(row.icp_positions) ? row.icp_positions : []
      if (!scoringAttribution.validators.some((validator) => validator.hotkey === validatorHotkey)
        || !/^[a-f0-9]{40}$/.test(commit) || !positions.length
        || positions.some((position) => integer(position) === null || Number(position) >= benchmarkIcpCount)) return []
      const workingTree = row.working_tree === 'clean' || row.working_tree === 'dirty' ? row.working_tree : 'unknown'
      return [{ validatorHotkey, commit, workingTree, icpPositions: [...new Set(positions as number[])] }]
    })
  }

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

export type CompetitionScoreHistoryPoint = {
  evaluationDate: string
  timestamp: number
  score: number | null
  roundId: string | null
  promotionStatus: string | null
}

// Use the normalized history as the canonical record. References can include a
// newer round outside the history window, but must not replace its record.
function publishedCompetitionRounds(snapshot: CompetitionSnapshot): CompetitionRoundSummary[] {
  const byId = new Map(snapshot.rounds.map((round) => [round.roundId, round]))
  for (const round of [snapshot.latestRound, snapshot.latestCompletedRound, snapshot.openRound]) {
    if (round && !byId.has(round.roundId)) byId.set(round.roundId, round)
  }
  const publicationTime = (round: CompetitionRoundSummary) => {
    const timestamp = Date.parse(round.publishedAt ?? '')
    return Number.isFinite(timestamp) ? timestamp : -Infinity
  }
  return [...byId.values()]
    .filter((round) => round.status === 'published' && calendarDate(round.evaluationDate))
    .sort((a, b) => (a.evaluationDate ?? '').localeCompare(b.evaluationDate ?? '')
      || publicationTime(a) - publicationTime(b) || a.roundId.localeCompare(b.roundId))
}

/** The reigning champion keeps its winning score while a new round runs. */
export function currentChampionRound(snapshot: CompetitionSnapshot): CompetitionRoundSummary | null {
  return publishedCompetitionRounds(snapshot)
    .filter((round) => round.champion && round.promotionStatus === 'promoted')
    .at(-1) ?? null
}

/** Historical round winners, including winners whose promotion was superseded.
 * A round without a winner is a gap; never substitute the baseline's score. */
export function competitionChampionHistory(snapshot: CompetitionSnapshot): CompetitionScoreHistoryPoint[] {
  const published = publishedCompetitionRounds(snapshot)
  if (!published.length) return []
  const dayMs = 86_400_000
  const end = Date.parse(`${published[published.length - 1].evaluationDate}T00:00:00Z`)
  const start = Math.max(Date.parse(`${published[0].evaluationDate}T00:00:00Z`), end - 13 * dayMs)
  // Multiple releases for one evaluation day use the latest published record.
  const byDate = new Map(published.map((round) => [round.evaluationDate, round]))
  const points: CompetitionScoreHistoryPoint[] = []
  for (let timestamp = start; timestamp <= end; timestamp += dayMs) {
    const evaluationDate = new Date(timestamp).toISOString().slice(0, 10)
    const round = byDate.get(evaluationDate)
    points.push({ evaluationDate, timestamp, score: score(round?.champion?.finalScore), roundId: round?.roundId ?? null, promotionStatus: round?.promotionStatus ?? null })
  }
  return points
}

function evaluationFailureLabel(submission: Pick<CompetitionSubmission, 'failureReason' | 'evaluation'>): string {
  const reasons = submission.evaluation?.failureReasons
  if (reasons && reasons.length > 1) return 'Evaluation incomplete · multiple causes'
  switch (reasons?.[0]) {
    case 'execution_window': return 'Evaluation incomplete · execution window ended'
    case 'review': return 'Evaluation incomplete · review did not finish'
    case 'provider_credentials': return 'Provider access failed'
    case 'provider': return 'Provider request failed'
    case 'execution': return 'Model execution failed'
    case 'unknown': return 'Evaluation failed'
  }
  return submission.failureReason === 'credential_error' ? 'Provider access failed' : 'Evaluation failed'
}

export function competitionSubmissionStatusLabel(
  submission: Pick<CompetitionSubmission, 'isBaseline' | 'isChampion' | 'status' | 'failureReason' | 'codeReview' | 'evaluation'>,
  round: Pick<CompetitionRoundSummary, 'promotionStatus' | 'status'>,
): string {
  if (submission.status === 'review_failed') return 'Code review could not complete'
  if (submission.status === 'review_rejected') return 'Code review rejected'
  if (submission.isChampion || submission.status === 'champion') {
    if (round.promotionStatus === 'pending') return 'Champion · promotion pending'
    if (round.promotionStatus === 'promoted') return 'Champion · promoted'
    if (round.promotionStatus === 'superseded') return 'Champion · promotion superseded'
    return 'Champion'
  }
  if (submission.status === 'scored' && round.status === 'published' && !submission.isBaseline) {
    return 'Scored · not promoted'
  }
  if (submission.status === 'scored' && round.status !== 'published') {
    return 'Scored · round in progress'
  }
  if (submission.status === 'scoring_failed') return evaluationFailureLabel(submission)
  if (submission.status === 'queued' || submission.status === 'accepted') {
    const reviewIssue = codeReviewIssueLabel(submission.codeReview)
    if (reviewIssue) return reviewIssue
    return 'Queued for validation'
  }
  if (submission.status === 'scoring') {
    if (submission.evaluation?.state === 'queued') return 'Queued for validation'
    if (submission.evaluation?.state === 'evaluating') return 'Evaluating'
    if (submission.evaluation?.state === 'finalizing') return 'Finalizing results'
    if (submission.evaluation?.state === 'retrying') return 'Evaluation retrying'
    if (submission.evaluation?.state === 'failed') return evaluationFailureLabel(submission)
    if (submission.evaluation?.state === 'completed') return 'Evaluation complete · finalizing'
    if (submission.evaluation?.state === 'unavailable') return 'Evaluation status unavailable'
    return 'In evaluation'
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
