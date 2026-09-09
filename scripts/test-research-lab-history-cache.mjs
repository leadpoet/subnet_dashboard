import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const { createClient } = require('@supabase/supabase-js')
const RECEIPTS = 'research_loop_receipt_events'
const ALLOCATIONS = 'research_lab_emission_allocation_snapshots'
const DAY = 86_400_000
const START = Date.parse('2026-09-09T12:00:00Z')

function event(id, miner, cost, age, run = id) {
  return {
    event_id: id, ticket_id: `ticket-${miner}`, receipt_id: `receipt-${id}`,
    event_type: 'completed', run_id: run, cost_microusd: cost * 1_000_000,
    created_at: new Date(START - age).toISOString(),
  }
}

function allocation(id, epoch, miner, alpha) {
  return {
    allocation_id: id, epoch, created_at: new Date(START).toISOString(),
    allocation_doc: { lab_cap_alpha_percent: 30, reimbursement_allocations: [
      { miner_hotkey: miner, paid_alpha_percent: alpha },
    ] },
  }
}

// Execute the actual GET handler with the real Supabase query builder. Only
// transport and wall-clock time are replaced; no production credentials/network.
function harness() {
  const state = {
    now: START,
    events: [
      event('a-recent', 'miner-a', 2.5, DAY - 45_000, 'run-a'),
      event('a-duplicate', 'miner-a', 0.5, 2 * DAY, 'run-a'),
      event('a-old', 'miner-a', 1, 3 * DAY),
      event('b-recent', 'miner-b', 4, 3_600_000),
    ],
    allocations: [allocation('allocation-a', 10, 'miner-a', 1), allocation('allocation-b', 11, 'miner-b', 2)],
    current: null,
    pageCap: 2,
    calls: [],
    intercept: null,
  }
  async function transport(input, init = {}) {
    const url = new URL(String(input))
    const table = url.pathname.split('/').at(-1)
    const call = { table, method: init.method || 'GET', params: url.searchParams }
    state.calls.push(call)
    const intercepted = state.intercept?.(call)
    if (intercepted) return intercepted
    let rows = []
    if (table === RECEIPTS) {
      assert.equal(call.params.get('event_type'), 'in.(completed,failed)')
      rows = state.events.filter((row) => ['completed', 'failed'].includes(row.event_type))
    } else if (table === ALLOCATIONS) rows = state.allocations
    else if (table === 'research_loop_tickets') {
      rows = [...new Set(state.events.map((row) => row.ticket_id))].map((ticket_id) => ({
        ticket_id, miner_hotkey: ticket_id.slice('ticket-'.length),
      }))
    } else if (table === 'research_loop_receipts') {
      rows = state.events.map((row) => ({ receipt_id: row.receipt_id, run_id: row.run_id }))
    } else if (table === 'research_lab_emission_allocation_current') rows = state.current ? [state.current] : []
    else if (table === 'research_lab_compact_weight_authorities_v2') rows = [{ epoch_id: 20 }]

    for (const [field, filter] of call.params) {
      if (filter.startsWith('in.(') && field !== 'event_type') {
        const allowed = filter.slice(4, -1).split(',').map((v) => v.replaceAll('"', ''))
        rows = rows.filter((row) => allowed.includes(row[field]))
      } else if (filter.startsWith('eq.') && field === 'epoch') {
        rows = rows.filter((row) => String(row[field]) === filter.slice(3))
      }
    }
    if (call.method === 'HEAD') {
      assert.equal(new Headers(init.headers).get('prefer'), 'count=exact')
      assert.equal(call.params.get('select'), table === RECEIPTS ? 'event_id' : 'allocation_id')
      return new Response(null, { headers: { 'content-range': `*/${rows.length}` } })
    }
    if (table === RECEIPTS || table === ALLOCATIONS) {
      assert.ok(!call.params.get('select').includes('*'), 'history requests must keep narrow projections')
      const order = call.params.get('order')
      assert.ok(order.includes(table === RECEIPTS ? 'event_id.asc' : 'allocation_id.asc'))
      rows = [...rows].sort((a, b) => {
        if (table === RECEIPTS) return b.created_at.localeCompare(a.created_at) || a.event_id.localeCompare(b.event_id)
        return a.epoch - b.epoch || a.allocation_id.localeCompare(b.allocation_id)
      })
    }
    const offset = Number(call.params.get('offset') || 0)
    const requested = Number(call.params.get('limit') || rows.length)
    // Exercise a PostgREST cap below the requested 1,000-row batch size.
    const cap = table === RECEIPTS || table === ALLOCATIONS ? state.pageCap : Infinity
    return Response.json(rows.slice(offset, offset + Math.min(requested, cap)))
  }
  const modules = new Map()
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [state.now])) }
    static now() { return state.now }
  }
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    const module = { exports: {} }
    modules.set(path, module)
    const output = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      fileName: path,
    }).outputText
    const localRequire = (name) => {
      if (name.startsWith('@/')) return load(resolve('src', `${name.slice(2)}.ts`))
      if (name === '@supabase/supabase-js') return {
        createClient: (url, key, options) => createClient(url, key, { ...options, global: { fetch: transport } }),
      }
      return require(name)
    }
    const context = vm.createContext({
      module, exports: module.exports, require: localRequire,
      process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SECRET_KEY: 'test-placeholder' } },
      Date: Clock, AbortSignal,
      fetch: async () => Response.json({}),
      console: { error() {}, warn() {} },
    })
    vm.runInContext(output, context, { filename: path })
    return module.exports
  }
  const { GET } = load(resolve('src/app/api/research-lab/route.ts'))
  state.refresh = () => { state.now += 30_001 }
  state.get = async (status = 200) => {
    const response = await GET()
    assert.equal(response.status, status)
    const payload = await response.json()
    assert.equal(payload.success, status === 200)
    if (status === 200) assert.match(response.headers.get('cache-control'), /no-store/)
    return payload.data?.labMinerSpend
  }
  state.reads = (table, method = 'GET') => state.calls.filter((call) => call.table === table && call.method === method).length
  return state
}

