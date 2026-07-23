// PR test for the get_chain_summaries batching change:
//  - the pure reshaping of the batched RPC response (winners -> keys / lead map /
//    chain-canonical rows), including partial/missing rows and first-claim dedup;
//  - the migration's safety guards (100-id bound, cycle-safe UNION recursion) and
//    that winners return the full consumed fields, not just lead_id.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'chain-summaries-'))

const tsc = spawnSync(process.execPath, [
  resolve('node_modules/typescript/bin/tsc'),
  resolve('src/lib/chain-summaries.ts'),
  '--target', 'ES2022', '--module', 'CommonJS', '--moduleResolution', 'Node',
  '--outDir', outDir, '--strict', '--skipLibCheck',
], { stdio: 'inherit' })
assert.equal(tsc.status, 0, 'chain-summaries helper should compile')

const require = createRequire(import.meta.url)
const { reshapeChainSummaries } = require(join(outDir, 'chain-summaries.js'))

// --- reshaping: full winner rows -> keys, lead map, canonical rows ---
const rids = ['rid-a', 'rid-b', 'rid-missing']
const summaries = [
  {
    request_id: 'rid-a',
    winners: [
      { lead_id: 'L1', consensus_id: 'c1', is_winner: true, consensus_final_score: 9 },
      { lead_id: 'L2', consensus_id: 'c2', is_winner: true, consensus_final_score: 8 },
    ],
    root_num_leads: 20,
    held_count: 2,
  },
  {
    request_id: 'rid-b',
    // L1 also appears here (recycled chain) -> first-claim (rid-a) must win.
    winners: [{ lead_id: 'L1', consensus_id: 'c3', is_winner: true, consensus_final_score: 7 }],
    root_num_leads: null,
    held_count: 5,
  },
]

const r = reshapeChainSummaries(rids, summaries)

// Per-request arrays are aligned to rids, with safe defaults for the missing one.
assert.equal(r.rootLeadsResults.length, 3)
assert.deepEqual(r.rootLeadsResults.map((x) => x.data), [20, null, null])
assert.deepEqual(r.heldResults.map((x) => x.data), [2, 5, 0])
assert.deepEqual(r.chainWinnersResults[2].data, [], 'missing rid -> empty winners')

// Winner keys are (request_id|lead_id).
assert.ok(r.chainWinnerKeys.has('rid-a|L1'))
assert.ok(r.chainWinnerKeys.has('rid-a|L2'))
assert.ok(r.chainWinnerKeys.has('rid-b|L1'))

// First-claim wins: L1 maps to rid-a (seen first), not rid-b.
assert.equal(r.leadIdToVisibleRid.get('L1'), 'rid-a')
assert.equal(r.leadIdToVisibleRid.get('L2'), 'rid-a')

// Chain-canonical rows are the FULL winner rows (all three), carrying more than
// lead_id -- so the route no longer needs a supplemental query.
assert.equal(r.chainCanonicalRows.length, 3)
assert.ok(r.chainCanonicalRows.every((row) => 'consensus_id' in row && 'is_winner' in row))

// --- resilience: null/empty input never throws ---
const empty = reshapeChainSummaries(['x'], null)
assert.deepEqual(empty.chainWinnersResults[0].data, [])
assert.equal(empty.rootLeadsResults[0].data, null)
assert.equal(empty.heldResults[0].data, 0)
assert.equal(empty.chainCanonicalRows.length, 0)

// --- migration guards ---
const migration = await readFile(
  resolve('supabase/migrations/20260722212844_batch_chain_summaries.sql'),
  'utf8',
)
assert.match(migration, /at most 100 unique request ids/, 'input must be bounded to 100 ids')
assert.match(migration, /ERRCODE = '22023'/, 'oversized input raises a defined error')
// Check the executable SQL (comments mention "UNION ALL" to explain the choice).
const sqlOnly = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
assert.match(sqlOnly, /\bUNION\b/, 'recursion must use UNION (cycle-safe)')
assert.doesNotMatch(sqlOnly, /UNION ALL/, 'UNION ALL would loop forever on a cyclic chain')
// Winners return the full consumed field set (not just lead_id).
for (const col of ['consensus_id', 'miner_hotkey', 'reward_pct', 'is_winner', 'consensus_final_score']) {
  assert.ok(migration.includes(col), `winners must include ${col}`)
}
// Locked-down grants preserved.
for (const role of ['anon', 'authenticated', 'service_role']) {
  assert.ok(migration.includes(`TO ${role}`), `grant to ${role} preserved`)
}

console.log('test-chain-summaries: OK')
