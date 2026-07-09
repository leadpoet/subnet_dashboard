import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'research-lab-compute-spend-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/research-lab-compute-spend.ts'),
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

  assert.equal(tsc.status, 0, 'compute spend helper should compile')

  const require = createRequire(import.meta.url)
  const {
    buildResearchLabDailyComputeSpend,
    receiptEventCostMicrousd,
  } = require(join(outDir, 'research-lab-compute-spend.js'))

  assert.equal(
    receiptEventCostMicrousd({
      final_cost_ledger: {
        actual_openrouter_cost_microusd: 750_000,
        actual_openrouter_cost_usd: 99,
      },
    }),
    750_000,
    'canonical microusd should take precedence over USD fallbacks',
  )

  const spend = buildResearchLabDailyComputeSpend({
    days: 3,
    now: new Date('2026-07-09T19:30:00Z'),
    receiptRunIds: new Map([['receipt-c', 'run-c']]),
    events: [
      {
        receipt_id: 'receipt-a',
        created_at: '2026-07-08T23:00:00Z',
        event_doc: {
          run_id: 'run-a',
          final_cost_ledger: { actual_openrouter_cost_usd: 1 },
        },
      },
      {
        receipt_id: 'receipt-a',
        created_at: '2026-07-09T01:00:00Z',
        event_doc: {
          run_id: 'run-a',
          final_cost_ledger: { actual_openrouter_cost_usd: 1.25 },
        },
      },
      {
        receipt_id: 'receipt-b',
        created_at: '2026-07-09T10:00:00Z',
        event_doc: {
          run_id: 'run-b',
          final_cost_ledger: { actual_openrouter_cost_microusd: 500_000 },
        },
      },
      {
        receipt_id: 'receipt-c',
        created_at: '2026-07-08T15:00:00Z',
        event_doc: {
          final_cost_ledger: { total_usd: 2 },
        },
      },
      {
        receipt_id: 'missing-run',
        created_at: '2026-07-09T12:00:00Z',
        event_doc: { final_cost_ledger: { total_usd: 50 } },
      },
      {
        receipt_id: 'outside-window',
        created_at: '2026-07-06T12:00:00Z',
        event_doc: {
          run_id: 'run-old',
          final_cost_ledger: { total_usd: 50 },
        },
      },
    ],
  })

  assert.deepEqual(spend.points, [
    { date: '2026-07-07', spendUsd: 0, runCount: 0 },
    { date: '2026-07-08', spendUsd: 2, runCount: 1 },
    { date: '2026-07-09', spendUsd: 1.75, runCount: 2 },
  ])
  assert.equal(spend.totalUsd, 3.75)
  assert.equal(spend.averageDailyUsd, 1.25)
  assert.equal(spend.latestDayUsd, 1.75)
  assert.equal(spend.runCount, 3)

  const adminRouteSource = await readFile(resolve('src/app/api/admin/research-lab/route.ts'), 'utf8')
  assert.match(adminRouteSource, /\.filter\(\(loop\) => isActiveResearchLabLoopStatus\(loop\.statusKey\)\)/)
  assert.match(adminRouteSource, /id: 'awaiting_funding'/)
  assert.match(adminRouteSource, /id: 'waiting_credits'/)
  assert.match(adminRouteSource, /fetchComputeSpendSummary/)

  const componentSource = await readFile(resolve('src/app/admin/_components/AdminResearchLab.tsx'), 'utf8')
  assert.match(componentSource, /Daily compute spend/)
  assert.match(componentSource, /Finalized OpenRouter cost/)

  console.log('research-lab-compute-spend: daily ledger aggregation and admin wiring passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
