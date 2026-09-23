import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
globalThis.IS_REACT_ACT_ENVIRONMENT = true
// Next uses a React 18 concurrent root, including automatic async batching.
const rendererOptions = { unstable_isConcurrent: true }
let now = 0
let nextTimer = 0
let visibility = 'visible'
let respond
const calls = []
const timers = new Map()
const listeners = new Set()
const window = {
  setTimeout(callback, delay) {
    const id = ++nextTimer
    timers.set(id, { callback, at: now + delay })
    return id
  },
  clearTimeout(id) { timers.delete(id) },
  setInterval(callback, delay) {
    const id = ++nextTimer
    timers.set(id, { callback, at: now + delay, interval: delay })
    return id
  },
  clearInterval(id) { timers.delete(id) },
}
const document = {
  get visibilityState() { return visibility },
  addEventListener(type, listener) { assert.equal(type, 'visibilitychange'); listeners.add(listener) },
  removeEventListener(type, listener) { assert.equal(type, 'visibilitychange'); listeners.delete(listener) },
}
const modules = new Map()
function load(path, extra = '') {
  if (modules.has(path)) return modules.get(path)
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8') + extra, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module, exports: module.exports, window, document, Error,
    require: (name) => name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`) : require(name),
    fetch: async (url) => { calls.push(url); return respond(url) },
  })
  modules.set(path, module.exports)
  return module.exports
}
const { ResearchLab, RoundWorkspace } = load('src/components/dashboard/ResearchLab.tsx', '\nexport { RoundWorkspace };')
const { AdminResearchLab } = load('src/app/admin/_components/AdminResearchLab.tsx')
const { normalizeCompetitionSnapshot } = load('src/lib/research-lab-competition.ts')

async function advance(ms) {
  const end = now + ms
  while (true) {
    const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
    if (!next) break
    const [id, timer] = next
    now = timer.at
    if (timer.interval) timer.at += timer.interval
    else timers.delete(id)
    await act(async () => { timer.callback() })
  }
  now = end
}
async function setVisibility(value) {
  visibility = value
  await act(async () => { for (const listener of [...listeners]) listener() })
}
const count = (suffix) => calls.filter((url) => url.endsWith(suffix)).length
const markup = () => JSON.stringify(renderer.toJSON())
function deferred() {
  let resolve
  const promise = new Promise((yes) => { resolve = yes })
  return { promise, resolve }
}
const round = {
  round_id: 'arena-2026-09-22', status: 'stage1', mode: 'live', network_name: 'finney', netuid: 71,
  benchmark_icp_count: 10, promotion_margin: 0.5,
  icp_set_date: '2026-09-21', public_at: '2026-09-22T00:00:00Z',
}
const snapshot = { mode: 'live', network_name: 'finney', netuid: 71, latest_round: round, rounds: [round] }
const baseline = { submission_id: 'baseline', miner_hotkey: '5Baseline', status: 'scoring', is_baseline: true, code: { available: false } }
const competitor = { submission_id: 'competitor', miner_hotkey: '5Competitor', status: 'scoring', code: { available: false } }
let benchmarkGated = true
const publicResponse = (url) => {
  if (url.endsWith('/competition')) return Response.json(snapshot)
  const roundId = url.match(/\/rounds\/([^/]+)/)?.[1]
  if (url.endsWith('/submissions')) return Response.json({ round_id: roundId, submissions: [baseline, competitor] })
  if (url.endsWith('/benchmark')) {
    if (benchmarkGated) return Response.json({ error: 'not released' }, { status: 403 })
    return Response.json({
      round_id: roundId, icp_set_date: round.icp_set_date, public_at: round.public_at,
      benchmark_icp_count: 10, public_icp_count: 10, private_icp_count: 0, disclosure_policy: 'cutoff_public_v1',
      icps: Array.from({ length: 10 }, (_, icp_position) => ({ icp_position, prompt: `Public ICP ${icp_position + 1}` })),
    })
  }
  if (url.includes('/results/')) return Response.json({
    round_id: roundId, submission_id: url.split('/').at(-1), benchmark_icp_count: 10, public_icp_status: 'pending',
  })
  throw new Error(`Unexpected request: ${url}`)
}
let renderer
async function unmount() {
  await act(async () => { renderer?.unmount() })
  renderer = null
  assert.equal(timers.size, 0)
  assert.equal(listeners.size, 0)
  calls.length = 0
}

try {
  respond = publicResponse
  const normalizedRound = normalizeCompetitionSnapshot(snapshot).latestRound
  await act(async () => { renderer = TestRenderer.create(React.createElement(RoundWorkspace, { round: normalizedRound, active: true }), rendererOptions) })
  assert.equal(calls.length, 3, 'initial view reads submissions, benchmark, and selected results once')
  await act(async () => { renderer.update(React.createElement(RoundWorkspace, { round: { ...normalizedRound }, active: true })) })
  assert.equal(calls.length, 3, 'an equivalent summary must not restart polling or re-fetch results')
  await advance(60_000)
  assert.equal(calls.length, 6, 'one interval refreshes each detail endpoint once')
  await unmount()

  // Exercise the actual parent/child refresh cascade and saved visible output.
  await act(async () => { renderer = TestRenderer.create(React.createElement(ResearchLab), rendererOptions) })
  assert.equal(calls.length, 4)
  await advance(60_000)
  assert.equal(calls.length, 8, 'one public polling cycle makes four requests, including the summary')
  assert.equal(count('/results/baseline'), 2)
  assert.equal(calls.some((url) => url.endsWith('/code')), false, 'source remains on demand')
  await act(async () => { renderer.root.findAllByType('button').find((button) => button.props['aria-pressed'] === false).props.onClick() })
  assert.equal(count('/results/competitor'), 1, 'selecting another submission immediately loads its results')
  const beforeHidden = calls.length
  await setVisibility('hidden')
  await advance(5 * 60_000)
  assert.equal(calls.length, beforeHidden, 'hidden public tabs do no polling')
  benchmarkGated = false
  await setVisibility('visible')
  assert.equal(calls.length, beforeHidden + 4, 'resuming refreshes each endpoint once')
  assert.match(markup(), /Public ICP 1/, 'a previously gated benchmark becomes visible after release')
  const beforeInactive = calls.length
  await act(async () => { renderer.update(React.createElement(ResearchLab, { active: false })) })
  await advance(2 * 60_000)
  assert.equal(calls.length, beforeInactive, 'switching to FAQ pauses the kept-mounted competition')
  await act(async () => { renderer.update(React.createElement(ResearchLab, { active: true })) })
  assert.equal(calls.length, beforeInactive + 4)
  const pending = deferred()
  respond = async (url) => {
    if (url.endsWith('/submissions')) await pending.promise
    return publicResponse(url)
  }
  const beforeSlow = count('/submissions')
  await advance(3 * 60_000)
  assert.equal(count('/submissions'), beforeSlow + 1, 'slow detail requests do not overlap or restart on summary updates')
  await act(async () => { pending.resolve() })
  await unmount()

  // A new round still starts fetching immediately and ignores the old request.
  const oldRound = deferred()
  respond = async (url) => {
    if (url.includes('/arena-2026-09-22/')) await oldRound.promise
    return publicResponse(url)
  }
  await act(async () => { renderer = TestRenderer.create(React.createElement(RoundWorkspace, { round: normalizedRound, active: true }), rendererOptions) })
  await act(async () => { renderer.update(React.createElement(RoundWorkspace, { round: { ...normalizedRound, roundId: 'arena-2026-09-23' }, active: true })) })
  await act(async () => { oldRound.resolve() })
  assert.equal(count('/arena-2026-09-23/submissions'), 1)
  assert.equal(count('/arena-2026-09-22/results/baseline'), 0, 'a completed old-round request cannot select an old submission')
  assert.equal(count('/arena-2026-09-23/results/baseline'), 1)
  await unmount()

  let adminStatus = 'stage1'
  let adminPending = null
  let adminFail = false
  respond = async () => {
    if (adminPending) await adminPending.promise
    if (adminFail) throw new Error('temporary failure')
    return Response.json({
      arena: { activeRound: { roundId: round.round_id, status: adminStatus }, publishedBaseline: null, publishedWinner: null },
      gateway: { commitSha: null, sourceAvailable: false },
    })
  }
  await act(async () => { renderer = TestRenderer.create(React.createElement(AdminResearchLab), rendererOptions) })
  assert.equal(calls.length, 1)
  await advance(30_000)
  assert.equal(calls.length, 2)
  await setVisibility('hidden')
  await advance(5 * 60_000)
  assert.equal(calls.length, 2, 'hidden admin tabs do no Arena polling')
  adminStatus = 'published'
  await setVisibility('visible')
  assert.equal(calls.length, 3)
  assert.match(markup(), /published/, 'resuming the admin tab displays fresh data')
  adminPending = deferred()
  await advance(3 * 30_000)
  assert.equal(calls.length, 4, 'a slow admin refresh cannot overlap')
  await act(async () => { adminPending.resolve() })
  adminPending = null
  adminFail = true
  await advance(30_000)
  assert.match(markup(), /temporary failure/)
  assert.match(markup(), /published/, 'an error preserves the last successful status')
  adminFail = false
  await advance(30_000)
  assert.doesNotMatch(markup(), /temporary failure/, 'the next poll recovers without a reload')
  await unmount()
  console.log('arena-polling: stable refresh counts, selection, release gates, visibility, slow requests, round changes, and admin recovery passed')
} finally {
  await act(async () => { renderer?.unmount() })
  globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
}
