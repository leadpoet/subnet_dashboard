import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

// Keep compiled React fixtures below this repository's node_modules so their
// generated `react/jsx-runtime` import resolves without mutating NODE_PATH.
const outDir = await mkdtemp(join(resolve('node_modules'), '.research-lab-current-benchmark-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/research-lab-benchmark.ts'),
    '--target', 'ES2022',
    '--module', 'CommonJS',
    '--moduleResolution', 'Node',
    '--outDir', outDir,
    '--strict',
    '--skipLibCheck',
  ], { stdio: 'inherit' })
  assert.equal(tsc.status, 0, 'current benchmark date helper should compile')

  const require = createRequire(import.meta.url)
  const { utcCalendarDateKey } = require(join(outDir, 'research-lab-benchmark.js'))
  assert.equal(
    utcCalendarDateKey(new Date('2026-08-18T23:59:59.999Z')),
    '2026-08-18',
    'benchmark dates use the UTC calendar day before midnight',
  )
  assert.equal(
    utcCalendarDateKey(new Date('2026-08-19T00:00:00.000Z')),
    '2026-08-19',
    'benchmark date changes at the UTC day boundary',
  )

  const routeSource = await readFile(resolve('src/app/api/research-lab/route.ts'), 'utf8')
  assert.match(
    routeSource,
    /fetchLatestBenchmark\([\s\S]*\.eq\('benchmark_date', currentBenchmarkDate\)/,
    'public benchmark query must select the current UTC benchmark date',
  )
  assert.match(
    routeSource,
    /cache\.benchmarkDate === currentBenchmarkDate/,
    'cached snapshots must not cross the UTC day boundary',
  )
  assert.match(
    routeSource,
    /fetchLatestBenchmark\(supabase, currentBenchmarkDate\)/,
    'benchmark fetch must use the current UTC date key',
  )
  assert.match(
    routeSource,
    /\.eq\('run_type', 'private_baseline_rebenchmark'\)[\s\S]*\.eq\('benchmark_date', currentBenchmarkDate\)/,
    'scoring telemetry must be limited to the current UTC day',
  )
  assert.match(
    routeSource,
    /publicSnapshotFlightBenchmarkDate !== currentBenchmarkDate[\s\S]*publicSnapshotFlight\.current = null/,
    'an in-flight snapshot must not cross the UTC day boundary',
  )
  assert.match(
    routeSource,
    /servingModelVersion: publicBenchmarkServingModelVersion\(doc\)/,
    'the public payload must normalize baseline and promoted serving-model lineage',
  )

  const publicBenchmarkCompile = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/research-lab-public-benchmark.ts'),
    resolve('src/components/dashboard/ResearchLabBenchmarkLineage.tsx'),
    '--target', 'ES2022',
    '--module', 'CommonJS',
    '--moduleResolution', 'Node',
    '--jsx', 'react-jsx',
    '--rootDir', resolve('src'),
    '--outDir', outDir,
    '--strict',
    '--skipLibCheck',
  ], { stdio: 'inherit' })
  assert.equal(publicBenchmarkCompile.status, 0, 'public benchmark normalizers and lineage UI should compile')

  const {
    normalizeBenchmarkServingModelVersion,
    normalizePublicBenchmarkCounts,
    publicBenchmarkServingModelVersion,
  } = require(join(outDir, 'lib/research-lab-public-benchmark.js'))
  const nestedLineage = normalizeBenchmarkServingModelVersion({
    run_id: 'run-123',
    git_commit_sha: 'a'.repeat(40),
    model_artifact_hash: `sha256:${'b'.repeat(64)}`,
    manifest_hash: `sha256:${'c'.repeat(64)}`,
    benchmark_attempt: 0,
    evaluation_epoch: 0,
    version_stamp_hash: `sha256:${'d'.repeat(64)}`,
    public_stamp_hash: `sha256:${'e'.repeat(64)}`,
    candidate_id: 'private-candidate',
    parent_model: { image_digest: 'private-image' },
  })
  assert.deepEqual(Object.keys(nestedLineage), [
    'runId', 'gitCommitSha', 'modelArtifactHash', 'manifestHash',
    'benchmarkAttempt', 'evaluationEpoch', 'versionStampHash', 'publicStampHash',
  ])
  assert.equal(nestedLineage.benchmarkAttempt, 0)
  assert.equal(nestedLineage.evaluationEpoch, 0)
  assert.doesNotMatch(JSON.stringify(nestedLineage), /private-candidate|private-image/)

  assert.deepEqual(
    publicBenchmarkServingModelVersion({
      activation_git_commit_sha: 'f'.repeat(40),
      activation_model_artifact_hash: `sha256:${'1'.repeat(64)}`,
      activation_manifest_hash: `sha256:${'2'.repeat(64)}`,
      source_candidate_id: 'private-candidate',
    }),
    {
      runId: null,
      gitCommitSha: 'f'.repeat(40),
      modelArtifactHash: `sha256:${'1'.repeat(64)}`,
      manifestHash: `sha256:${'2'.repeat(64)}`,
      benchmarkAttempt: null,
      evaluationEpoch: null,
      versionStampHash: null,
      publicStampHash: null,
    },
  )
  assert.equal(publicBenchmarkServingModelVersion({ source_candidate_id: 'private' }), null)
  assert.deepEqual(
    normalizePublicBenchmarkCounts({
      visibility_split: { public_count: 10, private_count: 10, conditional_count: 20 },
    }),
    { itemCount: 40, publicIcpCount: 10, privateHoldoutIcpCount: 10, conditionalHoldoutIcpCount: 20 },
  )
  assert.deepEqual(
    normalizePublicBenchmarkCounts({
      item_count: 40,
      public_icp_count: 10,
      private_holdout_icp_count: 10,
      conditional_holdout_icp_count: 20,
    }),
    { itemCount: 40, publicIcpCount: 10, privateHoldoutIcpCount: 10, conditionalHoldoutIcpCount: 20 },
  )

  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const { ResearchLabBenchmarkLineage } = require(join(
    outDir,
    'components/dashboard/ResearchLabBenchmarkLineage.js',
  ))
  const lineageHtml = renderToStaticMarkup(React.createElement(ResearchLabBenchmarkLineage, {
    lineage: nestedLineage,
    currentStatusLabel: 'Aug 23, 2026, 5:00 AM',
  }))
  assert.match(lineageHtml, new RegExp(`title="sha256:${'b'.repeat(64)}"[^>]*>Model b{12}<`))
  assert.match(lineageHtml, new RegExp(`title="${'a'.repeat(40)}"[^>]*>Commit a{12}<`))
  assert.match(lineageHtml, /title="run-123"[^>]*>Run run-123</)
  assert.match(lineageHtml, />Attempt 0</)
  assert.match(lineageHtml, />Epoch 0</)
  assert.match(lineageHtml, />Current Aug 23, 2026, 5:00 AM</)
  assert.equal(
    renderToStaticMarkup(React.createElement(ResearchLabBenchmarkLineage, {
      lineage: null,
      currentStatusLabel: null,
    })),
    '',
  )

  const componentSource = await readFile(resolve('src/components/dashboard/ResearchLab.tsx'), 'utf8')
  assert.match(componentSource, /<ArenaHero arena=\{data\?\.arena/)
  assert.match(componentSource, /No retired benchmark report is available for today/)
  assert.match(componentSource, /: 'in progress'/)
  assert.doesNotMatch(componentSource, /No benchmark has been published yet/)
  assert.doesNotMatch(componentSource, /Last published:/)
  assert.match(componentSource, /Public Pydantic baseline · Arena/)
  assert.match(componentSource, /\{benchmark\.publicIcpCount\}<\/span> public/)
  assert.match(componentSource, /\{benchmark\.privateHoldoutIcpCount\}<\/span> private/)
  assert.match(componentSource, /\{benchmark\.conditionalHoldoutIcpCount\}<\/span> conditional/)

  console.log('research-lab-current-benchmark: UTC date filtering, cache rollover, public lineage, and in-progress UI passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
