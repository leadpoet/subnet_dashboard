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
  disclosurePolicy: CompetitionDisclosurePolicy | null
  benchmarkState: CompetitionBenchmarkState | null
  benchmarkCommitmentHash: string | null
  benchmarkCommittedAt: string | null
}

export type CompetitionDisclosurePolicy = 'all_20_next_day' | 'commit_reveal_day2_v1'
export type CompetitionBenchmarkState = 'pending_commitment' | 'committed' | 'reveal_delayed' | 'reveal_available'

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
  disclosurePolicy: CompetitionDisclosurePolicy
  commitment: CompetitionBenchmarkCommitment | null
  verification: CompetitionBenchmarkVerification | null
  download: JsonRecord
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
  raw: JsonRecord
}

export type CompetitionBenchmarkManifestEntry = {
  icpPosition: number
  icpHash: string
}

export type CompetitionBenchmarkManifest = {
  schemaVersion: 'leadpoet.lab_arena.benchmark_commitment.v1'
  networkName: string
  netuid: number
  roundId: string
  icpSetDate: string
  evaluationDate: string
  publicAt: string
  disclosurePolicy: 'commit_reveal_day2_v1'
  icpCount: 20
  entries: CompetitionBenchmarkManifestEntry[]
}

export type CompetitionBenchmarkCommitment = {
  roundId: string
  manifest: CompetitionBenchmarkManifest
  manifestHash: string
  canonicalManifest: string
  committedAt: string
  download: JsonRecord
}

export type CompetitionBenchmarkVerification = {
  manifestHash: string
  canonicalPreimages: string[]
}

export type CompetitionBenchmarkVerificationResult =
  | { ok: true; message: 'Matches published commitment' }
  | { ok: false; message: string }

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

export type JsonRecord = Record<string, unknown>

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
  expectedRound?: Pick<CompetitionRoundSummary, 'roundId' | 'networkName' | 'netuid' | 'icpSetDate' | 'evaluationDate' | 'publicAt' | 'disclosurePolicy' | 'benchmarkCommitmentHash' | 'benchmarkCommittedAt'>,
): CompetitionBenchmark | null {
  const source = record(value)
  const roundId = text(source?.round_id)
  const icpSetDate = calendarDate(source?.icp_set_date)
  const publicAt = utcTimestamp(source?.public_at)
  if (!source || !roundId || !icpSetDate || !publicAt || !Array.isArray(source.icps) || jsonByteLength(source) > 8 * 1024 * 1024) return null
  if (
    expectedRound
    && (roundId !== expectedRound.roundId
      || (expectedRound.icpSetDate !== null && icpSetDate !== expectedRound.icpSetDate)
      || (expectedRound.publicAt !== null && publicAt !== expectedRound.publicAt)
      || (expectedRound.disclosurePolicy !== null && text(source.disclosure_policy) !== expectedRound.disclosurePolicy))
  ) return null
  const icps = source.icps.map((item) => {
    const row = record(item)
    const position = integer(row?.icp_position)
    if (!row || position === null || position >= 20) return null
    const raw = withoutKeys(row, ['icp_position', 'baseline_score'])
    if (!isSupportedJson(raw)) return null
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
      raw,
    }
  }).filter(isPresent).sort((left, right) => left.position - right.position)
  const publicIcpCount = integer(source.public_icp_count)
  const privateIcpCount = integer(source.private_icp_count)
  const disclosurePolicy = text(source.disclosure_policy)
  if (
    publicIcpCount !== 20
    || privateIcpCount !== 0
    || !isDisclosurePolicy(disclosurePolicy)
    || icps.length !== 20
    || new Set(icps.map((icp) => icp.position)).size !== 20
  ) return null
  const commitment = disclosurePolicy === 'commit_reveal_day2_v1'
    ? normalizeCompetitionCommitment(source.commitment, expectedRound)
    : null
  const verification = disclosurePolicy === 'commit_reveal_day2_v1'
    ? normalizeBenchmarkVerification(source.verification, commitment)
    : null
  if (disclosurePolicy === 'commit_reveal_day2_v1' && (!commitment || !verification)) return null
  return {
    roundId,
    icpSetDate,
    publicAt,
    icps,
    publicIcpCount,
    privateIcpCount,
    disclosurePolicy,
    commitment,
    verification,
    download: cloneJsonRecord(source),
  }
}

