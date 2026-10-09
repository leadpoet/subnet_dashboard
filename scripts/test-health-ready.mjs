import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const routeSource = await readFile(resolve('src/app/api/health/ready/route.ts'), 'utf8')
const proxySource = await readFile(resolve('src/lib/arena-public-proxy.ts'), 'utf8')
const megabyte = 1024 * 1024

async function check(overrides = {}) {
  const scenario = {
    latencyMs: 3_500, upstreamStatus: 200, body: { status: 'ok' },
    rssMb: 100, freeMemoryMb: 512, metagraphError: false,
    metagraph: { available: true, ageMs: 0, refreshing: false, totalNeurons: 256 },
    ...overrides,
  }
  const deadlines = []
  const signals = new Map()
  let metagraphReads = 0
  const context = {
    Error,
    process: { env: {}, memoryUsage: () => ({ rss: scenario.rssMb * megabyte }) },
    // Virtual time avoids a wall-clock wait while exercising the actual route
    // and proxy, including the signal's deadline and cancellation behavior.
    AbortSignal: { timeout(timeoutMs) {
      deadlines.push(timeoutMs)
      const controller = new AbortController()
      signals.set(controller.signal, { controller, timeoutMs })
      return controller.signal
    } },
    fetch: async (url, options) => {
      assert.equal(new URL(url).pathname, '/arena/v1/current')
      assert.equal(options.cache, 'no-store')
      const { controller, timeoutMs } = signals.get(options.signal)
      if (scenario.latencyMs >= timeoutMs) controller.abort(new DOMException('Arena request timed out', 'TimeoutError'))
      options.signal.throwIfAborted()
      return { status: scenario.upstreamStatus, json: async () => scenario.body }
    },
  }
  const next = { NextResponse: { json: (body, options) => Response.json(body, options) } }
  function load(source, imports) {
    const module = { exports: {} }
    const compiled = ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
    } }).outputText
    vm.runInNewContext(compiled, {
      ...context, module, exports: module.exports,
      require(name) {
        assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`)
        return imports[name]
      },
    })
    return module.exports
  }
  const proxy = load(proxySource, { 'next/server': next })
  const route = load(routeSource, {
    'node:os': { freemem: () => scenario.freeMemoryMb * megabyte },
    'next/server': next,
    '@/lib/arena-public-proxy': proxy,
    '@/lib/metagraph': {
      async fetchMetagraph() {
        metagraphReads += 1
        if (scenario.metagraphError) throw new Error('Metagraph unavailable')
      },
      getMetagraphCacheHealth: () => scenario.metagraph,
    },
  })
  const response = await route.GET()
  assert.deepEqual(deadlines, [8_000], 'Readiness must use the existing public request deadline')
  assert.equal(metagraphReads, 1, 'Arena failures must not bypass the metagraph check')
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  return { status: response.status, body: await response.json() }
}

const slowSuccess = await check()
assert.equal(slowSuccess.status, 200, 'A successful 3.5-second user request is ready within its 8-second deadline')
assert.equal(slowSuccess.body.status, 'ready')
assert.equal(slowSuccess.body.checks.arena.ok, true)
assert.equal(slowSuccess.body.checks.metagraphCache.ok, true)
assert.equal(slowSuccess.body.checks.memory.ok, true)

for (const status of [400, 503]) {
  const error = await check({ upstreamStatus: status })
  assert.equal(error.status, 503)
  assert.equal(error.body.checks.arena.ok, false)
  assert.equal(error.body.checks.arena.status, status)
  assert.equal(error.body.checks.arena.detail, `Arena returned HTTP ${status}`)
}
const timeout = await check({ latencyMs: 8_001 })
assert.equal(timeout.status, 503)
assert.equal(timeout.body.checks.arena.status, null)
assert.equal(timeout.body.checks.arena.ok, false)
assert.match(timeout.body.checks.arena.detail, /timed out/)
const invalidResponse = await check({ body: null })
assert.equal(invalidResponse.status, 503)
assert.equal(invalidResponse.body.checks.arena.ok, false)

for (const metagraph of [
  { available: false, ageMs: null },
  { available: true, ageMs: 600_001 },
]) {
  const stale = await check({ metagraph })
  assert.equal(stale.status, 503)
  assert.equal(stale.body.checks.arena.ok, true)
  assert.equal(stale.body.checks.metagraphCache.ok, false)
}
assert.equal((await check({ metagraphError: true })).status, 200, 'A fresh retained cache can tolerate refresh failure')
assert.equal((await check({ metagraph: { available: true, ageMs: 600_000 } })).status, 200)
for (const memory of [{ rssMb: 1_301 }, { freeMemoryMb: 191 }]) {
  const lowMemory = await check(memory)
  assert.equal(lowMemory.status, 503)
  assert.equal(lowMemory.body.checks.arena.ok, true)
  assert.equal(lowMemory.body.checks.memory.ok, false)
}
assert.equal((await check({ rssMb: 1_300, freeMemoryMb: 192 })).status, 200)
console.log('health-ready: public Arena deadline, failures, cache freshness, and memory checks passed')
