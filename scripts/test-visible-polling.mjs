import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import React, { useCallback, useState } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import ts from 'typescript'

const require = createRequire(import.meta.url)
let now = 0
let nextTimer = 0
let visibility = 'visible'
const timers = new Map()
const listeners = new Set()
const browser = {
  setTimeout(callback, delay) {
    const id = ++nextTimer
    timers.set(id, { callback, at: now + delay })
    return id
  },
  clearTimeout(id) { timers.delete(id) },
}
const document = {
  get visibilityState() { return visibility },
  addEventListener(type, listener) { assert.equal(type, 'visibilitychange'); listeners.add(listener) },
  removeEventListener(type, listener) { assert.equal(type, 'visibilitychange'); listeners.delete(listener) },
}
const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/hooks/useVisiblePolling.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { module, exports: module.exports, require, window: browser, document })
const { useVisiblePolling } = module.exports

function Panel({ enabled, poll, name, immediate = true }) {
  const [completed, setCompleted] = useState(0)
  const refresh = useCallback(async () => {
    await poll()
    setCompleted((value) => value + 1)
  }, [poll])
  useVisiblePolling(refresh, 60_000, { enabled, immediate })
  return React.createElement('output', { name }, completed)
}

async function advance(ms) {
  const end = now + ms
  while (true) {
    const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
    if (!next) break
    const [id, timer] = next
    now = timer.at
    timers.delete(id)
    await act(async () => { timer.callback() })
  }
  now = end
}

