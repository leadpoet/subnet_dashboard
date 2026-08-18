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
 * Match only the public subnet71 domains. The first forwarded host is the
 * browser-facing value when a proxy sends a comma-separated host list.
 */
export function isSubnet71PublicHost(host: string | null | undefined): boolean {
  const firstHost = host?.split(',')[0]?.trim()
  if (!firstHost) return false

  try {
    const hostname = new URL(`http://${firstHost}`).hostname.toLowerCase().replace(/\.$/, '')
    return hostname === 'subnet71.com' || hostname === 'www.subnet71.com'
  } catch {
    return false
  }
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
