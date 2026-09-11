import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
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
    competitionSubmissionStatusLabel,
    competitionRoundOptions,
    formatCompetitionScore,
    normalizeCompetitionBenchmark,
    normalizeCompetitionCommitment,
    normalizeCompetitionCode,
    normalizeCompetitionResults,
    normalizeCompetitionSnapshot,
    normalizeCompetitionSubmissions,
    verifyCompetitionBenchmark,
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

  const revealAt = '2026-09-14T00:00:00Z'
  const committedAt = '2026-09-13T00:00:01Z'
  const rawIcps = Array.from({ length: 20 }, (_, index) => ({
    icp_id: `committed-${index}`,
    prompt: index === 0 ? 'Find cafés in Montréal ☕' : `Committed ICP ${index}`,
    industry: index % 2 === 0 ? 'Software' : null,
    employee_count: ['11-50'],
    qualification: { minimum_score: index + 0.5, required: true },
  }))
  const canonicalPreimages = rawIcps.map((icp, index) => canonicalJson({
    schema_version: 'leadpoet.lab_arena.benchmark_leaf.v1', network_name: 'finney', netuid: 71,
    round_id: 'arena-2026-09-13', icp_set_date: '2026-09-12', evaluation_date: '2026-09-13',
    icp_position: index, nonce: index.toString(16).padStart(64, '0'), icp,
  }))
  const manifest = {
    schema_version: 'leadpoet.lab_arena.benchmark_commitment.v1', network_name: 'finney', netuid: 71,
    round_id: 'arena-2026-09-13', icp_set_date: '2026-09-12', evaluation_date: '2026-09-13',
    public_at: revealAt, disclosure_policy: 'commit_reveal_day2_v1', icp_count: 20,
    entries: canonicalPreimages.map((preimage, index) => ({ icp_position: index, icp_hash: sha256(preimage) })),
  }
  const canonicalManifest = canonicalJson(manifest)
  const manifestHash = sha256(canonicalManifest)
  const commitmentPayload = {
    round_id: manifest.round_id, manifest, manifest_hash: manifestHash,
    canonical_manifest: canonicalManifest, committed_at: committedAt,
  }
  const newRoundPayload = {
    ...published, round_id: manifest.round_id, status: 'published', network_name: 'finney', netuid: 71,
    icp_set_date: manifest.icp_set_date, evaluation_date: manifest.evaluation_date, public_at: revealAt,
    submission_open: '2026-09-12T00:00:00Z', submission_cutoff: '2026-09-13T00:00:00Z',
    disclosure_policy: 'commit_reveal_day2_v1', benchmark_state: 'reveal_available',
    benchmark_commitment_hash: manifestHash, benchmark_committed_at: committedAt,
  }
  const newSnapshot = normalizeCompetitionSnapshot({
    mode: 'live', network_name: 'finney', netuid: 71, rounds: [newRoundPayload], latest_round: newRoundPayload,
  })
  assert.ok(newSnapshot)
  assert.equal(newSnapshot.latestRound.disclosurePolicy, 'commit_reveal_day2_v1')
  assert.equal(newSnapshot.latestRound.benchmarkState, 'reveal_available')
  assert.equal(normalizeCompetitionSnapshot({ mode: 'live', network_name: 'finney', netuid: 71, rounds: [{ ...newRoundPayload, disclosure_policy: 'future_policy' }] }).rounds.length, 0, 'unknown disclosure policies fail closed')
  assert.equal(normalizeCompetitionSnapshot({ mode: 'live', network_name: 'finney', netuid: 71, rounds: [{ ...newRoundPayload, public_at: '2026-02-30T00:00:00Z' }] }).rounds.length, 0, 'UTC timestamps that roll into another date fail closed')
  const commitment = normalizeCompetitionCommitment(commitmentPayload, newSnapshot.latestRound)
  assert.ok(commitment)
  assert.equal(commitment.manifest.entries.length, 20)
  assert.equal(normalizeCompetitionCommitment({ ...commitmentPayload, extra: true }, newSnapshot.latestRound), null, 'the commitment envelope has an exact field set')
  assert.equal(normalizeCompetitionCommitment({ ...commitmentPayload, canonical_manifest: canonicalJson({ ...manifest, netuid: 1 }) }, newSnapshot.latestRound), null, 'canonical manifest content must match the displayed manifest')

  const sharedFixture = JSON.parse(await readFile(resolve('scripts/fixtures/benchmark_commit_reveal_v1.json'), 'utf8'))
  const sharedManifest = sharedFixture.commitment.manifest
  const sharedRound = {
    ...newSnapshot.latestRound,
    roundId: sharedManifest.round_id,
    networkName: sharedManifest.network_name,
    netuid: sharedManifest.netuid,
    icpSetDate: sharedManifest.icp_set_date,
    evaluationDate: sharedManifest.evaluation_date,
    publicAt: sharedManifest.public_at,
    benchmarkCommitmentHash: sharedFixture.commitment.manifest_hash,
    benchmarkCommittedAt: sharedFixture.commitment.committed_at,
  }
  const sharedReveal = normalizeCompetitionBenchmark(sharedFixture.reveal, sharedRound)
  assert.ok(sharedReveal, 'the shared Python commitment fixture must satisfy the dashboard parser')
  assert.match(sharedFixture.reveal.verification.canonical_preimages[0], /café 日本/, 'the shared vector exercises exact UTF-8 bytes')
  assert.match(sharedFixture.reveal.verification.canonical_preimages[0], /1e-07/, 'the shared vector preserves Python float serialization')
  assert.deepEqual(await verifyCompetitionBenchmark(sharedReveal), { ok: true, message: 'Matches published commitment' }, 'Web Crypto verifies Python canonical bytes')
  const permutedRevealPayload = structuredClone(sharedFixture.reveal)
  ;[permutedRevealPayload.verification.canonical_preimages[0], permutedRevealPayload.verification.canonical_preimages[1]] = [permutedRevealPayload.verification.canonical_preimages[1], permutedRevealPayload.verification.canonical_preimages[0]]
  const permutedReveal = normalizeCompetitionBenchmark(permutedRevealPayload, sharedRound)
  assert.ok(permutedReveal)
  assert.deepEqual(await verifyCompetitionBenchmark(permutedReveal), { ok: false, message: 'A benchmark preimage has the wrong round scope or position.' }, 'canonical preimages must remain in exact position order')
  const sharedChangedRevealPayload = structuredClone(sharedFixture.reveal)
  sharedChangedRevealPayload.icps[0].prompt = 'changed after reveal'
  const sharedChangedReveal = normalizeCompetitionBenchmark(sharedChangedRevealPayload, sharedRound)
  assert.ok(sharedChangedReveal)
  assert.deepEqual(await verifyCompetitionBenchmark(sharedChangedReveal), { ok: false, message: 'ICP 1 does not match its committed preimage.' }, 'displayed raw ICP fields remain bound to the Python preimage')
  const reusedNoncePayload = resignReveal(sharedFixture.reveal, (preimages) => { preimages[1].nonce = preimages[0].nonce })
  const reusedNonceRound = { ...sharedRound, benchmarkCommitmentHash: reusedNoncePayload.commitment.manifest_hash }
  const reusedNonceReveal = normalizeCompetitionBenchmark(reusedNoncePayload, reusedNonceRound)
  assert.ok(reusedNonceReveal)
  assert.deepEqual(await verifyCompetitionBenchmark(reusedNonceReveal), { ok: false, message: 'The revealed benchmark reuses a commitment nonce.' })
  const reservedFieldPayload = resignReveal(sharedFixture.reveal, (preimages) => { preimages[2].icp.icp_position = 2 })
  const reservedFieldRound = { ...sharedRound, benchmarkCommitmentHash: reservedFieldPayload.commitment.manifest_hash }
  const reservedFieldReveal = normalizeCompetitionBenchmark(reservedFieldPayload, reservedFieldRound)
  assert.ok(reservedFieldReveal)
  assert.deepEqual(await verifyCompetitionBenchmark(reservedFieldReveal), { ok: false, message: 'A benchmark preimage does not match the public schema.' }, 'reserved display fields are forbidden inside committed raw ICPs')
  const oversizedPreimagePayload = resignReveal(sharedFixture.reveal, (preimages) => {
    preimages[4].icp.oversized = 'x'.repeat(256 * 1024)
  })
  oversizedPreimagePayload.icps[4].oversized = 'x'.repeat(256 * 1024)
  const oversizedPreimageRound = { ...sharedRound, benchmarkCommitmentHash: oversizedPreimagePayload.commitment.manifest_hash }
  const oversizedPreimageReveal = normalizeCompetitionBenchmark(oversizedPreimagePayload, oversizedPreimageRound)
  assert.ok(oversizedPreimageReveal)
  assert.deepEqual(await verifyCompetitionBenchmark(oversizedPreimageReveal), { ok: false, message: 'ICP 5 preimage exceeds the verification limit.' })

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
  assert.equal(normalizeCompetitionBenchmark({ ...benchmarkPayload, oversized: 'x'.repeat(8 * 1024 * 1024) }), null, 'oversized reveal documents fail closed')

  const revealPayload = {
    round_id: manifest.round_id, icp_set_date: manifest.icp_set_date, public_at: revealAt,
    public_icp_count: 20, private_icp_count: 0, disclosure_policy: 'commit_reveal_day2_v1',
    icps: rawIcps.map((icp, index) => ({ ...icp, icp_position: index, baseline_score: index })),
    commitment: commitmentPayload,
    verification: { manifest_hash: manifestHash, canonical_preimages: canonicalPreimages },
  }
  const reveal = normalizeCompetitionBenchmark(revealPayload, newSnapshot.latestRound)
  assert.ok(reveal)
  assert.deepEqual(reveal.icps[0].raw, rawIcps[0], 'display decorators stay outside the exact raw ICP')
  assert.deepEqual(await verifyCompetitionBenchmark(reveal), { ok: true, message: 'Matches published commitment' })
  const changedReveal = normalizeCompetitionBenchmark({
    ...revealPayload,
    icps: revealPayload.icps.map((icp, index) => index === 7 ? { ...icp, prompt: 'changed after commit' } : icp),
  }, newSnapshot.latestRound)
  assert.ok(changedReveal)
  assert.deepEqual(await verifyCompetitionBenchmark(changedReveal), { ok: false, message: 'ICP 8 does not match its committed preimage.' })
  const tamperedPreimages = [...canonicalPreimages]
  tamperedPreimages[3] = canonicalPreimages[3].replace('Committed ICP 3', 'tampered ICP 3')
  const tamperedReveal = normalizeCompetitionBenchmark({
    ...revealPayload, verification: { manifest_hash: manifestHash, canonical_preimages: tamperedPreimages },
  }, newSnapshot.latestRound)
  assert.ok(tamperedReveal)
  assert.deepEqual(await verifyCompetitionBenchmark(tamperedReveal), { ok: false, message: 'ICP 4 hash verification failed.' })

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
  const aggregateOnly = normalizeCompetitionResults({
    round_id: manifest.round_id, submission_id: 'miner-1', public_icp_status: 'pending',
    scores: {}, submission_scores: { stage_1: 72.25, final: 81.5 },
  })
  assert.ok(aggregateOnly)
  assert.equal(aggregateOnly.finalScore, 81.5, 'Day 1 aggregate scores remain public before benchmark details')
  assert.equal(aggregateOnly.publicScores.size, 0)
  assert.equal(normalizeCompetitionResults({
    round_id: manifest.round_id, submission_id: 'miner-1', public_icp_status: 'pending',
    scores: { stage_1: [{ icp_position: 0, per_icp_score: 99 }] }, submission_scores: { final: 81.5 },
  }), null, 'pending results fail closed if raw per-ICP details leak into the response')
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
  }).outputText + '\nexports.RoundSummary = RoundSummary; exports.PublishedResults = PublishedResults;', {
    module: renderedModule, exports: renderedModule.exports,
    require(name) {
      if (name === '@/lib/research-lab-competition') return require(join(outDir, 'research-lab-competition.js'))
      // These imports belong to other panels, which this summary must not run.
      if (name === '@/lib/hooks/useVisiblePolling' || name === '@/lib/research-lab-emissions') return {}
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
  assert.match(renderSummary(newSnapshot.latestRound), /Day 2 · Benchmark reveal/)
  assert.match(renderSummary(newSnapshot.latestRound), /Benchmark hashes publish before scoring/)
  const day1ResultsMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.PublishedResults, {
    benchmark: null, benchmarkState: 'gated', results: aggregateOnly, resultsState: 'available',
    round: { ...newSnapshot.latestRound, status: 'published', benchmarkState: 'committed' },
    submission: { ...submissions[0], finalScore: 81.5 }, verification: null, verifying: false, onVerify() {},
  }))
  assert.match(day1ResultsMarkup, /Published aggregate scores/)
  assert.match(day1ResultsMarkup, /81\.50/, 'Day 1 aggregate scoring must render while plaintext remains gated')
  assert.match(day1ResultsMarkup, /remain hidden until the round is terminal/)
  const delayedMarkup = renderToStaticMarkup(React.createElement(renderedModule.exports.PublishedResults, {
    benchmark: null, benchmarkState: 'gated', results: aggregateOnly, resultsState: 'available',
    round: { ...newSnapshot.latestRound, status: 'stage2', benchmarkState: 'reveal_delayed' },
    submission: { ...submissions[0], finalScore: 81.5 }, verification: null, verifying: false, onVerify() {},
  }))
  assert.match(delayedMarkup, /Reveal delayed: evaluation is still running\./)
  for (const promotionStatus of ['pending', 'promoted']) {
    const markup = renderSummary({ ...snapshot.latestCompletedRound, promotionStatus,
      champion: { submissionId: 'winner', minerHotkey: '5winner', finalScore: 51, outcome: 'new_king' } })
    assert.match(markup, /Champion/)
    assert.match(markup, promotionStatus === 'promoted' ? /Becomes next baseline/ : /Promotion pending/)
  }
  assert.doesNotMatch(component, /if \(!competition\) return/, 'an Arena outage must not hide the independent settlement view')
  assert.match(component, /competition\?\.repoUrl \?\? DEFAULT_REPO_URL/)
  assert.match(component, /Competition data is temporarily unavailable\. This page will retry automatically\./)
  assert.match(component, /<LabEmissionSplit spend=\{settlement\?\.labMinerSpend \?\? null\}/)
  assert.match(component, /const selectedRound = roundOptions\[0\] \?\? null/, 'the displayed round must follow the automatic priority order on every refresh')
  assert.doesNotMatch(component, /selectedRoundId|setSelectedRoundId|onSelectRound|roundOptionLabel|Competition round/, 'manual round selection must remain absent')
  assert.match(component, /Public ICPs \(20\)/)
  assert.match(component, /Improve the public agent and compete on the same daily ICPs\./)
  assert.match(component, /All 20 ICPs are public for this round\./)
  assert.match(component, /value="PydanticAI"/)
  assert.doesNotMatch(component, /server-held .* evaluation view/)
  assert.match(component, /gatedStatuses\.includes\(response\.status\)/)
  assert.match(component, /icp\.position/)
  assert.match(component, /results\?\.publicIcpStatus === 'ready'/)
  assert.match(component, /useVisiblePolling\(refreshRound, 60_000, \{ enabled: active \}\)/)
  assert.match(component, /selectedSubmissionIdRef\.current !== requestedSubmissionId/)
  assert.match(component, /Last known submissions are shown below/)
  assert.match(component, /normalized\?\.roundId !== requestedRoundId/)
  assert.match(component, /Code becomes public when Day 1 evaluation is complete\./)
  assert.match(component, /This round was cancelled\. Aggregate and per-ICP scores were not published\./)
  assert.match(component, /This round was cancelled\. Source code was not published\./)
  assert.match(component, /Published aggregate scores/)
  assert.match(component, /Plaintext ICPs are released separately from aggregate scores and source\./)
  assert.match(component, /Reveal delayed: evaluation is still running\./)
  assert.doesNotMatch(component, /Matches saved Day 1 commitment/)
  assert.doesNotMatch(component, /24.hour|24 hours|private ICP/i)
  assert.match(component, /Day 0 · Submissions/)
  assert.match(component, /Day 1 · Evaluation/)
  assert.match(component, /const submissionDate = utcCalendarDate\(round\.submissionOpen\) \?\? round\.icpSetDate/)
  assert.match(component, /const legacyDaily = submissionDate === round\.icpSetDate\s+&& isNextUtcDay\(submissionDate, round\.evaluationDate\)\s+&& utcCalendarDate\(round\.publicAt\) === round\.evaluationDate/, 'historical bank and disclosure dates must not be relabeled as the new daily cycle')
  assert.match(component, /key=\{`\$\{selectedRound\.networkName\}:\$\{selectedRound\.netuid\}:\$\{selectedRound\.roundId\}`\}/, 'round and network switches must remount the release workspace')
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
  const commitmentRoute = await readFile(resolve('src/app/api/research-lab/rounds/[roundId]/benchmark-commitment/route.ts'), 'utf8')
  assert.match(commitmentRoute, /publicArenaId/)
  assert.match(commitmentRoute, /benchmark-commitment/)

  const shell = await readFile(resolve('src/components/dashboard/DashboardClient.tsx'), 'utf8')
  assert.match(shell, /label="Open Source Agent Competition"/)
  const faq = await readFile(resolve('src/components/dashboard/FAQ.tsx'), 'utf8')
  assert.doesNotMatch(faq, /24.hour|24 hours|keeps the complementary|fixed 10-ICP/i)

  console.log('research-lab-competition: public projection, honest scores, release gates, and narrow proxy checks passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function resignReveal(source, mutate) {
  const reveal = structuredClone(source)
  const preimages = reveal.verification.canonical_preimages.map((value) => JSON.parse(value))
  mutate(preimages)
  reveal.verification.canonical_preimages = preimages.map(canonicalJson)
  reveal.commitment.manifest.entries = reveal.verification.canonical_preimages.map((value, index) => ({ icp_position: index, icp_hash: sha256(value) }))
  reveal.commitment.canonical_manifest = canonicalJson(reveal.commitment.manifest)
  reveal.commitment.manifest_hash = sha256(reveal.commitment.canonical_manifest)
  reveal.verification.manifest_hash = reveal.commitment.manifest_hash
  return reveal
}
