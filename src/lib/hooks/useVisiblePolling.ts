'use client'

import { useEffect, useRef } from 'react'

/** Poll a visible panel without overlapping requests or discarding its state. */
export function useVisiblePolling(
  poll: () => Promise<void>,
  intervalMs: number,
  { enabled = true, immediate = true }: { enabled?: boolean; immediate?: boolean } = {},
) {
  // Survives effect cleanup when a kept-mounted panel is briefly deactivated.
  const inFlight = useRef<Promise<void> | null>(null)

  useEffect(() => {
    if (!enabled) return

    let disposed = false
    let timer: number | undefined
    let waitingForFlight = false
    const visible = () => document.visibilityState === 'visible'
    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = undefined
    }

    const refresh = async () => {
      clearTimer()
      if (disposed || !visible()) return

      if (inFlight.current) {
        // A request started before hiding can finish normally. Coalesce rapid
        // visibility changes into one fresh read after that request completes.
        if (waitingForFlight) return
        waitingForFlight = true
        await inFlight.current
        waitingForFlight = false
        if (!disposed && visible()) void refresh()
        return
      }

      const current = Promise.resolve()
        .then(() => {
          if (!disposed && visible()) return poll()
        })
        // Callers own their error UI. A rejected refresh must remain retryable.
        .catch(() => {})
      inFlight.current = current
      await current
      if (inFlight.current === current) inFlight.current = null

      if (!disposed && visible()) {
        timer = window.setTimeout(() => void refresh(), intervalMs)
      }
    }

    const onVisibilityChange = () => {
      clearTimer()
      if (visible()) void refresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    if (immediate) void refresh()
    else if (visible()) timer = window.setTimeout(() => void refresh(), intervalMs)

    return () => {
      disposed = true
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, immediate, intervalMs, poll])
}
