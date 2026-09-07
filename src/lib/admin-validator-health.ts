export type ValidatorHealthNode = {
  id: string
  component: string
  nodeId: string
  hotkey: string | null
  observedPcr0: string | null
  gitSha: string | null
  attestedAt: string | null
  matched?: boolean | null
  buildId?: string | null
}

export type ValidatorDeploymentEvidence = {
  sourceAvailable: boolean
  currentRuntimeVerified: boolean
  verificationReason: string | null
  commitSha: string | null
  buildId: string | null
  reportedAt: string | null
}

const COMMIT_SHA_RE = /^[0-9a-f]{40}$/i
const MAX_FUTURE_SKEW_MS = 60_000

export function isValidCommitSha(value: string | null): boolean {
  return typeof value === 'string' && COMMIT_SHA_RE.test(value)
}

export function isValidatorHealthNode(node: ValidatorHealthNode): boolean {
  const component = node.component.trim().toLowerCase()
  return component.includes('validator') && !component.includes('gateway')
}

export function isFreshTimestamp(
  value: string | null,
  nowMs: number,
  freshnessMs: number,
): boolean {
  if (!value) return false
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return false
  if (timestamp - nowMs > MAX_FUTURE_SKEW_MS) return false
  return nowMs - timestamp <= freshnessMs
}

function nodeIdentity(node: ValidatorHealthNode): string {
  return node.hotkey ?? node.nodeId ?? node.id
}

export function dedupeLatestValidatorNodes<T extends ValidatorHealthNode>(
  nodes: readonly T[],
): T[] {
  const latest = new Map<string, T>()
  for (const node of nodes) {
    if (!isValidatorHealthNode(node)) continue
    const key = nodeIdentity(node)
    const current = latest.get(key)
    if (!current || Date.parse(node.attestedAt ?? '') > Date.parse(current.attestedAt ?? '')) {
      latest.set(key, node)
    }
  }
  return [...latest.values()].sort((left, right) =>
    Date.parse(right.attestedAt ?? '') - Date.parse(left.attestedAt ?? ''),
  )
}

export function selectCurrentValidatorNode<T extends ValidatorHealthNode>(
  nodes: readonly T[],
): T | null {
  return dedupeLatestValidatorNodes(nodes)[0] ?? null
}

export function selectValidatorPcrNode<T extends ValidatorHealthNode>(
  nodes: readonly T[],
): T | null {
  return dedupeLatestValidatorNodes(nodes).find((node) => Boolean(node.observedPcr0)) ?? null
}

export function evaluateValidatorDeploymentEvidence(
  receipt: {
    commitSha: string | null
    buildId: string | null
    reportedAt: string | null
  } | null,
  nodes: readonly ValidatorHealthNode[],
  nowMs: number,
): ValidatorDeploymentEvidence {
  const node = selectCurrentValidatorNode(nodes)
  const receiptFresh = Boolean(
    receipt &&
    isValidCommitSha(receipt.commitSha) &&
    isFreshTimestamp(receipt.reportedAt, nowMs, 3 * 60 * 60_000),
  )
  const runtimeFresh = Boolean(
    node &&
    isValidCommitSha(node.gitSha) &&
    isFreshTimestamp(node.attestedAt, nowMs, 5 * 60_000),
  )
  const verified = receiptFresh || (runtimeFresh && node?.matched === true)
  const sourceAvailable = receiptFresh || runtimeFresh
  return {
    sourceAvailable,
    currentRuntimeVerified: verified,
    verificationReason: verified
      ? null
      : sourceAvailable
        ? 'Latest validator runtime evidence is stale, future-dated, or rejected.'
        : 'No current validator runtime receipt or validator attestation is available.',
    commitSha: receiptFresh ? receipt?.commitSha ?? null : node?.gitSha ?? null,
    buildId: receiptFresh ? receipt?.buildId ?? null : node?.buildId ?? null,
    reportedAt: receiptFresh ? receipt?.reportedAt ?? null : node?.attestedAt ?? null,
  }
}