export function normalizeCompetitionCommitment(
  value: unknown,
  expectedRound?: Pick<CompetitionRoundSummary, 'roundId' | 'networkName' | 'netuid' | 'icpSetDate' | 'evaluationDate' | 'publicAt' | 'benchmarkCommitmentHash' | 'benchmarkCommittedAt'>,
): CompetitionBenchmarkCommitment | null {
  const source = record(value)
  if (!source || !hasExactKeys(source, ['round_id', 'manifest', 'manifest_hash', 'canonical_manifest', 'committed_at'])) return null
  const roundId = text(source.round_id)
  const manifestHash = sha256Hash(source.manifest_hash)
  const canonicalManifest = typeof source.canonical_manifest === 'string' ? source.canonical_manifest : ''
  const committedAt = utcTimestamp(source.committed_at)
  const manifest = normalizeBenchmarkManifest(source.manifest)
  if (!roundId || !manifestHash || !canonicalManifest || !committedAt || !manifest || roundId !== manifest.roundId) return null
  let canonicalParsed: unknown
  try { canonicalParsed = JSON.parse(canonicalManifest) } catch { return null }
  if (!jsonEqual(canonicalParsed, source.manifest)) return null
  if (expectedRound && (
    roundId !== expectedRound.roundId
    || manifest.networkName !== expectedRound.networkName
    || manifest.netuid !== expectedRound.netuid
    || (expectedRound.icpSetDate !== null && manifest.icpSetDate !== expectedRound.icpSetDate)
    || (expectedRound.evaluationDate !== null && manifest.evaluationDate !== expectedRound.evaluationDate)
    || (expectedRound.publicAt !== null && manifest.publicAt !== expectedRound.publicAt)
    || (expectedRound.benchmarkCommitmentHash !== null && manifestHash !== expectedRound.benchmarkCommitmentHash)
    || (expectedRound.benchmarkCommittedAt !== null && committedAt !== expectedRound.benchmarkCommittedAt)
  )) return null
  return { roundId, manifest, manifestHash, canonicalManifest, committedAt, download: cloneJsonRecord(source) }
}

export async function verifyCompetitionBenchmark(
  benchmark: CompetitionBenchmark,
): Promise<CompetitionBenchmarkVerificationResult> {
  const commitment = benchmark.commitment
  const verification = benchmark.verification
  if (benchmark.disclosurePolicy !== 'commit_reveal_day2_v1' || !commitment || !verification) {
    return { ok: false, message: 'This round does not include commitment verification data.' }
  }
  if (!globalThis.crypto?.subtle) return { ok: false, message: 'Cryptographic verification is unavailable in this browser.' }
  const manifestHash = await hashCanonicalString(commitment.canonicalManifest)
  if (manifestHash !== commitment.manifestHash || verification.manifestHash !== commitment.manifestHash) {
    return { ok: false, message: 'Manifest hash verification failed.' }
  }
  const positions = new Set<number>()
  const nonces = new Set<string>()
  const icpIds = new Set<string>()
  for (const [expectedPosition, canonicalPreimage] of verification.canonicalPreimages.entries()) {
    if (utf8ByteLength(canonicalPreimage) > 256 * 1024) return { ok: false, message: `ICP ${expectedPosition + 1} preimage exceeds the verification limit.` }
    let parsed: unknown
    try { parsed = JSON.parse(canonicalPreimage) } catch { return { ok: false, message: 'A benchmark preimage is not valid JSON.' } }
    const preimage = normalizeBenchmarkPreimage(parsed)
    if (!preimage) return { ok: false, message: 'A benchmark preimage does not match the public schema.' }
    if (
      preimage.networkName !== commitment.manifest.networkName
      || preimage.netuid !== commitment.manifest.netuid
      || preimage.roundId !== commitment.manifest.roundId
      || preimage.icpSetDate !== commitment.manifest.icpSetDate
      || preimage.evaluationDate !== commitment.manifest.evaluationDate
      || preimage.icpPosition !== expectedPosition
      || positions.has(preimage.icpPosition)
    ) return { ok: false, message: 'A benchmark preimage has the wrong round scope or position.' }
    if (nonces.has(preimage.nonce)) return { ok: false, message: 'The revealed benchmark reuses a commitment nonce.' }
    const entry = commitment.manifest.entries[preimage.icpPosition]
    if (!entry || entry.icpPosition !== preimage.icpPosition || await hashCanonicalString(canonicalPreimage) !== entry.icpHash) {
      return { ok: false, message: `ICP ${preimage.icpPosition + 1} hash verification failed.` }
    }
    const displayed = benchmark.icps.find((icp) => icp.position === preimage.icpPosition)
    if (!displayed || !jsonEqual(displayed.raw, preimage.icp)) {
      return { ok: false, message: `ICP ${preimage.icpPosition + 1} does not match its committed preimage.` }
    }
    const icpId = text(preimage.icp.icp_id)
    if (!icpId) return { ok: false, message: 'A revealed ICP is missing its committed ID.' }
    if (icpIds.has(icpId)) return { ok: false, message: 'The revealed benchmark contains duplicate ICP IDs.' }
    icpIds.add(icpId)
    nonces.add(preimage.nonce)
    positions.add(preimage.icpPosition)
  }
  if (positions.size !== 20) return { ok: false, message: 'The reveal does not contain all 20 committed ICPs.' }
  return { ok: true, message: 'Matches published commitment' }
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
  if (!['pending', 'ready'].includes(publicIcpStatus)) return null
  const parsedScores = mergeScores(perIcpScores(scores?.stage_1), perIcpScores(scores?.stage_2))
  if (!incomplete && publicIcpStatus === 'pending' && parsedScores.size !== 0) return null
  const publicScores = incomplete || publicIcpStatus === 'pending' ? new Map<number, number>() : parsedScores
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
  submission: Pick<CompetitionSubmission, 'isBaseline' | 'isChampion' | 'status'>,
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
  const disclosurePolicy = optionalDisclosurePolicy(source.disclosure_policy)
  const benchmarkState = optionalBenchmarkState(source.benchmark_state)
  const benchmarkCommitmentHash = optionalSha256Hash(source.benchmark_commitment_hash)
  const benchmarkCommittedAt = optionalUtcTimestamp(source.benchmark_committed_at)
  if ([icpSetDate, evaluationDate, publicAt, submissionOpen, submissionCutoff, disclosurePolicy, benchmarkState, benchmarkCommitmentHash, benchmarkCommittedAt].includes(undefined)) return null
  if (disclosurePolicy === 'commit_reveal_day2_v1' && !benchmarkState) return null
  if (disclosurePolicy === 'commit_reveal_day2_v1') {
    const committed = benchmarkState !== 'pending_commitment'
    if (committed !== Boolean(benchmarkCommitmentHash && benchmarkCommittedAt)) return null
  }
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
    disclosurePolicy: disclosurePolicy ?? null,
    benchmarkState: benchmarkState ?? null,
    benchmarkCommitmentHash: benchmarkCommitmentHash ?? null,
    benchmarkCommittedAt: benchmarkCommittedAt ?? null,
  }
}