async function setVisibility(value) {
  visibility = value
  await act(async () => { for (const listener of [...listeners]) listener() })
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

let renderer
try {
  const calls = { lab: 0, fulfillment: 0 }
  const lab = async () => { calls.lab++ }
  const fulfillment = async () => { calls.fulfillment++ }
  function Dashboard({ active }) {
    return React.createElement(React.Fragment, null,
      React.createElement(Panel, { name: 'lab', enabled: active === 'lab', poll: lab }),
      React.createElement(Panel, { name: 'fulfillment', enabled: active === 'fulfillment', poll: fulfillment }),
    )
  }
  await act(async () => { renderer = TestRenderer.create(React.createElement(Dashboard, { active: 'lab' })) })
  assert.deepEqual(calls, { lab: 1, fulfillment: 0 })
  await advance(5 * 60_000)
  assert.deepEqual(calls, { lab: 6, fulfillment: 0 }, 'inactive mounted panel must not poll')
  await act(async () => { renderer.update(React.createElement(Dashboard, { active: 'fulfillment' })) })
  assert.deepEqual(calls, { lab: 6, fulfillment: 1 }, 'newly active panel refreshes immediately')
  await advance(5 * 60_000)
  assert.deepEqual(calls, { lab: 6, fulfillment: 6 })
  await setVisibility('hidden')
  assert.equal(timers.size, 0, 'backgrounding cancels scheduled polling')
  await advance(10 * 60_000)
  assert.deepEqual(calls, { lab: 6, fulfillment: 6 }, 'hidden browser tab must not poll')
  await setVisibility('visible')
  assert.deepEqual(calls, { lab: 6, fulfillment: 7 })
  await act(async () => { renderer.update(React.createElement(Dashboard, { active: 'lab' })) })
  assert.deepEqual(calls, { lab: 7, fulfillment: 7 })
  assert.deepEqual(renderer.toJSON().map((panel) => panel.children), [['7'], ['7']], 'switching preserves each mounted panel state')
  await act(async () => { renderer.update(React.createElement(Dashboard, { active: 'faq' })) })
  await advance(5 * 60_000)
  assert.deepEqual(calls, { lab: 7, fulfillment: 7 }, 'FAQ leaves both reporting panels idle')
  await act(async () => { renderer.unmount() })
  assert.equal(listeners.size, 0)
  assert.equal(timers.size, 0)

  visibility = 'hidden'
  let attempts = 0
  const pending = deferred()
  let simultaneous = 0
  let maxSimultaneous = 0
  const slow = async () => {
    const attempt = ++attempts
    simultaneous++
    maxSimultaneous = Math.max(maxSimultaneous, simultaneous)
    try { if (attempt === 1) await pending.promise } finally { simultaneous-- }
  }
  const probe = (enabled, poll = slow) => React.createElement(Panel, { name: 'slow', enabled, poll })
  await act(async () => { renderer = TestRenderer.create(probe(true)) })
  await advance(60_000)
  assert.equal(attempts, 0, 'hidden initial mount must wait for visibility')
  await setVisibility('visible')
  assert.equal(attempts, 1)
  await advance(3 * 60_000)
  assert.equal(attempts, 1, 'a slow request cannot overlap the next interval')
  await act(async () => { renderer.update(probe(false)) })
  await act(async () => { renderer.update(probe(true)) })
  await setVisibility('hidden')
  await setVisibility('visible')
  await setVisibility('visible')
  assert.equal(attempts, 1, 'resuming must wait for the earlier request')
  await act(async () => { pending.resolve() })
  assert.equal(attempts, 2, 'rapid resumes coalesce into one fresh request')
  assert.equal(maxSimultaneous, 1)
  assert.equal(timers.size, 1)
  await advance(60_000)
  assert.equal(attempts, 3, 'polling resumes normally after the pending request')

  let failures = 0
  const flaky = async () => { if (++failures === 1) throw new Error('fixture outage') }
  const priorState = renderer.toJSON().children
  await act(async () => { renderer.update(probe(true, flaky)) })
  assert.equal(failures, 1)
  assert.deepEqual(renderer.toJSON().children, priorState, 'failed refresh retains prior data')
  await advance(59_999)
  assert.equal(failures, 1, 'failures must not trigger a tight retry loop')
  await advance(1)
  assert.equal(failures, 2, 'failed refresh retries at the normal interval')

  const late = deferred()
  let lateCalls = 0
  const latePoll = async () => { lateCalls++; await late.promise }
  await act(async () => { renderer.update(probe(true, latePoll)) })
  await act(async () => { renderer.unmount() })
  assert.equal(listeners.size, 0)
  await act(async () => { late.resolve() })
  await advance(5 * 60_000)
  assert.equal(lateCalls, 1)
  assert.equal(timers.size, 0, 'an unmounted request cannot restart polling')

  const shell = readFileSync('src/components/dashboard/DashboardClient.tsx', 'utf8')
  assert.match(shell, /<ResearchLab[^>]*active=\{activeTab === 'research-lab'\}/)
  assert.match(shell, /<Fulfillment[^>]*active=\{activeTab === 'fulfillment'\}/)
  assert.match(shell, /keepMounted/, 'the change must preserve mounted panel state')
  for (const component of ['ResearchLab', 'Fulfillment']) {
    const source = readFileSync(`src/components/dashboard/${component}.tsx`, 'utf8')
    assert.match(source, /useVisiblePolling\(fetchData, 60_000, \{ enabled: active \}\)/)
    assert.doesNotMatch(source, /setInterval\([^\n]*fetchData/)
  }
  let dashboardReads = 0
  const dashboardPoll = async () => { dashboardReads++ }
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Panel, { name: 'dashboard', enabled: true, poll: dashboardPoll, immediate: false }))
  })
  assert.equal(dashboardReads, 0, 'server-rendered data must not trigger a duplicate mount read')
  await advance(59_999)
  assert.equal(dashboardReads, 0)
  await advance(1)
  assert.equal(dashboardReads, 1)
  await setVisibility('hidden')
  await advance(60_000)
  await setVisibility('visible')
  assert.equal(dashboardReads, 2, 'deferred initial refresh still resumes immediately')
  assert.match(shell, /useVisiblePolling\(refreshDashboard, 60_000, \{ immediate: false \}\)/)
  assert.doesNotMatch(shell, /addEventListener\('visibilitychange'/, 'the shell must not retain a second overlapping resume path')
  await act(async () => { renderer.unmount() })

  // Execute the real shell as well as the hook. Stub only unrelated visuals
  // and transport so deployment reloads and the parallel API pair are covered.
  const compile = (source, resolve, globals = {}) => {
    const mod = { exports: {} }
    vm.runInNewContext(ts.transpileModule(source, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, { module: mod, exports: mod.exports, require: resolve, window: browser, document, URLSearchParams, console, ...globals })
    return mod.exports
  }
  const tabPolicy = compile(readFileSync('src/lib/dashboard-tabs.ts', 'utf8'), require)
  const passthrough = ({ children }) => React.createElement('div', null, children)
  const empty = () => null
  let reloads = 0
  let shellReads = 0
  let pairActive = 0
  let maxPairActive = 0
  let responseGate = null
  let nextVersion = 'initial'
  const initialData = {
    summary: {}, minerStats: [], epochStats: [], leadInventory: [], rejectionReasons: [], buildVersion: 'initial',
  }
  browser.location = { search: '', pathname: '/', hash: '', reload() { reloads++ } }
  const shellModule = compile(shell, (name) => {
    if (name === '@/lib/hooks/useVisiblePolling') return { useVisiblePolling }
    if (name === '@/lib/dashboard-tabs') return tabPolicy
    if (name === '@/lib/utils') return { cn: (...parts) => parts.filter(Boolean).join(' ') }
    if (name === '@/components/dashboard') return { Overview: empty, MinerTracker: empty, EpochAnalysis: empty, SubmissionTracker: empty, ResearchLab: empty, FAQ: empty }
    if (name === '@/components/dashboard/Fulfillment') return { Fulfillment: empty }
    if (name === '@/components/shared/ErrorBoundary') return { ErrorBoundary: passthrough }
    if (name === '@/components/ui/tabs') return { Tabs: passthrough, TabsContent: passthrough, TabsList: passthrough, TabsTrigger: passthrough }
    return require(name)
  }, {
    process: { env: { NODE_ENV: 'production' } },
    fetch: async (url) => {
      const version = nextVersion
      shellReads++
      pairActive++
      maxPairActive = Math.max(maxPairActive, pairActive)
      try {
        if (responseGate) await responseGate.promise
        return { ok: true, json: async () => url === '/api/dashboard' ? { ...initialData, buildVersion: version } : null }
      } finally { pairActive-- }
    },
  })
  await act(async () => { renderer = TestRenderer.create(React.createElement(shellModule.DashboardClient, { initialData, metagraph: null, isSubnet71Public: true })) })
  assert.equal(shellReads, 0)
  responseGate = deferred()
  await advance(60_000)
  assert.equal(shellReads, 2)
  await setVisibility('hidden')
  await setVisibility('visible')
  await advance(2 * 60_000)
  assert.equal(shellReads, 2, 'real shell must not overlap its two-request batch on resume')
  const gate = responseGate
  responseGate = null
  await act(async () => { gate.resolve() })
  assert.equal(shellReads, 4, 'real shell resumes with one fresh batch')
  assert.equal(maxPairActive, 2, 'only one dashboard/metagraph pair may be pending')
  nextVersion = 'deployed'
  await setVisibility('hidden')
  await setVisibility('visible')
  assert.equal(reloads, 1, 'visibility resume must reload a changed deployment build')
  nextVersion = 'stale-flight'
  responseGate = deferred()
  await advance(60_000)
  nextVersion = 'new-server-render'
  await act(async () => { renderer.update(React.createElement(shellModule.DashboardClient, { initialData: { ...initialData, buildVersion: nextVersion }, metagraph: null, isSubnet71Public: true })) })
  const staleGate = responseGate
  responseGate = null
  await act(async () => { staleGate.resolve() })
  assert.equal(reloads, 1, 'an old generation must not reload after server props change')
  responseGate = deferred()
  await advance(60_000)
  await act(async () => { renderer.unmount() })
  await act(async () => { responseGate.resolve() })
  assert.equal(reloads, 1, 'a late response cannot reload an unmounted dashboard')
  assert.equal(timers.size, 0)
  assert.equal(listeners.size, 0)
  console.log('visible-polling: real React lifecycle, inactive panels, background tabs, immediate resume, preserved state, slow-request coalescing, failures/retry and cleanup passed')
} finally {
  await act(async () => { renderer?.unmount() })
}
