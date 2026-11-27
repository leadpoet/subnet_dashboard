'use client'

import { useCallback, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { SALES_AGENT, isCollectionStatus, type CollectionStatus } from '@/lib/collection'
import { MinerContributions } from '@/components/dashboard/MinerContributions'
import { useVisiblePolling } from '@/lib/hooks/useVisiblePolling'

const steps = [
  ['Choose an offer', 'Review the tasks and fixed quotes in the miner CLI. Choose the offer you want to sign with your registered wallet.'],
  ['Set your spending cap', 'Provide a dedicated OpenRouter key and sign the offer with a rolling 24-hour budget.'],
  ['Fund an agent run', 'We run the public sales agent on a simulated workflow and capture its available reasoning, tool calls, evidence and decisions.'],
  ['Earn emissions', 'When the result and trace pass verification, validators use the fixed quote to allocate subnet emissions.'],
] as const

export function CollectionLab({ active = true }: { active?: boolean }) {
  const [status, setStatus] = useState<CollectionStatus | null>(null)
  const [refreshFailed, setRefreshFailed] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/collection/status', { cache: 'no-store' })
      if (!response.ok) throw new Error('Status unavailable')
      const data: unknown = await response.json()
      if (!isCollectionStatus(data)) throw new Error('Invalid status')
      setStatus(data)
      setRefreshFailed(false)
    } catch {
      setRefreshFailed(true)
    }
  }, [])
  useVisiblePolling(refresh, 60_000, { enabled: active })

  const pending = refreshFailed ? 'Unavailable' : 'Checking…'
  const activity = status ? (status.running_runs === 0 ? 'Idle' : `${status.running_runs.toLocaleString('en-US')} running`) : pending

  return (
    <main className="pb-16 md:pb-24">
      <div className="grid items-center gap-9 border-b border-[var(--line)] py-10 md:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.75fr)] md:gap-14 md:py-16 lg:gap-24">
        <section aria-labelledby="fund-heading">
          <h1 id="fund-heading" className="max-w-[12ch] font-display text-[clamp(3rem,6.4vw,5.25rem)] font-medium leading-[0.98] tracking-[-0.065em] text-[var(--white)]">
            Fund a <span className="whitespace-nowrap">sales agent.</span>
          </h1>
          <p className="mt-5 max-w-[51ch] text-base leading-relaxed text-[var(--muted)] md:text-lg">
            Use your OpenRouter credits to fund sales research. Our agent checks company evidence and records its decisions. Verified work earns subnet emissions.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2">
            <a href={SALES_AGENT} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-[var(--platinum)] hover:underline">View the agent <ArrowUpRight aria-hidden="true" size={14} /></a>
          </div>
        </section>

        <section aria-labelledby="collection-status" className="rounded-xl border border-[var(--line-2)] bg-[var(--surface)] px-5 py-5 md:px-7 md:py-6">
          <h2 id="collection-status" className="text-sm font-medium text-[var(--platinum)]">Collection status</h2>
          <dl className="mt-5">
            <div className="mb-5 flex items-baseline gap-3">
              <dt className="order-2 text-sm text-[var(--muted)]">Verified runs across paid offers</dt>
              <dd className="font-display text-[3.25rem] font-medium leading-none tracking-[-0.065em] text-[var(--white)]">{status ? status.verified_runs.toLocaleString('en-US') : '—'}</dd>
            </div>
            <StatusRow label="Paid enrollment" value={status ? (status.paid_enrollment_open ? 'Open' : 'Closed') : pending} />
            <StatusRow label="Funded run activity" value={activity} />
            <StatusRow label="Champion rewards" value={status ? (status.champion_rewards_off ? 'Off' : 'On') : pending} />
          </dl>
          <p role="status" className="mt-4 text-xs leading-relaxed text-[var(--muted-2)]">
            {status ? <>{refreshFailed ? 'Refresh unavailable. Last confirmed ' : 'Updated '}<time dateTime={status.as_of}>{new Date(status.as_of).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' })} UTC</time></> : refreshFailed ? 'Live status is temporarily unavailable.' : 'Checking live status…'}
          </p>
        </section>
      </div>

      <section aria-labelledby="how-it-works" className="pt-9 md:pt-12">
        <h2 id="how-it-works" className="font-display text-2xl font-medium tracking-[-0.04em] text-[var(--white)] md:text-3xl">How it works</h2>
        <ol className="mt-6 grid gap-y-6 sm:grid-cols-2 sm:gap-x-8 lg:grid-cols-4">
          {steps.map(([title, detail], i) => (
            <li key={title} className="border-t border-[var(--line-2)] pt-4">
              <span aria-hidden="true" className="font-mono text-xs text-[var(--muted-2)]">0{i + 1}</span>
              <h3 className="mt-2 font-display text-lg font-medium tracking-[-0.025em] text-[var(--platinum)]">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{detail}</p>
            </li>
          ))}
        </ol>
      </section>
      <MinerContributions active={active} />
    </main>
  )
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-baseline justify-between gap-3 border-t border-[var(--line)] py-2.5 text-sm">
    <dt className="text-[var(--muted)]">{label}</dt>
    <dd className="text-right font-medium text-[var(--platinum)]">{value}</dd>
  </div>
}