const h = harness()
const initial = await h.get()
assert.equal(initial.allTime.byHotkey['miner-a'].computeSpendUsd, 3.5)
assert.equal(initial.allTime.byHotkey['miner-b'].computeSpendUsd, 4)
assert.equal(initial.byHotkey['miner-a'].computeSpendUsd, 2.5)
assert.equal(initial.byHotkey['miner-b'].computeSpendUsd, 4)
assert.equal(initial.allTime.byHotkey['miner-a'].alphaEarned, 1)
assert.equal(initial.allTime.byHotkey['miner-b'].alphaEarned, 2)
assert.equal(initial.currentAllocation.epoch, 11, 'snapshot fallback survives caching')
const coldCalls = h.calls.length
await h.get()
assert.equal(h.calls.length, coldCalls, '30-second response cache still avoids every backend request')

const receiptReads = h.reads(RECEIPTS)
const allocationReads = h.reads(ALLOCATIONS)
const parentReads = h.reads('research_loop_tickets') + h.reads('research_loop_receipts')
h.refresh()
assert.deepEqual(await h.get(), initial, 'warm history must preserve the complete API rollup')
assert.equal(h.reads(RECEIPTS), receiptReads)
assert.equal(h.reads(ALLOCATIONS), allocationReads)
assert.equal(h.reads('research_loop_tickets') + h.reads('research_loop_receipts'), parentReads)

h.refresh()
const rolled = await h.get()
assert.equal(rolled.byHotkey['miner-a']?.computeSpendUsd ?? 0, 0, '24-hour spend expires without a write')
assert.equal(rolled.allTime.byHotkey['miner-a'].computeSpendUsd, 3.5)
assert.equal(h.reads(RECEIPTS), receiptReads)

// Backfills and identical timestamps must invalidate even without a new maximum timestamp.
h.events.push(event('backdated', 'miner-a', 3, 4 * DAY))
h.events.push(event('same-timestamp', 'miner-b', 5, 3_600_000))
h.allocations.push(allocation('allocation-backfill', 9, 'miner-b', 6))
h.refresh()
const appended = await h.get()
assert.equal(appended.allTime.byHotkey['miner-a'].computeSpendUsd, 6.5)
assert.equal(appended.allTime.byHotkey['miner-b'].computeSpendUsd, 9)
assert.equal(appended.allTime.byHotkey['miner-b'].alphaEarned, 8)
assert.equal(appended.allTime.firstEpoch, 9)
assert.ok(h.reads(RECEIPTS) > receiptReads)
assert.ok(h.reads(ALLOCATIONS) > allocationReads)

h.current = allocation('live', 20, 'miner-a', 12)
h.refresh()
const beforeConcurrent = h.reads(RECEIPTS, 'HEAD')
const concurrent = await Promise.all(Array.from({ length: 8 }, () => h.get()))
assert.equal(h.reads(RECEIPTS, 'HEAD') - beforeConcurrent, 1, 'refreshes must share one flight')
assert.equal(concurrent[0].currentAllocation.epoch, 20, 'live allocation continues refreshing with unchanged history')
assert.equal(concurrent[0].currentAllocation.byHotkey['miner-a'].paidAlphaPercent, 12)

function failOnce(state, match, response = () => Response.json({ message: 'fixture failure' }, { status: 503 })) {
  state.intercept = (call) => {
    if (!match(call)) return null
    state.intercept = null
    return response()
  }
}

