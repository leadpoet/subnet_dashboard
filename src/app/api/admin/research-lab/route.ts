import { NextRequest, NextResponse } from 'next/server'
import { decodeAddress } from '@polkadot/util-crypto'
import { getAdminSupabase } from '@/lib/admin-supabase'
import { normalizeResearchLabArenaSnapshot, type ResearchLabArenaSnapshot } from '@/lib/research-lab-arena'
import { fetchGatewayDeployment, type GatewayDeployment } from '@/lib/gateway-deployment'
import { fetchGatewayPcr0Acceptance, type GatewayPcr0Acceptance } from '@/lib/research-lab-pcr0-readiness'
import { evaluateResearchLabAlerts, type ResearchLabAlertObservations, type ResearchLabAlertResolution, type ResearchLabEvaluatedAlert } from '@/lib/research-lab-alerts'
import { getRuntimeSecretEnvironment } from '@/lib/runtime-secret-environment'
import { parseResearchLabAlertDeliveryConfig } from '@/lib/research-lab-alert-delivery'
import {
  dedupeLatestValidatorNodes,
  evaluateValidatorDeploymentEvidence,
  selectValidatorPcrNode,
} from '@/lib/admin-validator-health'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const GATEWAY_URL = (process.env.LEADPOET_GATEWAY_URL?.trim() || process.env.FULFILLMENT_GATEWAY_URL?.trim() || 'https://gateway.subnet71.com').replace(/\/+$/, '')
const ALERT_MONITOR_ID = 'research-lab-alerts:v1'
const FRESH_ATTESTATION_MS = 3 * 60 * 60 * 1000
const ADMIN_QUERY_LIMIT = 500

type HealthState = 'healthy' | 'degraded' | 'critical' | 'unknown'
export type AdminLabMonitoredValidator = { hotkey: string; label: string | null; source: 'database' | 'environment'; enabled: boolean; monitorPcr0: boolean; monitorOffchainWeights: boolean; monitorOnchainWeights: boolean; expectedPcr0: string | null; updatedAt: string | null }
export type AdminLabAlert = { id: string; fingerprint: string; signal: string; severity: string; status: string; title: string; detail: string; firstSeenAt: string | null; lastSeenAt: string | null; count: number }
export type AdminLabAlertOperations = { state: HealthState; sourceAvailable: boolean; monitorEnabled: boolean; monitoredValidatorCount: number; validators: AdminLabMonitoredValidator[]; emailConfigured: boolean; discordConfigured: boolean; deliveryReady: boolean; detail: string; lastCompletedAt: string | null; lastError: string | null }
export type AdminLabAlerts = { state: HealthState; sourceAvailable: boolean; totalLast24h: number; criticalLast24h: number; warningLast24h: number; activeCount: number; latestObservedAt: string | null; recent: AdminLabAlert[]; operations: AdminLabAlertOperations }
export type AdminLabAttestation = { state: HealthState; sourceAvailable: boolean; latestAttestedAt: string | null; nodes: Array<{ id: string; component: string; nodeId: string; hotkey: string | null; expectedPcr0: string | null; observedPcr0: string | null; matched: boolean | null; buildId: string | null; gitSha: string | null; attestedAt: string | null; acceptanceCheckedAt: string | null; acceptanceDetail: string | null }> }
export type AdminLabGateway = GatewayDeployment & { pcr0: GatewayPcr0Acceptance }
export type AdminLabValidatorDeployment = { sourceAvailable: boolean; currentRuntimeVerified: boolean; verificationReason: string | null; commitSha: string | null; buildId: string | null; reportedAt: string | null; checkedAt: string }
export type AdminLabHealthSignal = { id: string; label: string; value: string; state: HealthState; detail: string; updatedAt: string | null }
export type AdminLabOps = { state: HealthState; healthSignals: AdminLabHealthSignal[]; alerts: AdminLabAlerts; evaluatedAlerts: ResearchLabEvaluatedAlert[]; alertResolutions: ResearchLabAlertResolution[]; attestation: AdminLabAttestation; gateway: AdminLabGateway; validatorDeployment: AdminLabValidatorDeployment }
export type AdminResearchLabPayload = { arena: ResearchLabArenaSnapshot; ops: AdminLabOps; fetchedAt: string }

