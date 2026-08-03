import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const tsc = spawnSync(process.execPath, [
  resolve('node_modules/typescript/bin/tsc'),
  '--noEmit',
  '--pretty',
  'false',
], { stdio: 'inherit' })
assert.equal(tsc.status, 0, 'the durable alert monitor and application should compile')

const monitor = await readFile(resolve('src/lib/research-lab-alert-monitor.ts'), 'utf8')
const instrumentation = await readFile(resolve('src/instrumentation.ts'), 'utf8')
const route = await readFile(resolve('src/app/api/admin/research-lab/route.ts'), 'utf8')
const alerts = await readFile(resolve('src/lib/research-lab-alerts.ts'), 'utf8')
const leaseMigration = await readFile(
  resolve('supabase/migrations/20260710093000_research_lab_alert_monitor_lease.sql'),
  'utf8',
)

assert.match(monitor, /claim_ops_alert_monitor_lease/)
assert.match(monitor, /const MONITOR_OWNER = `\$\{process\.pid\}:\$\{crypto\.randomUUID\(\)\}`/)
assert.match(monitor, /dependencies\.owner \?\? MONITOR_OWNER/)
assert.match(monitor, /planResearchLabAlertLifecycle/)
assert.match(monitor, /ops_alert_current/)
assert.match(monitor, /ops_alert_events/)
assert.match(monitor, /ops_alert_delivery_events/)
assert.match(monitor, /deliverResearchLabAlert/)
assert.match(monitor, /RESEARCH_LAB_ALERT_SIGNALS/)
assert.match(monitor, /enabledSignals\.has\(alert\.signal\)/)
assert.match(monitor, /fallbackFor: 'discord'/)
assert.match(monitor, /collectCanonicalAlertSnapshotFromAdminRoute/)
assert.match(monitor, /resolutions: snapshot\.resolutions/)
assert.match(monitor, /planResearchLabAlertDeliveryBatches\(\s*scanned\.deliverableIntents,\s*new Date\(nowIso\),/)
assert.match(monitor, /partitionResearchLabAlertDeliveryIntents\(intents\)/)
assert.match(monitor, /shouldSuppressResearchLabBenchmarkRecoveryDelivery/)
assert.match(monitor, /suppressed_benchmark_recoveries/)
assert.match(monitor, /\.order\('intent_id', \{ ascending: true \}\)/)
assert.match(monitor, /\.range\(offset, offset \+ DELIVERY_BATCH_SIZE - 1\)/)
assert.match(monitor, /idempotencyKey: batchDeliveryIdempotencyKey\(batch\.intents\)/)
assert.match(monitor, /\.eq\('status', 'pending'\)/)
const persistenceBlock = monitor.slice(
  monitor.indexOf('async function persistLifecyclePlan'),
  monitor.indexOf('async function deliverDueIntents'),
)
assert.ok(
  persistenceBlock.indexOf(".from('ops_alert_events')") <
    persistenceBlock.indexOf(".from('ops_alert_current')"),
  'append-only transition events must persist before the mutable incident row',
)
const deliveryBlock = monitor.slice(
  monitor.indexOf('async function deliverDueIntents'),
  monitor.indexOf('function batchDeliveryIdempotencyKey'),
)
assert.doesNotMatch(deliveryBlock, /\.limit\(DELIVERY_BATCH_SIZE\)/,
  'suppressed legacy rows cannot consume the only delivery page')
assert.ok(
  deliveryBlock.indexOf('if (batch.intents.some(isSuppressedBenchmarkRecoveryIntent))') <
    deliveryBlock.indexOf('await deliverResearchLabAlert'),
  'the final pending-outbox guard must run before every provider call',
)
assert.ok(
  persistenceBlock.indexOf(".from('ops_alert_delivery_events')") <
    persistenceBlock.indexOf(".from('ops_alert_current')"),
  'delivery intents must persist before the mutable incident row',
)
assert.match(instrumentation, /RESEARCH_LAB_ALERT_MONITOR_ENABLED/)
assert.match(instrumentation, /runResearchLabAlertMonitor/)
assert.match(route, /evaluatedAlerts: ResearchLabEvaluatedAlert\[\]/)
assert.match(route, /evaluatedAlerts,/)
assert.match(route, /alertResolutions,/)
assert.match(route, /shouldSuppressResearchLabExecutionAlert/)
assert.match(route, /shouldSuppressResearchLabUnlinkedBenchmarkFailure/)
assert.match(route, /buildBenchmarkAlertResolutions/)
assert.match(route, /resolveResearchLabBenchmarkAlertIdentity/)
assert.match(route, /alertIdentity/)
assert.match(route, /buildResearchLabBenchmarkSuccessResolutions/)
assert.doesNotMatch(route, /const MIN_LINKED_BENCHMARK_FAILURES_FOR_WARNING/)
assert.match(alerts, /export const MIN_LINKED_BENCHMARK_FAILURES_FOR_WARNING = 2/)
assert.match(alerts, /\['benchmark_failed', 'benchmark_stalled'\]/)
assert.doesNotMatch(alerts, /linkedFailedExecutionIds\.size >= 2/)
assert.match(leaseMigration, /security definer/)
assert.match(leaseMigration, /revoke all on function[\s\S]*from public, anon, authenticated/)
assert.match(leaseMigration, /grant execute on function[\s\S]*to service_role/)

await testPendingOutboxBenchmarkRecoverySuppression()

console.log('research-lab-alert-monitor: lease, persistence, queue, delivery, and scheduler wiring passed')

async function testPendingOutboxBenchmarkRecoverySuppression() {
  const outDir = await mkdtemp(join(tmpdir(), 'research-lab-alert-monitor-runtime-'))
  try {
    const compile = spawnSync(process.execPath, [
      resolve('node_modules/typescript/bin/tsc'),
      '--project', resolve('tsconfig.json'),
      '--noEmit', 'false',
      '--outDir', outDir,
      '--module', 'CommonJS',
      '--moduleResolution', 'Node',
      '--target', 'ES2022',
    ], { stdio: 'inherit' })
    assert.equal(compile.status, 0, 'compiled monitor harness should type-check')

    const require = createRequire(import.meta.url)
    const Module = require('node:module')
    const originalResolveFilename = Module._resolveFilename
    let resolvingProjectPackage = false
    Module._resolveFilename = function resolveCompiledAlias(request, parent, isMain, options) {
      if (resolvingProjectPackage) {
        return originalResolveFilename.call(this, request, parent, isMain, options)
      }
      if (request.startsWith('@/')) {
        return originalResolveFilename.call(
          this,
          join(outDir, 'src', request.slice(2)),
          parent,
          isMain,
          options,
        )
      }
      if (!request.startsWith('.') && !request.startsWith('node:')) {
        resolvingProjectPackage = true
        try {
          return require.resolve(request)
        } finally {
          resolvingProjectPackage = false
        }
      }
      return originalResolveFilename.call(this, request, parent, isMain, options)
    }

    const now = new Date('2026-08-03T12:00:00.000Z')
    const dueAt = new Date(now.getTime() - (10 * 60 * 1_000)).toISOString()
    const benchmarkRecovery = pendingIntent({
      intentId: 'benchmark-recovery',
      transition: 'recover',
      signal: 'benchmark_failed',
      scope: 'benchmark',
      fingerprint: 'research-lab:v1:benchmark_failed:benchmark:2026-08-03',
      dueAt,
    })
    const deliverableIntents = [
      pendingIntent({
        intentId: 'data-recovery',
        transition: 'recover',
        signal: 'data_freshness',
        scope: 'data',
        fingerprint: 'research-lab:v1:data_freshness:data:research-lab',
        dueAt,
      }),
      pendingIntent({
        intentId: 'benchmark-open',
        transition: 'open',
        signal: 'benchmark_failed',
        scope: 'benchmark',
        fingerprint: 'research-lab:v1:benchmark_failed:benchmark:2026-08-03',
        dueAt,
      }),
      pendingIntent({
        intentId: 'benchmark-escalate',
        transition: 'escalate',
        signal: 'benchmark_failed',
        scope: 'benchmark',
        fingerprint: 'research-lab:v1:benchmark_failed:benchmark:2026-08-03',
        dueAt,
      }),
      pendingIntent({
        intentId: 'benchmark-remind',
        transition: 'remind',
        signal: 'benchmark_failed',
        scope: 'benchmark',
        fingerprint: 'research-lab:v1:benchmark_failed:benchmark:2026-08-03',
        dueAt,
      }),
    ]
    const fake = createMonitorSupabase([benchmarkRecovery, ...deliverableIntents])
    const fetchCalls = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (url) => {
      fetchCalls.push(String(url))
      return new Response(null, { status: 204 })
    }

    try {
      const { runResearchLabAlertMonitor } = require(
        join(outDir, 'src/lib/research-lab-alert-monitor.js'),
      )
      const result = await runResearchLabAlertMonitor({
        supabase: fake.supabase,
        collectAlerts: async () => [],
        now: () => now,
        owner: 'monitor-test-owner',
        env: {
          RESEARCH_LAB_ALERT_DASHBOARD_URL: 'https://dashboard.example.com/admin/research-lab',
          RESEARCH_LAB_ALERT_DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123456789/test-token',
        },
      })
      assert.equal(result.deliveryCount, 4)
      assert.equal(result.deliveryFailureCount, 0)
      assert.equal(fetchCalls.length, 4, 'only non-suppressed persisted intents may call Discord')
      assert.equal(
        fake.deliveryUpdates.some((update) => update.intentId === 'benchmark-recovery'),
        false,
        'the old-schema guard leaves a suppressed pending row untouched',
      )
      assert.deepEqual(
        fake.deliveryUpdates.map((update) => update.intentId).sort(),
        deliverableIntents.map((intent) => intent.intent_id).sort(),
      )
      assert.equal(fake.heartbeatDoc.suppressed_benchmark_recoveries, 1)

      const olderSuppressed = Array.from({ length: 50 }, (_, index) => pendingIntent({
        intentId: `benchmark-recovery-${String(index + 1).padStart(2, '0')}`,
        transition: 'recover',
        signal: index % 2 === 0 ? 'benchmark_failed' : 'benchmark_stalled',
        scope: 'benchmark',
        fingerprint: `research-lab:v1:benchmark_failed:benchmark:2026-08-03-${index + 1}`,
        dueAt: new Date(now.getTime() - (20 * 60 * 1_000)).toISOString(),
      }))
      const laterDeliverable = pendingIntent({
        intentId: 'data-recovery-after-suppressed-rows',
        transition: 'recover',
        signal: 'data_freshness',
        scope: 'data',
        fingerprint: 'research-lab:v1:data_freshness:data:research-lab',
        dueAt,
      })
      const saturated = createMonitorSupabase([...olderSuppressed, laterDeliverable])
      const providerCallsBeforeSaturatedScan = fetchCalls.length
      const saturatedResult = await runResearchLabAlertMonitor({
        supabase: saturated.supabase,
        collectAlerts: async () => [],
        now: () => now,
        owner: 'monitor-saturated-test-owner',
        env: {
          RESEARCH_LAB_ALERT_DASHBOARD_URL: 'https://dashboard.example.com/admin/research-lab',
          RESEARCH_LAB_ALERT_DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123456789/test-token',
        },
      })
      assert.equal(saturatedResult.deliveryCount, 1,
        'the first actionable row after a full suppressed page is still delivered')
      assert.equal(fetchCalls.length - providerCallsBeforeSaturatedScan, 1)
      assert.equal(
        saturated.deliveryUpdates.some((update) => update.intentId.startsWith('benchmark-recovery-')),
        false,
        'all suppressed legacy rows remain pending without a status or transition write',
      )
      assert.deepEqual(
        saturated.deliveryUpdates.map((update) => update.intentId),
        [laterDeliverable.intent_id],
      )
      assert.equal(saturated.heartbeatDoc.suppressed_benchmark_recoveries, 50)
      assert.deepEqual(
        saturated.deliveryReads.map((read) => read.range),
        [[0, 49], [50, 99]],
        'the monitor advances by raw rows and reads the second deterministic page',
      )
      assert.deepEqual(
        saturated.deliveryReads.map((read) => read.orders),
        [
          ['due_at:asc', 'intent_id:asc'],
          ['due_at:asc', 'intent_id:asc'],
        ],
      )
    } finally {
      globalThis.fetch = originalFetch
      Module._resolveFilename = originalResolveFilename
    }
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}

function pendingIntent({ intentId, transition, signal, scope, fingerprint, dueAt }) {
  const occurredAt = '2026-08-03T11:00:00.000Z'
  const alert = {
    fingerprint,
    signal,
    severity: 'warning',
    scope,
    entityId: scope === 'benchmark' ? '2026-08-03' : 'research-lab',
    validatorId: null,
    title: `${signal} fixture`,
    detail: 'Persisted pending delivery fixture.',
    observedAt: occurredAt,
    ageMs: 1_000,
    ageBlocks: null,
    sources: ['fixture'],
    occurrences: 1,
  }
  return {
    intent_id: intentId,
    idempotency_key: `${intentId}:key`,
    attempt: 1,
    is_retry: false,
    status: 'pending',
    due_at: dueAt,
    retry_delay_ms: 0,
    channel: 'discord',
    destination_hash: `${intentId}-hash`,
    transition_id: `${intentId}:transition`,
    transition,
    incident_id: `${intentId}:incident`,
    fingerprint,
    payload_doc: {
      transitionId: `${intentId}:transition`,
      transition,
      incidentId: `${intentId}:incident`,
      fingerprint,
      episode: 1,
      sequence: 1,
      occurredAt,
      fromStatus: transition === 'open' ? null : 'open',
      toStatus: transition === 'recover' ? 'resolved' : 'open',
      fromSeverity: transition === 'open' ? null : 'warning',
      toSeverity: transition === 'recover' ? null : 'warning',
      severity: 'warning',
      alert,
    },
  }
}

function createMonitorSupabase(pendingRows) {
  const deliveryUpdates = []
  const deliveryReads = []
  let heartbeatDoc = null
  const supabase = {
    async rpc() {
      return { data: true, error: null }
    },
    from(table) {
      let selected = false
      let statusFilter = null
      let dueAtFilter = null
      let update = null
      let intentId = null
      let rangeStart = null
      let rangeEnd = null
      const orders = []
      const query = {
        select() {
          selected = true
          return query
        },
        order(column, options = {}) {
          orders.push(`${column}:${options.ascending === false ? 'desc' : 'asc'}`)
          return query
        },
        limit() {
          return query
        },
        range(from, to) {
          rangeStart = from
          rangeEnd = to
          return query
        },
        lte(column, value) {
          if (column === 'due_at') dueAtFilter = value
          return query
        },
        eq(column, value) {
          if (column === 'status') statusFilter = value
          if (column === 'intent_id') intentId = value
          return query
        },
        upsert() {
          return Promise.resolve({ data: null, error: null })
        },
        update(values) {
          update = values
          return query
        },
        then(resolve, reject) {
          if (update) {
            if (table === 'ops_alert_delivery_events' && intentId) {
              deliveryUpdates.push({ intentId, values: update })
            }
            if (table === 'ops_alert_monitor_state') heartbeatDoc = update.heartbeat_doc
            return Promise.resolve({ data: null, error: null }).then(resolve, reject)
          }
          let data = []
          if (selected && table === 'ops_alert_delivery_events' && statusFilter === 'pending') {
            data = pendingRows
              .filter((row) => row.status === 'pending')
              .filter((row) => dueAtFilter === null || row.due_at <= dueAtFilter)
              .sort((left, right) => {
                for (const order of orders) {
                  const [column, direction] = order.split(':')
                  const leftValue = String(left[column] ?? '')
                  const rightValue = String(right[column] ?? '')
                  if (leftValue === rightValue) continue
                  const comparison = leftValue < rightValue ? -1 : 1
                  return direction === 'desc' ? -comparison : comparison
                }
                return 0
              })
            const from = rangeStart ?? 0
            const to = rangeEnd ?? data.length - 1
            data = data.slice(from, to + 1)
            deliveryReads.push({
              status: statusFilter,
              dueAt: dueAtFilter,
              orders: [...orders],
              range: [from, to],
            })
          }
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        },
      }
      return query
    },
  }
  return {
    supabase,
    deliveryUpdates,
    deliveryReads,
    get heartbeatDoc() {
      return heartbeatDoc ?? {}
    },
  }
}
