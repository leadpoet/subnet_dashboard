'use client'

import { useCallback, useState } from 'react'
import { displayUnits, formatShare, isMinerPage, type LatestPayout, type MinerContribution, type MinerPage } from '@/lib/collection'
import { MinerShareChart } from '@/components/dashboard/MinerShareChart'
import { useVisiblePolling } from '@/lib/hooks/useVisiblePolling'

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
})
const columns = ['Miner hotkey', 'Funded runs', 'Last funded run', 'Reward target', 'On-chain share']
const mobileLabel = 'mb-1 block text-xs font-normal text-[var(--muted)] lg:hidden'
const cell = 'align-top lg:py-5 lg:pr-5'

function shareLabel(miner: MinerContribution, payout?: LatestPayout): string {
  if (!payout || payout.status === 'unavailable') return 'Unavailable'
  if (payout.status !== 'confirmed') return 'No payouts yet'
  if (Object.hasOwn(payout.shares, miner.hotkey)) return formatShare(payout.shares[miner.hotkey])
  if (Date.parse(miner.joined_at) > Date.parse(payout.closed_at)) return 'Joined later'
  return '0%'
}

export function MinerContributions({ active }: { active: boolean }) {
  const [pages, setPages] = useState<(string | null)[]>([null])
  const after = pages[pages.length - 1]
  const [result, setResult] = useState<{ after: string | null; page: MinerPage } | null>(null)
  const [error, setError] = useState<{ after: string | null } | null>(null)
  const page = result?.after === after ? result.page : null
  const failed = error?.after === after
  const payout = result?.page.latest_payout
  const refresh = useCallback(async () => {
    try {
      const url = '/api/collection/miners' + (after ? '?after=' + encodeURIComponent(after) : '')
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) throw new Error('Unavailable')
      const data: unknown = await response.json()
      if (!isMinerPage(data)) throw new Error('Invalid contributions')
      setResult({ after, page: data })
      setError(null)
    } catch {
      setError({ after })
    }
  }, [after])
  useVisiblePolling(refresh, 60_000, { enabled: active })

  return <section aria-labelledby="miner-contributions" className="mt-12 border-t border-[var(--line)] pt-8 md:mt-16 md:pt-10">
    <h2 id="miner-contributions" className="font-display text-2xl font-medium tracking-[-0.04em] text-[var(--white)] md:text-3xl">Miner contributions</h2>
    <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">Funded runs and USD reward targets are lifetime totals. On-chain shares refer to the latest finalized collection payout. All times are UTC.</p>
    {payout?.status === 'confirmed' ? <MinerShareChart key={payout.epoch} payout={payout} />
      : result && <p role="status" className="mt-4 text-sm text-[var(--muted)]">{payout?.status === 'none' ? 'No collection payouts have finalized yet.' : 'On-chain payout shares are temporarily unavailable.'}</p>}
    {page?.miners.length ? <table aria-labelledby="miner-contributions" className="mt-6 block w-full text-left text-sm lg:table">
      <thead className="sr-only lg:not-sr-only lg:table-header-group">
        <tr className="border-b border-[var(--line-2)]">{columns.map(label => <th scope="col" key={label} className="pb-3 pr-5 text-xs font-medium text-[var(--muted)]">{label}</th>)}</tr>
      </thead>
      <tbody className="block lg:table-row-group">{page.miners.map(miner => <tr key={miner.hotkey} className="grid grid-cols-2 gap-x-4 gap-y-4 border-b border-[var(--line)] py-5 text-[var(--platinum)] lg:table-row lg:py-0">
        <th scope="row" className={cell + ' col-span-2 font-normal lg:w-[32%]'}>
          <span className={mobileLabel}>Miner hotkey</span>
          <code className="block select-all break-all font-mono text-[13px] leading-relaxed text-[var(--white)]">{miner.hotkey}</code>
          <span className="mt-1 block text-xs text-[var(--muted)]">Joined <time dateTime={miner.joined_at}>{dateFormat.format(Date.parse(miner.joined_at))}</time></span>
        </th>
        <td className={cell}><span className={mobileLabel}>Funded runs</span>{miner.funded_runs.toLocaleString('en-US')}</td>
        <td className={cell}><span className={mobileLabel}>Last funded run</span>{miner.last_funded_at ? <time dateTime={miner.last_funded_at}>{dateFormat.format(Date.parse(miner.last_funded_at))}</time> : 'No funded runs yet'}</td>
        <td className={cell}><span className={mobileLabel}>Reward target</span>${displayUnits(miner.earned_quote_microusd, 6, 2)}</td>
        <td className="align-top lg:py-5"><span className={mobileLabel}>On-chain share</span>
          {shareLabel(miner, payout)}
          {miner.payout_status === 'pending' && <span className="mt-1 block text-xs text-[var(--muted)]">Awaiting settlement</span>}
        </td>
      </tr>)}</tbody>
    </table> : <p role="status" className="mt-5 border-y border-[var(--line)] py-5 text-sm text-[var(--muted)]">
      {page ? 'No miner contributions on this page yet.' : failed ? 'Miner contributions are temporarily unavailable.' : 'Loading miner contributions…'}
    </p>}
    {page && failed && <p role="status" className="mt-3 text-xs text-[var(--muted)]">Refresh unavailable. Showing the last confirmed rows.</p>}
    {(pages.length > 1 || page?.next) && <nav aria-label="Miner pages" className="mt-4 flex items-center justify-end gap-4 text-sm text-[var(--platinum)]">
      <button type="button" disabled={pages.length === 1} onClick={() => setPages(list => list.slice(0, -1))} className="min-h-11 disabled:opacity-40">Previous</button>
      <span className="text-[var(--muted)]">Page {pages.length}</span>
      <button type="button" disabled={!page?.next} onClick={() => { if (page?.next) setPages(list => [...list, page.next]) }} className="min-h-11 disabled:opacity-40">Next</button>
    </nav>}
  </section>
}