export async function GET(_request: NextRequest): Promise<NextResponse> {
  let supabase: ReturnType<typeof getAdminSupabase>
  try { supabase = getAdminSupabase() } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'admin supabase not configured' }, { status: 503 }) }
  try {
    const [arena, gateway, attestation, alerts] = await Promise.all([fetchArena(), fetchGatewayDeployment({ gatewayUrl: GATEWAY_URL }), fetchAttestation(supabase), fetchAlerts(supabase)])
    const validator = await buildValidatorDeployment(supabase, attestation)
    const evaluatedAlerts = evaluateResearchLabAlerts(buildAlertObservations(attestation, gateway), { now: new Date() })
    const gatewayPcr0 = await checkGatewayPcr0(attestation)
    const state = worstState([alerts.state, attestation.state, validator.currentRuntimeVerified ? 'healthy' : 'degraded'])
    const data: AdminResearchLabPayload = { arena, ops: { state, healthSignals: buildHealthSignals(arena, alerts, attestation, gateway, validator), alerts: { ...alerts, latestObservedAt: latestIso(alerts.latestObservedAt, attestation.latestAttestedAt) }, evaluatedAlerts, alertResolutions: [], attestation, gateway: { ...gateway, pcr0: gatewayPcr0 }, validatorDeployment: validator }, fetchedAt: new Date().toISOString() }
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to fetch Research Lab status' }, { status: 502 }) }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin')
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: 'Cross-origin validator registry writes are not allowed.' }, { status: 403 })
  let supabase: ReturnType<typeof getAdminSupabase>
  try { supabase = getAdminSupabase() } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'admin supabase not configured' }, { status: 503 }) }
  let body: Record<string, unknown>
  try { body = await request.json() as Record<string, unknown> } catch { return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 }) }
  const action = stringOr(body.action); const hotkey = stringOr(body.hotkey)
  if (!hotkey || !isValidValidatorHotkey(hotkey)) return NextResponse.json({ error: 'A valid Bittensor validator hotkey is required.' }, { status: 400 })
  if (action === 'remove_validator_monitor') { const { error } = await supabase.from('ops_validator_registry').delete().eq('validator_hotkey', hotkey); if (error) return NextResponse.json({ error: error.message }, { status: 502 }); return NextResponse.json({ ok: true, hotkey }, { headers: { 'Cache-Control': 'no-store' } }) }
  if (action !== 'upsert_validator_monitor') return NextResponse.json({ error: 'Unsupported validator registry action.' }, { status: 400 })
  const rawExpectedPcr0 = stringOr(body.expectedPcr0); const expectedPcr0 = rawExpectedPcr0 ? normalizePcr0(rawExpectedPcr0) : null
  if (rawExpectedPcr0 && !expectedPcr0) return NextResponse.json({ error: 'Expected PCR0 must be a 96-character hexadecimal value.' }, { status: 400 })
  const row = { validator_hotkey: hotkey, label: stringOr(body.label)?.slice(0, 80) ?? null, enabled: booleanOr(body.enabled) ?? true, monitor_pcr0: booleanOr(body.monitorPcr0) ?? true, monitor_offchain_weights: booleanOr(body.monitorOffchainWeights) ?? true, monitor_onchain_weights: booleanOr(body.monitorOnchainWeights) ?? true, expected_pcr0: expectedPcr0, created_by: 'admin_dashboard', updated_at: new Date().toISOString() }
  const { data, error } = await supabase.from('ops_validator_registry').upsert(row, { onConflict: 'validator_hotkey' }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 502 })
  return NextResponse.json({ ok: true, validator: normalizeValidator(data as Record<string, unknown>) }, { headers: { 'Cache-Control': 'no-store' } })
}

async function fetchArena(): Promise<ResearchLabArenaSnapshot> {
  let current: unknown
  try { current = await fetchJson(`${GATEWAY_URL}/arena/v1/current`) } catch { return { activeRound: null, publishedBaseline: null, publishedWinner: null } }
  const root = record(current); if (!root) return { activeRound: null, publishedBaseline: null, publishedWinner: null }
  const running = Array.isArray(root.running_rounds) ? root.running_rounds.map(record).filter((row): row is Record<string, unknown> => Boolean(row)) : []
  const active = running.at(-1) ?? record(root.round); const published = record(root.published_round)
  const activeId = stringOr(active?.round_id); const publishedId = stringOr(published?.round_id); const ids = [...new Set([activeId, publishedId].filter((id): id is string => Boolean(id)))]
  const rounds = await Promise.all(ids.map(async (id) => { try { return [id, await fetchJson(`${GATEWAY_URL}/arena/v1/rounds/${encodeURIComponent(id)}`)] as const } catch { return null } }))
  const byId = new Map(rounds.filter((entry): entry is readonly [string, unknown] => Boolean(entry)))
  return normalizeResearchLabArenaSnapshot(current, activeId ? byId.get(activeId) ?? active : null, publishedId ? byId.get(publishedId) : null)
}
async function fetchJson(url: string): Promise<unknown> { const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) }); if (!response.ok) throw new Error(`Arena request failed (${response.status})`); return response.json() }

