import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(resolve('node_modules'), '.research-lab-arena-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/research-lab-arena.ts'),
    '--target', 'ES2022', '--module', 'CommonJS', '--moduleResolution', 'Node',
    '--outDir', outDir, '--strict', '--skipLibCheck',
  ], { stdio: 'inherit' })
  assert.equal(tsc.status, 0, 'Arena public-result normalizer should compile')

  const require = createRequire(import.meta.url)
  const { normalizeResearchLabArenaSnapshot } = require(join(outDir, 'research-lab-arena.js'))
  const snapshot = normalizeResearchLabArenaSnapshot(
    {
      round: { round_id: 'arena-open', status: 'open' },
      king: null,
      published_round: { round_id: 'arena-published', status: 'published' },
    },
    { round_id: 'arena-running', status: 'stage2_scoring' },
    {
      round_id: 'arena-published', status: 'published',
      participants: [
        { submission_id: 'miner-1', is_baseline: false },
        { submission_id: 'pydantic-baseline', is_king: true },
      ],
      final_ranking: [
        { submission_id: 'miner-1', final_score: 81.2, rank: 1 },
        { submission_id: 'pydantic-baseline', final_score: 78.4, rank: 2 },
      ],
      publication: { published_at: '2026-09-04T12:00:00Z' },
    },
  )
  assert.deepEqual(snapshot, {
    activeRound: { roundId: 'arena-running', status: 'stage2_scoring' },
    publishedBaseline: {
      roundId: 'arena-published', submissionId: 'pydantic-baseline', score: 78.4,
      rank: 2, publishedAt: '2026-09-04T12:00:00Z',
    },
  })

  const incomplete = normalizeResearchLabArenaSnapshot(
    {
      round: { round_id: 'arena-open', status: 'open' },
      king: null,
      published_round: { round_id: 'arena-published', status: 'published' },
    }, null,
    {
      round_id: 'arena-published', status: 'published',
      participants: [{ submission_id: 'pydantic-baseline', is_baseline: true }],
      final_ranking: [{ submission_id: 'pydantic-baseline', final_score: null, rank: 1 }],
    },
  )
  assert.deepEqual(incomplete, {
    activeRound: { roundId: 'arena-open', status: 'open' }, publishedBaseline: null,
  }, 'an incomplete publication must not fabricate a zero score')

  const invalidPublications = [
    {
      round_id: 'different-round', status: 'published',
      participants: [{ submission_id: 'baseline', is_baseline: true }],
      final_ranking: [{ submission_id: 'baseline', final_score: 50, rank: 1 }],
    },
    {
      round_id: 'arena-published', status: 'published',
      participants: [
        { submission_id: 'baseline-1', is_baseline: true },
        { submission_id: 'baseline-2', is_king: true },
      ],
      final_ranking: [{ submission_id: 'baseline-1', final_score: 50, rank: 1 }],
    },
    {
      round_id: 'arena-published', status: 'published',
      participants: [{ submission_id: 'baseline', is_baseline: true }],
      final_ranking: [{ submission_id: 'baseline', final_score: 101, rank: 1 }],
    },
    {
      round_id: 'arena-published', status: 'published',
      participants: [{ submission_id: 'miner', is_baseline: false }],
      final_ranking: [{ submission_id: 'miner', final_score: 50, rank: 1 }],
    },
  ]
  for (const publication of invalidPublications) {
    assert.equal(normalizeResearchLabArenaSnapshot(
      { published_round: { round_id: 'arena-published', status: 'published' } },
      null,
      publication,
    ).publishedBaseline, null)
  }
  for (const score of [0, 100]) {
    assert.equal(normalizeResearchLabArenaSnapshot(
      { published_round: { round_id: 'arena-published', status: 'published' } },
      null,
      {
        round_id: 'arena-published', status: 'published',
        participants: [{ submission_id: 'baseline', is_baseline: true }],
        final_ranking: [{ submission_id: 'baseline', final_score: score, rank: 1 }],
      },
    ).publishedBaseline?.score, score)
  }

  const routeSource = await readFile(resolve('src/app/api/research-lab/route.ts'), 'utf8')
  assert.match(routeSource, /https:\/\/gateway\.subnet71\.com/)
  assert.match(routeSource, /\/arena\/v1\/current/)
  assert.match(routeSource, /\/arena\/v1\/rounds\/\$\{encodeURIComponent\(roundId\)\}/)
  assert.match(routeSource, /Promise\.allSettled\(roundIds/)
  assert.match(routeSource, /currentRecord\.published_round/)
  assert.doesNotMatch(routeSource, /currentRecord\.king/)

  const componentSource = await readFile(resolve('src/components/dashboard/ResearchLab.tsx'), 'utf8')
  assert.match(componentSource, /Public Pydantic baseline · Arena/)
  assert.match(componentSource, /No score is inferred/)
  assert.match(componentSource, /Retired rebenchmark detail/)
  assert.match(componentSource, /waiting to start/)

  console.log('research-lab-arena: public baseline join, active stage, and incomplete-score handling passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
