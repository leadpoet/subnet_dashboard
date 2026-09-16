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
    formatCompetitionScore,
    normalizeCompetitionBenchmark,
    normalizeCompetitionCode,
    normalizeCompetitionResults,
    normalizeCompetitionSnapshot,
    normalizeCompetitionSubmissions,
    isCompetitionReviewExcluded,
  } = require(join(outDir, 'research-lab-competition.js'))
  assert.equal(DEFAULT_REPO_URL, 'https://github.com/leadpoet/champion_model/tree/lab')

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
    repo_url: 'https://github.com/leadpoet/champion_model/tree/lab',
    open_round: null, latest_round: cancelled, latest_completed_round: published,
    rounds: [cancelled, published],
  })
  assert.ok(snapshot)
  assert.equal(snapshot.repoUrl, DEFAULT_REPO_URL)
  assert.equal(normalizeCompetitionSnapshot({
    mode: 'live', network_name: 'finney', netuid: 71,
    repo_url: 'https://github.com/leadpoet/champion_model/tree/main', rounds: [],
  }).repoUrl, 'https://github.com/leadpoet/champion_model/tree/main')
  assert.equal(normalizeCompetitionSnapshot({
    mode: 'live', network_name: 'finney', netuid: 71,
    repo_url: 'https://github.com/leadpoet/champion_model-unrelated/tree/lab', rounds: [],
  }).repoUrl, DEFAULT_REPO_URL)
  assert.equal(snapshot.latestCompletedRound.baseline.finalScore, 0, 'zero is a real score, not missing data')
  assert.equal(snapshot.latestCompletedRound.evaluationDate, '2026-09-05')
  assert.deepEqual(competitionRoundOptions(snapshot).map((round) => round.roundId), ['arena-2026-09-09', 'arena-2026-09-05'])
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
    'Scoring failed',
    'a failed submission must not look scored or promotable',
  )
  assert.equal(formatCompetitionScore(0), '0.00', 'a real zero score must remain published')
  const champion = { ...submissions[0], status: 'champion', isChampion: true }
  assert.equal(competitionSubmissionStatusLabel(champion, pendingRound), 'Champion · promotion pending')
  assert.equal(
    competitionSubmissionStatusLabel(champion, { ...pendingRound, promotionStatus: 'promoted' }),
    'Champion · promoted',
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
  assert.equal(benchmark.privateIcpCount, 0)
  assert.equal(benchmark.disclosurePolicy, 'all_20_next_day')
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
  assert.equal(results.publicIcpStatus, 'ready')
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

  const code = normalizeCompetitionCode({ submission_id: 'miner-1', files: [{ path: 'agent.py', content: 'print(1)' }], truncated: true })
  assert.deepEqual(code.files[0], { path: 'agent.py', content: 'print(1)', language: null })
  assert.equal(code.truncated, true)

  const component = await readFile(resolve('src/components/dashboard/ResearchLab.tsx'), 'utf8')
  const renderedModule = { exports: {} }
  vm.runInNewContext(ts.transpileModule(component, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText + '\nexports.RoundSummary = RoundSummary; exports.SubmissionTable = SubmissionTable; exports.PublishedResults = PublishedResults; exports.SourcePanel = SourcePanel;', {
    module: renderedModule, exports: renderedModule.exports,
    require(name) {
      if (name === '@/lib/research-lab-competition') return require(join(outDir, 'research-lab-competition.js'))
      // These imports belong to other panels, which this summary must not run.
      if (name === '@/lib/hooks/useVisiblePolling') return {}
      return require(name)
    },
  })
  const renderSummary = (round) => renderToStaticMarkup(React.createElement(renderedModule.exports.RoundSummary, { round }))
  for (const status of ['open', 'committed', 'stage1', 'stage1_scored', 'stage2', 'scored']) {
    const markup = renderSummary({ ...snapshot.latestCompletedRound, status, publishedAt: null, baseline: null })
    assert.match(markup, /Pending/, `${status} must not imply a final promotion decision`)
    assert.match(markup, /Decision follows completed evaluation/)
    assert.doesNotMatch(markup, /Not required|No champion was published|Stage1 scored/)
    if (status === 'scored') assert.match(markup, /Publishing results/)
    else if (status !== 'open') assert.match(markup, /Scoring/)
  }
  const finalMarkup = renderSummary(snapshot.latestCompletedRound)
  assert.match(finalMarkup, /Not required/)
  assert.match(finalMarkup, /No champion was published/)
  assert.match(finalMarkup, /0\.00/, 'a published zero baseline is not pending')
  assert.match(renderSummary(snapshot.latestRound), /Cancelled round/)
  assert.doesNotMatch(renderSummary(snapshot.latestRound), /Decision follows completed evaluation/)
  for (const promotionStatus of ['pending', 'promoted']) {
    const markup = renderSummary({ ...snapshot.latestCompletedRound, promotionStatus,
      champion: { submissionId: 'winner', minerHotkey: '5winner', finalScore: 51, outcome: 'new_king' } })
    assert.match(markup, /Champion/)
    assert.match(markup, promotionStatus === 'promoted' ? /Becomes next baseline/ : /Promotion pending/)
  }

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
  assert.equal(competitionSubmissionStatusLabel(passedWithStaleError, pendingRound), 'Queued')
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
  assert.doesNotMatch(reviewSourceMarkup, /View released source|Source locked|Available after evaluation/)

  // Public September 12 state, reduced to fields needed for status rendering.
  const credentialFixture = JSON.parse(await readFile(resolve('scripts/fixtures/competition-credential-error-20260912.json'), 'utf8'))
  const submissionsRouteSource = await readFile(resolve('src/app/api/research-lab/rounds/[roundId]/submissions/route.ts'), 'utf8')
  const proxySource = await readFile(resolve('src/lib/arena-public-proxy.ts'), 'utf8')
  async function projectSubmissions(detail = credentialFixture.failed_result, detailStatus = 200) {
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
          ? Response.json(credentialFixture.submissions)
          : Response.json(detail, { status: detailStatus })
      },
    })
    const routeModule = { exports: {} }
    vm.runInNewContext(ts.transpileModule(submissionsRouteSource, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, {
      module: routeModule, exports: routeModule.exports,
      require: (name) => name === '@/lib/arena-public-proxy' ? proxyModule.exports : require(name),
    })
    const response = await routeModule.exports.GET(null, { params: Promise.resolve({ roundId: credentialFixture.submissions.round_id }) })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0, must-revalidate')
    assert.deepEqual(calls, [
      `${credentialFixture.source}/submissions`,
      `${credentialFixture.source}/results/${credentialFixture.failed_result.submission_id}`,
    ], 'only the failed submission needs a detail lookup')
    return response.json()
  }
  const projected = await projectSubmissions()
  const liveSubmissions = normalizeCompetitionSubmissions(projected)
  const failedSubmission = liveSubmissions.find((row) => row.submissionId === credentialFixture.failed_result.submission_id)
  assert.equal(failedSubmission.status, 'scoring_failed', 'the competition status must stay unchanged')
  assert.equal(failedSubmission.finalScore, null)
  assert.equal(competitionSubmissionStatusLabel(failedSubmission, credentialFixture.round), 'Provider credential error')
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
  assert.match(tableMarkup, /Provider credential error/)
  assert.doesNotMatch(tableMarkup, /Scoring failed/)
  const renderFailedResults = (submission) => renderToStaticMarkup(React.createElement(renderedModule.exports.PublishedResults, {
    submission, round: credentialFixture.round, benchmark, benchmarkState: 'available', results: null, resultsState: 'error',
  }))
  assert.match(renderFailedResults(failedSubmission), /Provider credential error\. No complete evaluation score is available\./)
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
    assert.equal(competitionSubmissionStatusLabel(submission, credentialFixture.round), 'Scoring failed')
    assert.match(renderFailedResults(submission), /Scoring failed\. No complete evaluation score is available\./)
  }
  for (const status of ['queued', 'running', 'accepted', 'failed', 'scored', 'champion', 'cancelled', 'not_selected']) {
    for (const isBaseline of [false, true]) {
      for (const promotionStatus of ['pending', 'promoted', 'not_required']) {
        const submission = { ...submissions[0], status, isBaseline }
        const round = { ...pendingRound, promotionStatus }
        assert.equal(competitionSubmissionStatusLabel({ ...submission, failureReason: 'credential_error' }, round), competitionSubmissionStatusLabel(submission, round), `${status} must not inherit a historical credential failure`)
      }
    }
  }
  assert.doesNotMatch(component, /if \(!competition\) return/, 'an Arena outage must render its retry state')
  assert.match(component, /competition\?\.repoUrl \?\? DEFAULT_REPO_URL/)
  assert.match(component, /Competition data is temporarily unavailable\. This page will retry automatically\./)
  assert.doesNotMatch(component, /settlement|LabEmissionSplit|\/api\/research-lab\?/)
  assert.match(component, /const selectedRound = roundOptions\[0\] \?\? null/, 'the displayed round must follow the automatic priority order on every refresh')
  assert.doesNotMatch(component, /selectedRoundId|setSelectedRoundId|onSelectRound|roundOptionLabel|Competition round/, 'manual round selection must remain absent')
  assert.match(component, /Public ICPs \(20\)/)
  assert.match(component, /Improve the public agent and compete on the same daily ICPs\./)
  assert.match(component, /All 20 ICPs are public for this round\./)
  assert.match(component, /value="PydanticAI"/)
  assert.doesNotMatch(component, /server-held .* evaluation view/)
  assert.match(component, /response\.status === 403/)
  assert.match(component, /icp\.position/)
  assert.match(component, /publicIcpStatus !== 'ready'/)
  assert.match(component, /useVisiblePolling\(refreshRound, 60_000, \{ enabled: active \}\)/)
  assert.match(component, /selectedSubmissionIdRef\.current !== requestedSubmissionId/)
  assert.match(component, /if \(!selectedSubmissionId \|\| reviewExcluded\) return/, 'terminal review failures must not request a result')
  assert.ok(component.indexOf('if (!selectedSubmissionId || reviewExcluded) return') < component.indexOf('fetchReleasedJson(`/api/research-lab/rounds/${encodeURIComponent(requestedRoundId)}/results/'), 'the review exclusion gate must run before the result request')
  assert.match(component, /Last known submissions are shown below/)
  assert.match(component, /normalized\?\.roundId !== requestedRoundId/)
  assert.match(component, /Code becomes public when Day 1 evaluation is complete\./)
  assert.match(component, /This round was cancelled\. Aggregate and per-ICP scores were not published\./)
  assert.match(component, /This round was cancelled\. Source code was not published\./)
  assert.match(component, /Scores and source code appear when evaluation is complete\./)
  assert.match(component, /<PendingIcpResults benchmark=\{benchmark\}>/)
  assert.match(component, /if \(submission\.status === 'scoring_failed'\) return <PendingIcpResults benchmark=\{benchmark\}>\{competitionSubmissionStatusLabel\(submission, round\)\}\. No complete evaluation score is available\./, 'failed-run zero placeholders must not render as completed per-ICP evaluations')
  assert.ok(component.indexOf("if (submission.status === 'scoring_failed')") < component.indexOf('const scores = submission.isBaseline'), 'failure status must gate baseline score rendering too')
  assert.doesNotMatch(component, /24.hour|24 hours|private ICP/i)
  assert.match(component, /Day 0 · Submissions/)
  assert.match(component, /Day 1 · Evaluation/)
  assert.match(component, /const submissionDate = utcCalendarDate\(round\.submissionOpen\) \?\? round\.icpSetDate/)
  assert.match(component, /const nextDay = submissionDate === round\.icpSetDate\s+&& isNextUtcDay\(submissionDate, round\.evaluationDate\)\s+&& utcCalendarDate\(round\.publicAt\) === round\.evaluationDate/, 'historical bank and disclosure dates must not be relabeled as the new daily cycle')
  assert.match(component, /No final baseline score has been published for this round\./)
  assert.match(component, /label="Round baseline" value="PydanticAI"/)
  assert.match(component, /ICP set · \{formatUtcDate\(icpSetDate\)\}/)
  assert.match(component, /normalizeCompetitionBenchmark\(benchmarkRequest\.value\.body, round\)/)
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
  assert.match(shell, /label="Open Source Agent Competition"/)
  const faq = await readFile(resolve('src/components/dashboard/FAQ.tsx'), 'utf8')
  assert.doesNotMatch(faq, /24.hour|24 hours|keeps the complementary|fixed 10-ICP/i)

  console.log('research-lab-competition: public projection, honest scores, release gates, and narrow proxy checks passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