async function fetchAttestation(supabase: ReturnType<typeof getAdminSupabase>): Promise<AdminLabAttestation> {
  const result = await supabase.from('ops_attestation_current').select('*').limit(ADMIN_QUERY_LIMIT)
  if (result.error) return { state: 'unknown', sourceAvailable: false, latestAttestedAt: null, nodes: [] }

  const nodes = dedupeLatestValidatorNodes(
    ((result.data ?? []) as Array<Record<string, unknown>>).map(normalizeAttestation),
  )
  const latestAttestedAt = latestIso(...nodes.map((node) => node.attestedAt))
  const age = latestAttestedAt ? Date.now() - Date.parse(latestAttestedAt) : null
  const mismatched = nodes.some((node) => node.matched === false)
  return {
    state: mismatched ? 'critical' : age === null || age > FRESH_ATTESTATION_MS ? 'degraded' : 'healthy',
    sourceAvailable: true,
    latestAttestedAt,
    nodes,
  }
}
async function fetchAlerts(supabase: ReturnType<typeof getAdminSupabase>): Promise<AdminLabAlerts> {
  const [current, monitor, registry] = await Promise.all([supabase.from('ops_alert_current').select('*').order('last_seen_at', { ascending: false }).limit(ADMIN_QUERY_LIMIT), supabase.from('ops_alert_monitor_state').select('*').eq('monitor_id', ALERT_MONITOR_ID).limit(1).maybeSingle(), supabase.from('ops_validator_registry').select('*').order('updated_at', { ascending: false }).limit(ADMIN_QUERY_LIMIT)])
  const recent = ((current.data ?? []) as Array<Record<string, unknown>>).map(normalizeAlert).filter((row): row is AdminLabAlert => Boolean(row)); const last24 = recent.filter((row) => Date.parse(row.lastSeenAt ?? row.firstSeenAt ?? '') >= Date.now() - 86_400_000); const validators = ((registry.data ?? []) as Array<Record<string, unknown>>).map(normalizeValidator); const known = new Set(validators.map((row) => row.hotkey)); for (const hotkey of configuredValidatorHotkeys()) { if (!known.has(hotkey)) validators.push({ hotkey, label: null, source: 'environment', enabled: true, monitorPcr0: true, monitorOffchainWeights: true, monitorOnchainWeights: true, expectedPcr0: null, updatedAt: null }) }
  let emailConfigured = false; let discordConfigured = false; let deliveryError: string | null = null
  try { const config = parseResearchLabAlertDeliveryConfig(getRuntimeSecretEnvironment()); emailConfigured = Boolean(config.email); discordConfigured = Boolean(config.discord) } catch (error) { deliveryError = error instanceof Error ? error.message : 'Alert delivery configuration is invalid.' }
  const monitorRow = (monitor.data ?? null) as Record<string, unknown> | null; const monitorEnabled = process.env.RESEARCH_LAB_ALERT_MONITOR_ENABLED === 'true'; const lastCompletedAt = stringOr(monitorRow?.last_completed_at); const heartbeatAge = lastCompletedAt ? Date.now() - Date.parse(lastCompletedAt) : null
  const state: HealthState = current.error || registry.error || monitor.error ? 'unknown' : !monitorEnabled || validators.filter((row) => row.enabled).length === 0 || (!emailConfigured && !discordConfigured) ? 'degraded' : heartbeatAge === null || heartbeatAge > 10 * 60_000 ? 'critical' : 'healthy'
  return { state, sourceAvailable: !current.error, totalLast24h: last24.reduce((sum, row) => sum + Math.max(1, row.count), 0), criticalLast24h: last24.filter((row) => row.severity === 'critical').length, warningLast24h: last24.filter((row) => row.severity === 'warning').length, activeCount: recent.filter((row) => !['resolved', 'closed'].includes(row.status)).length, latestObservedAt: latestIso(...recent.map((row) => row.lastSeenAt ?? row.firstSeenAt)), recent: recent.slice(0, 24), operations: { state, sourceAvailable: !registry.error && !monitor.error, monitorEnabled, monitoredValidatorCount: validators.filter((row) => row.enabled).length, validators, emailConfigured, discordConfigured, deliveryReady: !deliveryError && (emailConfigured || discordConfigured), detail: deliveryError ?? (monitorEnabled ? 'Alert monitor is configured.' : 'Background alert monitor is disabled.'), lastCompletedAt, lastError: stringOr(monitorRow?.last_error) } }
}

