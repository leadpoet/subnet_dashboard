/**
 * Research Lab benchmark dates are stored as UTC calendar dates. Keep the
 * date-key calculation in one place so the API query and its cache use the
 * same day boundary.
 */
export function utcCalendarDateKey(now = new Date()): string {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const day = String(now.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
