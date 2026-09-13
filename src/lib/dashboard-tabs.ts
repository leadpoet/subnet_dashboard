export type DashboardTabKey = 'research-lab' | 'faq'

const DASHBOARD_TABS: readonly DashboardTabKey[] = ['research-lab', 'faq'] as const

export function getDashboardTabs(): readonly DashboardTabKey[] {
  return DASHBOARD_TABS
}

export function isDashboardTab(
  value: string | null,
  visibleTabs: readonly DashboardTabKey[] = DASHBOARD_TABS,
): value is DashboardTabKey {
  return Boolean(value && visibleTabs.includes(value as DashboardTabKey))
}

export function normalizeDashboardTab(
  value: string | null,
  visibleTabs: readonly DashboardTabKey[] = DASHBOARD_TABS,
): DashboardTabKey {
  return isDashboardTab(value, visibleTabs) ? value : 'research-lab'
}