async function buildValidatorDeployment(supabase: ReturnType<typeof getAdminSupabase>, attestation: AdminLabAttestation): Promise<AdminLabValidatorDeployment> {
  const receipt = await supabase.from('research_lab_attested_execution_receipts_v2').select('commit_sha,boot_identity_hash,issued_at,created_at').eq('role', 'validator_weights').order('issued_at', { ascending: false }).limit(1).maybeSingle()
  const receiptRow = (receipt.data ?? null) as Record<string, unknown> | null
  const receiptAt = stringOr(receiptRow?.issued_at) ?? stringOr(receiptRow?.created_at)
  const evidence = evaluateValidatorDeploymentEvidence(
    receiptRow
      ? {
          commitSha: stringOr(receiptRow.commit_sha),
          buildId: stringOr(receiptRow.boot_identity_hash),
          reportedAt: receiptAt,
        }
      : null,
    attestation.nodes,
    Date.now(),
  )
  return {
    ...evidence,
    checkedAt: new Date().toISOString(),
  }
}
function buildAlertObservations(attestation: AdminLabAttestation, gateway: GatewayDeployment): ResearchLabAlertObservations { return { validators: attestation.nodes.map((node) => ({ validatorId: node.hotkey ?? node.nodeId, source: 'ops_attestation_current', pcr0: { expectedPcr0: node.expectedPcr0, observedPcr0: node.observedPcr0, matched: node.matched, observedAt: node.attestedAt }, offchainWeightBundle: { publishedAt: node.attestedAt, bundleId: node.id } })), dataFreshness: [{ sourceId: 'validator_attestation', source: 'ops_attestation_current', observedAt: attestation.latestAttestedAt }, ...(gateway.checkedAt ? [{ sourceId: 'gateway_readiness', source: 'gateway', observedAt: gateway.checkedAt }] : [])] } }
async function checkGatewayPcr0(attestation: AdminLabAttestation): Promise<GatewayPcr0Acceptance> {
  const node = selectValidatorPcrNode(attestation.nodes)
  return fetchGatewayPcr0Acceptance({
    gatewayUrl: GATEWAY_URL,
    pcr0: node?.observedPcr0 ?? null,
    commit: node?.gitSha ?? null,
  })
}
function buildHealthSignals(
  arena: ResearchLabArenaSnapshot,
  alerts: AdminLabAlerts,
  attestation: AdminLabAttestation,
  gateway: GatewayDeployment,
  validator: AdminLabValidatorDeployment,
): AdminLabHealthSignal[] {
  return [
    {
      id: 'arena',
      label: 'Arena',
      value: arena.activeRound?.status ?? 'Unavailable',
      state: arena.activeRound ? 'healthy' : 'unknown',
      detail: arena.activeRound
        ? `Round ${arena.activeRound.roundId} is ${arena.activeRound.status}.`
        : 'Arena current state is unavailable.',
      updatedAt: null,
    },
    {
      id: 'baseline',
      label: 'Public baseline',
      value: arena.publishedBaseline ? arena.publishedBaseline.score.toFixed(2) : 'Unavailable',
      state: arena.publishedBaseline ? 'healthy' : 'unknown',
      detail: arena.publishedBaseline
        ? `Published round ${arena.publishedBaseline.roundId}.`
        : 'No published baseline result is available.',
      updatedAt: arena.publishedBaseline?.publishedAt ?? null,
    },
    {
      id: 'pcr0',
      label: 'PCR0',
      value: attestation.nodes.length
        ? `${attestation.nodes.filter((node) => node.matched === true).length}/${attestation.nodes.length}`
        : 'Unavailable',
      state: attestation.state,
      detail: attestation.latestAttestedAt
        ? `Latest attestation ${attestation.latestAttestedAt}.`
        : 'No validator attestation is available.',
      updatedAt: attestation.latestAttestedAt,
    },
    {
      id: 'gateway',
      label: 'Gateway',
      value: gateway.sourceAvailable ? 'Metadata available' : 'Unavailable',
      state: gateway.sourceAvailable ? 'unknown' : 'degraded',
      detail: gateway.sourceAvailable
        ? 'The deployment endpoint reported commit metadata; runtime readiness is not proven by this signal.'
        : gateway.unavailableReason ?? 'Gateway deployment metadata is unavailable.',
      updatedAt: gateway.checkedAt,
    },
    {
      id: 'validator',
      label: 'Validator runtime',
      value: validator.currentRuntimeVerified ? 'Ready' : 'Attention',
      state: validator.currentRuntimeVerified ? 'healthy' : 'degraded',
      detail: validator.verificationReason ?? 'Recent validator runtime evidence is available.',
      updatedAt: validator.reportedAt,
    },
    {
      id: 'alerts',
      label: 'Alerts',
      value: `${alerts.activeCount} active`,
      state: alerts.state,
      detail: alerts.operations.detail,
      updatedAt: alerts.latestObservedAt,
    },
  ]
}
function normalizeAttestation(row: Record<string, unknown>): AdminLabAttestation['nodes'][number] { const expected = normalizePcr0(row.expected_pcr0 ?? row.expectedPCR0); const observed = normalizePcr0(row.observed_pcr0 ?? row.validator_pcr0 ?? row.pcr0 ?? row.observedPCR0); const explicit = typeof row.matched === 'boolean' ? row.matched : typeof row.pcr0_matched === 'boolean' ? row.pcr0_matched : null; return { id: stringOr(row.id) ?? `${stringOr(row.component) ?? 'validator'}:${stringOr(row.node_id) ?? stringOr(row.validator_hotkey) ?? 'unknown'}`, component: stringOr(row.component) ?? 'validator', nodeId: stringOr(row.node_id) ?? stringOr(row.validator_id) ?? stringOr(row.validator_hotkey) ?? 'unknown', hotkey: stringOr(row.hotkey) ?? stringOr(row.validator_hotkey), expectedPcr0: expected, observedPcr0: observed, matched: explicit ?? (expected && observed ? expected === observed : null), buildId: stringOr(row.build_id) ?? (row.epoch_id === undefined ? null : `epoch ${String(row.epoch_id)}`), gitSha: stringOr(row.git_sha) ?? stringOr(row.git_commit_sha) ?? stringOr(row.pcr0_commit_hash), attestedAt: stringOr(row.attested_at) ?? stringOr(row.updated_at) ?? stringOr(row.created_at), acceptanceCheckedAt: null, acceptanceDetail: null } }
function normalizeAlert(row: Record<string, unknown>): AdminLabAlert | null { const id = stringOr(row.id) ?? stringOr(row.alert_id); if (!id) return null; return { id, fingerprint: stringOr(row.fingerprint) ?? id, signal: stringOr(row.signal) ?? 'unknown', severity: stringOr(row.severity)?.toLowerCase() ?? 'warning', status: stringOr(row.status)?.toLowerCase() ?? 'open', title: stringOr(row.title) ?? id, detail: stringOr(row.detail) ?? '', firstSeenAt: stringOr(row.first_seen_at) ?? stringOr(row.created_at), lastSeenAt: stringOr(row.last_seen_at) ?? stringOr(row.updated_at), count: numberOr(row.occurrences ?? row.count, 1) } }
function normalizeValidator(row: Record<string, unknown>): AdminLabMonitoredValidator { return { hotkey: stringOr(row.validator_hotkey) ?? '', label: stringOr(row.label), source: 'database', enabled: booleanOr(row.enabled) ?? true, monitorPcr0: booleanOr(row.monitor_pcr0) ?? true, monitorOffchainWeights: booleanOr(row.monitor_offchain_weights) ?? true, monitorOnchainWeights: booleanOr(row.monitor_onchain_weights) ?? true, expectedPcr0: normalizePcr0(row.expected_pcr0), updatedAt: stringOr(row.updated_at) } }
function isValidValidatorHotkey(value: string): boolean { if (!/^[1-9A-HJ-NP-Za-km-z]{40,64}$/.test(value)) return false; try { return decodeAddress(value).length === 32 } catch { return false } }
function configuredValidatorHotkeys(): string[] { return (process.env.OPS_MONITORED_VALIDATOR_HOTKEYS ?? '').split(',').map((value) => value.trim()).filter(Boolean) }
function normalizePcr0(value: unknown): string | null { const text = stringOr(value)?.toLowerCase().replace(/^0x/, ''); return text && /^[0-9a-f]{96}$/.test(text) ? text : null }
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null }
function stringOr(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null }
function numberOr(value: unknown, fallback: number): number { const result = typeof value === 'number' ? value : Number(value); return Number.isFinite(result) ? result : fallback }
function booleanOr(value: unknown): boolean | null { return typeof value === 'boolean' ? value : null }
function latestIso(...values: Array<string | null | undefined>): string | null { const valid = values.filter((value): value is string => typeof value === 'string' && Boolean(value) && Number.isFinite(Date.parse(value))); return valid.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null }
function worstState(states: Array<HealthState | string>): HealthState { if (states.includes('critical')) return 'critical'; if (states.includes('degraded')) return 'degraded'; if (states.includes('unknown')) return 'unknown'; return 'healthy' }
