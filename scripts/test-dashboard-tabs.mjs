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
    isSubnet71PublicRequest,
    isSubnet71PublicHost,
    normalizeDashboardTab,
  } = require(join(outDir, 'dashboard-tabs.js'))

  assert.equal(isSubnet71PublicHost('subnet71.com'), true)
  assert.equal(isSubnet71PublicHost('www.subnet71.com:443'), true)
  assert.equal(isSubnet71PublicHost('SUBNET71.COM.'), true)
  assert.equal(isSubnet71PublicHost('subnet71.com, internal.proxy'), true)
  assert.equal(isSubnet71PublicHost('internal.proxy, subnet71.com'), true)
  assert.equal(isSubnet71PublicHost('subnet71.com.evil.example'), false)
  assert.equal(isSubnet71PublicHost('localhost:3000'), false)
  assert.equal(isSubnet71PublicHost('dashboard.leadpoet.com'), false)
  assert.equal(
    isSubnet71PublicRequest('subnet71.com', 'internal.proxy:3000'),
    true,
    'the browser-facing host must win when x-forwarded-host is an internal upstream host',
  )
  assert.equal(
    isSubnet71PublicRequest('internal.proxy:3000', 'subnet71.com'),
    true,
    'the public forwarded host must still work when host is internal',
  )
  assert.equal(isSubnet71PublicRequest('localhost:3000', 'internal.proxy:3000'), false)

  const publicTabs = getDashboardTabs(true)
  const defaultTabs = getDashboardTabs(false)
  assert.deepEqual(publicTabs, ['research-lab', 'faq'])
  assert.deepEqual(defaultTabs, ['research-lab', 'fulfillment', 'faq'])
  assert.equal(isDashboardTab('faq', publicTabs), true)
  assert.equal(isDashboardTab('fulfillment', publicTabs), false)
  assert.equal(normalizeDashboardTab('fulfillment', publicTabs), 'research-lab')
  assert.equal(normalizeDashboardTab('faq', publicTabs), 'faq')
  assert.equal(normalizeDashboardTab('fulfillment', defaultTabs), 'fulfillment')

  const pageSource = await readFile(resolve('src/app/page.tsx'), 'utf8')
  const clientSource = await readFile(resolve('src/components/dashboard/DashboardClient.tsx'), 'utf8')
  assert.match(pageSource, /headers\(\)/)
  assert.match(pageSource, /isSubnet71PublicRequest\(/)
  assert.match(pageSource, /requestHeaders\.get\('host'\)/)
  assert.match(pageSource, /requestHeaders\.get\('x-forwarded-host'\)/)
  assert.match(clientSource, /getDashboardTabs\(isSubnet71Public\)/)
  assert.match(clientSource, /normalizeDashboardTab\(tab, visibleTabs\)/)
  assert.match(
    clientSource,
    /\{visibleTabs\.includes\('fulfillment'\) && \(\s*<DashboardTabTrigger/,
    'the Fulfillment trigger must use the host-specific tab policy',
  )
  assert.match(
    clientSource,
    /\{visibleTabs\.includes\('fulfillment'\) && mountedTabs\.has\('fulfillment'\) && \(/,
    'the Fulfillment content must use the host-specific tab policy',
  )
  assert.doesNotMatch(clientSource, /window\.location\.hostname/)

  console.log('dashboard-tabs: hostname visibility and active-tab fallback checks passed')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