function normalizeBenchmarkManifest(value: unknown): CompetitionBenchmarkManifest | null {
  const source = record(value)
  if (!source || !hasExactKeys(source, ['schema_version', 'network_name', 'netuid', 'round_id', 'icp_set_date', 'evaluation_date', 'public_at', 'disclosure_policy', 'icp_count', 'entries'])) return null
  const entries = records(source.entries).map((entry) => {
    if (!hasExactKeys(entry, ['icp_position', 'icp_hash'])) return null
    const icpPosition = integer(entry.icp_position)
    const icpHash = sha256Hash(entry.icp_hash)
    return icpPosition !== null && icpPosition < 20 && icpHash ? { icpPosition, icpHash } : null
  }).filter(isPresent)
  const networkName = text(source.network_name)
  const netuid = integer(source.netuid)
  const roundId = text(source.round_id)
  const icpSetDate = calendarDate(source.icp_set_date)
  const evaluationDate = calendarDate(source.evaluation_date)
  const publicAt = utcTimestamp(source.public_at)
  if (source.schema_version !== 'leadpoet.lab_arena.benchmark_commitment.v1' || !networkName || netuid === null || !roundId || !icpSetDate || !evaluationDate || !publicAt || source.disclosure_policy !== 'commit_reveal_day2_v1' || source.icp_count !== 20 || entries.length !== 20) return null
  const manifest: CompetitionBenchmarkManifest = {
    schemaVersion: source.schema_version,
    networkName,
    netuid,
    roundId,
    icpSetDate,
    evaluationDate,
    publicAt,
    disclosurePolicy: source.disclosure_policy,
    icpCount: source.icp_count,
    entries,
  }
  if (entries.some((entry, index) => entry.icpPosition !== index)) return null
  return manifest
}

function normalizeBenchmarkVerification(value: unknown, commitment: CompetitionBenchmarkCommitment | null): CompetitionBenchmarkVerification | null {
  const source = record(value)
  if (!source || !commitment || !hasExactKeys(source, ['manifest_hash', 'canonical_preimages'])) return null
  const manifestHash = sha256Hash(source.manifest_hash)
  const canonicalPreimages = Array.isArray(source.canonical_preimages)
    ? source.canonical_preimages.filter((item): item is string => typeof item === 'string')
    : []
  if (manifestHash !== commitment.manifestHash || canonicalPreimages.length !== 20) return null
  return { manifestHash, canonicalPreimages }
}

