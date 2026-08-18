import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'research-lab-current-benchmark-'))

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

  const componentSource = await readFile(resolve('src/components/dashboard/ResearchLab.tsx'), 'utf8')
  assert.match(componentSource, /if \(!benchmark\) return <ScoringHero telemetry=\{telemetry\} \/>/)
  assert.match(componentSource, /Today&apos;s benchmark is still in progress/)
  assert.match(componentSource, /: 'in progress'/)
  assert.doesNotMatch(componentSource, /No benchmark has been published yet/)
  assert.doesNotMatch(componentSource, /Last published:/)

  console.log('research-lab-current-benchmark: UTC date filtering, cache rollover, and in-progress UI passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
