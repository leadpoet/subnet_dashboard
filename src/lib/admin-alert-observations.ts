import type {
  ResearchLabAlertObservations,
  ResearchLabValidatorAlertObservation,
} from './research-lab-alerts'

export type AdminAlertAttestationNode = {
  id: string
  nodeId: string
  hotkey: string | null
  expectedPcr0: string | null
  observedPcr0: string | null
  matched: boolean | null
  attestedAt: string | null
}

export type AdminAlertMonitoredValidator = {
  hotkey: string
  enabled: boolean
  monitorPcr0: boolean
  monitorOffchainWeights: boolean
  monitorOnchainWeights: boolean
  expectedPcr0: string | null
}

export type AdminAlertGateway = { checkedAt: string | null }

type AlertSupabase = {
  from: (table: string) => unknown
}

type AlertQuery = {
  eq: (column: string, value: unknown) => AlertQuery
  in: (column: string, values: readonly string[]) => AlertQuery
  order: (column: string, options: { ascending: boolean }) => AlertQuery
  limit: (count: number) => PromiseLike<{ data: unknown; error: unknown }>
}

type AlertFrom = { select: (columns?: string) => AlertQuery }

type AlertMetagraph = {
  lastUpdates: Record<string, number>
  currentBlock: number | null
}

export async function buildAdminAlertObservations({
  supabase,
  attestationNodes,
  gateway,
  configuredValidators,
  fetchMetagraphFn,
}: {
  supabase: AlertSupabase
  attestationNodes: readonly AdminAlertAttestationNode[]
  gateway: AdminAlertGateway
  configuredValidators: readonly AdminAlertMonitoredValidator[]
  fetchMetagraphFn: () => Promise<AlertMetagraph>
}): Promise<ResearchLabAlertObservations> {
  const configured = new Map(
    configuredValidators.map((validator) => [validator.hotkey, validator]),
  )
  const observed = new Map(
    attestationNodes.map((node) => [node.hotkey ?? node.nodeId, node]),
  )
  const validatorIds = new Set([...configured.keys(), ...observed.keys()])
  const monitored = [...validatorIds].filter(
    (validatorId) => configured.get(validatorId)?.enabled !== false,
  )
  const onchainIds = monitored.filter(
    (validatorId) => configured.get(validatorId)?.monitorOnchainWeights ?? true,
  )
  const offchainIds = monitored.filter(
    (validatorId) => configured.get(validatorId)?.monitorOffchainWeights ?? true,
  )

  const [metagraph, weightBundles] = await Promise.all([
    onchainIds.length > 0 ? fetchMetagraphFn() : Promise.resolve(null),
    fetchPublishedWeightBundles(supabase, offchainIds),
  ])

  const validators = monitored.map((validatorId) => {
    const configuration = configured.get(validatorId)
    const node = observed.get(validatorId)
    const observation: ResearchLabValidatorAlertObservation = {
      validatorId,
      source: node ? 'ops_attestation_current' : 'ops_validator_registry',
    }

    if (configuration?.monitorPcr0 ?? true) {
      observation.pcr0 = {
        expectedPcr0: configuration?.expectedPcr0 ?? node?.expectedPcr0 ?? null,
        observedPcr0: node?.observedPcr0 ?? null,
        matched: node?.matched ?? null,
        observedAt: node?.attestedAt ?? null,
      }
    }
    if (configuration?.monitorOffchainWeights ?? true) {
      observation.offchainWeightBundle = weightBundles.get(validatorId) ?? {
        publishedAt: null,
        bundleId: null,
      }
    }
    if (configuration?.monitorOnchainWeights ?? true) {
      observation.onchainUpdate = {
        lastUpdateBlock: metagraph?.lastUpdates?.[validatorId] ?? null,
        currentBlock: metagraph?.currentBlock ?? null,
      }
    }
    return observation
  })

  return {
    validators,
    dataFreshness: [
      {
        sourceId: 'validator_attestation',
        source: 'ops_attestation_current',
        observedAt: latestTimestamp(attestationNodes.map((node) => node.attestedAt)),
      },
      ...(gateway.checkedAt
        ? [{ sourceId: 'gateway_readiness', source: 'gateway', observedAt: gateway.checkedAt }]
        : []),
    ],
  }
}

async function fetchPublishedWeightBundles(
  supabase: AlertSupabase,
  validatorHotkeys: string[],
): Promise<Map<string, { publishedAt: string | null; bundleId: string | null }>> {
  if (validatorHotkeys.length === 0) return new Map()
  const query = (supabase.from('published_weight_bundles') as AlertFrom).select(
    'validator_hotkey,epoch_id,created_at',
  )
  const result = await query
    .eq('netuid', 71)
    .in('validator_hotkey', validatorHotkeys)
    .order('created_at', { ascending: false })
    .limit(500)
  if (result.error) return new Map()

  const latest = new Map<string, { publishedAt: string | null; bundleId: string | null }>()
  for (const row of (result.data ?? []) as Array<Record<string, unknown>>) {
    const hotkey = stringOr(row.validator_hotkey)
    if (!hotkey || latest.has(hotkey)) continue
    latest.set(hotkey, {
      publishedAt: stringOr(row.created_at),
      bundleId: stringOr(row.epoch_id),
    })
  }
  return latest
}

function latestTimestamp(values: readonly (string | null)[]): string | null {
  const valid: string[] = []
  for (const value of values) {
    if (value && Number.isFinite(Date.parse(value))) valid.push(value)
  }
  valid.sort((left, right) => Date.parse(right) - Date.parse(left))
  return valid[0] ?? null
}

function stringOr(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
