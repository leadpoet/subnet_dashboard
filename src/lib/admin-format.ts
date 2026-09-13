export function shortHotkey(hk: string | null | undefined, head = 6, tail = 4): string {
  if (!hk) return ''
  if (hk.length <= head + tail + 3) return hk
  return `${hk.slice(0, head)}…${hk.slice(-tail)}`
}
