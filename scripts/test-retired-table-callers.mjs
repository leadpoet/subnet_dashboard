import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const retired = (await readFile(resolve('scripts/fixtures/retired-dashboard-tables-20260913.txt'), 'utf8'))
  .split(/\r?\n/u)
  .map((name) => name.trim())
  .filter(Boolean)
assert.equal(retired.length, 65, 'the source guard must cover the complete approved allowlist')

async function sourceFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(path))
    else if (/\.(?:ts|tsx|js|mjs|cjs)$/u.test(entry.name)) files.push(path)
  }
  return files
}

const violations = []
for (const path of await sourceFiles(resolve('src'))) {
  const source = await readFile(path, 'utf8')
  for (const table of retired) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9_])${table.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}([^A-Za-z0-9_]|$)`, 'u')
    if (pattern.test(source)) violations.push(`${path}: ${table}`)
  }
}
assert.deepEqual(violations, [], `retired database callers remain in src:\n${violations.join('\n')}`)

for (const path of [
  'src/app/api/dashboard/route.ts',
  'src/app/api/fulfillment/route.ts',
  'src/app/api/research-lab/route.ts',
  'src/app/api/admin/research-lab/economics/route.ts',
  'src/app/api/admin/requests/route.ts',
  'src/app/api/lead-search/route.ts',
  'src/lib/db-precalc.ts',
  'src/lib/research-lab-alert-monitor.ts',
  'src/lib/research-lab-economics.ts',
  'src/lib/supabase.ts',
]) assert.equal(existsSync(resolve(path)), false, `${path} must stay retired`)

const instrumentation = await readFile(resolve('src/instrumentation.ts'), 'utf8')
assert.doesNotMatch(instrumentation, /warm|monitor|deep-research|supabase/i)
const ready = await readFile(resolve('src/app/api/health/ready/route.ts'), 'utf8')
assert.match(ready, /fetchPublicArenaJson\('\/arena\/v1\/current'/)
assert.match(ready, /fetchMetagraph\(\)/)
assert.doesNotMatch(ready, /precalc|supabase/i)
const arena = await readFile(resolve('src/components/dashboard/ResearchLab.tsx'), 'utf8')
assert.match(arena, /fetchJson\('\/api\/research-lab\/competition'\)/)
assert.doesNotMatch(arena, /\/api\/research-lab\?|settlement|LabEmissionSplit/)
assert.ok(existsSync(resolve('src/app/admin/_components/AdminMetagraph.tsx')), 'current metagraph admin UI must remain')
assert.ok(existsSync(resolve('src/app/admin/_components/AdminWeightsAlerts.tsx')), 'independent chain weights UI must remain')
assert.ok(existsSync(resolve('scripts/weights_alert.py')), 'independent chain weights worker must remain')

console.log('retired-table-callers: 65-name source guard and preserved Arena/metagraph/weights paths passed')
