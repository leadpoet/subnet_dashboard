'use client'

import { useState } from 'react'
import { formatShare, type LatestPayout } from '@/lib/collection'

const visibleMiners = 8
const chartRow = 'grid grid-cols-[6.5rem_minmax(0,1fr)_5.25rem] items-center gap-x-2 sm:grid-cols-[10rem_minmax(0,1fr)_6rem] sm:gap-x-4'

export function MinerShareChart({ payout }: { payout: Extract<LatestPayout, { status: 'confirmed' }> }) {
  const [expanded, setExpanded] = useState(false)
  const ranked = Object.entries(payout.shares).filter(([, value]) => value > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
  const top = ranked[0]?.[1] ?? 0
  const unit = top > 0 ? 10 ** Math.floor(Math.log10(top)) : 1
  const ceiling = top > 0 ? Math.min(100, Math.ceil(top / unit) * unit) : 1
  const rows = expanded ? ranked : ranked.slice(0, visibleMiners)
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(Date.parse(payout.closed_at))

  return <figure className="mt-6 rounded-xl border border-[var(--line-2)] bg-[var(--surface)] p-4 sm:p-6">
    <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h3 className="font-display text-lg font-medium text-[var(--platinum)]">On-chain alpha share</h3>
      <span className="text-xs text-[var(--muted)]">Payout epoch {payout.epoch.toLocaleString('en-US')} · <time dateTime={payout.closed_at}>{date} UTC</time></span>
    </figcaption>
    <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">Each bar shows a miner’s share of all SN71 miner emissions in this payout epoch. The total includes emissions sent to burn.</p>
    {rows.length > 0 ? <div className="mt-5">
      <ul aria-label="Miner shares, largest first" className="space-y-1">
        {rows.map(([hotkey, share]) => <li key={hotkey} className={chartRow + ' min-h-7 text-xs sm:text-sm'}>
          <span className="truncate font-mono text-[var(--muted)]" title={hotkey}>
            <span aria-hidden="true">{hotkey.slice(0, 6)}…{hotkey.slice(-4)}</span><span className="sr-only">{hotkey}</span>
          </span>
          <span className="h-2 overflow-hidden rounded-sm bg-[var(--line)]" aria-hidden="true">
            <span className="block h-full rounded-sm bg-[var(--platinum)]" style={{ width: `${share / ceiling * 100}%` }} />
          </span>
          <span className="text-right font-mono tabular-nums text-[var(--white)]">{formatShare(share)}</span>
        </li>)}
      </ul>
      <div className={chartRow + ' mt-2'} aria-hidden="true">
        <div className="col-start-2 flex justify-between border-t border-[var(--line-2)] pt-1 font-mono text-[10px] text-[var(--muted)]"><span>0%</span><span>{formatShare(ceiling)}</span></div>
      </div>
      {ranked.length > visibleMiners && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="mt-2 min-h-11 text-sm text-[var(--platinum)] hover:underline">{expanded ? 'Show fewer miners' : `Show all ${ranked.length} miners`}</button>}
    </div> : <p className="mt-4 text-sm text-[var(--muted)]">No miner received a share in this payout epoch.</p>}
  </figure>
}
