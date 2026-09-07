import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const outDir = await mkdtemp(join(tmpdir(), 'admin-alert-observations-'))

try {
  const compile = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/admin-alert-observations.ts'),
    '--target', 'ES2022', '--module', 'CommonJS', '--moduleResolution', 'Node',
    '--lib', 'ES2022,DOM', '--outDir', outDir, '--strict', '--skipLibCheck',
  ], { stdio: 'inherit' })
  assert.equal(compile.status, 0, 'alert observation helper should compile')

  const require = createRequire(import.meta.url)
  const { buildAdminAlertObservations } = require(join(outDir, 'admin-alert-observations.js'))
  const { evaluateResearchLabAlerts } = require(join(outDir, 'research-lab-alerts.js'))

  const rows = [
    { validator_hotkey: 'configured-missing', epoch_id: 1, created_at: '2026-09-07T02:00:00Z' },
    { validator_hotkey: 'observed-healthy', epoch_id: 2, created_at: '2026-09-07T02:59:59Z' },
  ]
  const queried = []
  const supabase = {
    from(table) {
      assert.equal(table, 'published_weight_bundles')
      let requestedHotkeys = []
      const query = {
        select() { return query },
        eq() { return query },
        in(_column, values) { requestedHotkeys = values; return query },
        order() { return query },
        limit() {
          queried.push(requestedHotkeys)
          return Promise.resolve({ data: rows, error: null })
        },
      }
      return query
    },
  }

  const observations = await buildAdminAlertObservations({
    supabase,
    attestationNodes: [{
      id: 'healthy-node', nodeId: 'healthy-node', hotkey: 'observed-healthy',
      expectedPcr0: 'same', observedPcr0: 'same', matched: true,
      attestedAt: '2026-09-07T02:59:59Z',
    }],
    gateway: { checkedAt: '2026-09-07T02:59:59Z' },
    configuredValidators: [
      {
        hotkey: 'configured-missing', enabled: true, monitorPcr0: true,
        monitorOffchainWeights: true, monitorOnchainWeights: true, expectedPcr0: 'expected',
      },
      {
        hotkey: 'observed-disabled', enabled: true, monitorPcr0: false,
        monitorOffchainWeights: false, monitorOnchainWeights: false, expectedPcr0: null,
      },
      {
        hotkey: 'observed-healthy', enabled: true, monitorPcr0: true,
        monitorOffchainWeights: true, monitorOnchainWeights: true, expectedPcr0: 'same',
      },
    ],
    fetchMetagraphFn: async () => ({
      lastUpdates: { 'configured-missing': 0, 'observed-healthy': 999 },
      currentBlock: 1_000,
    }),
  })

  assert.deepEqual(queried, [['configured-missing', 'observed-healthy']])
  const byId = new Map(observations.validators.map((validator) => [validator.validatorId, validator]))
  assert.equal(byId.has('configured-missing'), true, 'configured missing validator must be retained')
  assert.equal(byId.get('configured-missing').offchainWeightBundle.publishedAt, '2026-09-07T02:00:00Z')
  assert.equal(byId.get('configured-missing').pcr0.observedPcr0, null, 'historical bundle must not provide runtime PCR0')
  assert.equal(byId.get('observed-disabled').pcr0, undefined)
  assert.equal(byId.get('observed-disabled').offchainWeightBundle, undefined)
  assert.equal(byId.get('observed-disabled').onchainUpdate, undefined)
  assert.equal(byId.get('observed-healthy').onchainUpdate.lastUpdateBlock, 999)

  const now = '2026-09-07T03:00:00Z'
  const evaluated = evaluateResearchLabAlerts(observations, {
    now,
    thresholds: {
      pcr0Stale: { warnMs: 10_000, criticalMs: 20_000 },
      offchainWeightBundleStale: { warnMs: 10_000, criticalMs: 20_000 },
      onchainValidatorUpdateStale: { warnMs: 10, criticalMs: 20, warnBlocks: 10, criticalBlocks: 20 },
    },
  })
  assert.deepEqual(
    evaluated.map((alert) => `${alert.entityId}:${alert.signal}`).sort(),
    [
      'configured-missing:offchain_weight_bundle_stale',
      'configured-missing:onchain_validator_update_stale',
      'configured-missing:pcr0_missing',
    ],
  )
  console.log('admin-alert-observations: configured union, real bundle freshness, monitor flags, and runtime separation passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
