/**
 * Public dashboard tab policy. Keep this in a shared, pure module so the
 * server can decide the initial tab set without reading window.location on
 * the client (which would make the first render disagree with the server).
 */
export type DashboardTabKey =
  | 'research-lab'
  | 'fulfillment'
  | 'overview'
  | 'miner-tracker'
  | 'epoch-analysis'
  | 'submission-tracker'
  | 'faq'

const ALL_DASHBOARD_TABS: readonly DashboardTabKey[] = [
  'research-lab',
  'fulfillment',
  'faq',
] as const

const SUBNET_71_PUBLIC_TABS: readonly DashboardTabKey[] = [
  'research-lab',
  'faq',
] as const

/** Return the dashboard tabs that should be rendered for the request host. */
export function getDashboardTabs(isSubnet71Public: boolean): readonly DashboardTabKey[] {
  return isSubnet71Public ? SUBNET_71_PUBLIC_TABS : ALL_DASHBOARD_TABS
}

/**
 * Match only the public subnet71 domains. A proxy can append hosts to a
 * comma-separated forwarded-host chain, so accept the public host wherever
 * it appears in that chain.
 */
export function isSubnet71PublicHost(host: string | null | undefined): boolean {
  return (host?.split(',') ?? []).some((candidate) => {
    const value = candidate.trim()
    if (!value) return false

    try {
      const hostname = new URL(`http://${value}`).hostname.toLowerCase().replace(/\.$/, '')
      return hostname === 'subnet71.com' || hostname === 'www.subnet71.com'
    } catch {
      return false
    }
  })
}

/**
 * Resolve the public site from both request host headers. Some deployments
 * preserve the browser-facing host in `host` but put an internal upstream
 * host in `x-forwarded-host`; trusting only the latter exposes hidden tabs.
 */
export function isSubnet71PublicRequest(
  host: string | null | undefined,
  forwardedHost: string | null | undefined,
): boolean {
  return isSubnet71PublicHost(host) || isSubnet71PublicHost(forwardedHost)
}

export function isDashboardTab(
  value: string | null,
  visibleTabs: readonly DashboardTabKey[],
): value is DashboardTabKey {
  return Boolean(value && visibleTabs.includes(value as DashboardTabKey))
}

/** Fall back to Research Lab when a hidden or invalid tab is requested. */
export function normalizeDashboardTab(
  value: string | null,
  visibleTabs: readonly DashboardTabKey[],
): DashboardTabKey {
  return isDashboardTab(value, visibleTabs) ? value : (visibleTabs[0] ?? 'research-lab')
}
