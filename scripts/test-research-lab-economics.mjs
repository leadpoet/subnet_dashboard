import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'research-lab-economics-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/research-lab-economics.ts'),
    '--target', 'ES2022',
    '--module', 'CommonJS',
    '--moduleResolution', 'Node',
    '--outDir', outDir,
    '--strict',
    '--skipLibCheck',
  ], { stdio: 'inherit' })
  assert.equal(tsc.status, 0, 'economics helpers should compile')

  const require = createRequire(import.meta.url)
  const {
    authoritativeImprovementPoints,
    buildEconomicsAllocationSummary,
    candidatePipelineGroup,
    queueReasonLabel,
  } = require(join(outDir, 'research-lab-economics.js'))

  const summary = buildEconomicsAllocationSummary({
    epoch: 23916,
    netuid: 71,
    snapshot_status: 'active',
    lab_cap_alpha_percent: 30,
    source_add_alpha_percent: 0,
    reimbursement_alpha_percent: 4.964095,
    champion_alpha_percent: 23.1335,
    queued_champion_alpha_percent: 1.902405,
    unallocated_alpha_percent: 0,
    created_at: '2026-07-13T04:30:38Z',
    allocation_doc: {
      champion_allocations: [{ miner_hotkey: '5full', paid_alpha_percent: 23.1335 }],
      queued_champion_allocations: [{ miner_hotkey: '5partial', paid_alpha_percent: 1.902405 }],
      reimbursement_allocations: [{ miner_hotkey: '5compute', paid_alpha_percent: 4.964095 }],
    },
  })
  assert.equal(summary.reconciled, true, 'allocation totals should reconcile to the Lab cap')
  assert.equal(summary.reconciliationTotal.value, 30)
  assert.equal(summary.minerCounts.champions, 1, 'fully funded champion miner should be counted')
  assert.equal(summary.minerCounts.queuedChampions, 1, 'partial champion miner should be counted in queue')

  const mismatch = buildEconomicsAllocationSummary({
    ...summary,
    epoch: 1,
    lab_cap_alpha_percent: 30,
    reimbursement_alpha_percent: 5,
    champion_alpha_percent: 20,
    queued_champion_alpha_percent: 2,
    source_add_alpha_percent: 0,
    unallocated_alpha_percent: 0,
    created_at: '2026-07-13T00:00:00Z',
  })
  assert.equal(mismatch.reconciled, false, 'mismatched allocations should fail closed')
  assert.equal(queueReasonLabel('queued_with_partial_capacity'), 'Partially funded — Lab cap reached')
  assert.equal(queueReasonLabel('queued_no_capacity'), 'Waiting — no remaining champion capacity')
  assert.equal(queueReasonLabel('future_reason'), 'future_reason', 'unknown queue reasons must remain visible')

  const privateMetric = authoritativeImprovementPoints({
    private_holdout_gate: {
      decision: 'private_holdout_approved',
      private_holdout_evaluated: true,
      candidate_delta_vs_daily_baseline: 9.225,
    },
    aggregates: { mean_delta: 4.1 },
  })
  assert.equal(privateMetric.value, 9.225, 'approved private holdout should use daily-baseline delta')
  assert.match(privateMetric.basis, /daily baseline/)

  const legacyMetric = authoritativeImprovementPoints({ aggregates: { mean_delta: 3.75 } })
  assert.equal(legacyMetric.value, 3.75, 'legacy bundles should use aggregate mean delta')
  assert.match(legacyMetric.basis, /Legacy bundle/)
  assert.equal(candidatePipelineGroup('queued', 'candidate_created', null), 'Waiting for scoring')
  assert.equal(candidatePipelineGroup('scored', 'rebase_queued', null), 'Rebase queued')
  assert.notEqual(candidatePipelineGroup('scored', 'rebase_queued', null), 'Waiting for emission capacity')

  const routeSource = await readFile(resolve('src/app/api/admin/research-lab/economics/route.ts'), 'utf8')
  const componentSource = await readFile(resolve('src/app/admin/_components/AdminResearchLabEconomics.tsx'), 'utf8')
  assert.match(routeSource, /\.range\(from, from \+ pageSize - 1\)/, 'primary lists should use bounded database pages')
  assert.match(routeSource, /fetchPagedRows\('payout history'/, 'paid-to-date history should page beyond PostgREST caps')
  assert.match(routeSource, /paidThisEpoch > 0 \? 'earning' : 'not_paid'/, 'active obligation alone must not prove payment')
  assert.match(routeSource, /research_lab_epoch_payouts/, 'actual reimbursement payments should come from payout evidence')
  assert.match(componentSource, /per-run, per-hotkey daily, per-island daily, and global budget caps/, 'reimbursement caps should be explained')
  assert.match(componentSource, /Candidate improvement pipeline[\s\S]*separate from the emission-capacity queue/, 'candidate and capacity queues should be distinguished')
  assert.match(componentSource, /no matching published weight record/, 'missing weight epochs should warn operators')
  assert.match(routeSource, /Legacy publication only — no V2 finalization evidence/, 'legacy publication must not claim chain finalization')
  assert.doesNotMatch(componentSource, /private_model_manifest|image_digest|patch_payload|proxy|credential/i, 'client output must not expose private fields')

  console.log('research-lab-economics: allocation, reward, queue, reimbursement, scoring, weight, pagination, and sanitization checks passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
