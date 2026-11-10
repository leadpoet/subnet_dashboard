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
    competitionRoundOutcome,
    competitionSubmissionPromotionGap,
    compareCompetitionSubmissions,
    formatCompetitionScorePrecise,
    normalizeCompetitionCurrentRound,
    competitionSubmissionEvaluationNotice,
    competitionSubmissionStatusLabel,
    competitionRoundOptions,
    competitionChampionHistory,
    formatCompetitionScore,
    currentChampionRound,
    latestChampionScore,
    competitionSubmissionMiner,
    normalizeCompetitionBenchmark,
    normalizeCompetitionCode,
    normalizeCompetitionResults,
    normalizeCompetitionHistory,
    normalizeCompetitionSnapshot,
    normalizeCompetitionRewardSeats,
    competitionRewardSeatReductions,
    formatRewardSeatShare,
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
    publishedAt: `${date}T18:00:00Z`, submissionCutoff: `${date}T00:00:00Z`, baseline: { submissionId: 'baseline', minerHotkey: '5baseline', finalScore: 99 },
    champion: { submissionId: `winner-${date}`, minerHotkey: '5winner', finalScore, outcome: 'new_king' }, promotionStatus: 'promoted',
    ...overrides,
  })
  const historySnapshot = (rounds, refs = {}) => ({ ...snapshot, rounds, latestRound: null, latestCompletedRound: null, openRound: null, ...refs })
  assert.deepEqual(competitionChampionHistory(historySnapshot([])), [])
  const canonical = historyRound('2026-09-05', 0, { baseline: { submissionId: 'baseline', minerHotkey: '5baseline', finalScore: 0 } })
  const history = competitionChampionHistory(historySnapshot([
    historyRound('2026-09-10', 4.633, { baseline: { submissionId: 'baseline', minerHotkey: '5baseline', finalScore: null } }), historyRound('2026-09-06', null), canonical,
    historyRound('2026-09-07', 80, { status: 'cancelled' }),
    historyRound('2026-09-08', 70, { status: 'stage2' }),
    historyRound('2026-09-09', 60, { status: 'scoring_failed' }),
    historyRound(null, 90), historyRound('2026-02-30', 90),
  ], { latestCompletedRound: { ...canonical, champion: { ...canonical.champion, finalScore: 99 } } }))
  assert.deepEqual(history.map((point) => point.evaluationDate), ['2026-09-05', '2026-09-10'], 'history sorts valid UTC evaluation dates and plots only days with a published score')
  assert.deepEqual(history.map((point) => point.score), [0, 4.633], 'true zero is retained; pending, failed, cancelled and missing scores are not plotted')
  assert.deepEqual(history.map((point) => point.baselineScore), [0, null], 'baseline scores follow the same published evaluation day while missing values and zero stay distinct')
  assert.deepEqual(history.map((point) => point.newChampion), [true, true], 'only promoted winners mark a new champion')
  assert.ok(!history.some((point) => point.evaluationDate === '2026-09-06'), 'a promoted winner with a missing score never falls back to the defending champion score')
  assert.equal(history[0].timestamp, Date.parse('2026-09-05T00:00:00Z'))
  assert.equal(history[0].roundId, canonical.roundId, 'canonical history wins over stale round references')
  assert.equal(competitionChampionHistory(historySnapshot([canonical, canonical])).length, 1, 'duplicate references do not add chart points')
  assert.equal(competitionChampionHistory(historySnapshot([], { latestCompletedRound: canonical }))[0].score, 0, 'a published canonical reference outside the history list is included')
  const laterRelease = historyRound('2026-09-05', 2, { roundId: 'arena-rerun', publishedAt: '2026-09-05T20:00:00Z' })
  assert.equal(competitionChampionHistory(historySnapshot([laterRelease, canonical]))[0].score, 2, 'a repeated evaluation day uses the latest published release regardless of input order')
  const baselineRerun = historyRound('2026-09-05', 2, { roundId: 'arena-rerun', publishedAt: '2026-09-05T20:00:00Z', baseline: { submissionId: 'baseline', minerHotkey: '5baseline', finalScore: 23 } })
  assert.equal(competitionChampionHistory(historySnapshot([baselineRerun, canonical]))[0].baselineScore, 23, 'same-day baseline uses the same latest published release as its champion score')
  assert.equal(competitionChampionHistory(historySnapshot([
    laterRelease, historyRound('2026-09-05', 3, { roundId: 'offset-release', publishedAt: '2026-09-05T17:00:00-04:00' }),
  ]))[0].score, 3, 'release ordering compares UTC instants rather than timestamp strings')
  const month = Array.from({ length: 26 }, (_, day) => historyRound(`2026-09-${String(day + 5).padStart(2, '0')}`, day))
  const fullHistory = competitionChampionHistory(historySnapshot(month))
  assert.equal(fullHistory.length, 26, 'chart covers every published day from the first published score, not a recent window')
  assert.equal(fullHistory[0].evaluationDate, '2026-09-05')
  assert.equal(fullHistory.at(-1).score, 25)
  const unscoredStart = historyRound('2026-09-01', null, { champion: null, promotionStatus: 'not_required', baseline: { submissionId: 'baseline', minerHotkey: '5baseline', finalScore: null } })
  assert.equal(competitionChampionHistory(historySnapshot([unscoredStart, canonical]))[0].evaluationDate, '2026-09-05', 'chart starts at the first published score')
  assert.deepEqual(competitionChampionHistory(historySnapshot([unscoredStart])), [], 'published rounds without any score leave the chart empty')
  const latePromotion = historyRound('2026-10-01', 40, { publishedAt: '2026-10-02T07:55:00Z' })
  const lateHistory = competitionChampionHistory(historySnapshot([
    latePromotion, historyRound('2026-10-02', 30, { champion: null, promotionStatus: 'not_required' }),
    historyRound('2026-10-03', 30, { champion: null, promotionStatus: 'not_required' }),
  ]))
  assert.deepEqual(lateHistory.map((point) => point.score), [40, 99, 99], 'every published day plots the score its defending champion actually earned')
  assert.deepEqual(lateHistory.map((point) => point.championNotRerun), [false, false, false], 'publication times never imply which champion defended')
  assert.deepEqual(lateHistory.map((point) => point.championHotkey), ['5winner', null, null], 'a held day the gateway does not name stays unnamed')
  const namedDefender = { submissionId: 'winner-2026-09-28', minerHotkey: '5older' }
  const gatewayHistory = competitionChampionHistory(historySnapshot([
    historyRound('2026-10-01', 40),
    historyRound('2026-10-02', 30, { champion: null, promotionStatus: 'not_required', defendingChampion: namedDefender }),
    historyRound('2026-10-03', 30, { champion: null, promotionStatus: 'not_required', defendingChampion: { submissionId: 'winner-2026-10-01', minerHotkey: '5winner' } }),
  ]))
  assert.deepEqual(gatewayHistory.map((point) => point.championNotRerun), [false, true, false], 'a named defender older than the latest promotion is a previous champion')
  assert.deepEqual(gatewayHistory.map((point) => point.championHotkey), ['5winner', '5older', '5winner'], 'each day names the champion that actually ran')
  const lateCrowning = competitionChampionHistory(historySnapshot([latePromotion, historyRound('2026-10-02', 50)]))
  assert.deepEqual(lateCrowning.map((point) => point.score), [40, 50], 'a crowning day after a late promotion shows its winner')
  assert.equal(lateCrowning[1].championNotRerun, false)
  const rolloverHistory = competitionChampionHistory(historySnapshot([historyRound('2026-12-31', 1), historyRound('2027-01-02', 2)]))
  assert.deepEqual(rolloverHistory.map((point) => point.evaluationDate), ['2026-12-31', '2027-01-02'], 'history crosses UTC year boundaries without a local-time shift')
  assert.deepEqual(rolloverHistory.map((point) => point.timestamp), [Date.parse('2026-12-31T00:00:00Z'), Date.parse('2027-01-02T00:00:00Z')])

  const promoted = historyRound('2026-10-07', 5.75)
  const inProgress = historyRound('2026-10-08', 88, { status: 'stage2' })
  const defendedBy = { defendingChampion: { submissionId: promoted.champion.submissionId, minerHotkey: '5winner' } }
  const pending = historyRound('2026-10-09', 90, { promotionStatus: 'pending', ...defendedBy })
  const superseded = historyRound('2026-10-10', 95, { promotionStatus: 'superseded', ...defendedBy })
  const held = historyRound('2026-10-11', null, { champion: null, promotionStatus: 'not_required', ...defendedBy })
  const championSnapshot = historySnapshot([held, superseded, pending, inProgress, promoted], { latestRound: inProgress, latestCompletedRound: held })
  assert.equal(currentChampionRound(championSnapshot)?.roundId, promoted.roundId, 'active, pending, superseded and no-winner rounds cannot replace the reigning champion')
  assert.equal(currentChampionRound(championSnapshot)?.champion.finalScore, 5.75, 'headline uses winning score instead of a subsequent baseline evaluation')
  assert.equal(currentChampionRound(historySnapshot([canonical]))?.champion.finalScore, 0, 'zero is a valid winning score')
  assert.equal(currentChampionRound(historySnapshot([], { latestCompletedRound: promoted }))?.roundId, promoted.roundId, 'include published references outside history')
  assert.equal(currentChampionRound(historySnapshot([promoted], { latestCompletedRound: { ...promoted, champion: { ...promoted.champion, finalScore: 99 } } }))?.champion.finalScore, 5.75, 'canonical record wins over a stale reference')
  const missingChampionScore = historyRound('2026-10-12', null)
  assert.equal(currentChampionRound(historySnapshot([promoted, missingChampionScore]))?.champion.finalScore, null, 'a newer promoted champion with a missing score must not inherit the old champion score')
  assert.equal(currentChampionRound(historySnapshot([historyRound(null, 99)])), null, 'unknown evaluation dates must not displace the current champion')
  const championHistory = competitionChampionHistory(championSnapshot)
  assert.deepEqual(championHistory.map((point) => point.score), [5.75, 99, 99, 99], 'each published day shows the champion score: the promoted winner on its day, otherwise the defending champion; unfinished rounds are not plotted')
  assert.deepEqual(championHistory.map((point) => point.newChampion), [true, false, false, false], 'pending, superseded and no-winner days never crown a new champion')
  assert.deepEqual(championHistory.map((point) => point.challengerScore), [null, 90, 95, null], 'unpromoted winners stay visible as challengers')
  assert.equal(championHistory[0].championHotkey, '5winner')
  assert.deepEqual(championHistory.map((point) => point.championHotkey), ['5winner', '5winner', '5winner', '5winner'], 'held days name the champion the gateway reports')
  const latest = latestChampionScore(currentChampionRound(championSnapshot), championHistory)
  assert.deepEqual([latest.evaluationDate, latest.score, latest.newChampion], ['2026-10-11', 99, false], 'the headline uses the champion’s latest daily score')
  assert.equal(latestChampionScore(promoted, competitionChampionHistory(historySnapshot([promoted]))).score, 5.75, 'a champion without a later day keeps its winning score')
  const olderLatest = competitionChampionHistory(historySnapshot([promoted, { ...held, defendingChampion: namedDefender }]))
  assert.equal(latestChampionScore(promoted, olderLatest).evaluationDate, '2026-10-07', 'a day run by an older champion is not the current champion’s score')
  assert.equal(latestChampionScore(null, championHistory), null)
  assert.equal(championHistory.at(-2).promotionStatus, 'superseded', 'history preserves promotion outcome for tooltip context')

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
    status: null, errorCode: null, failureReason: null, providerHttpStatus: null, retryable: null, attempts: null, admissionReason: null, categories: [],
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

  // Published Oct10 Tyche: seven stored scores, three unjudged ICPs, no aggregate.
  const partialPublishedPayload = {
    round_id: 'arena-2026-10-10', submission_id: 'sub-897a3b2e85aa7a7d57d3f0e34d48b9c6',
    benchmark_icp_count: 10, score_status: 'published', public_icp_status: 'ready',
    scores: { stage_1: [], stage_2: [0, 45.5, 0, 0, 0, 0, 35.75].map((per_icp_score, icp_position) => ({ icp_position, per_icp_score })) },
    submission_scores: { stage_1: null, final: null },
  }
  const partialPublished = normalizeCompetitionResults(partialPublishedPayload)
  assert.ok(partialPublished)
  assert.equal(partialPublished.finalScore, null)
  assert.equal(partialPublished.stage1Score, null)
  assert.deepEqual([...partialPublished.publicScores], [[0, 0], [1, 45.5], [2, 0], [3, 0], [4, 0], [5, 0], [6, 35.75]])
  for (const position of [7, 8, 9]) assert.equal(partialPublished.publicScores.has(position), false, 'unjudged ICPs must remain missing')
  for (const submissionScores of [{ final: 0, stage_1: null }, { final: null, stage_1: 50 }, { stage_1: null }]) {
    assert.equal(normalizeCompetitionResults({ ...partialPublishedPayload, submission_scores: submissionScores }), null, 'a partial result needs explicit null aggregates')
  }
  assert.equal(normalizeCompetitionResults({ ...partialPublishedPayload, score_status: 'complete' }), null, 'unpublished partial results still fail closed')
  for (const extraRow of [null, {}, { icp_position: -1, per_icp_score: 50 }, { icp_position: 10, per_icp_score: 50 }, { icp_position: 1.5, per_icp_score: 50 }, { icp_position: 7, per_icp_score: NaN }, { icp_position: 7, per_icp_score: Infinity }, { icp_position: 7, per_icp_score: -1 }, { icp_position: 7, per_icp_score: 101 }, { icp_position: 7, per_icp_score: '50' }, { icp_position: 1, per_icp_score: 99 }]) {
    assert.equal(normalizeCompetitionResults({ ...partialPublishedPayload, scores: { stage_1: [], stage_2: [...partialPublishedPayload.scores.stage_2, extraRow] } }), null, 'malformed sparse scores must not become apparently valid partial evidence')
  }
  assert.equal(normalizeCompetitionResults({ ...partialPublishedPayload, round_id: '' }), null)
  assert.equal(normalizeCompetitionResults({ ...partialPublishedPayload, submission_id: '' }), null)
  assert.equal(normalizeCompetitionResults(partialPublishedPayload, { roundId: 'another-round', benchmarkIcpCount: 10 }), null)
  const completeTenPayload = { ...partialPublishedPayload, submission_id: 'baseline-2026-10-10', scores: { stage_1: Array.from({ length: 10 }, (_, icp_position) => ({ icp_position, per_icp_score: icp_position === 6 ? 12.75 : 0 })), stage_2: [] }, submission_scores: { stage_1: null, final: 1.275 } }
  assert.equal(normalizeCompetitionResults(completeTenPayload).publicScores.size, 10, 'complete baseline scores remain available')
  assert.equal(normalizeCompetitionResults({ ...completeTenPayload, scores: { stage_1: completeTenPayload.scores.stage_1.slice(0, 9), stage_2: [] } }), null, 'a numeric aggregate still requires complete per-ICP coverage')
  assert.equal(normalizeCompetitionResults({ ...partialPublishedPayload, incomplete: true, round_status: 'cancelled' }).publicScores.size, 0, 'cancelled sparse evidence remains hidden')

  const code = normalizeCompetitionCode({ submission_id: 'miner-1', files: [{ path: 'agent.py', content: 'print(1)' }], truncated: true })
  assert.deepEqual(code.files[0], { path: 'agent.py', content: 'print(1)', language: null })
  assert.equal(code.truncated, true)

  const component = await readFile(resolve('src/components/dashboard/ResearchLab.tsx'), 'utf8')
  const renderedModule = { exports: {} }
  vm.runInNewContext(ts.transpileModule(component, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText + '\nexports.ValidatorNamesContext = ValidatorNamesContext; exports.RewardSeats = RewardSeats; exports.ChampionScoreHistory = ChampionScoreHistory; exports.ScoreHistoryTooltip = ScoreHistoryTooltip; exports.RoundSummary = RoundSummary; exports.ChampionSummary = ChampionSummary; exports.SubmissionTable = SubmissionTable; exports.PublishedResults = PublishedResults; exports.ScoringAttributionSummary = ScoringAttributionSummary; exports.IcpList = IcpList; exports.CompanyDiagnostics = CompanyDiagnostics; exports.SourcePanel = SourcePanel; exports.EvaluationRunSummary = EvaluationRunSummary; exports.filterSubmissions = filterSubmissions;', {
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
  const partialRound = { ...snapshot.latestCompletedRound, roundId: partialPublished.roundId, status: 'published', benchmarkIcpCount: 10 }
  const partialBenchmark = { ...benchmark, benchmarkIcpCount: 10, icps: benchmark.icps.slice(0, 10) }
  const partialSubmission = { ...evaluationRow({ state: 'failed', validators: [], failure_reasons: ['scoring_window'] }, 'scoring_failed'), submissionId: partialPublished.submissionId, finalScore: null }
  const renderPartial = (overrides = {}) => renderToStaticMarkup(React.createElement(renderedModule.exports.PublishedResults, {
    submission: partialSubmission, round: partialRound, benchmark: partialBenchmark, benchmarkState: 'available', results: partialPublished, resultsState: 'available', ...overrides,
  }))
  const partialMarkup = renderPartial()
  assert.match(partialMarkup, /Evaluation incomplete · scoring window ended/)
  assert.match(partialMarkup, /No complete evaluation score is available/)
  assert.match(partialMarkup, /45\.50/)
  assert.match(partialMarkup, /35\.75/)
  assert.equal((partialMarkup.match(/>0\.00<\/span>/g) ?? []).length, 5, 'five stored zero scores must render')
  assert.equal((partialMarkup.match(/>—<\/span>/g) ?? []).length, 3, 'three unjudged scores must stay blank')
  assert.doesNotMatch(partialMarkup, /Final score/, 'the renderer must not invent an aggregate')
  for (const overrides of [
    { round: { ...partialRound, status: 'cancelled' } },
    { round: { ...partialRound, status: 'stage2_scoring' } },
    { benchmark: null, benchmarkState: 'gated' },
    { results: { ...partialPublished, publicIcpStatus: 'pending' } },
    { results: { ...partialPublished, finalScore: 99 } },
    { resultsState: 'loading' }, { resultsState: 'error' },
    { submission: { ...partialSubmission, status: 'review_failed' } },
  ]) assert.doesNotMatch(renderPartial(overrides), /45\.50|35\.75/, 'sparse scores must respect publication, disclosure, review, and result-state gates')
  assert.match(renderPartial({ results: { ...partialPublished, incomplete: true } }), /This round was cancelled/)
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
    scoring_window: 'Evaluation incomplete · scoring window ended',
    review: 'Evaluation incomplete · review did not finish',
    provider_credentials: 'Provider access failed',
    provider_authentication_failed: 'Provider API key authentication failed',
    provider_credit_exhausted: 'Out of credit / insufficient provider funding',
    openrouter_zdr_route_unavailable: "OpenRouter model unavailable under Arena's ZDR policy",
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
  const zdrFailure = evaluationRow({ state: 'failed', validators: [], failure_reasons: ['openrouter_zdr_route_unavailable'] }, 'scoring_failed')
  assert.deepEqual(zdrFailure.evaluation.failureReasons, ['openrouter_zdr_route_unavailable'])
  assert.equal(competitionSubmissionStatusLabel(zdrFailure, pendingRound), failureLabels.openrouter_zdr_route_unavailable)
  assert.equal(competitionSubmissionStatusLabel(evaluationRow({
    state: 'failed', validators: [], failure_reasons: ['unknownproviderfailure'], model_name: 'some-model',
  }, 'scoring_failed'), pendingRound), 'Evaluation failed', 'unknown provider errors and model names must not imply a ZDR route failure')
  const zdrMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.SubmissionTable, {
    submissions: [zdrFailure], round: pendingRound, selectedId: zdrFailure.submissionId, onSelect() {},
  })) + renderToStaticMarkup(React.createElement(renderedModule.exports.PublishedResults, {
    submission: zdrFailure, round: pendingRound, benchmark, benchmarkState: 'available', results: null, resultsState: 'error',
  }))
  assert.match(zdrMarkup, /OpenRouter model unavailable under Arena&#x27;s ZDR policy|OpenRouter model unavailable under Arena's ZDR policy/)
  assert.match(zdrMarkup, /Choose a model with a ZDR-compatible endpoint\./)
  const publishedZdrRow = {
    submission_id: 'miner-published-zdr', miner_hotkey: '5miner', is_baseline: false, status: 'provider_blocked',
    submitted_at: '2026-10-21T10:00:00Z', stage1_score: null, final_score: null, is_champion: false,
    evaluation: { state: 'provider_blocked', validators: [], failure_reasons: ['openrouter_zdr_route_unavailable'] },
    code: { available: false, available_at: null, url: null },
  }
  const publishedZdr = normalizeCompetitionSubmissions({ submissions: [publishedZdrRow] })[0]
  assert.equal(publishedZdr.status, 'provider_blocked', 'the published exclusion status remains unchanged')
  assert.equal(publishedZdr.finalScore, null, 'a blocked published row does not gain a score')
  assert.equal(publishedZdr.evaluation.state, 'provider_blocked')
  assert.deepEqual(publishedZdr.evaluation.failureReasons, ['openrouter_zdr_route_unavailable'])
  assert.equal(competitionSubmissionStatusLabel(publishedZdr, pendingRound), failureLabels.openrouter_zdr_route_unavailable)
  const publishedZdrMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.SubmissionTable, {
    submissions: [publishedZdr], round: pendingRound, selectedId: publishedZdr.submissionId, onSelect() {},
  })) + renderToStaticMarkup(React.createElement(renderedModule.exports.PublishedResults, {
    submission: publishedZdr, round: pendingRound, benchmark, benchmarkState: 'available', results: null, resultsState: 'error',
  }))
  assert.match(publishedZdrMarkup, /OpenRouter model unavailable under Arena&#x27;s ZDR policy|OpenRouter model unavailable under Arena's ZDR policy/)
  assert.match(publishedZdrMarkup, /Choose a model with a ZDR-compatible endpoint\./)
  const publishedZdrHistory = normalizeCompetitionHistory({
    rounds: [published], submissions: [{ ...publishedZdrRow, round_id: published.round_id }], next_cursor: null,
  })
  assert.equal(publishedZdrHistory.entries[0].submission.status, 'provider_blocked', 'history preserves the immutable exclusion status')
  assert.equal(competitionSubmissionStatusLabel(publishedZdrHistory.entries[0].submission, publishedZdrHistory.entries[0].round), failureLabels.openrouter_zdr_route_unavailable)
  const unprovedBlocked = normalizeCompetitionSubmissions({ submissions: [{
    ...publishedZdrRow, submission_id: 'miner-unproved-blocked',
    evaluation: { state: 'provider_blocked', validators: [] },
  }] })[0]
  assert.equal(competitionSubmissionStatusLabel(unprovedBlocked, pendingRound), 'Provider blocked', 'provider_blocked status without the exact allowlisted reason stays generic')
  const unprovedBlockedMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.SubmissionTable, {
    submissions: [unprovedBlocked], round: pendingRound, selectedId: unprovedBlocked.submissionId, onSelect() {},
  }))
  assert.doesNotMatch(unprovedBlockedMarkup, /OpenRouter model unavailable|ZDR-compatible endpoint/, 'status or an unrecognized reason cannot imply ZDR incompatibility')
  const creditFixture = JSON.parse(await readFile(resolve('scripts/fixtures/competition-provider-credit-20261015-16.json'), 'utf8'))
  assert.deepEqual(creditFixture.groups.map((group) => group.submissions.length), [6, 2])
  for (const group of creditFixture.groups) {
    for (const recorded of group.submissions) {
      const submission = { ...evaluationRow(recorded.evaluation, recorded.status), submissionId: recorded.submission_id }
      const label = recorded.submission_id === 'sub-d85459ed504e64ebbccaaab782c837d0'
        ? 'Evaluation incomplete · multiple causes'
        : 'Out of credit / insufficient provider funding'
      assert.equal(competitionSubmissionStatusLabel(submission, pendingRound), label, `${group.round_id} ${recorded.submission_id}`)
      const markup = renderToStaticMarkup(React.createElement(renderedModule.exports.SubmissionTable, {
        submissions: [submission], round: pendingRound, selectedId: submission.submissionId, onSelect() {},
      }))
      assert.ok(markup.includes(label), 'the table must show the recorded funding cause or retain all mixed causes')
      const details = renderToStaticMarkup(React.createElement(renderedModule.exports.PublishedResults, {
        submission, round: pendingRound, benchmark, benchmarkState: 'available', results: null, resultsState: 'error',
      }))
      assert.ok(details.includes(`${label}. No complete evaluation score is available.`), details)
      assert.ok(details.includes('Out of credit / insufficient provider funding'), 'the detail must retain the funding cause even alongside another cause')
      if (recorded.submission_id === 'sub-d85459ed504e64ebbccaaab782c837d0') {
        assert.match(details, /Recorded causes:.*scoring window ended/)
      }
      assert.equal(submission.finalScore, null, 'failure labels must not create an evaluation score')
    }
  }
  for (const reason of ['provider_credentials', 'provider_authentication_failed', 'provider', 'execution', 'unknown']) {
    const submission = evaluationRow({
      state: 'failed', validators: [], failure_reasons: [reason],
      provider_http_status: 402, terminal_status: 'budget_exhausted',
    }, 'scoring_failed')
    assert.equal(competitionSubmissionStatusLabel(submission, pendingRound), failureLabels[reason], 'HTTP 402 or a model budget must not override the recorded failure reason')
  }
  const authenticationFailure = evaluationRow({
    state: 'failed', validators: [], failure_reasons: ['provider_authentication_failed'],
  }, 'scoring_failed')
  const authenticationMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.SubmissionTable, {
    submissions: [authenticationFailure], round: pendingRound, selectedId: authenticationFailure.submissionId, onSelect() {},
  })) + renderToStaticMarkup(React.createElement(renderedModule.exports.PublishedResults, {
    submission: authenticationFailure, round: pendingRound, benchmark, benchmarkState: 'available', results: null, resultsState: 'error',
  }))
  assert.match(authenticationMarkup, /Provider API key authentication failed/)
  assert.doesNotMatch(authenticationMarkup, /Out of credit|expired|revoked|>0\.00</, 'authentication evidence must not invent a funding cause, exact key state, or score')
  const unprovedAuthentication = evaluationRow({
    state: 'failed', validators: [], failure_reasons: ['provider_credentials'], provider_http_status: 401,
  }, 'scoring_failed')
  assert.equal(competitionSubmissionStatusLabel(unprovedAuthentication, pendingRound), 'Provider access failed', 'a status field alone must not replace the gateway diagnostic')
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
  for (const reasons of ['review', [null], ['private-raw-error'], ['review', 'private-raw-error'], [{}], Array(11).fill('review')]) {
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
  const validatorNames = normalizeValidatorNames({ names: { [primaryHotkey]: 'Subnet 71', [yumaHotkey]: 'Yuma', ghost: 'Wrong identity' }, hotkeyToUid: { [primaryHotkey]: 0, [yumaHotkey]: 155 } })
  assert.deepEqual(validatorNames, { [primaryHotkey]: 'Subnet 71', [yumaHotkey]: 'Yuma' })
  assert.deepEqual(normalizeValidatorNames({ names: { [primaryHotkey]: 'Subnet 71' } }), {})
  const withNames = (node) => React.createElement(renderedModule.exports.ValidatorNamesContext.Provider, { value: validatorNames }, node)
  const progressMarkup = renderToStaticMarkup(withNames(React.createElement(renderedModule.exports.SubmissionTable, {
    submissions: [evaluating, { ...queued, submissionId: 'waiting' }], round: pendingRound, selectedId: null, onSelect() {},
  })))
  assert.match(progressMarkup, /Evaluating/)
  assert.match(progressMarkup, /Scoring · .*Subnet 71/)
  assert.match(progressMarkup, /Running · .*Yuma/)
  assert.match(progressMarkup, /Queued for validation/)
  assert.doesNotMatch(progressMarkup, /Commit not recorded|checkout state unknown/, 'live rows show status and validator, without missing technical metadata')
  const activeVersionMarkup = renderToStaticMarkup(withNames(React.createElement(renderedModule.exports.SubmissionTable, {
    submissions: [versionedEvaluation], round: pendingRound, selectedId: null, onSelect() {},
  })))
  assert.doesNotMatch(activeVersionMarkup, /local modifications|\/commit\//)
  assert.match(activeVersionMarkup, /Running · .*Subnet 71/)
  assert.match(activeVersionMarkup, /retrying tasks/)
  const multiVersionMarkup = renderToStaticMarkup(withNames(React.createElement(renderedModule.exports.SubmissionTable, {
    submissions: [multiVersionEvaluation], round: pendingRound, selectedId: null, onSelect() {},
  })))
  assert.match(multiVersionMarkup, /Evaluating/)
  assert.doesNotMatch(multiVersionMarkup, /bbbbbbbbbbbb|cccccccccccc|Uncommitted files detected|File state not recorded/)
  assert.equal((multiVersionMarkup.match(/Subnet 71/g) ?? []).length, 2, 'each mutually exclusive mobile/desktop status shows a validator once per phase')
  assert.match(multiVersionMarkup, /Scoring · .*Yuma/)
  const archivedVersionMarkup = renderToStaticMarkup(withNames(React.createElement(renderedModule.exports.EvaluationRunSummary, { submission: completedEvaluation })))
  assert.match(archivedVersionMarkup, /Execution/)
  assert.match(archivedVersionMarkup, new RegExp('b'.repeat(40)))
  assert.match(archivedVersionMarkup, /No uncommitted changes detected/)
  assert.match(archivedVersionMarkup, /recorded when the validator started/)
  assert.match(archivedVersionMarkup, /linked commit is the checkout’s base version/)
  assert.match(archivedVersionMarkup, /does not list them or show that scoring code changed/)
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
  const searchDefenderRound = { defendingChampion: { submissionId: 'winning-submission', minerHotkey: '5VerifiedDefender' } }
  assert.deepEqual(renderedModule.exports.filterSubmissions(rowsWithBaselineLast, '5VerifiedDefender', 'all', searchDefenderRound), [baselineRow], 'the defending row is searchable by its displayed miner')
  assert.deepEqual(renderedModule.exports.filterSubmissions([baselineRow], baselineRow.minerHotkey, 'all', searchDefenderRound), [], 'the organizer key must not match the defending miner filter')
  const namedAttribution = renderToStaticMarkup(withNames(React.createElement(renderedModule.exports.ScoringAttributionSummary, { attribution: attributedResults.scoringAttribution })))
  assert.match(namedAttribution, /Subnet 71 \(5FNVgRnrx…xEBLo9\), Yuma \(5Chnr6Y72…LmU4BW\)/)
  assert.match(namedAttribution, new RegExp(primaryHotkey), 'full hotkeys remain available in expanded attribution')

  const renderSummary = (round) => renderToStaticMarkup(React.createElement(renderedModule.exports.RoundSummary, { round }))
  for (const [status, label] of Object.entries({
    open: 'Open for submissions', committed: 'Preparing evaluation',
    stage1: 'Initial evaluation in progress', stage1_closed: 'Initial evaluation in progress',
    stage1_scoring: 'Initial scoring in progress', stage1_judged: 'Initial scoring in progress',
    stage1_scored: 'Preparing final evaluation', stage2: 'Final evaluation in progress',
    stage2_closed: 'Final evaluation in progress', stage2_scoring: 'Final scoring in progress',
    stage2_judged: 'Final scoring in progress', scored: 'Final result pending',
  })) {
    const markup = renderSummary({ ...snapshot.latestCompletedRound, status, publishedAt: null, baseline: null })
    assert.match(markup, /Pending/, `${status} must not imply a final promotion decision`)
    assert.match(markup, /Awaiting score/, `${status} must distinguish a missing baseline score from zero`)
    assert.doesNotMatch(markup, /Not required|No champion was published|Stage1 scored/)
    assert.ok(markup.includes(label), `${status} must use a readable round status`)
  }
  const historyMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.ChampionScoreHistory, { points: history }))
  assert.match(historyMarkup, /Champion score by day/)
  assert.doesNotMatch(historyMarkup, /New champion crowned/, 'every day uses the same marker, so no crowning legend')
  assert.match(historyMarkup, /UTC · The champion’s score on each day’s ICPs\./)
  assert.doesNotMatch(historyMarkup, /Past competitions|Baseline/)
  const emptyHistoryMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.ChampionScoreHistory, { points: [] }))
  assert.match(emptyHistoryMarkup, /No champion scores yet/)
  const onePointMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.ChampionScoreHistory, { points: [history[0]] }))
  assert.match(onePointMarkup, /First published champion score/)
  const renderTooltip = (point) => renderToStaticMarkup(React.createElement(renderedModule.exports.ScoreHistoryTooltip, { active: true, payload: [{ payload: point }] }))
  const tooltipMarkup = renderTooltip(history[0])
  assert.match(tooltipMarkup, /Evaluation · Sep 5, 2026/)
  assert.match(tooltipMarkup, /New champion 0\.00 \/100/)
  assert.match(tooltipMarkup, /5winner/, 'a crowning day names the new champion')
  assert.match(tooltipMarkup, /Defending champion 0\.00 \/100/, 'a crowning day shows the defending champion it beat')
  assert.match(renderTooltip({ ...history[0], baselineScore: null }), /Defending champion Unavailable/, 'tooltip preserves an unavailable defending champion score instead of showing zero')
  const lateTooltip = renderTooltip(lateHistory[1])
  assert.match(lateTooltip, /Champion 99\.00 \/100[^]*Miner unavailable/, 'an unnamed held day says the miner is unavailable')
  assert.doesNotMatch(lateTooltip, /Previous champion/)
  assert.match(renderTooltip(gatewayHistory[1]), /Previous champion 99\.00 \/100[^]*5older/, 'the tooltip names the older champion that ran')
  assert.doesNotMatch(renderTooltip(gatewayHistory[1]), /after this round’s cutoff/, 'a different defender alone does not prove when promotion occurred')
  const heldTooltip = renderTooltip(championHistory.at(-1))
  assert.match(heldTooltip, /Champion 99\.00 \/100[^]*5winner/)
  assert.match(heldTooltip, /Champion held the title/)
  assert.doesNotMatch(heldTooltip, /New champion|Baseline/)
  assert.match(renderTooltip(championHistory[1]), /Champion 99\.00 \/100[^]*Top challenger 90\.00 · promotion pending/, 'a pending winner is a challenger, not the champion')
  assert.match(renderTooltip(championHistory[2]), /Top challenger 95\.00 · not promoted/)
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
  assert.match(completedBaselineMarkup, /Defending champion score/)
  assert.match(completedBaselineMarkup, /Round still in progress/)
  assert.match(completedBaselineMarkup, /Promotion margin/)
  assert.doesNotMatch(completedBaselineMarkup, /Baseline|baseline/, 'round details never call the defending champion a baseline')
  assert.match(renderSummary({ ...completedBaselineRound, status: 'scored' }), /Final result pending/)
  assert.match(completedBaselineMarkup, /Pending/)
  assert.doesNotMatch(completedBaselineMarkup, /Awaiting score|No champion was published/)
  assert.equal(competitionSubmissionStatusLabel({ ...submissions[0], status: 'scored' }, activeRound),
    'Scored', 'a completed model must not imply a winner or promotion')
  assert.match(finalMarkup, /Promotion margin.*\+.*1\.00.* points/)
  assert.match(finalMarkup, /Champion held/)
  assert.match(finalMarkup, /No new champion was published/)
  assert.match(finalMarkup, /0\.00/, 'a published zero baseline is not pending')
  assert.match(renderSummary(snapshot.latestRound), /Cancelled round/)
  assert.doesNotMatch(renderSummary(snapshot.latestRound), /Decision follows completed evaluation/)
  const championMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.ChampionSummary, { round: currentChampionRound(championSnapshot) }))
  assert.match(championMarkup, /Current champion/)
  assert.match(championMarkup, /5\.75/)
  assert.match(championMarkup, /Winning score · crowned Oct 7, 2026/)
  assert.doesNotMatch(championMarkup, /99\.00|Defending champion score|Baseline/)
  const latestMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.ChampionSummary, { round: currentChampionRound(championSnapshot), history: championHistory, active: false }))
  assert.match(latestMarkup, />99\.00<span/, 'the headline shows the latest daily score')
  assert.match(latestMarkup, /Latest score · Oct 11, 2026/)
  assert.match(latestMarkup, /Crowned Oct 7, 2026 · winning score 5\.75/)
  assert.doesNotMatch(latestMarkup, /Winning score · crowned/)
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
  const defendingTable = renderToStaticMarkup(React.createElement(renderedModule.exports.SubmissionTable, {
    submissions: [{ ...submissions[0], submissionId: 'baseline-2026-11-02', isBaseline: true, status: 'scored', finalScore: 7.225 }],
    round: activeRound, selectedId: null, onSelect: () => {},
  }))
  assert.match(defendingTable, />Defending champion</, 'the daily baseline row is labelled as the defending champion')
  assert.doesNotMatch(defendingTable, />Baseline</)
  assert.match(defendingTable, /Run by organizer/, 'without a named champion the organizer key is not presented as the champion key')
  assert.doesNotMatch(defendingTable, new RegExp(`>${submissions[0].minerHotkey.slice(0, 9)}`), 'the organizer hotkey is not shown beside the defending champion label')
  const defenderHotkey = '5HSutSjNeExampleDefenderHotkeySrXKu9'
  const namedDefendingTable = renderToStaticMarkup(React.createElement(renderedModule.exports.SubmissionTable, {
    submissions: [{ ...submissions[0], submissionId: 'baseline-2026-11-02', isBaseline: true, status: 'scored', finalScore: 7.225 }],
    round: { ...activeRound, defendingChampion: { submissionId: 'sub-champion', minerHotkey: defenderHotkey } }, selectedId: null, onSelect: () => {},
  }))
  assert.match(namedDefendingTable, />Defending champion</)
  assert.match(namedDefendingTable, new RegExp(`title="${defenderHotkey}"[^>]*>(?:<[^>]+>)*${defenderHotkey.slice(0, 8)}`), 'the defending row names the champion miner it ran')
  assert.doesNotMatch(namedDefendingTable, /Run by organizer/)
  assert.equal(competitionSubmissionMiner({ isBaseline: false, minerHotkey: '5miner' }, { defendingChampion: null }), '5miner')
  assert.equal(competitionSubmissionMiner({ isBaseline: true, minerHotkey: '5organizer' }, { defendingChampion: null }), null)
  const noChampionMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.ChampionSummary, { round: null }))
  assert.match(noChampionMarkup, /No promoted champion in published history/)
  assert.doesNotMatch(noChampionMarkup, />0\.00</)
  for (const promotionStatus of ['pending', 'promoted']) {
    const markup = renderSummary({ ...snapshot.latestCompletedRound, promotionStatus,
      champion: { submissionId: 'winner', minerHotkey: '5winner', finalScore: 51, outcome: 'new_king' } })
    assert.match(markup, /Champion/)
    assert.match(markup, promotionStatus === 'promoted' ? /Promoted to champion · 51\.00/ : /Promotion pending/)
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
  assert.doesNotMatch(supersededMarkup, /Promotion pending|Promoted to champion/)
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
    assert.equal(codeVersionMarkup.includes('· Uncommitted files detected'), workingTree === 'dirty')
    assert.equal(codeVersionMarkup.includes('· No uncommitted changes detected'), workingTree === 'clean')
    assert.equal(codeVersionMarkup.includes('· File state not recorded'), workingTree === 'unknown')
    assert.equal((codeVersionMarkup.match(/recorded when the validator started/g) ?? []).length, 1, 'checkout explanation appears once for all validators')
    assert.match(codeVersionMarkup, /recorded when the validator started/)
    assert.match(codeVersionMarkup, /not that files changed/)
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
    assert.match(renderSummary(dynamicRound), /Promotion margin.*\+.*0\.50.* points/)
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
    missingContact: true, checks: { ...allPassedChecks, contact: 'failed', email: 'not_evaluated' }, checkReasons: {}, contactFailure: null,
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
    duplicateCompany: false, missingContact: null, checks: companyOnlyChecks, checkReasons: {}, contactFailure: null,
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
  const reasonsPayload = { ...companyOnlyDiagnostic, qualified: false,
    checks: { ...companyOnlyChecks, industry: 'unavailable', intent_details: 'failed' },
    check_reasons: {
      industry: [{ code: 'verification_unavailable', message: 'Supply clear industry evidence.' }],
      intent_details: [{ code: 'paragraph_facts_unsupported', message: 'Correct the <unsupported> claim.' }],
      identity: [{ code: 'ignored', message: 'passed-check-must-not-render' }],
      private_extra: [{ code: 'ignored', message: 'private-extra-must-not-render' }],
    },
  }
  const reasonsResult = normalizeCompetitionResults({ ...attributedResultsPayload, company_diagnostics: [reasonsPayload] })
  assert.equal(reasonsResult.companyDiagnostics[0].checkReasons.industry[0].code, 'verification_unavailable')
  const reasonsMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.CompanyDiagnostics, { rows: reasonsResult.companyDiagnostics }))
  assert.match(reasonsMarkup, /Supply clear industry evidence\./)
  assert.match(reasonsMarkup, /Correct the &lt;unsupported&gt; claim\./, 'reason text is escaped, never interpreted as HTML')
  assert.doesNotMatch(reasonsMarkup, /passed-check-must-not-render|private-extra-must-not-render/)
  for (const invalid of [null, 'bad', { code: 'invalid code', message: 'bad' }, { code: 'valid', message: 'x'.repeat(401) }, { code: 'valid', message: 'bad\ntext' }]) {
    const result = normalizeCompetitionResults({ ...attributedResultsPayload, company_diagnostics: [{ ...reasonsPayload, check_reasons: { industry: [invalid] } }] })
    assert.ok(result.companyDiagnostics, 'invalid optional reasons preserve recorded company checks')
    assert.deepEqual(result.companyDiagnostics[0].checkReasons, {})
  }
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
  const loadingScoredResults = renderToStaticMarkup(React.createElement(renderedModule.exports.PublishedResults, {
    submission: { ...submissions[0], isBaseline: false, finalScore: 38.8 },
    round: activeRound, benchmark, benchmarkState: 'available', results: null, resultsState: 'loading',
  }))
  assert.match(loadingScoredResults, /Loading this model’s score and diagnostics\./)
  assert.doesNotMatch(loadingScoredResults, /appear when its evaluation and cost checks are complete/,
    'a finished score that is still loading must not read as an unfinished evaluation')
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
    status: 'error', errorCode: 'code_review_provider_unavailable', failureReason: null, providerHttpStatus: null,
    retryable: null, attempts: 3, admissionReason: null, categories: [],
  })
  assert.equal('costStatus' in madaraReviewFailure.codeReview, false, 'internal review cost state must not enter the UI model')
  assert.equal(isCompetitionReviewExcluded(madaraReviewFailure), true)
  assert.equal(competitionSubmissionStatusLabel(madaraReviewFailure, pendingRound), 'Code review failed · service unavailable')
  assert.equal(
    competitionSubmissionEvaluationNotice(madaraReviewFailure, pendingRound),
    'The review service or provider was unavailable. The review did not complete; no code violation was confirmed. Keep the submission ID when reporting this review failure. This submission was not evaluated.',
  )

  const reviewRejected = { ...madaraReviewFailure, status: 'review_rejected' }
  assert.equal(competitionSubmissionStatusLabel(reviewRejected, pendingRound), 'Code review rejected')
  assert.equal(
    competitionSubmissionEvaluationNotice(reviewRejected, pendingRound),
    'Code review rejected. This submission was not evaluated.',
  )
  const normalizePendingReview = (codeReview, status = 'queued') => normalizeCompetitionSubmissions({ submissions: [{
    submission_id: 'pending-review', miner_hotkey: '5Pending', status,
    is_baseline: false, stage1_score: null, final_score: null, is_champion: false,
    code: { available: false, available_at: null, url: null }, code_review: codeReview,
  }] })[0]
  const rejectionCases = [
    ['hardcoded_prepared_answers', 'prepared answers', 'Remove stored answers'],
    ['fabricated_evidence', 'unsupported claims or evidence', 'Support each factual claim with retrieved source evidence, or remove the unsupported claim.'],
    ['malicious_behavior', 'disallowed code behavior', 'Remove the disallowed behavior'],
    ['reviewer_manipulation', 'review interference', 'Remove instructions or code'],
    ['duplicate_submission', 'duplicate submission', 'Make a meaningful behavior improvement before submitting again; cosmetic edits alone do not qualify.'],
  ]
  for (const [category, label, action] of rejectionCases) {
    for (const admission_reason of [undefined, 'source_policy_violation']) {
      const submission = normalizePendingReview({ status: 'rejected', categories: [category], admission_reason,
        findings: [{ file: 'private-file', explanation: 'private-review-prose' }] }, 'review_rejected')
      assert.equal(competitionSubmissionStatusLabel(submission, pendingRound), `Rejected: ${label}`)
      const table = renderToStaticMarkup(React.createElement(renderedModule.exports.SubmissionTable, {
        submissions: [submission], round: pendingRound, selectedId: submission.submissionId, onSelect() {},
      }))
      assert.equal(table.split(`Rejected: ${label}`).length - 1, 2, 'the same specific cause appears in desktop and mobile status cells')
      const details = renderToStaticMarkup(React.createElement(renderedModule.exports.PublishedResults, {
        submission, round: pendingRound, benchmark: null, benchmarkState: 'gated', results: null, resultsState: 'idle',
      }))
      assert.ok(details.includes(action), `recorded ${category} needs a fixed action before ICP disclosure`)
      assert.doesNotMatch(details, /Use an original implementation|Do not reuse another competition entry/, 'guidance must permit meaningful improvements to shared code')
      assert.doesNotMatch(table + details, /private-file|private-review-prose|retrying|>0\.00</)
      assert.equal(submission.finalScore, null)
      assert.equal(submission.code.available, false)
    }
  }
  // November 9 public category shape, without private source or reviewer prose.
  for (const submission_id of ['sub-f29c7cb94498a4143fda5a09601bdeb7', 'sub-95b894c1405c212f89115bdeeaec18f6']) {
    const submission = normalizeCompetitionSubmissions({ submissions: [{
      submission_id, miner_hotkey: '5PublicFixture', status: 'review_rejected',
      is_baseline: false, stage1_score: null, final_score: null, is_champion: false,
      code: { available: false, available_at: null, url: null },
      code_review: { status: 'rejected', categories: ['fabricated_evidence'], admission_reason: 'source_policy_violation' },
    }] })[0]
    assert.equal(competitionSubmissionStatusLabel(submission, pendingRound), 'Rejected: unsupported claims or evidence')
    const notice = competitionSubmissionEvaluationNotice(submission, pendingRound)
    assert.match(notice, /For example, describing a company as already offering the product requested by the ICP needs company evidence/)
    assert.match(notice, /This is an example of the rule, not the specific finding for this submission/)
    assert.match(notice, /Support each factual claim with retrieved source evidence, or remove the unsupported claim/)
    assert.doesNotMatch(notice, /fraud|deceiv|fabricated|private-file|tyche_arena/)
  }
  for (const [review, status, label] of [
    [{ status: 'passed', categories: ['fabricated_evidence'] }, 'queued', 'Queued for validation'],
    [{ status: 'error', error_code: 'code_review_provider_refused', categories: ['fabricated_evidence'] }, 'review_failed', 'Code review failed · provider declined request'],
    [{ status: 'rejected', categories: ['future_private_category'] }, 'review_rejected', 'Code review rejected'],
  ]) {
    const submission = normalizePendingReview(review, status)
    assert.equal(competitionSubmissionStatusLabel(submission, pendingRound), label)
    assert.doesNotMatch(competitionSubmissionEvaluationNotice(submission, pendingRound) ?? '', /claimed offering|future_private_category/)
  }
  const reasonCases = [
    ['model_directed_research_required', 'review_rejected', 'Not qualified: model-directed research required', 'model decisions select research actions'],
    ['source_review_unverified', 'review_failed', 'Source review could not be verified', 'version covered by the review'],
    ['review_evidence_invalid', 'review_failed', 'Review evidence could not be verified', 'does not identify a code change'],
    ['review_response_incomplete', 'review_failed', 'Review response incomplete', 'does not identify a code change'],
    ['review_error', 'review_failed', 'Code review could not complete', 'does not identify a code change'],
    ['review_incomplete', 'review_failed', 'Code review could not complete', 'does not identify a code change'],
  ]
  for (const [admission_reason, status, label, action] of reasonCases) {
    const submission = normalizePendingReview({ status: admission_reason === 'source_review_unverified' ? 'passed' : 'error', admission_reason }, status)
    assert.equal(competitionSubmissionStatusLabel(submission, pendingRound), label)
    const notice = competitionSubmissionEvaluationNotice(submission, pendingRound)
    assert.ok(notice.includes(action))
    assert.ok(notice.includes('This submission was not evaluated.'))
    if (status === 'review_failed') assert.match(notice, /[Nn]o code violation was confirmed/)
    assert.doesNotMatch(notice, /retrying|resubmit|innocent/)
  }
  for (const admission_reason of ['private-secret', [], {}, 42]) {
    const submission = normalizePendingReview({ status: 'rejected', admission_reason, categories: ['fabricated_evidence', 'private-secret'] }, 'review_rejected')
    assert.equal(submission.codeReview.admissionReason, null)
    assert.deepEqual(submission.codeReview.categories, [])
    assert.equal(competitionSubmissionStatusLabel(submission, pendingRound), 'Code review rejected')
    assert.doesNotMatch(competitionSubmissionEvaluationNotice(submission, pendingRound), /private-secret/)
  }
  for (const categories of ['fabricated_evidence', [{}], [null], ['toString'], ['__proto__'], Array(6).fill('fabricated_evidence')]) {
    assert.deepEqual(normalizePendingReview({ status: 'rejected', categories }, 'review_rejected').codeReview.categories, [])
  }
  assert.deepEqual(normalizePendingReview({ status: 'rejected', categories: ['fabricated_evidence', 'fabricated_evidence'] }, 'review_rejected').codeReview.categories, ['fabricated_evidence'])
  const invalidNov6Review = normalizePendingReview({ status: 'error', error_code: 'review_response_invalid', admission_reason: 'review_evidence_invalid', retryable: false }, 'review_failed')
  assert.equal(competitionSubmissionStatusLabel(invalidNov6Review, pendingRound), 'Review evidence could not be verified')
  assert.match(competitionSubmissionEvaluationNotice(invalidNov6Review, pendingRound), /reviewer response.*no code violation was confirmed/)
  // Reduced public Nov6 API snapshot: eight recorded fabrication rejections and
  // one invalid review. Synthetic identities replace the public miner IDs.
  // The newer reason is added below to verify both pre-release and new APIs.
  const nov6PublicFixture = JSON.parse(await readFile(resolve('scripts/fixtures/competition-nov6-public-review-exclusions.json'), 'utf8'))
  for (const hostReasonsAvailable of [false, true]) {
    const fixture = structuredClone(nov6PublicFixture)
    if (hostReasonsAvailable) fixture.submissions.forEach((row, index) => { row.code_review.admission_reason = index < 8 ? 'source_policy_violation' : 'review_evidence_invalid' })
    const normalized = normalizeCompetitionSubmissions(fixture)
    assert.equal(normalized.length, 9)
    const table = renderToStaticMarkup(React.createElement(renderedModule.exports.SubmissionTable, {
      submissions: normalized, round: pendingRound, selectedId: null, onSelect() {},
    }))
    assert.equal(table.split('Rejected: unsupported claims or evidence').length - 1, 16, 'all eight recorded reasons must render in desktop and mobile cells')
    assert.equal(table.split(hostReasonsAvailable ? 'Review evidence could not be verified' : 'Code review failed · invalid reviewer response').length - 1, 2, 'the ninth incomplete review must have a different desktop and mobile label')
    for (const [index, submission] of normalized.entries()) {
      assert.equal(submission.finalScore, null)
      assert.equal(submission.stage1Score, null)
      assert.equal(submission.isChampion, false)
      const details = renderToStaticMarkup(React.createElement(renderedModule.exports.PublishedResults, {
        submission, round: pendingRound, benchmark, benchmarkState: 'available', results: null, resultsState: 'idle',
      }))
      const source = renderToStaticMarkup(React.createElement(renderedModule.exports.SourcePanel, {
        submission, cancelled: false, code: null, codeState: 'idle', selectedFile: null, onSelectFile() {}, onRequest() {},
      }))
      assert.ok(details.includes(index < 8 ? 'Support each factual claim with retrieved source evidence' : 'no code violation was confirmed'))
      assert.ok(source.includes('Source was not published because this submission was not evaluated'))
      assert.doesNotMatch(table + details + source, /View source|Source locked|retrying|>0\.00</)
    }
  }
  for (const [error_code, label, action] of [
    ['code_review_provider_rate_limited', 'provider rate limit', 'provider request limits'],
    ['code_review_provider_timeout', 'provider timeout', 'submission ID'],
    ['code_review_provider_refused', 'provider declined request', 'submission ID'],
    ['review_response_invalid', 'invalid reviewer response', 'does not identify a code change'],
    ['code_review_research_unverified', 'research qualification unverified', 'model decisions'],
    ['code_review_round_closed', 'review window closed', 'published deadlines'],
    ['source_license_invalid', 'invalid source license', 'required license'],
    ['harness_file_missing', 'invalid harness', 'complete harness'],
    ['source_contains_credentials', 'credentials in source', 'Remove embedded credentials'],
    ['code_review_source_digest_mismatch', 'source could not be verified', 'upload checksums'],
    ['source_archive_invalid', 'source validation failed', 'archive format'],
  ]) {
    const submission = normalizePendingReview({ status: 'error', error_code, retryable: true }, 'review_failed')
    assert.ok(competitionSubmissionStatusLabel(submission, pendingRound).includes(label))
    assert.ok(competitionSubmissionEvaluationNotice(submission, pendingRound).includes(action))
    assert.doesNotMatch(competitionSubmissionEvaluationNotice(submission, pendingRound), /retrying|resubmit/)
  }
  const authPending = normalizePendingReview({ status: 'error', error_code: 'code_review_provider_authentication', provider_http_status: 401, attempts: 1 })
  for (const [error_code, declined] of [['code_review_provider_refused', true], ['code_review_provider_authentication', false], [undefined, false]]) {
    for (const status of ['queued', 'review_failed']) {
      const submission = normalizePendingReview({ status: 'error', error_code, provider_http_status: 403, retryable: true }, status)
      const label = competitionSubmissionStatusLabel(submission, pendingRound)
      const notice = competitionSubmissionEvaluationNotice(submission, pendingRound)
      assert.ok(label.includes(declined ? 'provider declined request' : 'access denied'))
      if (declined) assert.doesNotMatch(label + notice, /authentication|access denied|provider key/i, 'a typed provider refusal must not become key advice because its raw HTTP status is 403')
      if (status === 'review_failed') assert.doesNotMatch(label + notice, /retrying/)
    }
  }
  const creditPending = normalizePendingReview({ status: 'error', error_code: 'code_review_provider_credit', provider_http_status: 402, attempts: 1 })
  const exhaustedReview = { status: 'error', error_code: 'code_review_provider_credit', provider_http_status: 402, failure_reason: 'provider_credit_exhausted', attempts: 1 }
  const exhaustedPending = normalizePendingReview(exhaustedReview)
  const retryingPending = normalizePendingReview({ status: 'error', error_code: 'code_review_provider_rate_limited', provider_http_status: 429, retryable: true, attempts: 2 })
  const legacyPending = normalizePendingReview({ status: 'error', error_code: 'code_review_provider_unavailable' })
  const reviewingWithStaleError = normalizePendingReview({ status: 'reviewing', error_code: 'code_review_provider_unavailable', provider_http_status: 503, retryable: true, attempts: 2 })
  const passedWithStaleError = normalizePendingReview({ status: 'passed', error_code: 'code_review_provider_authentication', provider_http_status: 401, retryable: true, attempts: 2 })
  assert.equal(competitionSubmissionStatusLabel(authPending, pendingRound), 'Provider authentication failed')
  for (const codeReview of [
    { status: 'error', provider_http_status: 403 },
    { status: 'error', error_code: 'code_review_provider_authentication' },
  ]) {
    assert.equal(competitionSubmissionStatusLabel(normalizePendingReview(codeReview), pendingRound), 'Provider access denied')
  }
  assert.equal(competitionSubmissionStatusLabel(creditPending, pendingRound), 'Provider payment required')
  assert.equal(competitionSubmissionStatusLabel(exhaustedPending, pendingRound), 'Out of credit / insufficient provider funding')
  assert.equal(competitionSubmissionEvaluationNotice(exhaustedPending, pendingRound), 'Out of credit / insufficient provider funding. This submission has not been evaluated yet.')
  for (const reason of [null, 'unknown', 'private provider prose', ['provider_credit_exhausted', 'unknown'], { reason: 'provider_credit_exhausted' }]) {
    const submission = normalizePendingReview({ ...exhaustedReview, failure_reason: reason })
    assert.equal(submission.codeReview.failureReason, null)
    assert.equal(competitionSubmissionStatusLabel(submission, pendingRound), 'Provider payment required')
  }
  for (const [status, label] of [[401, 'Provider authentication failed'], [403, 'Provider access denied']]) {
    const submission = normalizePendingReview({ ...exhaustedReview, error_code: 'code_review_provider_authentication', provider_http_status: status })
    assert.equal(competitionSubmissionStatusLabel(submission, pendingRound), label, 'authentication/access precedence must survive stale funding metadata')
  }
  for (const [status, label] of [['passed', 'Queued for validation'], ['reviewing', 'Code review in progress']]) {
    const submission = normalizePendingReview({ ...exhaustedReview, status })
    assert.equal(competitionSubmissionStatusLabel(submission, pendingRound), label)
  }
  assert.equal(competitionSubmissionStatusLabel(retryingPending, pendingRound), 'Code review unavailable · retrying')
  assert.equal(competitionSubmissionStatusLabel(legacyPending, pendingRound), 'Code review unavailable')
  assert.doesNotMatch(competitionSubmissionStatusLabel(legacyPending, pendingRound), /credential|retrying/i, 'legacy generic failures must not invent a cause or retry state')
  assert.equal(competitionSubmissionStatusLabel(reviewingWithStaleError, pendingRound), 'Code review in progress')
  assert.equal(competitionSubmissionStatusLabel(passedWithStaleError, pendingRound), 'Queued for validation')
  assert.equal(competitionSubmissionEvaluationNotice(passedWithStaleError, pendingRound), null, 'a passed review must ignore an old error document')

  const terminalReviewCases = [
    [exhaustedReview, 'Code review failed · Out of credit / insufficient provider funding'],
    [{ status: 'error', error_code: 'code_review_provider_credit', provider_http_status: 402, retryable: true }, 'Code review failed · provider payment required'],
    [{ status: 'error', error_code: 'code_review_provider_authentication', provider_http_status: 403, retryable: true }, 'Code review failed · provider access denied'],
    [{ status: 'error', error_code: 'code_review_provider_credit' }, 'Code review failed · provider payment required'],
    [{ status: 'error', error_code: 'code_review_provider_authentication' }, 'Code review failed · provider access denied'],
    [{ status: 'error', provider_http_status: 402 }, 'Code review failed · provider payment required'],
    [{ status: 'error', provider_http_status: 403 }, 'Code review failed · provider access denied'],
    [{ status: 'error', provider_http_status: 401 }, 'Code review failed · provider authentication failed'],
    [{ status: 'error', error_code: 'code_review_provider_unavailable', provider_http_status: 503, retryable: true }, 'Code review failed · service unavailable'],
    [{ status: 'error', error_code: 'unknown_failure' }, 'Code review could not complete'],
    [{ status: 'passed', error_code: 'code_review_provider_credit', provider_http_status: 402 }, 'Code review could not complete'],
    [{ status: 'reviewing', error_code: 'code_review_provider_credit', provider_http_status: 402 }, 'Code review could not complete'],
    [{}, 'Code review could not complete'],
  ]
  for (const [codeReview, label] of terminalReviewCases) {
    const submission = normalizePendingReview(codeReview, 'review_failed')
    assert.equal(competitionSubmissionStatusLabel(submission, pendingRound), label)
    assert.match(competitionSubmissionEvaluationNotice(submission, pendingRound), /no code violation was confirmed.*This submission was not evaluated\./)
    const terminalRowsMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.SubmissionTable, {
      submissions: [submission], round: pendingRound, selectedId: submission.submissionId, onSelect() {},
    }))
    const terminalResultsMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.PublishedResults, {
      submission, round: pendingRound, benchmark, benchmarkState: 'available', results: null, resultsState: 'idle',
    }))
    assert.ok(terminalRowsMarkup.includes(label), 'the terminal cause must appear in the submissions table')
    assert.ok(terminalResultsMarkup.includes('no code violation was confirmed'), 'incomplete review must not become a source violation')
    assert.doesNotMatch(terminalRowsMarkup + terminalResultsMarkup, /retrying|>0\.00</i, 'terminal failures must not imply a retry or a score')
  }

  const reviewRowsMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.SubmissionTable, {
    submissions: [madaraReviewFailure, reviewRejected, authPending, creditPending, exhaustedPending, retryingPending, legacyPending],
    round: pendingRound, selectedId: madaraReviewFailure.submissionId, onSelect() {},
  }))
  assert.match(reviewRowsMarkup, /Code review failed · service unavailable/)
  assert.match(reviewRowsMarkup, /Code review rejected/)
  assert.match(reviewRowsMarkup, /Provider authentication failed/)
  assert.match(reviewRowsMarkup, /Provider payment required/)
  assert.match(reviewRowsMarkup, /Out of credit \/ insufficient provider funding/)
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
  const resultRouteSource = await readFile(resolve('src/app/api/research-lab/rounds/[roundId]/results/[submissionId]/route.ts'), 'utf8')
  const resultDeadlines = []
  const resultProxyModule = { exports: {} }
  vm.runInNewContext(ts.transpileModule(proxySource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, {
    module: resultProxyModule, exports: resultProxyModule.exports, require, process: { env: {} },
    AbortSignal: { timeout: (ms) => { resultDeadlines.push(ms); return undefined } },
    fetch: async () => Response.json({ ok: true }),
  })
  const resultRouteModule = { exports: {} }
  vm.runInNewContext(ts.transpileModule(resultRouteSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, {
    module: resultRouteModule, exports: resultRouteModule.exports,
    require: (name) => name === '@/lib/arena-public-proxy' ? resultProxyModule.exports : require(name),
  })
  assert.equal((await resultRouteModule.exports.GET(null, { params: Promise.resolve({ roundId: 'arena-2026-11-09', submissionId: 'sub-a' }) })).status, 200)
  assert.ok(resultDeadlines[0] >= 15_000, 'a full result must outlast the 5-11 s the gateway took on Nov 9, 2026')
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
  assert.ok(component.indexOf('<ChampionSummary') < component.indexOf('<RoundSummary'), 'champion headline is separate from the active round')
  assert.match(component, /Public ICPs \(\$\{benchmark\.benchmarkIcpCount\}\)/)
  assert.match(component, /Open agents, public benchmarks, on-chain rewards\./)
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
  assert.ok(component.indexOf("if (submission.status === 'scoring_failed')") < component.indexOf('const scores = submission.isBaseline'), 'failure status must gate baseline score rendering too')
  assert.doesNotMatch(component, /24.hour|24 hours|private ICP/i)
  assert.match(component, /Submission day/)
  assert.match(component, /Evaluation day/)
  assert.doesNotMatch(component, /Day 0|Day 1/)
  assert.match(component, /const submissionDate = utcCalendarDate\(round\.submissionOpen\) \?\? round\.icpSetDate/)
  assert.doesNotMatch(component, /label="Round baseline"|label="Round status"|SummaryMetric/, 'summary must not repeat its score and status in metric cards')
  assert.match(component, /ICP set · \{formatUtcDate\(icpSetDate\)\}/)
  assert.match(component, /normalizeCompetitionBenchmark\(response\.body, \{ roundId, icpSetDate, publicAt, benchmarkIcpCount \}\)/)
  assert.match(component, /Some files are omitted from this preview\./)
  assert.match(component, /promotionStatus === 'promoted'[^]*Promoted to champion/)
  assert.match(component, /promotionStatus === 'pending'[^]*Promotion pending/)
  assert.doesNotMatch(component, /slice\(10/)
  assert.doesNotMatch(component, /More 10 ICPs/)
  assert.doesNotMatch(component, />Stage 1</)
  assert.doesNotMatch(component, /outputs|run_results|judge_evidence/)

  // Recorded public /arena/v1/current on 2026-11-09: one +27 win holds all three seats.
  const liveSeats = JSON.parse(await readFile(resolve('scripts/fixtures/competition-reward-seats-20261109.json'), 'utf8'))
  const live = normalizeCompetitionRewardSeats(liveSeats).seats
  assert.deepEqual(live.map((seat) => [seat.minimumImprovement, seat.baseSharePercent, seat.currentSharePercent, seat.halvings, seat.epochsToNextHalving]), [[20, 20, 20, 0, 25], [15, 15, 15, 0, 25], [8, 15, 15, 0, 25]])
  assert.deepEqual(live.map((seat) => seat.postFundingSharePercent), [null, null, null], 'no slash without a published funding factor')
  const kingHotkey = live[0].holder.minerHotkey
  const fundingSeats = (slotHolder, ppm) => normalizeCompetitionRewardSeats({
    ...liveSeats,
    king: { hotkey: kingHotkey },
    champion_reward_factor_ppm: ppm,
    reward_slots: liveSeats.reward_slots.map((slot, index) => index === 0 ? { ...slot, miner_hotkey: slotHolder } : slot),
  }).seats.map((seat) => seat.postFundingSharePercent)
  assert.deepEqual(fundingSeats(kingHotkey, 500000), [10, 7.5, 7.5], 'a funding halving shows on every seat the champion holds')
  assert.deepEqual(fundingSeats('5earlierHolder', 500000), [null, 7.5, 7.5], 'a funding halving never reduces another holder')
  assert.deepEqual(fundingSeats(kingHotkey, 1000000), [null, null, null], 'a full factor shows no slash')
  const reductionsAt = (halvings, ppm, holder = kingHotkey) => {
    const startEpoch = 26000
    const parsed = normalizeCompetitionRewardSeats({
      ...liveSeats,
      king: { hotkey: kingHotkey },
      champion_reward_factor_ppm: ppm,
      epoch_eligible: true,
      current_epoch: startEpoch + 140 * halvings + 5,
      weekly_slot_decay: { epochs_per_halving: 140, slots: [{ start_epoch: startEpoch }, { start_epoch: startEpoch }, { start_epoch: startEpoch }] },
      reward_slots: liveSeats.reward_slots.map((slot, index) => index === 0 ? { ...slot, miner_hotkey: holder } : slot),
    }).seats[0]
    return { base: parsed.baseSharePercent, epochsPerHalving: parsed.epochsPerHalving, reductions: competitionRewardSeatReductions(parsed) }
  }
  assert.deepEqual(reductionsAt(0, 1000000), { base: 20, epochsPerHalving: 140, reductions: [] }, 'a full share has nothing to strike through')
  assert.deepEqual(reductionsAt(2, 1000000).reductions, [{ kind: 'weekly', divisor: 4, sharePercent: 5 }], 'weekly decay is listed on its own')
  assert.deepEqual(reductionsAt(0, 500000).reductions, [{ kind: 'funding', divisor: 2, sharePercent: 10 }], 'failed keys are listed on their own')
  assert.deepEqual(reductionsAt(1, 500000).reductions, [{ kind: 'weekly', divisor: 2, sharePercent: 10 }, { kind: 'funding', divisor: 2, sharePercent: 5 }], 'both cuts stack in kernel order')
  assert.deepEqual(reductionsAt(1, 500000, '5earlierHolder').reductions, [{ kind: 'weekly', divisor: 2, sharePercent: 10 }], 'failed keys never reduce another holder')
  assert.equal(normalizeCompetitionRewardSeats(liveSeats).fundingFactorKnown, false, 'a response without the factor cannot confirm a full share')
  assert.equal(normalizeCompetitionRewardSeats({ ...liveSeats, champion_reward_factor_ppm: 1000000 }).fundingFactorKnown, true)
  assert.equal(normalizeCompetitionRewardSeats({ ...liveSeats, champion_reward_factor_ppm: 500000 }).fundingFactorKnown, true)
  assert.equal(normalizeCompetitionRewardSeats({ ...liveSeats, champion_reward_factor_ppm: 750000 }).fundingFactorKnown, false, 'an unsigned value is never read as a known factor')
  assert.equal(formatCompetitionScorePrecise(live[0].holder.improvement), '27.125', 'seat arithmetic stays exact')
  assert.equal(formatCompetitionScorePrecise(2.45), '2.45')
  assert.equal(formatCompetitionScorePrecise(8), '8.00')
  assert.equal(normalizeCompetitionCurrentRound({ king: { hotkey: '5king' } }).kingHotkey, '5king', 'the reigning champion survives its crowning round aging out')
  assert.deepEqual(normalizeCompetitionCurrentRound(null), { kingHotkey: null, openRoundId: null, replacementCutoff: null })

  // Published Nov 9 round: the defender scored 32.95 with an 8-point margin and nobody cleared it.
  const heldRound = { status: 'published', promotionStatus: 'not_required', promotionMargin: 8, champion: null, baseline: { finalScore: 32.95 } }
  const nov9Entries = [{ isBaseline: false, finalScore: null }, { isBaseline: false, finalScore: 33.45 }, { isBaseline: true, finalScore: 32.95 }, { isBaseline: false, finalScore: 38.8 }, { isBaseline: false, finalScore: null }]
  assert.deepEqual(competitionRoundOutcome(heldRound, nov9Entries), { label: 'Champion held', detail: 'Best challenger 38.80 · Needed 40.95' })
  assert.deepEqual(competitionRoundOutcome(heldRound, null), { label: 'Champion held', detail: 'Needed 40.95' }, 'loading never invents a challenger')
  assert.deepEqual(competitionRoundOutcome(heldRound, [{ isBaseline: true, finalScore: 32.95 }]), { label: 'Champion held', detail: 'No challenger scored · Needed 40.95' })
  assert.deepEqual(competitionRoundOutcome(heldRound, [{ isBaseline: false, finalScore: 41 }]), { label: 'Champion held', detail: 'Best challenger 41.00' }, 'an unexplained clear never claims the bar was missed')
  assert.equal(competitionRoundOutcome({ ...heldRound, baseline: null }, null).label, 'No new champion published', 'no defender score means no held claim')
  assert.equal(competitionRoundOutcome({ ...heldRound, status: 'stage2' }, null), null, 'an unfinished round has no outcome')
  assert.equal(competitionRoundOutcome({ ...heldRound, promotionStatus: 'promoted', champion: { finalScore: 29.575 }, baseline: { finalScore: 2.45 } }, null).label, 'New champion')
  assert.equal(competitionRoundOutcome({ ...heldRound, promotionStatus: 'superseded', champion: { finalScore: 50 } }, null).label, 'Superseded by a newer round', 'a superseded winner is never called champion')

  assert.ok(Math.abs(competitionSubmissionPromotionGap({ isBaseline: false, finalScore: 38.8 }, heldRound) - 2.15) < 1e-9)
  assert.equal(competitionSubmissionPromotionGap({ isBaseline: false, finalScore: 41 }, heldRound), null)
  assert.equal(competitionSubmissionPromotionGap({ isBaseline: true, finalScore: 32.95 }, heldRound), null)
  assert.equal(competitionSubmissionPromotionGap({ isBaseline: false, finalScore: null }, heldRound), null)
  assert.equal(competitionSubmissionPromotionGap({ isBaseline: false, finalScore: 38.8 }, { ...heldRound, status: 'stage2' }), null, 'provisional scores get no shortfall')
  assert.deepEqual([...nov9Entries].sort(compareCompetitionSubmissions).map((entry) => entry.finalScore), [32.95, 38.8, 33.45, null, null], 'defender first, then best score, unscored last')
  const zeroPoolSeats = normalizeCompetitionRewardSeats({ ...liveSeats, reward_slot_policy: { ...liveSeats.reward_slot_policy, pool_percent: 0 } }).seats
  assert.deepEqual(zeroPoolSeats.map((seat) => [seat.baseSharePercent, seat.currentSharePercent]), [[0, 0], [0, 0], [0, 0]], 'a valid legacy zero pool renders zero emissions')
  assert.match(renderToStaticMarkup(React.createElement(renderedModule.exports.RewardSeats, { seats: { seats: zeroPoolSeats } })), /0%/)

  // The new signed contract allocates each tier directly from total emissions.
  // Keep the recorded 50% fixture intact to prove compatibility before activation.
  const totalEmissionsPolicy = {
    ...liveSeats.reward_slot_policy,
    allocation_basis: 'total_emissions',
    pool_percent: 75,
    tiers: [
      { minimum_improvement: 15, allocation_percent: 35 },
      { minimum_improvement: 10, allocation_percent: 25 },
      { minimum_improvement: 5, allocation_percent: 15 },
    ],
  }
  const newSeatsInput = { ...liveSeats, reward_slot_policy: totalEmissionsPolicy }
  const newSeats = normalizeCompetitionRewardSeats(newSeatsInput).seats
  assert.deepEqual(newSeats.map((seat) => [seat.minimumImprovement, seat.baseSharePercent, seat.currentSharePercent]), [[15, 35, 35], [10, 25, 25], [5, 15, 15]])
  for (const [halvings, expected] of [[1, [17.5, 12.5, 7.5]], [2, [8.75, 6.25, 3.75]], [4, [2.1875, 1.5625, 0.9375]]]) {
    const decayed = normalizeCompetitionRewardSeats({ ...newSeatsInput, current_epoch: 26183 + halvings * 140 }).seats
    assert.deepEqual(decayed.map((seat) => seat.currentSharePercent), expected)
    assert.deepEqual(decayed.map((seat) => seat.epochsToNextHalving), [140, 140, 140])
  }
  const newMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.RewardSeats, { seats: { seats: newSeats } }))
  for (const threshold of [15, 10, 5]) assert.ok(newMarkup.includes(`+${threshold} or more`))
  for (const share of [35, 25, 15]) assert.ok(newMarkup.includes(`${share}%`))
  assert.doesNotMatch(newMarkup, /\+20 or more|\+8 or more/)

  // A smaller new champion takes only the +8 seat; each seat decays on its own clock.
  const newerWin = { ...liveSeats.reward_slots[2], miner_hotkey: '5NewerSmallWinner', submission_id: 'sub-newer', round_id: 'arena-2026-11-09', winner_score: 40, baseline_score: 31, start_epoch: 26290 }
  const split = {
    ...liveSeats,
    current_epoch: 26470,
    reward_slots: [liveSeats.reward_slots[0], null, newerWin],
    weekly_slot_decay: { epochs_per_halving: 140, slots: [{ start_epoch: 26183, source_normalized_sha256: 'sha256:a' }, null, { start_epoch: 26290, source_normalized_sha256: 'sha256:b' }] },
  }
  const splitSeats = normalizeCompetitionRewardSeats(split).seats
  assert.equal(splitSeats[0].holder.minerHotkey, liveSeats.reward_slots[0].miner_hotkey)
  assert.deepEqual([splitSeats[0].halvings, splitSeats[0].currentSharePercent], [2, 5])
  assert.equal(splitSeats[1].holder, null)
  assert.deepEqual([splitSeats[2].holder.minerHotkey, splitSeats[2].holder.improvement, splitSeats[2].halvings, splitSeats[2].currentSharePercent], ['5NewerSmallWinner', 9, 1, 7.5])
  const newSplitSeats = normalizeCompetitionRewardSeats({ ...split, reward_slot_policy: totalEmissionsPolicy }).seats
  assert.deepEqual(newSplitSeats.map((seat) => [seat.baseSharePercent, seat.currentSharePercent]), [[35, 8.75], [25, null], [15, 7.5]])
  assert.deepEqual(newSplitSeats.map((seat) => seat.holder), splitSeats.map((seat) => seat.holder), 'policy changes preserve recorded seat holders and achievement scores')
  const newSplitMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.RewardSeats, { seats: { seats: newSplitSeats } }))
  assert.match(newSplitMarkup, /8\.75%/)
  assert.match(newSplitMarkup, /<s [^>]*><span [^>]*>Full share <\/span>35%<\/s>/, 'the full share is struck through')
  assert.match(newSplitMarkup, /Weekly decay ÷4/)
  assert.match(newSplitMarkup, /Next halving in 133 epochs/)
  assert.match(newSplitMarkup, /Weekly decay ÷2/)
  assert.match(newSplitMarkup, /Next halving in 100 epochs/)
  const championHotkey = split.reward_slots[0].miner_hotkey
  const keysOutMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.RewardSeats, { seats: normalizeCompetitionRewardSeats({ ...split, king: { hotkey: championHotkey }, champion_reward_factor_ppm: 500000 }) }))
  assert.match(keysOutMarkup, /Weekly decay ÷4 · Keys out ÷2/, 'both reasons sit beside the number')
  assert.match(keysOutMarkup, /aria-label="2\.5% now\. See why this share is reduced"/, 'the actual number opens the reasons')
  assert.match(keysOutMarkup, /Hover or tap the current share/)
  const fullMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.RewardSeats, { seats: normalizeCompetitionRewardSeats({ ...liveSeats, champion_reward_factor_ppm: 1000000 }) }))
  assert.doesNotMatch(fullMarkup, /<s /, 'a full share is not struck through')
  assert.match(fullMarkup, /Full share · next halving in 25 epochs/)
  assert.doesNotMatch(fullMarkup, /before any halving/, 'a published full factor needs no caveat')
  assert.match(renderToStaticMarkup(React.createElement(renderedModule.exports.RewardSeats, { seats: normalizeCompetitionRewardSeats(liveSeats) })), /before any halving for a champion’s failed provider keys/, 'without the factor the page says what it cannot confirm')

  // Decay is never guessed, and a signed policy without a pot keeps total-emissions arithmetic.
  const { weekly_slot_decay: _clock, ...withoutClock } = liveSeats
  assert.deepEqual(normalizeCompetitionRewardSeats(withoutClock).seats.map((seat) => seat.currentSharePercent), [null, null, null])
  assert.equal(normalizeCompetitionRewardSeats({ ...liveSeats, epoch_eligible: false }).seats[0].currentSharePercent, null)
  const { pool_percent: _pool, ...noPool } = liveSeats.reward_slot_policy
  assert.equal(normalizeCompetitionRewardSeats({ ...liveSeats, reward_slot_policy: noPool }).seats[0].baseSharePercent, 40)
  for (const malformed of [null, {}, { ...liveSeats, reward_slots: [null] }, { ...liveSeats, reward_slots: [{ miner_hotkey: '5X' }, null, null] }, { ...liveSeats, reward_slot_policy: { ...liveSeats.reward_slot_policy, tiers: [] } }]) {
    assert.equal(normalizeCompetitionRewardSeats(malformed), null, 'a seat response outside the contract shows no seats')
  }
  const { pool_percent: _newPool, ...newPolicyWithoutPool } = totalEmissionsPolicy
  for (const policy of [
    { ...totalEmissionsPolicy, allocation_basis: null },
    { ...totalEmissionsPolicy, allocation_basis: 'unknown' },
    { ...totalEmissionsPolicy, pool_percent: 0 },
    { ...totalEmissionsPolicy, pool_percent: 101 },
    { ...totalEmissionsPolicy, pool_percent: 50 },
    newPolicyWithoutPool,
    { ...totalEmissionsPolicy, tiers: totalEmissionsPolicy.tiers.map((tier, i) => i === 0 ? { ...tier, allocation_percent: 101 } : tier) },
    { ...totalEmissionsPolicy, tiers: totalEmissionsPolicy.tiers.map((tier, i) => i === 0 ? { ...tier, allocation_percent: -1 } : tier) },
    { ...totalEmissionsPolicy, tiers: totalEmissionsPolicy.tiers.map((tier, i) => i === 0 ? { ...tier, allocation_percent: 34.5 } : tier) },
    { ...totalEmissionsPolicy, tiers: [...totalEmissionsPolicy.tiers].reverse() },
    { ...totalEmissionsPolicy, tiers: totalEmissionsPolicy.tiers.map((tier) => ({ ...tier, minimum_improvement: 15 })) },
    { ...liveSeats.reward_slot_policy, tiers: liveSeats.reward_slot_policy.tiers.map((tier, i) => i === 0 ? { ...tier, allocation_percent: 41 } : tier) },
    { tiers: totalEmissionsPolicy.tiers },
  ]) assert.equal(normalizeCompetitionRewardSeats({ ...liveSeats, reward_slot_policy: policy }), null, 'malformed reward policies must not display fabricated shares')
  assert.deepEqual([20, 1.25, 0.001].map(formatRewardSeatShare), ['20%', '1.25%', '<0.01%'])

  const seatsMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.RewardSeats, { seats: { seats: splitSeats } }))
  assert.match(seatsMarkup, /\+20 or more/)
  assert.match(seatsMarkup, /<s [^>]*><span [^>]*>Full share <\/span>20%<\/s>/)
  assert.match(seatsMarkup, /Next halving in 133 epochs/)
  assert.match(seatsMarkup, /5NewerSmallWinner/)
  assert.match(seatsMarkup, /Open\. No winner holds this seat/)
  assert.match(renderToStaticMarkup(React.createElement(renderedModule.exports.RewardSeats, { seats: null })), /temporarily unavailable/)

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