for (const invalidCount of ['*', '-1', 'not-a-count']) {
  h.refresh()
  failOnce(h, (c) => c.table === RECEIPTS && c.method === 'HEAD', () => new Response(null, {
    headers: { 'content-range': `*/${invalidCount}` },
  }))
  await h.get(500)
  await h.get()
}

for (const failedTable of [RECEIPTS, 'research_loop_tickets', 'research_loop_receipts', ALLOCATIONS]) {
  h.events.push(event(`retry-${failedTable}`, 'miner-b', 1, 0))
  h.allocations.push(allocation(`retry-${failedTable}`, 12, 'miner-b', 1))
  h.refresh()
  failOnce(h, (c) => c.table === failedTable && c.method === 'GET' &&
    (failedTable !== RECEIPTS || Number(c.params.get('offset')) > 0))
  await h.get(500)
  const recovered = await h.get()
  assert.equal(recovered.allTime.byHotkey['miner-b'].computeSpendUsd, h.events.filter((e) => e.ticket_id === 'ticket-miner-b').reduce((sum, e) => sum + e.cost_microusd / 1_000_000, 0))
  assert.equal(recovered.allTime.allocationSnapshotCount, h.allocations.length)
}

// Missing parent rows and an empty later page cannot become a permanent partial cache.
for (const failedTable of ['research_loop_tickets', RECEIPTS]) {
  h.events.push(event(`missing-${failedTable}`, 'miner-a', 1, 0))
  h.refresh()
  failOnce(h, (c) => c.table === failedTable && c.method === 'GET', () => Response.json([]))
  await h.get(500)
  await h.get()
}

h.events.push(event('before-race', 'miner-a', 1, 0))
h.refresh()
let historyStarted = false
h.intercept = (call) => {
  if (call.table !== RECEIPTS) return null
  if (call.method === 'GET') historyStarted = true
  if (call.method === 'HEAD' && historyStarted) {
    h.events.push(event('during-race', 'miner-b', 7, 0))
    h.intercept = null
  }
  return null
}
await h.get(500)
const afterRace = await h.get()
assert.equal(afterRace.allTime.byHotkey['miner-b'].computeSpendUsd, 20)

const empty = harness()
empty.events = []
empty.allocations = []
assert.deepEqual((await empty.get()).allTime.byHotkey, {})
empty.refresh()
await empty.get()
assert.equal(empty.reads(RECEIPTS), 0)
assert.equal(empty.reads(ALLOCATIONS), 0)
empty.events.push(event('first', 'miner-c', 2, 0))
empty.refresh()
assert.equal((await empty.get()).allTime.byHotkey['miner-c'].computeSpendUsd, 2)

const restarted = harness()
assert.deepEqual(await restarted.get(), initial, 'a new process reconstructs the same cold snapshot')
assert.ok(restarted.reads(RECEIPTS) > 0)

for (const field of ['miner_hotkey', 'run_id', 'created_at']) {
  const invalid = harness()
  const brokenRow = { ...invalid.events[0] }
  if (field === 'created_at') {
    invalid.events[0].created_at = 'invalid-timestamp'
  } else if (field === 'run_id') {
    invalid.events[0].run_id = null
  } else {
    failOnce(invalid, (c) => c.table === 'research_loop_tickets', () => Response.json([
      { ticket_id: 'ticket-miner-a', miner_hotkey: null },
      { ticket_id: 'ticket-miner-b', miner_hotkey: 'miner-b' },
    ]))
  }
  await invalid.get(500)
  invalid.events[0] = brokenRow
  assert.deepEqual(await invalid.get(), initial, `invalid ${field} must not poison history at the same count`)
}

const large = harness()
large.events = []
large.pageCap = 1_000
large.allocations = Array.from({ length: 5_001 }, (_, i) => allocation(`large-${i}`, i, 'miner-large', 1))
const largeResult = await large.get()
assert.equal(largeResult.allTime.allocationSnapshotCount, 5_001)
assert.equal(largeResult.allTime.byHotkey['miner-large'].alphaEarned, 5_001)
assert.equal(largeResult.currentAllocation.epoch, 5_000)
assert.equal(large.reads(ALLOCATIONS), 6)
large.refresh()
assert.deepEqual(await large.get(), largeResult)
assert.equal(large.reads(ALLOCATIONS), 6, 'large history also avoids repeat document reads')
console.log(`research-lab-history-cache: actual GET outputs, two miners, rolling expiry, append/backfill, pagination, live allocation, concurrency, failures/retry and cold restart passed; unchanged refresh: receipt payload reads 0 (cold ${receiptReads}), allocation payload reads 0 (cold ${allocationReads})`)
