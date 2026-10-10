import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import vm from 'node:vm'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const outDir = await mkdtemp(join(resolve('node_modules'), '.research-lab-competition-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/research-lab-competition.ts'),
    '--target', 'ES2022', '--module', 'CommonJS', '--moduleResolution', 'Node',
    '--lib', 'ES2022,DOM', '--outDir', outDir, '--strict', '--skipLibCheck',
  ], { stdio: 'inherit' })
  assert.equal(tsc.status, 0, 'competition normalizer should compile')

  const require = createRequire(import.meta.url)
  const {
    DEFAULT_REPO_URL,
    competitionSubmissionEvaluationNotice,
    competitionSubmissionStatusLabel,
    competitionRoundOptions,
    competitionChampionHistory,
    formatCompetitionScore,
    currentChampionRound,
    normalizeCompetitionBenchmark,
    normalizeCompetitionCode,
    normalizeCompetitionResults,
    normalizeCompetitionHistory,
    normalizeCompetitionSnapshot,
    normalizeCompetitionSubmissions,
    normalizeValidatorNames,
    isCompetitionReviewExcluded,
    COMPANY_CHECK_LABELS,
  } = require(join(outDir, 'research-lab-competition.js'))
  assert.equal(DEFAULT_REPO_URL, 'https://github.com/leadpoet/leadpoet-sales-agent/tree/lab')

  const published = {
    round_id: 'arena-2026-09-05', status: 'published', mode: 'live', network_name: 'finney', netuid: 71,
    published_at: '2026-09-05T18:00:00Z', created_at: '2026-09-04T18:00:00Z', cancel_reason: null,
    icp_set_date: '2026-09-04', evaluation_date: '2026-09-05', public_at: '2026-09-05T18:00:00Z',
    submission_open: '2026-09-04T00:00:00Z', submission_cutoff: '2026-09-04T23:59:59Z',
    baseline: { submission_id: 'baseline', miner_hotkey: '5baseline', final_score: 0 },
    champion: null, promotion_status: 'not_required',
  }
  const cancelled = {
    round_id: 'arena-2026-09-09', status: 'cancelled', mode: 'live', network_name: 'finney', netuid: 71,
    published_at: null, created_at: '2026-09-08T18:00:00Z', cancel_reason: 'scoring_incomplete',
    icp_set_date: '2026-09-08', evaluation_date: '2026-09-09', public_at: '2026-09-09T18:00:00Z',
    submission_open: '2026-09-08T00:00:00Z', submission_cutoff: '2026-09-08T23:59:59Z',
    baseline: null, champion: null, promotion_status: 'not_required',
  }
  const snapshot = normalizeCompetitionSnapshot({
    mode: 'live', network_name: 'finney', netuid: 71,
    repo_url: 'https://github.com/leadpoet/leadpoet-sales-agent/tree/lab',
    open_round: null, latest_round: cancelled, latest_completed_round: published,
    rounds: [cancelled, published],
  })
  assert.ok(snapshot)
  assert.equal(snapshot.repoUrl, DEFAULT_REPO_URL)
  assert.equal(normalizeCompetitionSnapshot({
    mode: 'live', network_name: 'finney', netuid: 71,
    repo_url: 'https://github.com/leadpoet/leadpoet-sales-agent/tree/main', rounds: [],
  }).repoUrl, 'https://github.com/leadpoet/leadpoet-sales-agent/tree/main')
  assert.equal(normalizeCompetitionSnapshot({
    mode: 'live', network_name: 'finney', netuid: 71,
    repo_url: 'https://github.com/leadpoet/leadpoet-sales-agent-unrelated/tree/lab', rounds: [],
  }).repoUrl, DEFAULT_REPO_URL)
  assert.equal(snapshot.latestCompletedRound.baseline.finalScore, 0, 'zero is a real score, not missing data')
  assert.equal(snapshot.latestCompletedRound.benchmarkIcpCount, 20, 'legacy rounds retain their 20-ICP display')
  assert.equal(snapshot.latestCompletedRound.promotionMargin, 1, 'legacy rounds retain their 1-point promotion rule')
  assert.equal(snapshot.latestCompletedRound.evaluationDate, '2026-09-05')
  assert.deepEqual(competitionRoundOptions(snapshot).map((round) => round.roundId), ['arena-2026-09-09', 'arena-2026-09-05'])
  const activeRound = { ...snapshot.latestRound, roundId: 'arena-2026-09-10', status: 'stage2', cancelReason: null }
  const activeSnapshot = { ...snapshot, latestRound: activeRound }
  assert.equal(competitionRoundOptions(activeSnapshot)[0].roundId, activeRound.roundId, 'the newer active round remains selected')
  assert.equal(currentChampionRound(snapshot), null, 'a baseline must never masquerade as a champion')
  const historyRound = (date, finalScore, overrides = {}) => ({
    ...snapshot.latestCompletedRound, roundId: `arena-${date}`, evaluationDate: date,
    publishedAt: `${date}T18:00:00Z`, baseline: { submissionId: 'baseline', minerHotkey: '5baseline', finalScore: 99 },
    champion: { submissionId: `winner-${date}`, minerHotkey: '5winner', finalScore, outcome: 'new_king' }, promotionStatus: 'promoted',
    ...overrides,
  })
  const historySnapshot = (rounds, refs = {}) => ({ ...snapshot, rounds, latestRound: null, latestCompletedRound: null, openRound: null, ...refs })
  assert.deepEqual(competitionChampionHistory(historySnapshot([])), [])
  const canonical = historyRound('2026-09-05', 0)
  const history = competitionChampionHistory(historySnapshot([
    historyRound('2026-09-10', 4.633), historyRound('2026-09-06', null), canonical,
    historyRound('2026-09-07', 80, { status: 'cancelled' }),
    historyRound('2026-09-08', 70, { status: 'stage2' }),
    historyRound('2026-09-09', 60, { status: 'scoring_failed' }),
    historyRound(null, 90), historyRound('2026-02-30', 90),
  ], { latestCompletedRound: { ...canonical, champion: { ...canonical.champion, finalScore: 99 } } }))
  assert.deepEqual(history.map((point) => point.evaluationDate), ['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'], 'history sorts valid UTC evaluation dates and fills calendar gaps')
  assert.deepEqual(history.map((point) => point.score), [0, null, null, null, null, 4.633], 'true zero is retained; pending, failed, cancelled and missing scores remain gaps')
  assert.equal(history[0].timestamp, Date.parse('2026-09-05T00:00:00Z'))
  assert.equal(history[0].roundId, canonical.roundId, 'canonical history wins over stale round references')
  assert.equal(competitionChampionHistory(historySnapshot([canonical, canonical])).length, 1, 'duplicate references do not add chart points')
  assert.equal(competitionChampionHistory(historySnapshot([], { latestCompletedRound: canonical }))[0].score, 0, 'a published canonical reference outside the history list is included')
  const laterRelease = historyRound('2026-09-05', 2, { roundId: 'arena-rerun', publishedAt: '2026-09-05T20:00:00Z' })
  assert.equal(competitionChampionHistory(historySnapshot([laterRelease, canonical]))[0].score, 2, 'a repeated evaluation day uses the latest published release regardless of input order')
  assert.equal(competitionChampionHistory(historySnapshot([
    laterRelease, historyRound('2026-09-05', 3, { roundId: 'offset-release', publishedAt: '2026-09-05T17:00:00-04:00' }),
  ]))[0].score, 3, 'release ordering compares UTC instants rather than timestamp strings')
  const windowedHistory = competitionChampionHistory(historySnapshot([canonical, historyRound('2026-09-30', 5)]))
  assert.equal(windowedHistory.length, 14, 'chart limits history to the most recent 14 evaluation days')
  assert.equal(windowedHistory[0].evaluationDate, '2026-09-17')
  assert.equal(windowedHistory.at(-1).score, 5)
  const rolloverHistory = competitionChampionHistory(historySnapshot([historyRound('2026-12-31', 1), historyRound('2027-01-02', 2)]))
  assert.deepEqual(rolloverHistory.map((point) => point.evaluationDate), ['2026-12-31', '2027-01-01', '2027-01-02'], 'history crosses UTC year boundaries without a local-time shift')

  const promoted = historyRound('2026-10-07', 5.75)
  const inProgress = historyRound('2026-10-08', 88, { status: 'stage2' })
  const pending = historyRound('2026-10-09', 90, { promotionStatus: 'pending' })
  const superseded = historyRound('2026-10-10', 95, { promotionStatus: 'superseded' })
  const held = historyRound('2026-10-11', null, { champion: null, promotionStatus: 'not_required' })
  const championSnapshot = historySnapshot([held, superseded, pending, inProgress, promoted], { latestRound: inProgress, latestCompletedRound: held })
  assert.equal(currentChampionRound(championSnapshot)?.roundId, promoted.roundId, 'active, pending, superseded and no-winner rounds cannot replace the reigning champion')
  assert.equal(currentChampionRound(championSnapshot)?.champion.finalScore, 5.75, 'headline uses winning score instead of a subsequent baseline evaluation')
  assert.equal(currentChampionRound(historySnapshot([canonical]))?.champion.finalScore, 0, 'zero is a valid winning score')
  assert.equal(currentChampionRound(historySnapshot([], { latestCompletedRound: promoted }))?.roundId, promoted.roundId, 'include published references outside history')
  assert.equal(currentChampionRound(historySnapshot([promoted], { latestCompletedRound: { ...promoted, champion: { ...promoted.champion, finalScore: 99 } } }))?.champion.finalScore, 5.75, 'canonical record wins over a stale reference')
  const missingChampionScore = historyRound('2026-10-12', null)
  assert.equal(currentChampionRound(historySnapshot([promoted, missingChampionScore]))?.champion.finalScore, null, 'a newer promoted champion with a missing score must not inherit the old champion score')
  assert.equal(currentChampionRound(historySnapshot([historyRound(null, 99)])), null, 'unknown evaluation dates must not displace the current champion')
  assert.deepEqual(competitionChampionHistory(championSnapshot).slice(-5).map((point) => point.score), [5.75, null, 90, 95, null], 'history shows published round winners; absent winners and unfinished rounds stay gaps')
  assert.equal(competitionChampionHistory(championSnapshot).at(-2).promotionStatus, 'superseded', 'history preserves promotion outcome for tooltip context')

  const legacySnapshot = normalizeCompetitionSnapshot({
    mode: 'live', network_name: 'finney', netuid: 71, rounds: [{
      ...published, round_id: 'arena-legacy', icp_set_date: '2026-09-05', evaluation_date: '2026-09-05',
    }],
  })
  assert.ok(legacySnapshot, 'historical same-day bank and evaluation dates remain valid')

  const submissions = normalizeCompetitionSubmissions({ submissions: [{
    submission_id: 'miner-1', miner_hotkey: '5miner', is_baseline: false, status: 'scored',
    submitted_at: '2026-09-05T10:00:00Z', stage1_score: 0, final_score: null, is_champion: false,
    code: { available: false, available_at: '2026-09-06T10:00:00Z', url: null },
  }] })
  assert.equal(submissions[0].stage1Score, 0)
  assert.equal(submissions[0].finalScore, null)
  assert.deepEqual(submissions[0].codeReview, {
    status: null, errorCode: null, providerHttpStatus: null, retryable: null, attempts: null,
  })
  const pendingRound = { ...snapshot.latestCompletedRound, promotionStatus: 'pending' }
  assert.equal(
    competitionSubmissionStatusLabel(submissions[0], pendingRound),
    'Scored · not promoted',
    'a non-winning scored submission must not inherit the champion promotion state',
  )
  assert.equal(
    competitionSubmissionStatusLabel({ ...submissions[0], status: 'scoring_failed' }, pendingRound),
    'Evaluation failed',
    'a failed submission must not look scored or promotable',
  )
  assert.equal(formatCompetitionScore(0), '0.00', 'a real zero score must remain published')
  const champion = { ...submissions[0], status: 'champion', isChampion: true }
  assert.equal(competitionSubmissionStatusLabel(champion, pendingRound), 'Champion · promotion pending')
  assert.equal(
    competitionSubmissionStatusLabel(champion, { ...pendingRound, promotionStatus: 'promoted' }),
    'Champion · promoted',
  )
  assert.equal(
    competitionSubmissionStatusLabel(champion, { ...pendingRound, promotionStatus: 'superseded' }),
    'Champion · promotion superseded',
  )
  assert.equal(
    competitionSubmissionStatusLabel(submissions[0], { ...pendingRound, promotionStatus: 'superseded' }),
    'Scored · not promoted',
  )
  assert.equal(formatCompetitionScore(0.99), '0.99')
  assert.equal(formatCompetitionScore(1), '1.00', 'two decimals distinguish threshold-adjacent scores')
  assert.equal(formatCompetitionScore(null), '—')

  const benchmarkPayload = {
    round_id: 'arena-2026-09-05', icp_set_date: '2026-09-04', public_at: '2026-09-05T18:00:00Z',
    public_icp_count: 20, private_icp_count: 0, disclosure_policy: 'all_20_next_day',
    icps: Array.from({ length: 20 }, (_, index) => ({
      icp_id: `public-${index}`, icp_position: index,
      prompt: 'Public ICP', baseline_score: index === 19 ? null : index === 18 ? 0 : 50 + index,
    })),
  }
  const benchmark = normalizeCompetitionBenchmark(benchmarkPayload, snapshot.latestCompletedRound)
  assert.equal(benchmark.icps.length, 20)
  assert.equal(benchmark.icps[18].baselineScore, 0)
  assert.equal(benchmark.icps[19].baselineScore, null, 'a baseline ICP score stays pending instead of becoming zero')
  assert.equal(benchmark.publicIcpCount, 20)
  assert.equal(benchmark.benchmarkIcpCount, 20)
  assert.equal(benchmark.privateIcpCount, 0)
  assert.equal(benchmark.disclosurePolicy, 'all_20_next_day')
  for (const policy of ['after_scoring_day2_v1', 'cutoff_public_v1']) {
    const released = normalizeCompetitionBenchmark({ ...benchmarkPayload, disclosure_policy: policy }, snapshot.latestCompletedRound)
    assert.equal(released?.icps.length, 20, 'supported gateway disclosure policies must render the released bank')
    assert.equal(released?.disclosurePolicy, policy)
    assert.equal(normalizeCompetitionBenchmark({ ...benchmarkPayload, disclosure_policy: policy, private_icp_count: 1 }), null)
  }
  assert.equal(normalizeCompetitionBenchmark({ ...benchmarkPayload, disclosure_policy: 'unknown_policy' }), null)
  assert.equal('nextIcps' in benchmark, false, 'the next ICP bank must not enter the public model')
  assert.equal(normalizeCompetitionBenchmark({ ...benchmarkPayload, icp_set_date: undefined }, snapshot.latestCompletedRound), null, 'a missing bank date must fail closed')
  assert.equal(normalizeCompetitionBenchmark({ ...benchmarkPayload, icp_set_date: '2026-09-03' }, snapshot.latestCompletedRound), null, 'a different bank must fail selected-round validation')
  assert.equal(normalizeCompetitionBenchmark({ ...benchmarkPayload, public_at: '2026-09-06T18:00:00Z' }, snapshot.latestCompletedRound), null, 'a mismatched release time must fail selected-round validation')
  assert.equal(normalizeCompetitionBenchmark({ ...benchmarkPayload, public_icp_count: 10 }), null, 'the retired 10-ICP projection must not render')
  assert.equal(normalizeCompetitionBenchmark({ ...benchmarkPayload, icps: [...benchmarkPayload.icps.slice(0, 19), { ...benchmarkPayload.icps[0] }] }), null, 'all 20 original positions must be unique')

  const results = normalizeCompetitionResults({
    round_id: 'arena-2026-09-05', submission_id: 'miner-1', public_icp_status: 'ready',
    scores: {
      stage_1: Array.from({ length: 10 }, (_, index) => ({ icp_position: index, per_icp_score: index === 2 ? 0 : 40 + index })),
      stage_2: Array.from({ length: 10 }, (_, index) => ({ icp_position: index + 10, per_icp_score: index === 7 ? 88.5 : 60 + index })),
    },
    submission_scores: { stage_1: 40, final: 64.25 },
  })
  assert.equal(results.publicScores.get(2), 0)
  assert.equal(results.publicScores.get(17), 88.5)
  assert.equal(results.publicScores.size, 20)
  assert.equal(results.benchmarkIcpCount, 20)
  assert.equal(results.publicIcpStatus, 'ready')
  assert.equal(results.scoringAttribution, null, 'a legacy result must show attribution as unavailable')
  assert.equal(results.companyDiagnostics, null, 'a legacy result without diagnostics must remain available without company rows')
  const primaryHotkey = '5FNVgRnrxMibhcBGEAaajGrYjsaCn441a5HuGUBUNnxEBLo9'
  const yumaHotkey = '5Chnr6Y72gdfTFdoZnsCvkndKpMk8jAtt9JAYKaNG3LmU4BW'
  const attributedResultsPayload = {
    round_id: 'arena-2026-09-05', submission_id: 'miner-1', public_icp_status: 'ready',
    scores: {
      stage_1: Array.from({ length: 10 }, (_, index) => ({ icp_position: index, per_icp_score: index === 2 ? 0 : 40 + index })),
      stage_2: Array.from({ length: 10 }, (_, index) => ({ icp_position: index + 10, per_icp_score: 60 + index })),
    },
    submission_scores: { stage_1: 40, final: 64.25 },
    scoring_attribution: {
      validators: [
        { hotkey: primaryHotkey, icp_count: 12, reused_icp_count: 3 },
        { hotkey: yumaHotkey, icp_count: 7, reused_icp_count: 1 },
      ],
      icps: [
        { icp_position: 0, validator_hotkeys: [primaryHotkey, yumaHotkey], reused_judgment: true },
        { icp_position: 1, validator_hotkeys: [], reused_judgment: false },
      ],
      unattributed_icp_count: 1,
    },
  }
  const attributedResults = normalizeCompetitionResults(attributedResultsPayload)
  assert.deepEqual(attributedResults.scoringAttribution, {
    validators: [
      { hotkey: primaryHotkey, icpCount: 12, reusedIcpCount: 3 },
      { hotkey: yumaHotkey, icpCount: 7, reusedIcpCount: 1 },
    ],
    icps: [
      { icpPosition: 0, validatorHotkeys: [primaryHotkey, yumaHotkey], reusedJudgment: true },
      { icpPosition: 1, validatorHotkeys: [], reusedJudgment: false },
    ],
    unattributedIcpCount: 1,
  })
  const withVersions = (versions) => normalizeCompetitionResults({ ...attributedResultsPayload, scoring_attribution: { ...attributedResultsPayload.scoring_attribution, code_versions: versions } })
  const version = { validator_hotkey: primaryHotkey, commit: 'a'.repeat(40), working_tree: 'dirty', icp_positions: [0] }
  assert.deepEqual(withVersions([version]).scoringAttribution.codeVersions, [{ validatorHotkey: primaryHotkey, commit: 'a'.repeat(40), workingTree: 'dirty', icpPositions: [0] }])
  for (const invalid of [{ ...version, commit: 'main' }, { ...version, validator_hotkey: 'unknown' }, { ...version, icp_positions: [-1] }, { ...version, icp_positions: [20] }]) {
    assert.deepEqual(withVersions([invalid]).scoringAttribution.codeVersions, [])
  }
  const historyPayload = { rounds: [published], submissions: [{ round_id: published.round_id, submission_id: 'miner-1', miner_hotkey: primaryHotkey, status: 'scored', final_score: 0 }], next_cursor: 'next_page' }
  assert.equal(normalizeCompetitionHistory(historyPayload).entries[0].submission.finalScore, 0)
  assert.equal(normalizeCompetitionHistory(historyPayload).nextCursor, 'next_page')
  assert.equal(normalizeCompetitionHistory({ ...historyPayload, next_cursor: '../unsafe' }), null)
  assert.equal(normalizeCompetitionHistory({ ...historyPayload, rounds: [{ ...published, status: 'open' }] }), null)
  assert.equal(normalizeCompetitionHistory({ ...historyPayload, rounds: [] }), null)
  for (const malformed of [
    { validators: null, icps: [], unattributed_icp_count: 0 },
    { validators: [{ hotkey: primaryHotkey, icp_count: 1, reused_icp_count: 2 }], icps: [], unattributed_icp_count: 0 },
    { validators: [], icps: [{ icp_position: 20, validator_hotkeys: [], reused_judgment: false }], unattributed_icp_count: 1 },
    { validators: [], icps: [{ icp_position: 0, validator_hotkeys: [primaryHotkey, primaryHotkey], reused_judgment: false }], unattributed_icp_count: 0 },
  ]) {
    const normalized = normalizeCompetitionResults({ ...attributedResultsPayload, scoring_attribution: malformed })
    assert.ok(normalized, 'malformed optional attribution must not discard valid scores')
    assert.equal(normalized.scoringAttribution, null, 'malformed attribution must render as unavailable')
  }
  assert.equal(normalizeCompetitionResults({
    round_id: 'arena-2026-09-05', submission_id: 'miner-1', public_icp_status: 'ready',
    scores: { stage_1: [{ icp_position: 2, per_icp_score: 99 }] }, submission_scores: { final: 99 },
  }), null, 'a partial ready result must fail closed')
  const incomplete = normalizeCompetitionResults({
    round_id: 'arena-2026-09-09', submission_id: 'miner-1', round_status: 'cancelled', incomplete: true,
    scores: { stage_1: [{ icp_position: 2, per_icp_score: 99 }] },
    submission_scores: { stage_1: 99, final: 99 },
  })
  assert.equal(incomplete.finalScore, null)
  assert.equal(incomplete.publicScores.size, 0, 'cancelled partial evidence must not become a displayed score')
  assert.equal(incomplete.scoringAttribution, null)
  assert.equal(incomplete.companyDiagnostics, null, 'cancelled evidence must not expose company diagnostics')

  const code = normalizeCompetitionCode({ submission_id: 'miner-1', files: [{ path: 'agent.py', content: 'print(1)' }], truncated: true })
  assert.deepEqual(code.files[0], { path: 'agent.py', content: 'print(1)', language: null })
  assert.equal(code.truncated, true)

  const component = await readFile(resolve('src/components/dashboard/ResearchLab.tsx'), 'utf8')
  const renderedModule = { exports: {} }
  vm.runInNewContext(ts.transpileModule(component, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText + '\nexports.ValidatorNamesContext = ValidatorNamesContext; exports.ChampionScoreHistory = ChampionScoreHistory; exports.ScoreHistoryTooltip = ScoreHistoryTooltip; exports.RoundSummary = RoundSummary; exports.ChampionSummary = ChampionSummary; exports.SubmissionTable = SubmissionTable; exports.PublishedResults = PublishedResults; exports.ScoringAttributionSummary = ScoringAttributionSummary; exports.IcpList = IcpList; exports.CompanyDiagnostics = CompanyDiagnostics; exports.SourcePanel = SourcePanel; exports.EvaluationRunSummary = EvaluationRunSummary; exports.filterSubmissions = filterSubmissions;', {
    module: renderedModule, exports: renderedModule.exports,
    require(name) {
      if (name === '@/lib/research-lab-competition') return require(join(outDir, 'research-lab-competition.js'))
      // These imports belong to other panels, which this summary must not run.
      if (name === '@/lib/hooks/useVisiblePolling') return {}
      return require(name)
    },
  })
  const evaluationRow = (evaluation, status = 'scoring') => normalizeCompetitionSubmissions({ submissions: [{
    submission_id: 'agent-progress', miner_hotkey: '5miner', status, evaluation,
  }] })[0]
  const evaluating = evaluationRow({ state: 'evaluating', validators: [{ hotkey: primaryHotkey, phase: 'scoring' }, { hotkey: yumaHotkey, phase: 'executing' }] })
  const queued = evaluationRow({ state: 'queued', validators: [] })
  assert.equal(competitionSubmissionStatusLabel(queued, pendingRound), 'Queued for validation')
  assert.equal(competitionSubmissionStatusLabel(evaluating, pendingRound), 'Evaluating')
  assert.equal(competitionSubmissionStatusLabel(evaluationRow({ state: 'finalizing', validators: [] }), pendingRound), 'Finalizing results')
  for (const evaluation of [null, { state: 'evaluating', validators: [] }, { state: 'queued', validators: [{ hotkey: primaryHotkey, phase: 'scoring' }] }, { state: 'evaluating', validators: [{ hotkey: primaryHotkey, phase: 'unknown' }] }]) {
    assert.equal(competitionSubmissionStatusLabel(evaluationRow(evaluation), pendingRound), 'In evaluation', 'missing or invalid progress must not imply an active assignment')
  }
  assert.equal(evaluationRow({ state: 'evaluating', validators: [{ hotkey: primaryHotkey, phase: 'scoring' }] }, 'review_failed').evaluation, null)
  const taskCounts = { queued: 2, active: 1, completed: 4, failed: 1, retrying: 1 }
  const evaluationVersion = { validator_hotkey: primaryHotkey, phase: 'executing', commit: 'b'.repeat(40), working_tree: 'clean' }
  const versionedEvaluation = evaluationRow({ state: 'evaluating', counts: taskCounts, validators: [{ hotkey: primaryHotkey, phase: 'executing', commit: 'b'.repeat(40), working_tree: 'dirty' }], code_versions: [evaluationVersion] })
  assert.deepEqual(versionedEvaluation.evaluation.counts, taskCounts)
  assert.equal(versionedEvaluation.evaluation.validators[0].commit, 'b'.repeat(40))
  assert.equal(versionedEvaluation.evaluation.validators[0].workingTree, 'dirty')
  assert.deepEqual(versionedEvaluation.evaluation.codeVersions, [{ validatorHotkey: primaryHotkey, phase: 'executing', commit: 'b'.repeat(40), workingTree: 'clean' }])
  const multiVersionValidators = [
    { hotkey: primaryHotkey, phase: 'executing', commit: 'b'.repeat(40), working_tree: 'clean' },
    { hotkey: primaryHotkey, phase: 'executing', commit: 'c'.repeat(40), working_tree: 'clean' },
    { hotkey: primaryHotkey, phase: 'executing', commit: 'c'.repeat(40), working_tree: 'dirty' },
    { hotkey: yumaHotkey, phase: 'scoring', commit: null, working_tree: 'unknown' },
  ]
  const multiVersionEvaluation = evaluationRow({ state: 'evaluating', validators: multiVersionValidators })
  assert.equal(multiVersionEvaluation.evaluation.state, 'evaluating', 'workers on multiple commits remain active')
  assert.equal(multiVersionEvaluation.evaluation.validators.length, 4)
  assert.equal(evaluationRow({ state: 'evaluating', validators: [...multiVersionValidators, multiVersionValidators[0]] }).evaluation, null, 'exact duplicate version tuples remain invalid')
  assert.equal(competitionSubmissionStatusLabel(evaluationRow({ state: 'unavailable', validators: [] }), pendingRound), 'Evaluation status unavailable')
  const completedEvaluation = evaluationRow({ state: 'completed', validators: [], counts: { ...taskCounts, active: 0, retrying: 0 }, code_versions: [evaluationVersion] }, 'scored')
  assert.equal(completedEvaluation.evaluation.state, 'completed', 'completed historical submissions retain their own run versions')
  assert.equal(evaluationRow({ state: 'failed', validators: [] }, 'scoring_failed').evaluation.state, 'failed')
  assert.equal(competitionSubmissionStatusLabel(evaluationRow({ state: 'retrying', validators: [] }), pendingRound), 'Evaluation retrying')
  const failureLabels = {
    execution_window: 'Evaluation incomplete · execution window ended',
    review: 'Evaluation incomplete · review did not finish',
    provider_credentials: 'Provider access failed',
    provider: 'Provider request failed',
    execution: 'Model execution failed',
    unknown: 'Evaluation failed',
  }
  for (const [reason, label] of Object.entries(failureLabels)) {
    for (const status of ['scoring', 'scoring_failed']) {
      const row = evaluationRow({ state: 'failed', validators: [], failure_reasons: [reason] }, status)
      assert.deepEqual(row.evaluation.failureReasons, [reason])
      assert.equal(competitionSubmissionStatusLabel(row, pendingRound), label)
    }
  }
  for (const status of ['scoring', 'scoring_failed']) {
    assert.equal(competitionSubmissionStatusLabel(evaluationRow({ state: 'failed', validators: [] }, status), pendingRound), 'Evaluation failed')
    assert.equal(competitionSubmissionStatusLabel(evaluationRow({ state: 'failed', validators: [], failure_reasons: ['review', 'execution_window'] }, status), pendingRound), 'Evaluation incomplete · multiple causes')
    assert.equal(competitionSubmissionStatusLabel({
      ...evaluationRow({ state: 'failed', validators: [], failure_reasons: ['unknown'] }, status),
      failureReason: 'credential_error',
    }, pendingRound), 'Provider access failed', 'keep the recorded credential cause when older run metadata is missing')
  }
  const unclaimedRows = Array.from({ length: 49 }, () => evaluationRow({
    state: 'failed', validators: [], counts: { queued: 0, active: 0, completed: 0, failed: 10, retrying: 0 },
    code_versions: [], failure_reasons: ['execution_window'],
  }))
  assert.ok(unclaimedRows.every((row) => competitionSubmissionStatusLabel(row, pendingRound) === failureLabels.execution_window))
  assert.ok(unclaimedRows.every((row) => row.evaluation.validators.length === 0 && row.evaluation.counts.failed === 10))
  for (const reasons of ['review', [null], ['private-raw-error'], ['review', 'private-raw-error'], [{}], Array(7).fill('review')]) {
    const row = evaluationRow({ state: 'failed', validators: [], failure_reasons: reasons, terminal_doc: 'private-detail' })
    assert.equal(row.evaluation.failureReasons, undefined, 'invalid optional causes must not be accepted or replace progress')
    assert.equal(competitionSubmissionStatusLabel(row, pendingRound), 'Evaluation failed')
    assert.doesNotMatch(JSON.stringify(row), /private/)
  }
  const repeatedReason = evaluationRow({ state: 'failed', validators: [], failure_reasons: ['review', 'review'] })
  assert.deepEqual(repeatedReason.evaluation.failureReasons, ['review'])
  assert.equal(competitionSubmissionStatusLabel(repeatedReason, pendingRound), failureLabels.review)
  for (const [state, label] of [['queued', 'Queued for validation'], ['retrying', 'Evaluation retrying'], ['completed', 'Evaluation complete · finalizing']]) {
    assert.equal(competitionSubmissionStatusLabel(evaluationRow({ state, validators: [], failure_reasons: ['provider_credentials'] }), pendingRound), label)
  }
  for (const [status, label] of [['review_failed', 'Code review could not complete'], ['review_rejected', 'Code review rejected'], ['champion', 'Champion · promotion pending'], ['scored', 'Scored · not promoted']]) {
    assert.equal(competitionSubmissionStatusLabel(evaluationRow({ state: 'failed', validators: [], failure_reasons: ['execution_window'] }, status), pendingRound), label)
  }
  for (const counts of [{ ...taskCounts, active: -1 }, { ...taskCounts, queued: '2' }, { ...taskCounts, retrying: 0.5 }, { active: 1 }]) {
    assert.equal(evaluationRow({ state: 'evaluating', validators: [{ hotkey: primaryHotkey, phase: 'scoring' }], counts }).evaluation.counts, undefined, 'invalid optional task counts must not discard confirmed assignments')
  }
  const unknownVersion = evaluationRow({ state: 'completed', validators: [], code_versions: [{ ...evaluationVersion, commit: 'main', working_tree: 'unexpected' }] }, 'scored')
  assert.equal(unknownVersion.evaluation.codeVersions[0].commit, null)
  assert.equal(unknownVersion.evaluation.codeVersions[0].workingTree, 'unknown')
  assert.deepEqual(evaluationRow({ state: 'completed', validators: [], code_versions: [{ ...evaluationVersion, phase: 'unknown' }] }, 'scored').evaluation.codeVersions, [])
  const validatorNames = normalizeValidatorNames({ names: { [primaryHotkey]: 'Leadpoet', [yumaHotkey]: 'Yuma', ghost: 'Wrong identity' }, hotkeyToUid: { [primaryHotkey]: 0, [yumaHotkey]: 155 } })
  assert.deepEqual(validatorNames, { [primaryHotkey]: 'Leadpoet', [yumaHotkey]: 'Yuma' })
  assert.deepEqual(normalizeValidatorNames({ names: { [primaryHotkey]: 'Leadpoet' } }), {})
  const withNames = (node) => React.createElement(renderedModule.exports.ValidatorNamesContext.Provider, { value: validatorNames }, node)
  const progressMarkup = renderToStaticMarkup(withNames(React.createElement(renderedModule.exports.SubmissionTable, {
    submissions: [evaluating, { ...queued, submissionId: 'waiting' }], round: pendingRound, selectedId: null, onSelect() {},
  })))
  assert.match(progressMarkup, /Evaluating/)
  assert.match(progressMarkup, /Scoring · .*Leadpoet/)
  assert.match(progressMarkup, /Running · .*Yuma/)
  assert.match(progressMarkup, /Queued for validation/)
  assert.doesNotMatch(progressMarkup, /Commit not recorded|checkout state unknown/, 'live rows show status and validator, without missing technical metadata')
  const activeVersionMarkup = renderToStaticMarkup(withNames(React.createElement(renderedModule.exports.SubmissionTable, {
    submissions: [versionedEvaluation], round: pendingRound, selectedId: null, onSelect() {},
  })))
  assert.doesNotMatch(activeVersionMarkup, /local modifications|\/commit\//)
  assert.match(activeVersionMarkup, /Running · .*Leadpoet/)
  assert.match(activeVersionMarkup, /retrying tasks/)
  const multiVersionMarkup = renderToStaticMarkup(withNames(React.createElement(renderedModule.exports.SubmissionTable, {
    submissions: [multiVersionEvaluation], round: pendingRound, selectedId: null, onSelect() {},
  })))
  assert.match(multiVersionMarkup, /Evaluating/)
  assert.doesNotMatch(multiVersionMarkup, /bbbbbbbbbbbb|cccccccccccc|local modifications|checkout state unknown/)
  assert.equal((multiVersionMarkup.match(/Leadpoet/g) ?? []).length, 2, 'each mutually exclusive mobile/desktop status shows a validator once per phase')
  assert.match(multiVersionMarkup, /Scoring · .*Yuma/)
  const archivedVersionMarkup = renderToStaticMarkup(withNames(React.createElement(renderedModule.exports.EvaluationRunSummary, { submission: completedEvaluation })))
  assert.match(archivedVersionMarkup, /Execution/)
  assert.match(archivedVersionMarkup, new RegExp('b'.repeat(40)))
  assert.match(archivedVersionMarkup, /clean checkout/)
  assert.match(archivedVersionMarkup, /original judgments/)
  assert.match(archivedVersionMarkup, /4 completed/)
  const unknownVersionMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.EvaluationRunSummary, { submission: unknownVersion }))
  assert.match(unknownVersionMarkup, /Commit not recorded/)
  const missingVersionMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.EvaluationRunSummary, { submission: { ...completedEvaluation, evaluation: null } }))
  assert.match(missingVersionMarkup, /Evaluation run versions were not recorded/)
  const filterRows = [versionedEvaluation, queued, completedEvaluation, evaluationRow({ state: 'failed', validators: [] }, 'scoring_failed')]
  assert.deepEqual(renderedModule.exports.filterSubmissions(filterRows, '', 'retrying').map((row) => row.status), ['scoring'])
  assert.deepEqual(renderedModule.exports.filterSubmissions(filterRows, '', 'failed').map((row) => row.status), ['scoring_failed'])
  assert.deepEqual(renderedModule.exports.filterSubmissions(filterRows, '', 'scored').map((row) => row.status), ['scored'])
  const baselineRow = { ...completedEvaluation, submissionId: 'baseline-round', isBaseline: true }
  const rowsWithBaselineLast = [...filterRows, baselineRow]
  const orderedRows = renderedModule.exports.filterSubmissions(rowsWithBaselineLast, '', 'all')
  assert.equal(orderedRows[0], baselineRow, 'the baseline is first before table pagination')
  assert.deepEqual(orderedRows.slice(1), filterRows, 'miner order and row data remain unchanged')
  assert.equal(rowsWithBaselineLast.at(-1), baselineRow, 'display ordering must not mutate the source list')
  assert.deepEqual(renderedModule.exports.filterSubmissions(rowsWithBaselineLast, '', 'failed'),
    renderedModule.exports.filterSubmissions(filterRows, '', 'failed'), 'the baseline must still match the selected filter')
  assert.deepEqual(renderedModule.exports.filterSubmissions(rowsWithBaselineLast, 'baseline-round', 'all'), [baselineRow])
  const namedAttribution = renderToStaticMarkup(withNames(React.createElement(renderedModule.exports.ScoringAttributionSummary, { attribution: attributedResults.scoringAttribution })))
  assert.match(namedAttribution, /Leadpoet \(5FNVgRnrx…xEBLo9\), Yuma \(5Chnr6Y72…LmU4BW\)/)
  assert.match(namedAttribution, new RegExp(primaryHotkey), 'full hotkeys remain available in expanded attribution')

  const renderSummary = (round) => renderToStaticMarkup(React.createElement(renderedModule.exports.RoundSummary, { round }))
  for (const [status, label] of Object.entries({
    open: 'Open for submissions', committed: 'Preparing evaluation',
    stage1: 'Initial evaluation in progress', stage1_closed: 'Initial evaluation in progress',
    stage1_scoring: 'Initial scoring in progress', stage1_judged: 'Initial scoring in progress',
    stage1_scored: 'Preparing final evaluation', stage2: 'Final evaluation in progress',
    stage2_closed: 'Final evaluation in progress', stage2_scoring: 'Final scoring in progress',
    stage2_judged: 'Final scoring in progress', scored: 'Publishing results',
  })) {
    const markup = renderSummary({ ...snapshot.latestCompletedRound, status, publishedAt: null, baseline: null })
    assert.match(markup, /Pending/, `${status} must not imply a final promotion decision`)
    assert.match(markup, /Decision follows completed evaluation/)
    assert.match(markup, /Awaiting score/, `${status} must distinguish a missing baseline score from zero`)
    assert.doesNotMatch(markup, /Not required|No champion was published|Stage1 scored/)
    assert.ok(markup.includes(label), `${status} must use a readable round status`)
  }
  const historyMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.ChampionScoreHistory, { points: history }))
  assert.match(historyMarkup, /Champion history/)
  assert.match(historyMarkup, /Past competitions/)
  assert.match(historyMarkup, /UTC/)
  const emptyHistoryMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.ChampionScoreHistory, { points: [] }))
  assert.match(emptyHistoryMarkup, /No champion scores yet/)
  const onePointMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.ChampionScoreHistory, { points: [history[0]] }))
  assert.match(onePointMarkup, /First published champion/)
  const tooltipMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.ScoreHistoryTooltip, { active: true, payload: [{ payload: history[0] }] }))
  assert.match(tooltipMarkup, /Evaluation · Sep 5, 2026 · UTC/)
  assert.match(tooltipMarkup, /Champion 0\.00 \/100/)
  assert.equal(renderToStaticMarkup(React.createElement(renderedModule.exports.ScoreHistoryTooltip, { active: true, payload: [{ payload: history[1] }] })), '', 'a missing point must not expose a zero tooltip')
  const finalMarkup = renderSummary(snapshot.latestCompletedRound)
  const datedRound = {
    ...snapshot.latestCompletedRound, status: 'stage1', publishedAt: null,
    icpSetDate: '2026-10-05', submissionOpen: '2026-10-05T00:00:00Z',
    submissionCutoff: '2026-10-05T23:59:59Z', evaluationDate: '2026-10-06',
    publicAt: '2026-10-06T00:00:00Z',
  }
  for (const status of ['stage1', 'published']) {
    const markup = renderSummary({ ...datedRound, status })
    assert.match(markup, /Submission day<\/div><div[^>]*>Oct 5, 2026<\/div>/)
    assert.match(markup, /Evaluation day<\/div><div[^>]*>Oct 6, 2026<\/div>/)
    assert.doesNotMatch(markup, /Day 0|Day 1/)
  }
  const rolloverMarkup = renderSummary({
    ...datedRound, icpSetDate: '2026-12-31', submissionOpen: '2026-12-30T16:00:00-08:00',
    submissionCutoff: '2026-12-31T23:59:59Z', evaluationDate: '2027-01-01',
    publicAt: '2027-01-01T00:00:00Z',
  })
  assert.match(rolloverMarkup, /Submission day<\/div><div[^>]*>Dec 31, 2026<\/div>/)
  assert.match(rolloverMarkup, /Evaluation day<\/div><div[^>]*>Jan 1, 2027<\/div>/)
  const historicalMarkup = renderSummary({ ...datedRound, evaluationDate: '2026-10-09', publicAt: '2026-10-09T18:00:00Z' })
  assert.match(historicalMarkup, /Evaluation day<\/div><div[^>]*>Oct 9, 2026<\/div>/, 'the API evaluation day must take precedence over any next-day assumption')
  const completedBaselineRound = {
    ...activeRound, baseline: { submissionId: 'baseline', minerHotkey: '5baseline', finalScore: 0 },
  }
  const completedBaselineMarkup = renderSummary(completedBaselineRound)
  assert.match(completedBaselineMarkup, /0\.00/)
  assert.match(completedBaselineMarkup, /Baseline evaluated/)
  assert.match(renderSummary({ ...completedBaselineRound, status: 'scored' }), /Evaluations complete. Publication pending/)
  assert.match(completedBaselineMarkup, /Pending/)
  assert.doesNotMatch(completedBaselineMarkup, /Awaiting score|No champion was published/)
  assert.equal(competitionSubmissionStatusLabel({ ...submissions[0], status: 'scored' }, activeRound),
    'Scored · provisional', 'a completed model must not imply a winner or promotion')
  assert.match(finalMarkup, /Promotion margin · \+1\.00 points/)
  assert.match(finalMarkup, /Not required/)
  assert.match(finalMarkup, /No champion was published/)
  assert.match(finalMarkup, /0\.00/, 'a published zero baseline is not pending')
  assert.match(renderSummary(snapshot.latestRound), /Cancelled round/)
  assert.doesNotMatch(renderSummary(snapshot.latestRound), /Decision follows completed evaluation/)
  const championMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.ChampionSummary, { round: currentChampionRound(championSnapshot) }))
  assert.match(championMarkup, /Current champion/)
  assert.match(championMarkup, /5\.75/)
  assert.match(championMarkup, /Published winning score · Oct 7, 2026 · UTC/)
  assert.doesNotMatch(championMarkup, /99\.00|Baseline score/)
  const renderScoreTable = (round, finalScore, selectedId = null) => renderToStaticMarkup(React.createElement(renderedModule.exports.SubmissionTable, {
    submissions: [{ ...submissions[0], submissionId: 'score-label-control', status: 'scored', finalScore }],
    round, selectedId, onSelect: () => {},
  }))
  const provisionalTable = renderScoreTable(activeRound, 0)
  assert.match(provisionalTable, />Provisional score</)
  assert.match(provisionalTable, />0\.00</, 'a provisional zero remains a real score')
  assert.match(provisionalTable, /View evaluation/)
  assert.match(provisionalTable, /aria-expanded="false"/)
  assert.match(renderScoreTable(activeRound, null), />—</, 'missing scores stay missing')
  const publishedTable = renderScoreTable(snapshot.latestCompletedRound, 0, 'score-label-control')
  assert.match(publishedTable, />Score</)
  assert.doesNotMatch(publishedTable, /Provisional score|Scored · provisional/)
  assert.match(publishedTable, /Close evaluation/)
  assert.match(publishedTable, /aria-expanded="true"/)
  assert.doesNotMatch(renderScoreTable(snapshot.latestRound, null), /Provisional score/)
  const noChampionMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.ChampionSummary, { round: null }))
  assert.match(noChampionMarkup, /No promoted champion in published history/)
  assert.doesNotMatch(noChampionMarkup, />0\.00</)
  assert.match(renderToStaticMarkup(React.createElement(renderedModule.exports.ScoreHistoryTooltip, { active: true, payload: [{ payload: { ...history[0], promotionStatus: 'superseded' } }] })), /Superseded/)
  for (const promotionStatus of ['pending', 'promoted']) {
    const markup = renderSummary({ ...snapshot.latestCompletedRound, promotionStatus,
      champion: { submissionId: 'winner', minerHotkey: '5winner', finalScore: 51, outcome: 'new_king' } })
    assert.match(markup, /Champion/)
    assert.match(markup, promotionStatus === 'promoted' ? /Becomes next baseline/ : /Promotion pending/)
    assert.doesNotMatch(markup, /Superseded|was not promoted because a newer evaluation day was published/)
  }

  const supersededRound = normalizeCompetitionSnapshot({
    mode: 'live', network_name: 'finney', netuid: 71,
    rounds: [{ ...published, promotion_status: 'superseded',
      champion: { submission_id: 'winner', miner_hotkey: '5winner', final_score: 51 } }],
  }).rounds[0]
  assert.equal(supersededRound.promotionStatus, 'superseded')
  const supersededMarkup = renderSummary(supersededRound)
  assert.match(supersededMarkup, /Superseded · 51\.00/)
  assert.match(supersededMarkup, /5winner/)
  assert.match(supersededMarkup, /This round’s champion was not promoted because a newer evaluation day was published\./)
  assert.doesNotMatch(supersededMarkup, /Promotion pending|Becomes next baseline/)
  const supersededTableMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.SubmissionTable, {
    submissions: [{ ...champion, submissionId: 'winner', minerHotkey: '5winner', finalScore: 51 }],
    round: supersededRound, selectedId: 'winner', onSelect() {},
  }))
  assert.match(supersededTableMarkup, /Champion · promotion superseded/)
  assert.match(supersededTableMarkup, /51\.00/)
  for (const promotionStatus of [null, 'not_required', 'unknown']) {
    const round = { ...supersededRound, promotionStatus }
    assert.equal(competitionSubmissionStatusLabel(champion, round), 'Champion')
    assert.doesNotMatch(renderSummary(round), /Superseded|was not promoted because a newer evaluation day was published/)
  }

  const attributionSummaryMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.ScoringAttributionSummary, {
    attribution: attributedResults.scoringAttribution,
  }))
  assert.match(attributionSummaryMarkup, /Scored by/)
  assert.match(attributionSummaryMarkup, new RegExp(primaryHotkey))
  assert.match(attributionSummaryMarkup, new RegExp(yumaHotkey))
  assert.match(attributionSummaryMarkup, /12 ICPs · 3 reused/)
  assert.match(attributionSummaryMarkup, /7 ICPs · 1 reused/)
  assert.match(attributionSummaryMarkup, /Unattributed ICPs 1/)
  assert.match(attributionSummaryMarkup, /Commit not recorded for accepted judgments/)
  for (const workingTree of ['unknown', 'clean', 'dirty']) {
    const codeVersionMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.ScoringAttributionSummary, {
      attribution: withVersions([{ ...version, working_tree: workingTree }]).scoringAttribution,
    }))
    assert.match(codeVersionMarkup, /Validator code commits/)
    assert.ok(codeVersionMarkup.includes(`href="https://github.com/leadpoet/leadpoet/commit/${version.commit}"`))
    assert.equal((codeVersionMarkup.match(/Commit not recorded for accepted judgments/g) ?? []).length, 1, 'the second validator still has no recorded commit')
    assert.equal(codeVersionMarkup.includes('local modifications'), workingTree === 'dirty')
    assert.equal(codeVersionMarkup.includes('checkout state unknown'), workingTree === 'unknown')
  }
  const renderCommitCoverage = (positions) => renderToStaticMarkup(React.createElement(renderedModule.exports.ScoringAttributionSummary, {
    attribution: {
      validators: [{ hotkey: primaryHotkey, icpCount: 10, reusedIcpCount: 2 }],
      icps: [], unattributedIcpCount: 0,
      codeVersions: positions.map((icpPositions, index) => ({ validatorHotkey: primaryHotkey, commit: String(index + 1).repeat(40), workingTree: 'clean', icpPositions })),
    },
  }))
  assert.match(renderCommitCoverage([[0, 1, 2, 3, 4, 5, 6, 7]]), /Commit not recorded for 2 ICPs\./, 'partial historical commit coverage must be explicit')
  const overlappingCommitCoverage = renderCommitCoverage([[0, 1, 2, 3, 4], [3, 4, 5, 6, 7]])
  assert.match(overlappingCommitCoverage, /Commit not recorded for 2 ICPs\./, 'overlapping commit positions count once')
  assert.doesNotMatch(overlappingCommitCoverage, /Commit not recorded for accepted judgments/)
  assert.doesNotMatch(renderCommitCoverage([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [0, 1]]), /Commit not recorded/, 'complete union coverage must not show a missing commit count')
  const legacyAttributionMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.ScoringAttributionSummary, {
    attribution: null,
  }))
  assert.match(legacyAttributionMarkup, /Unavailable/)
  assert.doesNotMatch(legacyAttributionMarkup, /Unattributed ICPs 0|None|0 validators/)

  const allPassedChecks = Object.fromEntries(Object.keys(COMPANY_CHECK_LABELS).map((name) => [name, 'passed']))
  const diagnosticRow = (overrides = {}) => ({
    icp_position: 0, company_index: 0, company_name: 'HiddenLayer', qualified: true,
    duplicate_company: false, missing_contact: false, checks: { ...allPassedChecks }, contact_failure: null,
    ...overrides,
  })
  for (const count of [10, 15, 30]) {
    const dynamicRound = normalizeCompetitionSnapshot({
      mode: 'live', network_name: 'finney', netuid: 71,
      rounds: [{ ...published, benchmark_icp_count: count, promotion_margin: 0.5 }],
    }).rounds[0]
    assert.equal(dynamicRound.benchmarkIcpCount, count)
    assert.equal(dynamicRound.promotionMargin, 0.5)
    assert.match(renderSummary(dynamicRound), /Promotion margin · \+0\.50 points/)
    const dynamicBenchmark = normalizeCompetitionBenchmark({
      ...benchmarkPayload, benchmark_icp_count: count, public_icp_count: count,
      icps: Array.from({ length: count }, (_, icp_position) => ({ icp_position, icp_id: `icp-${icp_position}`, prompt: 'Public ICP' })),
    }, dynamicRound)
    assert.equal(dynamicBenchmark?.icps.length, count, `${count} public ICPs must be accepted`)
    assert.equal(dynamicBenchmark?.benchmarkIcpCount, count)
    assert.equal(normalizeCompetitionBenchmark({ ...benchmarkPayload, benchmark_icp_count: count, public_icp_count: count - 1 }, dynamicRound), null)
    assert.equal(normalizeCompetitionBenchmark({ ...benchmarkPayload, public_icp_count: count, icps: dynamicBenchmark.icps }, dynamicRound), null, 'a new round cannot borrow the legacy fallback count')

    const dynamicResultPayload = {
      round_id: dynamicRound.roundId, submission_id: 'miner-1', benchmark_icp_count: count, public_icp_status: 'ready',
      scores: { stage_1: Array.from({ length: count }, (_, icp_position) => ({ icp_position, per_icp_score: 50 })) },
      submission_scores: { final: 50 },
      scoring_attribution: {
        validators: [{ hotkey: primaryHotkey, icp_count: count, reused_icp_count: 0 }],
        icps: [{ icp_position: count - 1, validator_hotkeys: [primaryHotkey], reused_judgment: false }],
        unattributed_icp_count: 0,
      },
      company_diagnostics: [diagnosticRow({ icp_position: count - 1 })],
    }
    const dynamicResult = normalizeCompetitionResults(dynamicResultPayload, dynamicRound)
    assert.equal(dynamicResult?.publicScores.size, count)
    assert.equal(dynamicResult?.scoringAttribution?.icps[0].icpPosition, count - 1)
    assert.equal(dynamicResult?.companyDiagnostics?.[0].icpPosition, count - 1)
    const dynamicMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.PublishedResults, {
      submission: submissions[0], round: dynamicRound, benchmark: dynamicBenchmark, benchmarkState: 'available',
      results: dynamicResult, resultsState: 'available',
    }))
    assert.match(dynamicMarkup, new RegExp(`Public ICPs \\(${count}\\)`))
    const gatedMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.PublishedResults, {
      submission: submissions[0], round: dynamicRound, benchmark: null, benchmarkState: 'gated',
      results: dynamicResult, resultsState: 'available',
    }))
    assert.match(gatedMarkup, new RegExp(`All ${count} ICPs become public`))
    assert.doesNotMatch(gatedMarkup, /Public ICPs \(/, 'a gated round must not reveal its ICP list')
    const { benchmark_icp_count: omittedCount, ...resultWithoutCount } = dynamicResultPayload
    assert.equal(omittedCount, count)
    assert.equal(normalizeCompetitionResults(resultWithoutCount, dynamicRound), null, 'missing new result count cannot become a legacy result')
    assert.equal(normalizeCompetitionResults({ ...dynamicResultPayload, scores: { stage_1: dynamicResultPayload.scores.stage_1.slice(1) } }, dynamicRound), null, 'missing one ready score must fail closed')
    assert.equal(normalizeCompetitionResults({ ...dynamicResultPayload, scores: { stage_1: [...dynamicResultPayload.scores.stage_1.slice(1), { icp_position: count, per_icp_score: 50 }] } }, dynamicRound), null, 'an out-of-range score cannot fill a missing position')
    assert.equal(normalizeCompetitionResults({ ...dynamicResultPayload, company_diagnostics: [diagnosticRow({ icp_position: count })] }, dynamicRound)?.companyDiagnostics, null)
    assert.equal(normalizeCompetitionResults({ ...dynamicResultPayload, scoring_attribution: { ...dynamicResultPayload.scoring_attribution, icps: [{ icp_position: count, validator_hotkeys: [], reused_judgment: false }] } }, dynamicRound)?.scoringAttribution, null)
  }
  const diagnosticResultsPayload = {
    ...attributedResultsPayload,
    company_diagnostics: [
      diagnosticRow({
        company_name: 'Zenskar', qualified: false, missing_contact: true,
        checks: { ...allPassedChecks, contact: 'failed', email: 'not_evaluated' },
      }),
      diagnosticRow({
        company_index: 1, company_name: 'Crusoe', qualified: false,
        checks: { ...allPassedChecks, contact: 'failed', email: 'not_evaluated' }, contact_failure: 'role',
      }),
      diagnosticRow({
        company_index: 2, company_name: 'Forus', qualified: false, missing_contact: true,
        checks: { ...allPassedChecks, employee_size: 'failed', stage: 'unavailable', intent: 'not_evaluated', intent_details: 'not_evaluated', contact: 'not_evaluated', email: 'not_evaluated' },
      }),
      diagnosticRow({ company_index: 3, company_name: 'HiddenLayer', qualified: true }),
    ],
  }
  const diagnosticResults = normalizeCompetitionResults(diagnosticResultsPayload)
  assert.ok(diagnosticResults)
  assert.equal(diagnosticResults.companyDiagnostics.length, 4)
  assert.deepEqual(diagnosticResults.companyDiagnostics[0], {
    icpPosition: 0, companyIndex: 0, companyName: 'Zenskar', qualified: false, duplicateCompany: false,
    missingContact: true, checks: { ...allPassedChecks, contact: 'failed', email: 'not_evaluated' }, contactFailure: null,
  })
  assert.equal(diagnosticResults.companyDiagnostics[1].contactFailure, 'Role')
  assert.equal(diagnosticResults.companyDiagnostics[2].checks.employee_size, 'failed')
  assert.equal(diagnosticResults.companyDiagnostics[2].checks.stage, 'unavailable')
  assert.equal(diagnosticResults.companyDiagnostics[3].qualified, true)
  assert.equal(diagnosticResults.companyDiagnostics[3].checks.email, 'passed')

  const { contact: omittedContact, email: omittedEmail, ...companyOnlyChecks } = allPassedChecks
  assert.equal(omittedContact, 'passed')
  assert.equal(omittedEmail, 'passed')
  const companyOnlyDiagnostic = {
    icp_position: 0, company_index: 0, company_name: 'Acme', qualified: true,
    duplicate_company: false, checks: companyOnlyChecks,
  }
  const companyOnlyResults = normalizeCompetitionResults({
    ...attributedResultsPayload, company_diagnostics: [companyOnlyDiagnostic],
  })
  assert.deepEqual(companyOnlyResults.companyDiagnostics, [{
    icpPosition: 0, companyIndex: 0, companyName: 'Acme', qualified: true,
    duplicateCompany: false, missingContact: null, checks: companyOnlyChecks, contactFailure: null,
  }])
  const renderedCompanyOnlyDiagnostics = renderToStaticMarkup(React.createElement(renderedModule.exports.CompanyDiagnostics, {
    rows: companyOnlyResults.companyDiagnostics,
  }))
  assert.match(renderedCompanyOnlyDiagnostics, /Acme · Qualified/)
  assert.match(renderedCompanyOnlyDiagnostics, /Company identity/)
  assert.match(renderedCompanyOnlyDiagnostics, /Intent Details/)
  assert.doesNotMatch(renderedCompanyOnlyDiagnostics, /Email verification|Missing contact|Contact check stopped|>Contact</)

  const { identity: omittedIdentity, ...missingCompanyCheck } = companyOnlyChecks
  assert.equal(omittedIdentity, 'passed')

  const malformedDiagnosticInputs = [
    [...diagnosticResultsPayload.company_diagnostics, null],
    [...diagnosticResultsPayload.company_diagnostics, diagnosticResultsPayload.company_diagnostics[0]],
    [...diagnosticResultsPayload.company_diagnostics, diagnosticRow({ icp_position: 20 })],
    [...diagnosticResultsPayload.company_diagnostics, diagnosticRow({ checks: { ...allPassedChecks, email: 'unknown' } })],
    [companyOnlyDiagnostic, { ...companyOnlyDiagnostic, company_index: 1, checks: missingCompanyCheck }],
    [{ ...companyOnlyDiagnostic, missing_contact: false }],
    [{ ...companyOnlyDiagnostic, checks: { ...companyOnlyChecks, contact: 'passed', email: 'passed' } }],
    [{ ...companyOnlyDiagnostic, missing_contact: false, checks: { ...companyOnlyChecks, contact: 'passed' } }],
  ]
  for (const companyDiagnostics of malformedDiagnosticInputs) {
    const normalized = normalizeCompetitionResults({ ...attributedResultsPayload, company_diagnostics: companyDiagnostics })
    assert.ok(normalized, 'malformed diagnostics must not discard valid scores')
    assert.equal(normalized.companyDiagnostics, null, 'malformed diagnostics must render as unavailable')
  }
  const maliciousDiagnostic = diagnosticRow({
    raw_extra: 'do-not-render', checks: { ...allPassedChecks, raw_extra: 'do-not-render' },
  })
  const sanitizedDiagnosticResults = normalizeCompetitionResults({ ...attributedResultsPayload, company_diagnostics: [maliciousDiagnostic] })
  assert.ok(sanitizedDiagnosticResults)
  assert.equal(Object.hasOwn(sanitizedDiagnosticResults.companyDiagnostics[0], 'raw_extra'), false)
  assert.equal(Object.hasOwn(sanitizedDiagnosticResults.companyDiagnostics[0].checks, 'raw_extra'), false)

  const emptyDiagnosticsResults = normalizeCompetitionResults({ ...attributedResultsPayload, company_diagnostics: [] })
  const missingDiagnosticsResults = normalizeCompetitionResults(attributedResultsPayload)
  assert.deepEqual(emptyDiagnosticsResults.companyDiagnostics, [], 'an explicit empty diagnostics list is distinct from missing diagnostics')
  assert.equal(missingDiagnosticsResults.companyDiagnostics, null, 'missing diagnostics remain unavailable')
  const renderedCompanyDiagnostics = renderToStaticMarkup(React.createElement(renderedModule.exports.CompanyDiagnostics, {
    rows: diagnosticResults.companyDiagnostics,
  }))
  assert.match(renderedCompanyDiagnostics, /Zenskar · Not qualified · Missing contact/)
  assert.match(renderedCompanyDiagnostics, /Contact check stopped at: Role\./)
  assert.match(renderedCompanyDiagnostics, /Email verification/)
  assert.match(renderedCompanyDiagnostics, /Not evaluated/)
  assert.match(renderedCompanyDiagnostics, /Company size/)
  assert.match(renderedCompanyDiagnostics, /Failed/)
  assert.match(renderedCompanyDiagnostics, /Could not verify/)
  assert.match(renderedCompanyDiagnostics, /HiddenLayer · Qualified/)
  assert.doesNotMatch(renderedCompanyDiagnostics, /do-not-render/)
  assert.match(renderToStaticMarkup(React.createElement(renderedModule.exports.CompanyDiagnostics, { rows: [] })), /No company checks were recorded/)
  assert.match(renderToStaticMarkup(React.createElement(renderedModule.exports.CompanyDiagnostics, { rows: null })), /Company checks are unavailable/)

  const gatedDiagnosticsMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.PublishedResults, {
    submission: submissions[0], round: pendingRound, benchmark: null, benchmarkState: 'gated',
    results: diagnosticResults, resultsState: 'available',
  }))
  assert.doesNotMatch(gatedDiagnosticsMarkup, /Zenskar|Crusoe|Forus|HiddenLayer/)
  const unpublishedResults = normalizeCompetitionResults({ ...diagnosticResultsPayload, public_icp_status: 'pending' })
  const completedBaselineResults = renderToStaticMarkup(React.createElement(renderedModule.exports.PublishedResults, {
    submission: { ...submissions[0], isBaseline: true, finalScore: diagnosticResults.finalScore },
    round: activeRound, benchmark, benchmarkState: 'available',
    results: diagnosticResults, resultsState: 'available',
  }))
  assert.match(completedBaselineResults, /Zenskar|HiddenLayer/,
    'a completed baseline exposes its diagnostics while the round is still active')
  assert.match(completedBaselineResults, /Evaluation results/)
  assert.doesNotMatch(completedBaselineResults, /This model’s score and diagnostics appear/)
  const incompleteBaselineResults = renderToStaticMarkup(React.createElement(renderedModule.exports.PublishedResults, {
    submission: { ...submissions[0], isBaseline: true, finalScore: null },
    round: activeRound, benchmark, benchmarkState: 'available', results: null, resultsState: 'gated',
  }))
  assert.match(incompleteBaselineResults, /This model’s score and diagnostics appear/)
  assert.doesNotMatch(incompleteBaselineResults, /Zenskar|HiddenLayer/)
  assert.equal(unpublishedResults.companyDiagnostics, null)
  const unpublishedDiagnosticsMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.PublishedResults, {
    submission: submissions[0], round: pendingRound, benchmark, benchmarkState: 'available',
    results: unpublishedResults, resultsState: 'available',
  }))
  assert.doesNotMatch(unpublishedDiagnosticsMarkup, /Zenskar|Crusoe|Forus|HiddenLayer/)

  const attributionIcpMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.IcpList, {
    title: 'Public ICPs (20)', icpSetDate: benchmark.icpSetDate, icps: benchmark.icps.slice(0, 3),
    scores: attributedResults.publicScores, scoringAttribution: attributedResults.scoringAttribution,
  }))
  assert.match(attributionIcpMarkup, /Scored by/)
  assert.match(attributionIcpMarkup, /Reused judgment/)
  assert.match(attributionIcpMarkup, /Yes/)
  assert.match(attributionIcpMarkup, /Not judged/, 'a zero execution failure without an accepted judgment must not name a validator')
  assert.match(attributionIcpMarkup, /Unavailable/, 'accepted attribution metadata with empty hotkeys must remain explicitly unavailable')
  assert.match(attributionIcpMarkup, new RegExp(primaryHotkey))
  assert.match(attributionIcpMarkup, new RegExp(yumaHotkey))
  const gatedAttributionMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.PublishedResults, {
    submission: submissions[0], round: { ...pendingRound, status: 'stage1' }, benchmark: null,
    benchmarkState: 'gated', results: attributedResults, resultsState: 'available',
  }))
  assert.match(gatedAttributionMarkup, /Scored by/)
  assert.match(gatedAttributionMarkup, new RegExp(primaryHotkey), 'aggregate attribution must remain public before ICP disclosure')
  assert.match(gatedAttributionMarkup, /All 20 ICPs become public/)
  assert.doesNotMatch(gatedAttributionMarkup, /Public ICP/, 'per-ICP content must remain hidden before disclosure')

  // Public Madara status on September 16, reduced to the fields needed to
  // verify the new public-list projection and miner-facing copy.
  const madaraFixture = JSON.parse(await readFile(resolve('scripts/fixtures/competition-madara-review-failure-20260916.json'), 'utf8'))
  const [madaraReviewFailure] = normalizeCompetitionSubmissions({ submissions: [{
    submission_id: madaraFixture.public_status.submission_id,
    miner_hotkey: '5MadaraMiner',
    is_baseline: false,
    status: madaraFixture.expected_public_list_status,
    submitted_at: '2026-09-15T03:48:00Z',
    stage1_score: 72,
    final_score: 81,
    is_champion: true,
    code: { available: true, available_at: '2026-09-16T00:44:44Z', url: '/must-not-render' },
    code_review: {
      ...madaraFixture.public_status.code_review,
      provider_http_status: null,
      attempts: 3,
    },
  }] })
  assert.equal(madaraReviewFailure.status, 'review_failed')
  assert.equal(madaraReviewFailure.stage1Score, null, 'review exclusion must fail closed over an inconsistent upstream score')
  assert.equal(madaraReviewFailure.finalScore, null, 'review exclusion must never render a fake or stale score')
  assert.equal(madaraReviewFailure.isChampion, false, 'review exclusion must never imply a winning outcome')
  assert.deepEqual(madaraReviewFailure.code, { available: false, availableAt: null, url: null })
  assert.deepEqual(madaraReviewFailure.codeReview, {
    status: 'error', errorCode: 'code_review_provider_unavailable', providerHttpStatus: null,
    retryable: null, attempts: 3,
  })
  assert.equal('costStatus' in madaraReviewFailure.codeReview, false, 'internal review cost state must not enter the UI model')
  assert.equal(isCompetitionReviewExcluded(madaraReviewFailure), true)
  assert.equal(competitionSubmissionStatusLabel(madaraReviewFailure, pendingRound), 'Code review could not complete')
  assert.equal(
    competitionSubmissionEvaluationNotice(madaraReviewFailure, pendingRound),
    'Code review could not complete. This submission was not evaluated.',
  )

  const reviewRejected = { ...madaraReviewFailure, status: 'review_rejected' }
  assert.equal(competitionSubmissionStatusLabel(reviewRejected, pendingRound), 'Code review rejected')
  assert.equal(
    competitionSubmissionEvaluationNotice(reviewRejected, pendingRound),
    'Code review rejected. This submission was not evaluated.',
  )
  const normalizePendingReview = (codeReview) => normalizeCompetitionSubmissions({ submissions: [{
    submission_id: 'pending-review', miner_hotkey: '5Pending', status: 'queued',
    is_baseline: false, stage1_score: null, final_score: null, is_champion: false,
    code: { available: false, available_at: null, url: null }, code_review: codeReview,
  }] })[0]
  const authPending = normalizePendingReview({ status: 'error', error_code: 'code_review_provider_authentication', provider_http_status: 401, attempts: 1 })
  const creditPending = normalizePendingReview({ status: 'error', error_code: 'code_review_provider_credit', provider_http_status: 402, attempts: 1 })
  const retryingPending = normalizePendingReview({ status: 'error', error_code: 'code_review_provider_rate_limited', provider_http_status: 429, retryable: true, attempts: 2 })
  const legacyPending = normalizePendingReview({ status: 'error', error_code: 'code_review_provider_unavailable' })
  const reviewingWithStaleError = normalizePendingReview({ status: 'reviewing', error_code: 'code_review_provider_unavailable', provider_http_status: 503, retryable: true, attempts: 2 })
  const passedWithStaleError = normalizePendingReview({ status: 'passed', error_code: 'code_review_provider_authentication', provider_http_status: 401, retryable: true, attempts: 2 })
  assert.equal(competitionSubmissionStatusLabel(authPending, pendingRound), 'Provider credential error')
  assert.equal(competitionSubmissionStatusLabel(creditPending, pendingRound), 'Insufficient provider credit')
  assert.equal(competitionSubmissionStatusLabel(retryingPending, pendingRound), 'Code review unavailable · retrying')
  assert.equal(competitionSubmissionStatusLabel(legacyPending, pendingRound), 'Code review unavailable')
  assert.doesNotMatch(competitionSubmissionStatusLabel(legacyPending, pendingRound), /credential|retrying/i, 'legacy generic failures must not invent a cause or retry state')
  assert.equal(competitionSubmissionStatusLabel(reviewingWithStaleError, pendingRound), 'Code review in progress')
  assert.equal(competitionSubmissionStatusLabel(passedWithStaleError, pendingRound), 'Queued for validation')
  assert.equal(competitionSubmissionEvaluationNotice(passedWithStaleError, pendingRound), null, 'a passed review must ignore an old error document')

  const reviewRowsMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.SubmissionTable, {
    submissions: [madaraReviewFailure, reviewRejected, authPending, creditPending, retryingPending, legacyPending],
    round: pendingRound, selectedId: madaraReviewFailure.submissionId, onSelect() {},
  }))
  assert.match(reviewRowsMarkup, /Code review could not complete/)
  assert.match(reviewRowsMarkup, /Code review rejected/)
  assert.match(reviewRowsMarkup, /Provider credential error/)
  assert.match(reviewRowsMarkup, /Insufficient provider credit/)
  assert.match(reviewRowsMarkup, /Code review unavailable · retrying/)
  assert.doesNotMatch(reviewRowsMarkup, />0\.00</, 'review failures must not render a zero score')
  const reviewResultsMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.PublishedResults, {
    submission: madaraReviewFailure, round: pendingRound, benchmark, benchmarkState: 'available', results: null, resultsState: 'idle',
  }))
  assert.match(reviewResultsMarkup, /This submission was not evaluated/)
  assert.doesNotMatch(reviewResultsMarkup, /provider_unavailable|cost_status|uncertain|72\.00|81\.00/)
  const reviewSourceMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.SourcePanel, {
    submission: madaraReviewFailure, cancelled: false, code: null, codeState: 'idle', selectedFile: null,
    onSelectFile() {}, onRequest() {},
  }))
  assert.match(reviewSourceMarkup, /Source was not published because this submission was not evaluated/)
  assert.doesNotMatch(reviewSourceMarkup, /View source|Source locked|Awaiting source release/)

  // Public September 12 state, reduced to fields needed for status rendering.
  const credentialFixture = JSON.parse(await readFile(resolve('scripts/fixtures/competition-credential-error-20260912.json'), 'utf8'))
  const submissionsRouteSource = await readFile(resolve('src/app/api/research-lab/rounds/[roundId]/submissions/route.ts'), 'utf8')
  const proxySource = await readFile(resolve('src/lib/arena-public-proxy.ts'), 'utf8')
  async function projectSubmissions(detail = credentialFixture.failed_result, detailStatus = 200, input = credentialFixture.submissions, expectedCalls = 2) {
    const calls = []
    const proxyModule = { exports: {} }
    vm.runInNewContext(ts.transpileModule(proxySource, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, {
      module: proxyModule, exports: proxyModule.exports, require, process: { env: {} }, AbortSignal,
      fetch: async (url, options) => {
        calls.push(url)
        assert.equal(options.cache, 'no-store')
        assert.equal(options.method ?? 'GET', 'GET', 'status lookup must be read-only')
        return url.endsWith('/submissions')
          ? Response.json(input)
          : Response.json(detail, { status: detailStatus })
      },
    })
    const routeModule = { exports: {} }
    vm.runInNewContext(ts.transpileModule(submissionsRouteSource, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, {
      module: routeModule, exports: routeModule.exports,
      require: (name) => name === '@/lib/arena-public-proxy' ? proxyModule.exports
        : name === '@/lib/research-lab-competition' ? { normalizeCompetitionSubmissions } : require(name),
    })
    const response = await routeModule.exports.GET(null, { params: Promise.resolve({ roundId: credentialFixture.submissions.round_id }) })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0, must-revalidate')
    assert.deepEqual(calls, [
      `${credentialFixture.source}/submissions`,
      `${credentialFixture.source}/results/${credentialFixture.failed_result.submission_id}`,
    ].slice(0, expectedCalls), 'only legacy failures without a displayed reason need a detail lookup')
    return response.json()
  }
  const detailedFailures = {
    ...credentialFixture.submissions,
    submissions: Array.from({ length: 145 }, (_, index) => ({
      ...credentialFixture.submissions.submissions.find((row) => row.status === 'scoring_failed'),
      submission_id: `failed-${index}`,
      evaluation: { state: 'failed', validators: [], failure_reasons: [['provider_credentials'], ['execution_window'], ['provider'], ['execution'], ['review'], ['unknown', 'execution']][index % 6] },
    })),
  }
  assert.deepEqual(await projectSubmissions(undefined, 200, detailedFailures, 1), detailedFailures,
    '145 failures with authoritative reasons need one upstream read and preserve all public fields')
  for (const reasons of [[], ['unknown'], ['future_reason']]) {
    const legacy = structuredClone(credentialFixture.submissions)
    legacy.submissions.find((row) => row.status === 'scoring_failed').evaluation = {
      state: 'failed', validators: [], failure_reasons: reasons,
    }
    const fallback = await projectSubmissions(undefined, 200, legacy)
    assert.equal(fallback.submissions.find((row) => row.status === 'scoring_failed').failure_reason, 'credential_error',
      'unknown and unsupported reasons retain the verified legacy fallback')
  }
  const projected = await projectSubmissions()
  const liveSubmissions = normalizeCompetitionSubmissions(projected)
  const failedSubmission = liveSubmissions.find((row) => row.submissionId === credentialFixture.failed_result.submission_id)
  assert.equal(failedSubmission.status, 'scoring_failed', 'the competition status must stay unchanged')
  assert.equal(failedSubmission.finalScore, null)
  assert.equal(competitionSubmissionStatusLabel(failedSubmission, credentialFixture.round), 'Provider access failed')
  for (let index = 0; index < projected.submissions.length; index++) {
    const { failure_reason, ...unchanged } = projected.submissions[index]
    assert.deepEqual(unchanged, credentialFixture.submissions.submissions[index], 'scores, code access, and other submission fields stay unchanged')
    if (liveSubmissions[index] !== failedSubmission) {
      assert.equal(failure_reason, undefined)
      assert.equal(competitionSubmissionStatusLabel(liveSubmissions[index], credentialFixture.round), liveSubmissions[index].isBaseline ? 'Scored' : 'Scored · not promoted')
    }
  }
  const tableMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.SubmissionTable, {
    submissions: liveSubmissions, round: credentialFixture.round, selectedId: failedSubmission.submissionId, onSelect() {},
  }))
  assert.match(tableMarkup, /Provider access failed/)
  assert.doesNotMatch(tableMarkup, /Scoring failed/)
  const renderFailedResults = (submission) => renderToStaticMarkup(React.createElement(renderedModule.exports.PublishedResults, {
    submission, round: credentialFixture.round, benchmark, benchmarkState: 'available', results: null, resultsState: 'error',
  }))
  assert.match(renderFailedResults(failedSubmission), /Provider access failed\. No complete evaluation score is available\./)
  assert.doesNotMatch(renderFailedResults(failedSubmission), />0\.00</, 'failed-run placeholders must remain hidden')
  for (const [detail, status] of [
    [{ error: 'temporarily unavailable' }, 503],
    [{ ...credentialFixture.failed_result, round_id: 'different-round' }, 200],
    [{ ...credentialFixture.failed_result, submission_id: 'different-submission' }, 200],
    [{ ...credentialFixture.failed_result, run_results: [null, { terminal_status: 'provider_error' }, { terminal_status: 'model_error' }] }, 200],
    [{ ...credentialFixture.failed_result, run_results: null }, 200],
  ]) {
    const fallback = await projectSubmissions(detail, status)
    assert.deepEqual(fallback, credentialFixture.submissions, 'unverified and other failures keep the original projection')
    const submission = normalizeCompetitionSubmissions(fallback).find((row) => row.submissionId === failedSubmission.submissionId)
    assert.equal(competitionSubmissionStatusLabel(submission, credentialFixture.round), 'Evaluation failed')
    assert.match(renderFailedResults(submission), /Evaluation failed\. No complete evaluation score is available\./)
  }
  for (const status of ['queued', 'running', 'accepted', 'failed', 'scored', 'champion', 'cancelled', 'not_selected']) {
    for (const isBaseline of [false, true]) {
      for (const promotionStatus of ['pending', 'promoted', 'superseded', 'not_required']) {
        const submission = { ...submissions[0], status, isBaseline }
        const round = { ...pendingRound, promotionStatus }
        assert.equal(competitionSubmissionStatusLabel({ ...submission, failureReason: 'credential_error' }, round), competitionSubmissionStatusLabel(submission, round), `${status} must not inherit a historical credential failure`)
      }
    }
  }
  assert.doesNotMatch(component, /if \(!competition\) return/, 'an Arena outage must render its retry state')
  assert.match(component, /https:\/\/github\.com\/leadpoet\/champion_model/); assert.match(component, /Top Sales Agent Model/)
  assert.match(component, /Competition data is temporarily unavailable\. This page will retry automatically\./)
  assert.doesNotMatch(component, /settlement|LabEmissionSplit|\/api\/research-lab\?/)
  assert.match(component, /const selectedRound = roundOptions\[0\] \?\? null/, 'the displayed round must follow the automatic priority order on every refresh')
  assert.ok(component.indexOf('<ChampionSummary') < component.indexOf('<RoundSummary'), 'champion headline is separate from the active round')
  assert.doesNotMatch(component, /selectedRoundId|setSelectedRoundId|onSelectRound|roundOptionLabel|Competition round/, 'manual round selection must remain absent')
  assert.match(component, /Public ICPs \(\$\{benchmark\.benchmarkIcpCount\}\)/)
  assert.match(component, /Open-source sales intelligence\./)
  assert.doesNotMatch(component, /server-held .* evaluation view/)
  assert.match(component, /response\.status === 403/)
  assert.match(component, /icp\.position/)
  assert.match(component, /publicIcpStatus !== 'ready'/)
  assert.match(component, /useVisiblePolling\(refreshRound, 60_000, \{ enabled: active \}\)/)
  assert.match(component, /selectedSubmissionIdRef\.current !== requestedSubmissionId/)
  assert.match(component, /if \(!inspectionOpen \|\| !selectedSubmissionId \|\| reviewExcluded\) return/, 'terminal review failures must not request a result')
  assert.ok(component.indexOf('if (!inspectionOpen || !selectedSubmissionId || reviewExcluded) return') < component.indexOf('fetchReleasedJson(`/api/research-lab/rounds/${encodeURIComponent(requestedRoundId)}/results/'), 'the review exclusion gate must run before the result request')
  assert.match(component, /Last known submissions are shown below/)
  assert.match(component, /normalized\?\.roundId !== requestedRoundId/)
  assert.match(component, /This round was cancelled\. Aggregate and per-ICP scores were not published\./)
  assert.match(component, /This round was cancelled\. Source code was not published\./)
  assert.match(component, /This model’s score and diagnostics appear when its evaluation and cost checks are complete\./)
  assert.match(component, /<PendingIcpResults benchmark=\{benchmark\}>/)
  assert.match(component, /if \(submission\.status === 'scoring_failed'\) return <PendingIcpResults benchmark=\{benchmark\}>\{competitionSubmissionStatusLabel\(submission, round\)\}\. No complete evaluation score is available\./, 'failed-run zero placeholders must not render as completed per-ICP evaluations')
  assert.ok(component.indexOf("if (submission.status === 'scoring_failed')") < component.indexOf('const scores = submission.isBaseline'), 'failure status must gate baseline score rendering too')
  assert.doesNotMatch(component, /24.hour|24 hours|private ICP/i)
  assert.match(component, /Submission day/)
  assert.match(component, /Evaluation day/)
  assert.doesNotMatch(component, /Day 0|Day 1/)
  assert.match(component, /const submissionDate = utcCalendarDate\(round\.submissionOpen\) \?\? round\.icpSetDate/)
  assert.match(component, /Available after evaluation and cost checks\./)
  assert.doesNotMatch(component, /label="Round baseline"|label="Round status"|SummaryMetric/, 'summary must not repeat its score and status in metric cards')
  assert.match(component, /ICP set · \{formatUtcDate\(icpSetDate\)\}/)
  assert.match(component, /normalizeCompetitionBenchmark\(response\.body, \{ roundId, icpSetDate, publicAt, benchmarkIcpCount \}\)/)
  assert.match(component, /Some files are omitted from this preview\./)
  assert.match(component, /promotionStatus === 'promoted'[^]*Becomes next baseline/)
  assert.match(component, /promotionStatus === 'pending'[^]*Promotion pending/)
  assert.doesNotMatch(component, /slice\(10/)
  assert.doesNotMatch(component, /More 10 ICPs/)
  assert.doesNotMatch(component, />Stage 1</)
  assert.doesNotMatch(component, /outputs|run_results|judge_evidence/)

  const proxy = await readFile(resolve('src/lib/arena-public-proxy.ts'), 'utf8')
  assert.match(proxy, /PUBLIC_ID/)
  assert.match(proxy, /cache: 'no-store'/)
  assert.match(proxy, /AbortSignal\.timeout\(timeoutMs\)/)
  const codeRoute = await readFile(resolve('src/app/api/research-lab/submissions/[submissionId]/code/route.ts'), 'utf8')
  assert.match(codeRoute, /publicArenaId/)
  assert.match(codeRoute, /encodeURIComponent\(submissionId\)/)

  const shell = await readFile(resolve('src/components/dashboard/DashboardClient.tsx'), 'utf8')
  assert.match(shell, /label="Competition"/)
  const faq = await readFile(resolve('src/components/dashboard/FAQ.tsx'), 'utf8')
  assert.doesNotMatch(faq, /24.hour|24 hours|keeps the complementary|fixed 10-ICP/i)

  console.log('research-lab-competition: public projection, honest scores, release gates, and narrow proxy checks passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
