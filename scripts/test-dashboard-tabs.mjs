import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outDir = await mkdtemp(join(tmpdir(), 'dashboard-tabs-'))

try {
  const tsc = spawnSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    resolve('src/lib/dashboard-tabs.ts'),
    '--target', 'ES2022',
    '--module', 'CommonJS',
    '--moduleResolution', 'Node',
    '--outDir', outDir,
    '--strict',
    '--skipLibCheck',
  ], { stdio: 'inherit' })
  assert.equal(tsc.status, 0, 'dashboard tab policy should compile')

  const require = createRequire(import.meta.url)
  const {
    getDashboardTabs,
    isDashboardTab,
    normalizeDashboardTab,
  } = require(join(outDir, 'dashboard-tabs.js'))

  const tabs = getDashboardTabs()
  assert.deepEqual(tabs, ['research-lab', 'faq'])
  assert.equal(isDashboardTab('faq', tabs), true)
  assert.equal(isDashboardTab('fulfillment', tabs), false)
  assert.equal(normalizeDashboardTab('fulfillment', tabs), 'research-lab')
  assert.equal(normalizeDashboardTab('faq', tabs), 'faq')

  const pageSource = await readFile(resolve('src/app/page.tsx'), 'utf8')
  const clientSource = await readFile(resolve('src/components/dashboard/DashboardClient.tsx'), 'utf8')
  assert.match(pageSource, /<DashboardClient \/>/)
  assert.match(clientSource, /getDashboardTabs\(\)/)
  assert.match(clientSource, /normalizeDashboardTab\(tab, visibleTabs\)/)
  assert.doesNotMatch(clientSource, /fulfillment|\/api\/dashboard/i)

  console.log('dashboard-tabs: hostname visibility and active-tab fallback checks passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
