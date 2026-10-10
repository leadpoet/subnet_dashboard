import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
const previousWindow = globalThis.window
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
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
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
    module, exports: module.exports, window, document, Error, URLSearchParams,
    require: (name) => name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`) : require(name),
    fetch: async (url) => { calls.push(url); return respond(url) },
  })
  modules.set(path, module.exports)
  return module.exports
}
const { ResearchLab, RoundWorkspace, CompetitionHistory, CompetitionSelect } = load('src/components/dashboard/ResearchLab.tsx', '\nexport { RoundWorkspace, CompetitionHistory, CompetitionSelect };')
const { AdminResearchLab } = load('src/app/admin/_components/AdminResearchLab.tsx')
const { normalizeCompetitionSnapshot } = load('src/lib/research-lab-competition.ts')
// Radix controls use window timers when cleaning up their keyboard state.
globalThis.window = window

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
const competitor = { submission_id: 'competitor', miner_hotkey: '5Competitor', status: 'scoring', evaluation: { state: 'queued', validators: [] }, code: { available: false } }
let benchmarkGated = true
const publicResponse = (url) => {
  if (url.endsWith('/metagraph')) return Response.json({ hotkeyToUid: { '5Validator': 0 }, names: { '5Validator': 'Leadpoet' } })
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
  assert.equal(calls.length, 1, 'initial table reads only submissions; collapsed details make no requests')
  await act(async () => { renderer.update(React.createElement(RoundWorkspace, { round: { ...normalizedRound }, active: true })) })
  assert.equal(calls.length, 1, 'an equivalent summary must not restart polling or re-fetch results')
  await advance(60_000)
  assert.equal(calls.length, 2, 'one interval refreshes only visible submissions')
  await unmount()

  // Exercise the actual parent/child refresh cascade and saved visible output.
  await act(async () => { renderer = TestRenderer.create(React.createElement(ResearchLab), rendererOptions) })
  assert.equal(calls.length, 3)
  assert.equal(count('/metagraph'), 1)
  assert.match(markup(), /Queued for validation/)
  const historyToggle = () => renderer.root.findAllByType('button').find((button) => button.children.some((child) => typeof child !== 'string' && child.children.some((text) => text === 'Show score history' || text === 'Hide score history')))
  assert.equal(historyToggle().props['aria-expanded'], false)
  await act(async () => { historyToggle().props.onClick() })
  assert.equal(historyToggle().props['aria-expanded'], true, 'score history can expand without reloading the competition')
  assert.equal(calls.length, 3, 'opening score history reuses existing public scores')
  await act(async () => { historyToggle().props.onClick() })
  assert.equal(historyToggle().props['aria-expanded'], false)
  const inspectionToggle = () => renderer.root.findAllByType('button').find((button) => button.props.title === 'competitor')
  assert.equal(inspectionToggle().props['aria-expanded'], false, 'submission details start collapsed')
  competitor.evaluation = { state: 'evaluating', validators: [{ hotkey: '5Validator', phase: 'scoring' }] }
  await advance(60_000)
  assert.match(markup(), /Evaluating/)
  assert.doesNotMatch(markup(), /Evaluation activity|more active models|checkout state unknown/)
  assert.match(markup(), /Leadpoet/)
  assert.equal(calls.length, 5, 'one public polling cycle makes only summary and submissions requests')
  assert.equal(count('/metagraph'), 1, 'validator identity polling is shared and less frequent than progress polling')
  assert.equal(count('/results/baseline'), 0)
  assert.equal(calls.some((url) => url.endsWith('/code')), false, 'source remains on demand')
  await act(async () => { inspectionToggle().props.onClick() })
  assert.equal(count('/results/competitor'), 1, 'selecting another submission immediately loads its results')
  assert.equal(inspectionToggle().props['aria-expanded'], true, 'selecting a submission opens its evaluation and source')
  assert.match(markup(), /ICPs become public/, 'opening details still respects the release gate')
  assert.doesNotMatch(markup(), /Public ICP 1/)
  await act(async () => { inspectionToggle().props.onClick() })
  assert.equal(inspectionToggle().props['aria-expanded'], false, 'submission details can be collapsed again')
  const beforeHidden = calls.length
  await setVisibility('hidden')
  await advance(5 * 60_000)
  assert.equal(calls.length, beforeHidden, 'hidden public tabs do no polling')
  benchmarkGated = false
  await setVisibility('visible')
  assert.equal(calls.length, beforeHidden + 3, 'resuming refreshes only visible endpoints once')
  await act(async () => { inspectionToggle().props.onClick() })
  assert.match(markup(), /Public ICP 1/, 'a previously gated benchmark becomes visible after release')
  await act(async () => { historyToggle().props.onClick() })
  assert.match(markup(), /Champion score history/, 'expanded score history is visible before changing tabs')
  const beforeInactive = calls.length
  await act(async () => { renderer.update(React.createElement(ResearchLab, { active: false })) })
  await advance(2 * 60_000)
  assert.equal(calls.length, beforeInactive, 'switching to FAQ pauses the kept-mounted competition')
  assert.doesNotMatch(markup(), /Champion score history/, 'hidden competition must not measure a chart inside the inactive panel')
  await act(async () => { renderer.update(React.createElement(ResearchLab, { active: true })) })
  assert.equal(calls.length, beforeInactive + 5)
  assert.equal(historyToggle().props['aria-expanded'], true, 'returning to competition preserves expanded score history')
  assert.match(markup(), /Champion score history/, 'score history returns when competition becomes visible')
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

  // Slow benchmarks must not hide ready submissions or block table updates.
  const slowBenchmark = deferred()
  respond = async (url) => {
    if (url.endsWith('/benchmark')) await slowBenchmark.promise
    return publicResponse(url)
  }
  await act(async () => { renderer = TestRenderer.create(React.createElement(RoundWorkspace, { round: normalizedRound, active: true }), rendererOptions) })
  assert.equal(count('/benchmark'), 0)
  assert.match(markup(), /5Competitor/)
  assert.doesNotMatch(markup(), /Loading submissions/)
  const toggle = () => renderer.root.findAllByType('button').find((button) => button.props.title === 'competitor')
  await act(async () => { toggle().props.onClick() })
  assert.equal(count('/benchmark'), 1)
  assert.equal(count('/results/competitor'), 1)
  const beforeSlowBenchmark = count('/submissions')
  await advance(60_000)
  assert.equal(count('/submissions'), beforeSlowBenchmark + 1, 'table refresh continues while the benchmark is pending')
  assert.equal(count('/benchmark'), 1, 'slow benchmark requests never overlap')
  await act(async () => { slowBenchmark.resolve() })
  assert.match(markup(), /Public ICP 1/)
  await act(async () => { toggle().props.onClick() })
  const collapsedBenchmark = count('/benchmark')
  const collapsedResults = count('/results/competitor')
  await advance(60_000)
  assert.equal(count('/benchmark'), collapsedBenchmark, 'collapsed benchmarks stop polling')
  assert.equal(count('/results/competitor'), collapsedResults, 'collapsed results stop polling')
  await unmount()

  // Live counts, task retries, and recorded run versions advance with each poll.
  const taskCounts = { queued: 0, active: 0, completed: 0, failed: 0, retrying: 2 }
  competitor.evaluation = { state: 'retrying', validators: [], counts: taskCounts, code_versions: [] }
  respond = publicResponse
  await act(async () => { renderer = TestRenderer.create(React.createElement(RoundWorkspace, { round: normalizedRound, active: true }), rendererOptions) })
  assert.match(markup(), /Evaluation retrying/)
  await act(async () => { renderer.root.findByType(CompetitionSelect).props.onChange('retrying') })
  assert.match(markup(), /competitor/)
  competitor.evaluation = { state: 'evaluating', validators: [{ hotkey: '5Validator', phase: 'executing', commit: 'c'.repeat(40), working_tree: 'clean' }], counts: { ...taskCounts, active: 1, retrying: 1 }, code_versions: [{ validator_hotkey: '5Validator', phase: 'executing', commit: 'c'.repeat(40), working_tree: 'clean' }] }
  await advance(60_000)
  assert.match(markup(), /Running/)
  assert.doesNotMatch(markup(), /cccccccccccc|checkout state unknown/)
  assert.match(markup(), /5Validator/)
  assert.match(markup(), /retrying tasks/)
  competitor.evaluation = { state: 'failed', validators: [], counts: { ...taskCounts, failed: 2, retrying: 0 }, code_versions: competitor.evaluation.code_versions }
  await advance(60_000)
  assert.match(markup(), /No miners match these filters/)
  await act(async () => { renderer.root.findByType(CompetitionSelect).props.onChange('failed') })
  assert.match(markup(), /Evaluation failed/)
  competitor.status = 'scored'
  competitor.evaluation = { ...competitor.evaluation, state: 'completed', counts: { ...taskCounts, completed: 2, retrying: 0 } }
  await advance(60_000)
  await act(async () => { renderer.root.findByType(CompetitionSelect).props.onChange('scored') })
  assert.match(markup(), /Scored/)
  await act(async () => { renderer.root.findAllByType('button').find((button) => button.props.title === 'competitor').props.onClick() })
  assert.match(markup(), /Submission · /)
  assert.match(markup(), /Miner hotkey · /)
  assert.match(markup(), /Evaluation run versions/)
  assert.match(markup(), new RegExp('c'.repeat(40)))
  assert.equal(calls.some((url) => url.endsWith('/code')), false)
  await unmount()
  competitor.status = 'scoring'
  competitor.evaluation = { state: 'evaluating', validators: [{ hotkey: '5Validator', phase: 'scoring' }] }

  // A transient source failure must be recoverable without reloading the page.
  let sourceAttempts = 0
  respond = (url) => {
    if (url.endsWith('/submissions')) return Response.json({ round_id: round.round_id, submissions: [{ ...baseline, code: { available: true } }, competitor] })
    if (url.endsWith('/code')) {
      sourceAttempts += 1
      return sourceAttempts === 1 ? Response.json({ error: 'temporary failure' }, { status: 502 }) : Response.json({
        submission_id: 'baseline', files: [{ path: 'agent.py', content: 'recovered source' }, { path: 'README.md', content: 'source readme' }],
      })
    }
    return publicResponse(url)
  }
  await act(async () => { renderer = TestRenderer.create(React.createElement(RoundWorkspace, { round: normalizedRound, active: true }), rendererOptions) })
  const sourceButton = (label) => renderer.root.findAllByType('button').find((button) => button.props.children === label)
  await act(async () => { renderer.root.findAllByType('button').find((button) => button.props.title === 'baseline').props.onClick() })
  await act(async () => { sourceButton('View source').props.onClick() })
  assert.match(markup(), /Released source is temporarily unavailable/)
  assert.ok(sourceButton('Retry source'), 'a failed source request must offer an immediate retry')
  await act(async () => { sourceButton('Retry source').props.onClick() })
  assert.equal(sourceAttempts, 2)
  assert.match(markup(), /recovered source/)
  await act(async () => { renderer.root.findAllByType(CompetitionSelect).find((select) => select.props.label === 'Source file').props.onChange('README.md') })
  assert.match(markup(), /source readme/)
  assert.doesNotMatch(markup(), /recovered source|Released source is temporarily unavailable/)
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
  assert.equal(count('/arena-2026-09-23/results/baseline'), 0, 'new-round details remain on demand')
  await unmount()

  // Filtering applies before pagination, including miners beyond the first page.
  respond = (url) => url.endsWith('/submissions') ? Response.json({ round_id: round.round_id,
    submissions: Array.from({ length: 32 }, (_, index) => ({ ...competitor, submission_id: `miner-${index}`, miner_hotkey: `5Miner${index}`, ...(index === 31 ? { status: 'review_rejected', evaluation: undefined } : {}) })) }) : publicResponse(url)
  await act(async () => { renderer = TestRenderer.create(React.createElement(RoundWorkspace, { round: normalizedRound, active: true }), rendererOptions) })
  assert.match(markup(), /Page /); assert.equal(renderer.root.findByProps({ 'aria-live': 'polite' }).children.at(-1), '1')
  assert.doesNotMatch(markup(), /miner-31/)
  await act(async () => { renderer.root.findByType('input').props.onChange({ target: { value: '5Miner31' } }) })
  assert.match(markup(), /miner-31/)
  assert.match(markup(), /Code review rejected/)
  assert.match(markup(), /1 match · /, 'one filtered submission uses a singular result label')
  await act(async () => { renderer.root.findByType('input').props.onChange({ target: { value: '' } }); renderer.root.findByType(CompetitionSelect).props.onChange('rejected') })
  assert.match(markup(), /miner-31/)
  await act(async () => { renderer.root.findAllByType('button').find((button) => button.props.children === 'Clear filters').props.onClick() })
  assert.equal(renderer.root.findByType('input').props.value, '')
  assert.equal(renderer.root.findByType(CompetitionSelect).props.value, 'all')
  assert.match(markup(), /miner-0/)
  assert.doesNotMatch(markup(), /miner-31/)
  await unmount()

  // A missing archived submission must never silently select the baseline.
  respond = publicResponse
  await act(async () => { renderer = TestRenderer.create(React.createElement(RoundWorkspace, { round: normalizedRound, active: true, inspectionOnly: true, initialSubmissionId: 'missing-miner' }), rendererOptions) })
  assert.match(markup(), /Submission details are unavailable/)
  assert.equal(count('/results/baseline'), 0)
  await unmount()

  // The opened historical evaluation refreshes its own model's run metadata.
  competitor.status = 'scored'
  competitor.evaluation = { state: 'completed', validators: [], counts: { queued: 0, active: 0, completed: 2, failed: 0, retrying: 0 }, code_versions: [{ validator_hotkey: '5HistoricalValidator', phase: 'scoring', commit: 'd'.repeat(40), working_tree: 'unknown' }] }
  await act(async () => { renderer = TestRenderer.create(React.createElement(RoundWorkspace, { round: { ...normalizedRound, status: 'published' }, active: true, inspectionOnly: true, initialSubmissionId: 'competitor' }), rendererOptions) })
  assert.match(markup(), /5HistoricalValidator/)
  assert.match(markup(), new RegExp('d'.repeat(40)))
  assert.match(markup(), /checkout state unknown/)
  const historicalResultReads = count('/results/competitor')
  competitor.evaluation.code_versions[0].commit = 'e'.repeat(40)
  await advance(60_000)
  assert.match(markup(), new RegExp('e'.repeat(40)))
  assert.doesNotMatch(markup(), new RegExp('d'.repeat(40)))
  assert.equal(count('/results/competitor'), historicalResultReads + 1, 'historical selected results refresh with submissions')
  await unmount()
  competitor.status = 'scoring'
  competitor.evaluation = { state: 'evaluating', validators: [{ hotkey: '5Validator', phase: 'scoring' }] }

  const oldHistory = deferred()
  respond = async (url) => {
    if (!url.includes('/history?')) return publicResponse(url)
    const params = new URLSearchParams(url.split('?')[1])
    if (params.get('hotkey') === 'OldMiner') await oldHistory.promise
    return Response.json({ rounds: [{ ...round, status: 'published' }], submissions: [{ ...competitor,
      round_id: round.round_id, miner_hotkey: params.get('hotkey') || 'AllMiners', final_score: 0,
    }], next_cursor: params.get('cursor') ? null : 'next_page' })
  }
  await act(async () => { renderer = TestRenderer.create(React.createElement(CompetitionHistory, { active: true }), rendererOptions) })
  const search = async (hotkey) => { await act(async () => { renderer.root.findAllByType('input')[0].props.onChange({ target: { value: hotkey } }) }); await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }) }) }
  await search('OldMiner')
  await search('NewMiner')
  await act(async () => { oldHistory.resolve() })
  assert.match(markup(), /NewMiner/)
  assert.doesNotMatch(markup(), /OldMiner/)
  await act(async () => { renderer.root.findAllByType('button').find((button) => button.props.children === 'Next').props.onClick() })
  assert.equal(renderer.root.findByProps({ 'aria-live': 'polite' }).children.at(-1), '2')
  assert.ok(calls.some((url) => url.includes('cursor=next_page') && url.includes('hotkey=NewMiner')))
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
  if (previousWindow === undefined) delete globalThis.window
  else globalThis.window = previousWindow
}
