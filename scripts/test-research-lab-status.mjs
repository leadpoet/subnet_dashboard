import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'research-lab-status-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/research-lab-status.ts'),
    '--target',
    'ES2022',
    '--module',
    'CommonJS',
    '--moduleResolution',
    'Node',
    '--outDir',
    outDir,
    '--strict',
    '--skipLibCheck',
  ], { stdio: 'inherit' })

  assert.equal(tsc.status, 0, 'status helper should compile')

  const require = createRequire(import.meta.url)
  const {
    deriveResearchLabLoopStatus,
    filterResearchLabActivityLoops,
    RESEARCH_LAB_OUTCOME_FILTER_OPTIONS,
    researchLabOutcomeFilterOptionsWithCounts,
  } = require(join(outDir, 'research-lab-status.js'))

  const cases = [
    {
      name: 'active scoring candidate renders Scoring, not Waiting for baseline',
      input: {
        outcomeLabel: 'scoring',
        outcomeBand: 'running',
        currentCandidateStatus: 'evaluating',
        currentReason: 'gateway_qualification_worker_heartbeat',
        candidateCount: 1,
        scoredCandidateCount: 0,
        runId: 'run-0',
        receiptId: 'receipt-0',
      },
      expected: {
        key: 'scoring',
        label: 'Scoring',
        band: 'running',
        active: true,
        scoring: true,
      },
    },
    {
      name: 'baseline_not_ready candidate renders Waiting for baseline',
      input: {
        outcomeLabel: 'scoring',
        outcomeBand: 'running',
        currentCandidateStatus: 'queued',
        currentReason: 'baseline_not_ready',
        currentQueueStatus: 'queued',
        runId: 'run-1',
        receiptId: 'receipt-1',
      },
      expected: {
        key: 'waiting_for_baseline',
        label: 'Waiting for baseline',
        band: 'pending',
        active: false,
        scoring: false,
        detail: 'Scoring is waiting for the benchmark baseline to become ready.',
      },
    },
    {
      name: 'explicit waiting_for_baseline outcome renders Waiting for baseline',
      input: {
        outcomeLabel: 'waiting_for_baseline',
        outcomeBand: 'pending',
        currentCandidateStatus: 'evaluating',
        currentReason: 'gateway_qualification_worker_heartbeat',
        candidateCount: 1,
        scoredCandidateCount: 0,
        runId: 'run-1a',
        receiptId: 'receipt-1a',
      },
      expected: {
        key: 'waiting_for_baseline',
        label: 'Waiting for baseline',
        band: 'pending',
        active: false,
        scoring: false,
        detail: 'Scoring is waiting for the benchmark baseline to become ready.',
      },
    },
    {
      name: 'completed queue with baseline_not_ready unscored candidate renders Waiting for baseline',
      input: {
        outcomeLabel: 'completed',
        outcomeBand: 'completed',
        currentCandidateStatus: 'queued',
        currentReason: 'baseline_not_ready',
        currentQueueStatus: 'completed',
        candidateCount: 1,
        scoredCandidateCount: 0,
        runId: 'run-1b',
        receiptId: 'receipt-1b',
      },
      expected: {
        key: 'waiting_for_baseline',
        label: 'Waiting for baseline',
        band: 'pending',
        active: false,
        scoring: false,
        detail: 'Candidate generation completed, but scoring is waiting for the benchmark baseline.',
      },
    },
    {
      name: 'stale_parent_needs_rescore renders Needs rescore',
      input: {
        outcomeLabel: 'needs_rescore',
        outcomeBand: 'stale',
        currentCandidateStatus: 'queued',
        currentReason: 'stale_parent_needs_rescore',
        runId: 'run-2',
        receiptId: 'receipt-2',
      },
      expected: {
        key: 'needs_rescore',
        label: 'Needs rescore',
        band: 'stale',
        active: false,
        scoring: false,
        detail: 'Candidate was created against an older parent model and needs to be rebased or rescored against the current parent.',
      },
    },
    {
      name: 'terminal failed queue does not become primary Failed without canonical failed outcome',
      input: {
        outcomeLabel: 'running',
        outcomeBand: 'stale',
        currentCandidateStatus: 'needs_rescore',
        currentReason: 'stale_parent',
        currentQueueStatus: 'failed',
        runId: 'run-3',
        receiptId: 'receipt-3',
      },
      expected: {
        key: 'needs_rescore',
        label: 'Needs rescore',
        band: 'stale',
        active: false,
        scoring: false,
      },
    },
    {
      name: 'scored candidate with no benchmark gain renders Scored, no gain',
      input: {
        outcomeLabel: 'running',
        outcomeBand: 'no_gain',
        currentCandidateStatus: 'scored',
        currentQueueStatus: 'completed',
        scoredCandidateCount: 1,
        runId: 'run-4',
        receiptId: 'receipt-4',
      },
      expected: {
        key: 'scored_no_gain',
        label: 'Scored, no gain',
        band: 'no_gain',
        active: false,
        scoring: false,
      },
    },
    {
      name: 'raw scored_no_gain renders Scored, no gain even with unscored candidate counts',
      input: {
        outcomeLabel: 'scored_no_gain',
        outcomeBand: 'no_gain',
        currentCandidateStatus: 'queued',
        candidateCount: 1,
        scoredCandidateCount: 0,
        runId: 'run-4b',
        receiptId: 'receipt-4b',
      },
      expected: {
        key: 'scored_no_gain',
        label: 'Scored, no gain',
        band: 'no_gain',
        active: false,
        scoring: false,
      },
    },
    {
      name: 'scored_no_gain with failed band and failed queue stays Scored, no gain',
      input: {
        outcomeLabel: 'scored_no_gain',
        outcomeBand: 'failed',
        currentCandidateStatus: 'scored',
        currentQueueStatus: 'failed',
        currentReceiptStatus: 'failed',
        candidateCount: 1,
        scoredCandidateCount: 1,
        runId: 'a45c7b0d-e2db-4933-b214-8afe6f80e21f',
        receiptId: 'receipt-ef544527',
      },
      expected: {
        key: 'scored_no_gain',
        label: 'Scored, no gain',
        band: 'no_gain',
        active: false,
        scoring: false,
        detail: 'Queue or receipt state is terminal failed, but the canonical model outcome is preserved.',
      },
    },
    {
      name: 'canonical failed outcome renders Failed',
      input: {
        outcomeLabel: 'failed',
        outcomeBand: 'failed',
        currentCandidateStatus: 'scored',
        currentQueueStatus: 'completed',
        candidateCount: 1,
        scoredCandidateCount: 1,
        runId: 'run-failed',
        receiptId: 'receipt-failed',
      },
      expected: {
        key: 'failed',
        label: 'Failed',
        band: 'failed',
        active: false,
        scoring: false,
      },
    },
    {
      name: 'raw submitted without run stays a neutral Submitted fallback',
      input: {
        outcomeLabel: 'submitted',
        outcomeBand: 'pending',
        runId: null,
        receiptId: null,
      },
      expected: {
        key: 'submitted',
        label: 'Submitted',
        band: 'pending',
        active: false,
        scoring: false,
      },
    },
  ]

  for (const fixture of cases) {
    const actual = deriveResearchLabLoopStatus(fixture.input)
    assert.equal(actual.key, fixture.expected.key, fixture.name)
    assert.equal(actual.label, fixture.expected.label, fixture.name)
    assert.equal(actual.band, fixture.expected.band, fixture.name)
    assert.equal(actual.active, fixture.expected.active, fixture.name)
    assert.equal(actual.scoring, fixture.expected.scoring, fixture.name)
    if (fixture.expected.detail) {
      assert.equal(actual.note?.detail, fixture.expected.detail, fixture.name)
    }
  }

  const optionValues = RESEARCH_LAB_OUTCOME_FILTER_OPTIONS.map((option) => option.value)
  assert.deepEqual(optionValues, [
    'all',
    'scoring',
    'waiting_for_baseline',
    'not_started',
    'completed_no_candidate',
    'failed',
    'scored',
    'scored_no_gain',
    'blocked_for_credit',
    'needs_rescore',
  ], 'outcome filter options should include required statuses')

  const activityLoops = [
    {
      id: 'scoring-alpha-a',
      minerHotkey: 'alpha-hotkey',
      topicSignatureHash: 'direction-a',
      topicTags: ['intent_quality', 'query_generation'],
      researchArea: 'ops',
      outcomeLabel: 'scoring',
      statusKey: 'scoring',
      lastActivityAt: '2026-01-04T00:00:00Z',
    },
    {
      id: 'scored-no-gain-failed-ops',
      minerHotkey: 'alpha-hotkey',
      topicSignatureHash: 'direction-a',
      topicTags: ['intent_quality', 'evidence_freshness'],
      researchArea: 'ops',
      outcomeLabel: 'scored_no_gain',
      statusKey: deriveResearchLabLoopStatus({
        outcomeLabel: 'scored_no_gain',
        outcomeBand: 'failed',
        currentCandidateStatus: 'scored',
        currentQueueStatus: 'failed',
        scoredCandidateCount: 1,
      }).key,
      lastActivityAt: '2026-01-03T12:00:00Z',
    },
    {
      id: 'waiting-alpha-a',
      minerHotkey: 'alpha-hotkey',
      topicSignatureHash: 'direction-a',
      topicTags: ['intent_quality'],
      researchArea: 'ops',
      outcomeLabel: 'scoring',
      statusKey: 'waiting_for_baseline',
      lastActivityAt: '2026-01-03T00:00:00Z',
    },
    {
      id: 'scored-beta-a',
      minerHotkey: 'beta-hotkey',
      topicSignatureHash: 'direction-a',
      topicTags: ['query_generation'],
      researchArea: 'ops',
      outcomeLabel: 'scored_promising',
      statusKey: 'scored_promising',
      lastActivityAt: '2026-01-02T00:00:00Z',
    },
    {
      id: 'scoring-alpha-b',
      minerHotkey: 'alpha-hotkey',
      topicSignatureHash: 'direction-b',
      topicTags: ['revops', 'intent_quality'],
      researchArea: 'ops',
      outcomeLabel: 'scoring',
      statusKey: 'scoring',
      lastActivityAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'failed-gamma-b',
      minerHotkey: 'gamma-hotkey',
      topicSignatureHash: 'direction-b',
      topicTags: ['revops'],
      researchArea: 'ops',
      outcomeLabel: 'failed',
      statusKey: 'failed',
      lastActivityAt: '2025-12-31T00:00:00Z',
    },
    {
      id: 'failed-alpha-a',
      minerHotkey: 'alpha-hotkey',
      topicSignatureHash: 'direction-a',
      topicTags: ['intent_quality'],
      researchArea: 'ops',
      outcomeLabel: 'failed',
      statusKey: deriveResearchLabLoopStatus({
        outcomeLabel: 'failed',
        outcomeBand: 'failed',
        currentCandidateStatus: 'scored',
      }).key,
      lastActivityAt: '2025-12-30T00:00:00Z',
    },
  ]

  const byId = (loops) => loops.map((loop) => loop.id)
  assert.deepEqual(
    byId(filterResearchLabActivityLoops(activityLoops, { outcome: 'waiting_for_baseline' })),
    ['waiting-alpha-a'],
    'outcome filter should find explicit waiting_for_baseline status'
  )
  assert.deepEqual(
    byId(filterResearchLabActivityLoops(activityLoops, { outcome: 'scoring' })),
    ['scoring-alpha-a', 'scoring-alpha-b'],
    'outcome filter should find only scoring statuses'
  )
  assert.deepEqual(
    byId(filterResearchLabActivityLoops(activityLoops, { outcome: 'scored_no_gain' })),
    ['scored-no-gain-failed-ops'],
    'Scored, no gain filter should include failed-ops scored_no_gain rows'
  )
  assert.deepEqual(
    byId(filterResearchLabActivityLoops(activityLoops, { outcome: 'failed' })),
    ['failed-gamma-b', 'failed-alpha-a'],
    'Failed filter should exclude scored_no_gain rows even if ops failed'
  )
  assert.deepEqual(
    byId(filterResearchLabActivityLoops(activityLoops, { outcome: 'scored' })),
    ['scored-beta-a'],
    'Scored outcome filter should include scored_promising records'
  )
  assert.deepEqual(
    byId(filterResearchLabActivityLoops(activityLoops, { direction: 'query_generation' })),
    ['scoring-alpha-a', 'scored-beta-a'],
    'direction filter should match loops where the selected tag is one of several tags'
  )
  assert.deepEqual(
    byId(filterResearchLabActivityLoops(activityLoops, { direction: 'evidence_freshness' })),
    ['scored-no-gain-failed-ops'],
    'direction filter should expose isolated tags instead of combined signatures'
  )
  assert.deepEqual(
    byId(filterResearchLabActivityLoops(activityLoops, {
      minerQuery: 'alpha',
      direction: 'query_generation',
      outcome: 'scoring',
    })),
    ['scoring-alpha-a'],
    'miner, direction, and outcome filters should combine'
  )

  const countedOutcomeOptions = researchLabOutcomeFilterOptionsWithCounts(activityLoops, {
    minerQuery: 'alpha',
    direction: 'intent_quality',
  })
  const countedOutcomeValues = countedOutcomeOptions.map((option) => option.value)
  const countByValue = Object.fromEntries(
    countedOutcomeOptions.map((option) => [option.value, option.count])
  )
  assert.deepEqual(
    countedOutcomeValues,
    ['all', 'scoring', 'waiting_for_baseline', 'failed', 'scored_no_gain'],
    'outcome dropdown should hide empty buckets'
  )
  assert.equal(countByValue.all, 5, 'All outcomes count should match visible miner+direction records')
  assert.equal(countByValue.scoring, 2, 'Scoring outcome count should match visible filtered records')
  assert.equal(countByValue.waiting_for_baseline, 1, 'Waiting outcome count should match visible filtered records')
  assert.equal(countByValue.scored_no_gain, 1, 'Scored, no gain outcome count should match visible filtered records')
  assert.equal(countByValue.failed, 1, 'Failed outcome count should match visible filtered records')

  console.log(`research-lab-status: ${cases.length} status fixtures and filter fixtures passed`)
} finally {
  await rm(outDir, { recursive: true, force: true })
}
