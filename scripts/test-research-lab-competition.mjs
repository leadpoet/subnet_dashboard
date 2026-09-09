import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

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
    competitionSubmissionStatusLabel,
    competitionRoundOptions,
    formatCompetitionScore,
    normalizeCompetitionBenchmark,
    normalizeCompetitionCode,
    normalizeCompetitionResults,
    normalizeCompetitionSnapshot,
    normalizeCompetitionSubmissions,
  } = require(join(outDir, 'research-lab-competition.js'))
  assert.equal(DEFAULT_REPO_URL, 'https://github.com/leadpoet/pydantic-harness/tree/lab')

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
    repo_url: 'https://github.com/leadpoet/pydantic-harness/tree/lab',
    open_round: null, latest_round: cancelled, latest_completed_round: published,
    rounds: [cancelled, published],
  })
  assert.ok(snapshot)
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
  assert.doesNotMatch(component, /if \(!competition\) return/, 'an Arena outage must not hide the independent settlement view')
  assert.match(component, /competition\?\.repoUrl \?\? DEFAULT_REPO_URL/)
  assert.match(component, /Competition data is temporarily unavailable\. This page will retry automatically\./)
  assert.match(component, /<LabEmissionSplit spend=\{settlement\?\.labMinerSpend \?\? null\}/)
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
  assert.match(component, /Last known submissions are shown below/)
  assert.match(component, /normalized\?\.roundId !== requestedRoundId/)
  assert.match(component, /Code becomes public when Day 1 evaluation is complete\./)
  assert.match(component, /This round was cancelled\. Aggregate and per-ICP scores were not published\./)
  assert.match(component, /This round was cancelled\. Source code was not published\./)
  assert.match(component, /Scores and source code appear when evaluation is complete\./)
  assert.match(component, /<PendingIcpResults benchmark=\{benchmark\}>/)
  assert.match(component, /if \(submission\.status === 'scoring_failed'\) return <PendingIcpResults benchmark=\{benchmark\}>Scoring failed\. No complete evaluation score is available\./, 'failed-run zero placeholders must not render as completed per-ICP evaluations')
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
  assert.match(proxy, /AbortSignal\.timeout\(8_000\)/)
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
