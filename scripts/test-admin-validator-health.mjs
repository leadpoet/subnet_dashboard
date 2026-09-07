import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'admin-validator-health-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/admin-validator-health.ts'),
    '--target', 'ES2022', '--module', 'CommonJS', '--moduleResolution', 'Node',
    '--lib', 'ES2022,DOM', '--outDir', outDir, '--strict', '--skipLibCheck',
  ], { stdio: 'inherit' })
  assert.equal(tsc.status, 0, 'validator health helper should compile')

  const require = createRequire(import.meta.url)
  const {
    dedupeLatestValidatorNodes,
    evaluateValidatorDeploymentEvidence,
    isFreshAttestationTimestamp,
    isFreshTimestamp,
    isValidCommitSha,
    selectCurrentValidatorNode,
    selectValidatorPcrNode,
  } = require(join(outDir, 'admin-validator-health.js'))
  const now = Date.parse('2026-09-07T03:00:00Z')
  const primary = {
    id: 'primary:old', component: 'primary-validator', nodeId: 'primary',
    hotkey: 'primary', observedPcr0: 'p'.repeat(96),
    gitSha: 'a'.repeat(40), attestedAt: '2026-09-07T02:59:00Z',
  }
  const newerPrimary = { ...primary, id: 'primary:new', observedPcr0: 'q'.repeat(96), attestedAt: '2026-09-07T02:59:30Z' }
  const gateway = {
    id: 'gateway', component: 'gateway-coordinator', nodeId: 'gateway',
    hotkey: 'gateway', observedPcr0: 'g'.repeat(96),
    gitSha: 'b'.repeat(40), attestedAt: '2026-09-07T02:59:50Z',
  }

  assert.equal(isValidCommitSha('a'.repeat(40)), true)
  assert.equal(isValidCommitSha('future-or-short'), false)
  assert.equal(isFreshTimestamp('2026-09-07T03:00:30Z', now, 300_000), true)
  assert.equal(isFreshTimestamp('2026-09-07T03:02:00Z', now, 300_000), false)
  assert.equal(isFreshAttestationTimestamp('2026-09-07T03:01:00Z', now, 300_000), false)
  const invalidPrimary = { ...primary, id: 'primary:invalid', attestedAt: 'not-a-timestamp' }
  assert.deepEqual(dedupeLatestValidatorNodes([invalidPrimary, newerPrimary]), [newerPrimary])
  assert.deepEqual(dedupeLatestValidatorNodes([primary, newerPrimary, gateway]), [newerPrimary])
  assert.equal(selectCurrentValidatorNode([gateway]), null)
  assert.equal(selectValidatorPcrNode([gateway]), null)
  assert.equal(selectValidatorPcrNode([gateway, primary, newerPrimary]), newerPrimary)

  const gatewayOnlyEvidence = evaluateValidatorDeploymentEvidence(
    null,
    [gateway],
    now,
  )
  assert.equal(gatewayOnlyEvidence.currentRuntimeVerified, false)
  assert.equal(gatewayOnlyEvidence.sourceAvailable, false)

  const futureReceipt = evaluateValidatorDeploymentEvidence(
    {
      commitSha: 'c'.repeat(40),
      buildId: 'boot',
      reportedAt: '2026-09-07T03:02:00Z',
    },
    [],
    now,
  )
  assert.equal(futureReceipt.currentRuntimeVerified, false)
  assert.match(futureReceipt.verificationReason, /No current validator runtime/)

  const invalidReceipt = evaluateValidatorDeploymentEvidence(
    {
      commitSha: 'not-a-commit',
      buildId: 'boot',
      reportedAt: '2026-09-07T02:59:00Z',
    },
    [],
    now,
  )
  assert.equal(invalidReceipt.currentRuntimeVerified, false)
  assert.equal(invalidReceipt.sourceAvailable, false)

  const routeSource = await readFile(resolve('src/app/api/admin/research-lab/route.ts'), 'utf8')
  const observationSource = await readFile(resolve('src/lib/admin-alert-observations.ts'), 'utf8')
  assert.match(routeSource, /buildAdminAlertObservations/)
  assert.match(observationSource, /published_weight_bundles/)
  assert.match(observationSource, /fetchMetagraphFn/)
  assert.match(observationSource, /monitorPcr0/)
  assert.match(observationSource, /monitorOffchainWeights/)
  assert.match(observationSource, /monitorOnchainWeights/)
  assert.match(observationSource, /lastUpdates\?\./)
  assert.match(observationSource, /currentBlock/)
  assert.doesNotMatch(observationSource, /fetchGatewayPcr0Acceptance/)
  assert.match(routeSource, /fetchMetagraphFn:\s*fetchMetagraph/)
  assert.match(routeSource, /selectValidatorPcrNode\(attestation\.nodes\)/)
  assert.match(routeSource, /Metadata available/)
  console.log('admin-validator-health: validator filtering, timestamp guards, and metadata-only gateway status passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