function normalizeBenchmarkPreimage(value: unknown): {
  networkName: string; netuid: number; roundId: string; icpSetDate: string; evaluationDate: string; icpPosition: number; nonce: string; icp: JsonRecord
} | null {
  const source = record(value)
  if (!source || !hasExactKeys(source, ['schema_version', 'network_name', 'netuid', 'round_id', 'icp_set_date', 'evaluation_date', 'icp_position', 'nonce', 'icp'])) return null
  const icp = record(source.icp)
  const netuid = integer(source.netuid)
  const icpPosition = integer(source.icp_position)
  const nonce = exactText(source.nonce)
  if (source.schema_version !== 'leadpoet.lab_arena.benchmark_leaf.v1' || !text(source.network_name) || netuid === null || !text(source.round_id) || !calendarDate(source.icp_set_date) || !calendarDate(source.evaluation_date) || icpPosition === null || icpPosition >= 20 || !/^[a-f0-9]{64}$/.test(nonce) || !icp || 'icp_position' in icp || 'baseline_score' in icp || !isSupportedJson(icp)) return null
  return { networkName: text(source.network_name), netuid, roundId: text(source.round_id), icpSetDate: calendarDate(source.icp_set_date)!, evaluationDate: calendarDate(source.evaluation_date)!, icpPosition, nonce, icp }
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

function exactText(value: unknown): string {
  return typeof value === 'string' && value === value.trim() ? value : ''
}

function nullableText(value: unknown): string | null {
  return text(value) || null
}

function calendarDate(value: unknown): string | null {
  const normalized = exactText(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null
  const date = new Date(`${normalized}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === normalized ? normalized : null
}

function utcTimestamp(value: unknown): string | null {
  const normalized = exactText(value)
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/.exec(normalized)
  if (!match) return null
  const date = new Date(normalized)
  if (!Number.isFinite(date.getTime())) return null
  const [, year, month, day, hour, minute, second] = match
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() + 1 === Number(month)
    && date.getUTCDate() === Number(day)
    && date.getUTCHours() === Number(hour)
    && date.getUTCMinutes() === Number(minute)
    && date.getUTCSeconds() === Number(second)
    ? normalized
    : null
}

function optionalCalendarDate(value: unknown): string | null | undefined {
  return value === null || value === undefined ? null : calendarDate(value) ?? undefined
}

function optionalUtcTimestamp(value: unknown): string | null | undefined {
  return value === null || value === undefined ? null : utcTimestamp(value) ?? undefined
}

function isDisclosurePolicy(value: string): value is CompetitionDisclosurePolicy {
  return value === 'all_20_next_day' || value === 'commit_reveal_day2_v1'
}

function optionalDisclosurePolicy(value: unknown): CompetitionDisclosurePolicy | null | undefined {
  if (value === null || value === undefined) return null
  const normalized = text(value)
  return isDisclosurePolicy(normalized) ? normalized : undefined
}

function optionalBenchmarkState(value: unknown): CompetitionBenchmarkState | null | undefined {
  if (value === null || value === undefined) return null
  const normalized = text(value)
  return ['pending_commitment', 'committed', 'reveal_delayed', 'reveal_available'].includes(normalized)
    ? normalized as CompetitionBenchmarkState
    : undefined
}

function sha256Hash(value: unknown): string | null {
  const normalized = exactText(value)
  return /^sha256:[a-f0-9]{64}$/.test(normalized) ? normalized : null
}

function optionalSha256Hash(value: unknown): string | null | undefined {
  return value === null || value === undefined ? null : sha256Hash(value) ?? undefined
}

function hasExactKeys(source: JsonRecord, expected: string[]): boolean {
  const actual = Object.keys(source).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function withoutKeys(source: JsonRecord, omitted: string[]): JsonRecord {
  const result: JsonRecord = {}
  for (const [key, value] of Object.entries(source)) if (!omitted.includes(key)) result[key] = value
  return result
}

function isSupportedJson(value: unknown, depth = 0): boolean {
  if (depth > 64) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every((item) => isSupportedJson(item, depth + 1))
  const source = record(value)
  return source !== null && Object.values(source).every((item) => isSupportedJson(item, depth + 1))
}

function cloneJsonRecord(source: JsonRecord): JsonRecord {
  return JSON.parse(JSON.stringify(source)) as JsonRecord
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function jsonByteLength(value: unknown): number {
  try { return utf8ByteLength(JSON.stringify(value)) }
  catch { return Number.POSITIVE_INFINITY }
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left === 'number' && typeof right === 'number') return Object.is(left, right) || left === right
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]))
  }
  const leftRecord = record(left)
  const rightRecord = record(right)
  if (!leftRecord || !rightRecord) return false
  const leftKeys = Object.keys(leftRecord).sort()
  const rightKeys = Object.keys(rightRecord).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && jsonEqual(leftRecord[key], rightRecord[key]))
}

async function hashCanonicalString(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
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
