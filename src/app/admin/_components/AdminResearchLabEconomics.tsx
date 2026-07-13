'use client'

import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clipboard,
  Download,
  FlaskConical,
  Gauge,
  Hourglass,
  Loader2,
  Network,
  Search,
  ShieldCheck,
  Trophy,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDateTime, shortHotkey } from '@/lib/admin-format'
import type {
  EconomicsChampion,
  EconomicsMetric,
  EconomicsPagination,
  EconomicsReimbursement,
  ResearchLabEconomicsPayload,
} from '@/lib/research-lab-economics'

export function AdminResearchLabEconomics({
  payload,
  error,
}: {
  payload: ResearchLabEconomicsPayload | null
  error: string | null
}) {
  const [livePayload, setLivePayload] = useState(payload)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [championFilter, setChampionFilter] = useState('all')
  const [championQuery, setChampionQuery] = useState('')
  const [selectedChampionId, setSelectedChampionId] = useState<string | null>(null)
  const [selectedAwardId, setSelectedAwardId] = useState<string | null>(null)
  const [historyFrom, setHistoryFrom] = useState('')
  const [historyTo, setHistoryTo] = useState('')

  const allocation = livePayload?.allocation
  const visibleChampions = useMemo(() => {
    const query = championQuery.trim().toLowerCase()
    return (livePayload?.champions ?? []).filter((champion) => {
      const matchesState = championFilter === 'all'
        || champion.epochState === championFilter
        || (championFilter === 'active' && champion.rewardStatus === 'active')
        || (championFilter === 'paid' && champion.rewardStatus === 'paid')
        || (championFilter === 'voided' && /void|tombstone/i.test(champion.rewardStatus))
        || (championFilter === 'replay' && champion.replayState?.toLowerCase().includes('extend'))
      const matchesQuery = !query || [
        champion.minerHotkey,
        String(champion.minerUid ?? ''),
        champion.candidateId,
        String(champion.evaluationEpoch ?? ''),
      ].some((value) => value.toLowerCase().includes(query))
      return matchesState && matchesQuery
    })
  }, [championFilter, championQuery, livePayload?.champions])

  const selectedChampion = livePayload?.champions.find((champion) => champion.rewardId === selectedChampionId) ?? null
  const selectedAward = livePayload?.reimbursements.find((award) => award.awardId === selectedAwardId) ?? null
  const visibleHistory = useMemo(() => (livePayload?.history ?? []).filter((epoch) => {
    const day = epoch.createdAt.slice(0, 10)
    return (!historyFrom || day >= historyFrom) && (!historyTo || day <= historyTo)
  }), [historyFrom, historyTo, livePayload?.history])

  const load = async (params: Record<string, number>) => {
    if (!livePayload) return
    setLoading(true)
    setLoadError(null)
    try {
      const query = new URLSearchParams({
        epoch: String(params.epoch ?? livePayload.allocation.epoch),
        championPage: String(params.championPage ?? livePayload.pagination.champions.page),
        reimbursementPage: String(params.reimbursementPage ?? livePayload.pagination.reimbursements.page),
        candidatePage: String(params.candidatePage ?? livePayload.pagination.candidates.page),
        pageSize: String(livePayload.pagination.champions.pageSize),
      })
      const response = await fetch(`/api/admin/research-lab/economics?${query}`, { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || `Economics request failed with ${response.status}`)
      setLivePayload(body as ResearchLabEconomicsPayload)
      setSelectedChampionId(null)
      setSelectedAwardId(null)
    } catch (loadFailure) {
      setLoadError(loadFailure instanceof Error ? loadFailure.message : 'Could not load economics data')
    } finally {
      setLoading(false)
    }
  }

  if (!livePayload || !allocation) {
    return (
      <div className="rounded-xl border border-burgundy-soft bg-burgundy-soft p-5 text-sm text-burgundy">
        {error ?? 'Research Lab economics data is unavailable.'}
      </div>
    )
  }

  const allocationSegments = [
    { label: 'Compute reimbursement', metric: allocation.reimbursements, color: '#c9a96e' },
    { label: 'Champions', metric: allocation.champions, color: '#e8e1d4' },
    { label: 'Queued champions', metric: allocation.queuedChampions, color: '#cf9d61' },
    { label: 'SOURCE_ADD', metric: allocation.sourceAdd, color: '#8a8a86' },
    { label: 'Unallocated', metric: allocation.unallocated, color: '#a8746f' },
  ]

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-tertiary)' }}>
            <FlaskConical className="h-3.5 w-3.5" /> Research Lab <span>/</span> Economics &amp; Rewards
          </div>
          <h1 className="text-2xl font-medium tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Research Lab Economics
          </h1>
          <p className="mt-1 max-w-2xl text-sm" style={{ color: 'var(--text-tertiary)' }}>
            Auditable emissions, champion obligations, compute reimbursements, candidate progress, and weight-submission evidence.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            Completed allocation epoch
            <select
              value={allocation.epoch}
              disabled={loading}
              onChange={(event) => void load({
                epoch: Number(event.target.value),
                championPage: 1,
                reimbursementPage: 1,
                candidatePage: 1,
              })}
              className="premium-focus mt-1 block rounded-lg border bg-transparent px-3 py-2 text-sm"
              style={{ borderColor: 'var(--surface-border-strong)', color: 'var(--text-primary)', background: 'var(--surface)' }}
            >
              {livePayload.epochs.map((epoch) => <option key={epoch} value={epoch}>Epoch {epoch}</option>)}
            </select>
          </label>
          <div className="rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)', color: 'var(--text-tertiary)' }}>
            {loading ? <span className="inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading epoch</span> : <>Created {formatDateTime(allocation.createdAt)}</>}
          </div>
        </div>
      </section>

      {(error || loadError) && (
        <div className="rounded-xl border border-burgundy-soft bg-burgundy-soft px-4 py-3 text-xs text-burgundy">
          {loadError ?? error}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <SplitCard label="Research Lab" value={livePayload.configuredSplit.researchLab} accent />
        <SplitCard label="Fulfillment pool" value={livePayload.configuredSplit.fulfillmentPool} />
        <SplitCard label="Fulfillment leaderboard" value={livePayload.configuredSplit.fulfillmentLeaderboard} />
        <SplitCard label="Legacy qualification" value={livePayload.configuredSplit.legacyQualificationChampion} />
        <SplitCard label="Legacy sourcing" value={livePayload.configuredSplit.legacySourcing} />
        <SplitCard label="Burn / fallback" value={allocation.unallocated.value ?? 0} />
      </section>

      <section className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}>
        <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: 'var(--surface-border)' }}>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Current emission allocation</h2>
              <StatusPill label={allocation.snapshotStatus} tone="neutral" />
              {allocation.reconciled ? <StatusPill label="Reconciled" tone="good" /> : <StatusPill label="Allocation mismatch" tone="bad" />}
            </div>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Epoch {allocation.epoch} · Netuid {allocation.netuid ?? '—'} · {allocation.allocationHash ? shortHash(allocation.allocationHash) : 'No allocation hash'}
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-medium text-gold">{formatPercent(allocation.labCap)}</div>
            <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>Research Lab cap</div>
          </div>
        </div>
        <div className="grid gap-px border-b sm:grid-cols-5" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-border)' }}>
          {allocationSegments.map((segment) => (
            <div key={segment.label} className="px-4 py-4" style={{ background: 'var(--surface)' }} title={`${segment.metric.source} · ${segment.metric.authoritative ? 'Authoritative' : 'Derived'}`}>
              <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>{segment.label}</div>
              <div className="mt-1 text-lg font-medium" style={{ color: 'var(--text-primary)' }}>{formatPercent(segment.metric)}</div>
            </div>
          ))}
        </div>
        <div className="space-y-4 px-5 py-5">
          <div className="flex h-3 overflow-hidden rounded-full" style={{ background: 'var(--surface-base)' }} aria-label="Research Lab allocation split">
            {allocationSegments.map((segment) => {
              const width = Math.max(0, ((segment.metric.value ?? 0) / Math.max(1, allocation.labCap.value ?? 30)) * 100)
              return <div key={segment.label} title={`${segment.label}: ${formatPercent(segment.metric)}`} style={{ width: `${width}%`, background: segment.color }} />
            })}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {allocationSegments.map((segment) => (
              <span key={segment.label} className="inline-flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                <span className="h-2 w-2 rounded-full" style={{ background: segment.color }} /> {segment.label}
              </span>
            ))}
          </div>
          <div className={cn('rounded-lg border px-4 py-3 text-xs', allocation.reconciled ? 'border-gold-soft bg-gold-soft text-gold' : 'border-burgundy-soft bg-burgundy-soft text-burgundy')}>
            {allocation.reconciled ? (
              <span className="inline-flex items-center gap-2"><Check className="h-3.5 w-3.5" /> SOURCE_ADD + reimbursements + champions + queued champions + unallocated = {formatPercent(allocation.reconciliationTotal)}</span>
            ) : (
              <span className="inline-flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5" /> Allocation mismatch: {allocation.reconciliationDifference.toFixed(6)} percentage points</span>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <OverviewCard icon={<Trophy className="h-4 w-4" />} label="Champion miners" value={allocation.minerCounts.champions} detail={`${formatPercent(allocation.champions)} fully funded`} />
        <OverviewCard icon={<Hourglass className="h-4 w-4" />} label="Capacity queue" value={livePayload.championQueue.length} detail={`${formatPercent(allocation.queuedChampions)} paid or deferred`} tone={livePayload.championQueue.length ? 'warning' : 'normal'} />
        <OverviewCard icon={<CircleDollarSign className="h-4 w-4" />} label="Reimbursed miners" value={allocation.minerCounts.reimbursements} detail={formatPercent(allocation.reimbursements)} />
        <OverviewCard icon={<Network className="h-4 w-4" />} label="Weight submission" value={weightStateLabel(livePayload.weightHealth.state)} detail={livePayload.weightHealth.finalizationStatus} tone={livePayload.weightHealth.state === 'healthy' ? 'good' : 'warning'} />
      </section>

      <Accordion title="Champion earnings" subtitle={`${livePayload.pagination.champions.total} reward obligations · actual payment proven from epoch ${allocation.epoch}`} icon={<Trophy className="h-4 w-4" />} defaultOpen>
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row" style={{ borderColor: 'var(--surface-border)' }}>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
            <input value={championQuery} onChange={(event) => setChampionQuery(event.target.value)} placeholder="UID, hotkey, candidate, evaluation epoch" className="premium-focus w-full rounded-lg border bg-transparent py-2 pl-9 pr-3 text-xs" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-primary)' }} />
          </div>
          <select value={championFilter} onChange={(event) => setChampionFilter(event.target.value)} className="premium-focus rounded-lg border bg-transparent px-3 py-2 text-xs" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-primary)', background: 'var(--surface)' }}>
            <option value="all">All obligations</option>
            <option value="earning">Earning this epoch</option>
            <option value="partial">Partially funded</option>
            <option value="waiting">Waiting for capacity</option>
            <option value="replay">Extended replay</option>
            <option value="active">Active obligation</option>
            <option value="paid">Paid</option>
            <option value="voided">Voided</option>
          </select>
          <ExportButton onClick={() => exportChampions(visibleChampions, allocation.epoch)} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-xs">
            <thead><tr className="border-b" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-tertiary)' }}>
              {['Miner', 'Candidate', 'Evaluation', 'Status', 'Improvement', 'Desired / epoch', 'Paid this epoch', 'Paid to date', 'Remaining', 'Deferred', ''].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}
            </tr></thead>
            <tbody>
              {visibleChampions.map((champion) => (
                <ChampionRow key={champion.rewardId} champion={champion} selected={selectedChampionId === champion.rewardId} onSelect={() => setSelectedChampionId(selectedChampionId === champion.rewardId ? null : champion.rewardId)} />
              ))}
            </tbody>
          </table>
        </div>
        {selectedChampion && <ChampionDetail champion={selectedChampion} />}
        <PaginationControls pagination={livePayload.pagination.champions} loading={loading} onPage={(page) => void load({ championPage: page })} />
      </Accordion>

      <Accordion title="Improvement reward queue" subtitle={`${livePayload.championQueue.length} selected-epoch capacity obligations`} icon={<Hourglass className="h-4 w-4" />} defaultOpen={livePayload.championQueue.length > 0}>
        <details className="border-b px-5 py-3 text-xs" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-secondary)' }}>
          <summary className="cursor-pointer font-medium text-amber-warm">Why is this queued?</summary>
          <p className="mt-2 max-w-3xl leading-5">Champion obligations are handled in chronological order. Compute reimbursements and earlier champion obligations can consume the available 30% Research Lab cap. An active historical obligation appears here only when this allocation snapshot persisted it as queued or deferred.</p>
        </details>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left text-xs">
            <thead><tr className="border-b" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-tertiary)' }}>
              {['#', 'Miner', 'Candidate', 'Improvement', 'Intended', 'Paid', 'Deferred', 'Paid to date', 'Remaining', 'Reason', 'Replay'].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}
            </tr></thead>
            <tbody>{livePayload.championQueue.map((item) => (
              <tr key={`${item.rewardId}:${item.position}`} className="border-b last:border-0" style={{ borderColor: 'var(--surface-border)' }}>
                <td className="px-4 py-3" style={{ color: 'var(--text-tertiary)' }}>{item.position}</td>
                <td className="px-4 py-3"><Hotkey hotkey={item.minerHotkey} uid={item.minerUid} /></td>
                <td className="px-4 py-3 font-mono" style={{ color: 'var(--text-secondary)' }}>{shortId(item.candidateId)}</td>
                <MetricCell metric={item.improvementPoints} />
                <MetricCell metric={item.intendedThisEpoch} />
                <MetricCell metric={item.paidThisEpoch} />
                <MetricCell metric={item.deferredThisEpoch} tone={item.state === 'waiting' ? 'bad' : 'warning'} />
                <MetricCell metric={item.paidToDate} />
                <MetricCell metric={item.remainingLifetimeReward} />
                <td className="px-4 py-3"><StatusPill label={item.queueReason} tone={item.state === 'waiting' ? 'bad' : item.state === 'partial' ? 'warning' : 'neutral'} /></td>
                <td className="px-4 py-3" style={{ color: item.replayState?.includes('extended') ? '#b59ad9' : 'var(--text-secondary)' }}>{item.replayState ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {livePayload.championQueue.length === 0 && <EmptyState message="No champion rewards are queued in this allocation snapshot." />}
        <div className="flex justify-end border-t p-4" style={{ borderColor: 'var(--surface-border)' }}><ExportButton onClick={() => exportQueue(livePayload, allocation.epoch)} /></div>
      </Accordion>

      <Accordion title="Compute reimbursements" subtitle={`${livePayload.pagination.reimbursements.total} awards · awarded amounts kept separate from actual payments`} icon={<CircleDollarSign className="h-4 w-4" />}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-xs">
            <thead><tr className="border-b" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-tertiary)' }}>
              {['Miner', 'Run', 'Status', 'Eligible cost', 'Target', 'Schedule', 'Intended', 'Paid this epoch', 'Paid to date', 'Deferred', ''].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}
            </tr></thead>
            <tbody>{livePayload.reimbursements.map((award) => (
              <ReimbursementRow key={award.awardId} award={award} selected={selectedAwardId === award.awardId} onSelect={() => setSelectedAwardId(selectedAwardId === award.awardId ? null : award.awardId)} />
            ))}</tbody>
          </table>
        </div>
        {selectedAward && <ReimbursementDetail award={selectedAward} />}
        <div className="flex justify-end border-t px-4 pt-4" style={{ borderColor: 'var(--surface-border)' }}><ExportButton onClick={() => exportReimbursements(livePayload, allocation.epoch)} /></div>
        <PaginationControls pagination={livePayload.pagination.reimbursements} loading={loading} onPage={(page) => void load({ reimbursementPage: page })} />
      </Accordion>

      <Accordion title="Candidate improvement pipeline" subtitle="Scoring and promotion work — separate from the emission-capacity queue" icon={<Gauge className="h-4 w-4" />}>
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {livePayload.candidates.map((candidate) => (
            <article key={candidate.candidateId} className="rounded-lg border p-4" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-base)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="truncate font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{shortId(candidate.candidateId)}</div><div className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{shortHotkey(candidate.minerHotkey)}</div></div>
                <StatusPill label={candidate.group} tone={candidate.group.includes('rejected') || candidate.group === 'Failed' ? 'bad' : candidate.group.includes('passed') || candidate.group === 'Reward created' ? 'good' : 'warning'} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-[11px]">
                <MiniFact label="Score bundle" value={candidate.scoreBundleAvailable ? 'Available' : 'Pending'} />
                <MiniFact label="Improvement" value={candidate.improvementPoints === null ? '—' : candidate.improvementPoints.toFixed(3)} />
                <MiniFact label="Public holdout" value={candidate.publicHoldoutStatus ?? '—'} />
                <MiniFact label="Private holdout" value={candidate.privateHoldoutStatus ?? '—'} />
              </div>
              {candidate.reason && <p className="mt-3 line-clamp-2 text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>{humanize(candidate.reason)}</p>}
            </article>
          ))}
        </div>
        <PaginationControls pagination={livePayload.pagination.candidates} loading={loading} onPage={(page) => void load({ candidatePage: page })} />
      </Accordion>

      <Accordion title="Weight-submission health" subtitle="Gateway publication and finalized-chain evidence are shown separately" icon={<ShieldCheck className="h-4 w-4" />} defaultOpen>
        <div className="grid gap-px sm:grid-cols-2 xl:grid-cols-4" style={{ background: 'var(--surface-border)' }}>
          <HealthFact label="Protocol" value={livePayload.weightHealth.protocol} />
          <HealthFact label="Gateway" value={livePayload.weightHealth.gatewayStatus} />
          <HealthFact label="Chain" value={livePayload.weightHealth.finalizationStatus} />
          <HealthFact label="Published epoch" value={String(livePayload.weightHealth.latestPublishedWeightEpoch ?? '—')} />
          <HealthFact label="Published block" value={String(livePayload.weightHealth.publishedBlock ?? '—')} />
          <HealthFact label="Validator" value={livePayload.weightHealth.validatorHotkey ? shortHotkey(livePayload.weightHealth.validatorHotkey) : '—'} />
          <HealthFact label="Weight hash" value={livePayload.weightHealth.weightHash ? shortHash(livePayload.weightHealth.weightHash) : '—'} mono />
          <HealthFact label="Publication delay" value={formatDuration(livePayload.weightHealth.publicationDelayMs)} />
        </div>
        {livePayload.weightHealth.missingEpoch && <div className="m-4 rounded-lg border border-burgundy-soft bg-burgundy-soft px-4 py-3 text-xs text-burgundy"><AlertTriangle className="mr-2 inline h-3.5 w-3.5" />Allocation epoch {allocation.epoch} has no matching published weight record.</div>}
      </Accordion>

      <Accordion title="Historical epoch explorer" subtitle={`${livePayload.history.length} recent allocation snapshots`} icon={<Network className="h-4 w-4" />}>
        <div className="flex flex-wrap items-end gap-3 border-b p-4" style={{ borderColor: 'var(--surface-border)' }}>
          <label className="text-[10px] uppercase tracking-[0.1em]" style={{ color: 'var(--text-tertiary)' }}>From date<input type="date" value={historyFrom} onChange={(event) => setHistoryFrom(event.target.value)} className="premium-focus mt-1 block rounded-lg border bg-transparent px-3 py-2 text-xs normal-case" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-primary)', colorScheme: 'dark' }} /></label>
          <label className="text-[10px] uppercase tracking-[0.1em]" style={{ color: 'var(--text-tertiary)' }}>To date<input type="date" value={historyTo} onChange={(event) => setHistoryTo(event.target.value)} className="premium-focus mt-1 block rounded-lg border bg-transparent px-3 py-2 text-xs normal-case" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-primary)', colorScheme: 'dark' }} /></label>
          {(historyFrom || historyTo) && <button onClick={() => { setHistoryFrom(''); setHistoryTo('') }} className="rounded-lg border px-3 py-2 text-xs hover-bg-warm" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-secondary)' }}>Clear dates</button>}
          <span className="ml-auto text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{visibleHistory.length} epochs</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-xs">
            <thead><tr className="border-b" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-tertiary)' }}>
              {['Epoch', 'Lab cap', 'Reimbursements', 'Champions', 'Queued', 'SOURCE_ADD', 'Unallocated', 'Paid miners', 'Gateway', 'Chain'].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}
            </tr></thead>
            <tbody>{visibleHistory.map((epoch) => (
              <tr key={epoch.epoch} className={cn('border-b last:border-0', epoch.epoch === allocation.epoch && 'bg-gold-soft')} style={{ borderColor: 'var(--surface-border)' }}>
                <td className="px-4 py-3"><button className="text-gold hover:underline" onClick={() => void load({ epoch: epoch.epoch, championPage: 1, reimbursementPage: 1, candidatePage: 1 })}>{epoch.epoch}</button></td>
                <td className="px-4 py-3">{epoch.labCap.toFixed(6)}%</td>
                <td className="px-4 py-3">{epoch.reimbursements.toFixed(6)}%</td>
                <td className="px-4 py-3">{epoch.champions.toFixed(6)}%</td>
                <td className="px-4 py-3">{epoch.queuedChampions.toFixed(6)}%</td>
                <td className="px-4 py-3">{epoch.sourceAdd.toFixed(6)}%</td>
                <td className="px-4 py-3">{epoch.unallocated.toFixed(6)}%</td>
                <td className="px-4 py-3">{epoch.paidMinerCount}</td>
                <td className="px-4 py-3"><StatusPill label={epoch.gatewayPublished ? 'Published' : 'Missing'} tone={epoch.gatewayPublished ? 'good' : 'bad'} /></td>
                <td className="px-4 py-3"><StatusPill label={epoch.chainFinalized ? 'Finalized' : 'No V2 evidence'} tone={epoch.chainFinalized ? 'good' : 'neutral'} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="flex justify-end border-t p-4" style={{ borderColor: 'var(--surface-border)' }}><ExportButton onClick={() => exportHistory(visibleHistory)} /></div>
      </Accordion>
    </div>
  )
}

function SplitCard({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return <div className={cn('rounded-xl border px-4 py-3', accent ? 'border-gold-soft bg-gold-soft' : '')} style={accent ? undefined : { borderColor: 'var(--surface-border)', background: 'var(--surface)' }}><div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>{label}</div><div className={cn('mt-1 text-xl font-medium', accent && 'text-gold')} style={accent ? undefined : { color: 'var(--text-primary)' }}>{value.toFixed(value % 1 ? 1 : 0)}%</div></div>
}

function OverviewCard({ icon, label, value, detail, tone = 'normal' }: { icon: React.ReactNode; label: string; value: React.ReactNode; detail: string; tone?: 'normal' | 'warning' | 'good' }) {
  return <div className="rounded-xl border p-4" style={{ borderColor: tone === 'warning' ? 'rgba(207,157,97,.32)' : tone === 'good' ? 'rgba(201,169,110,.3)' : 'var(--surface-border)', background: tone === 'warning' ? 'rgba(207,157,97,.07)' : 'var(--surface)' }}><div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-tertiary)' }}>{icon}{label}</div><div className="mt-3 text-2xl font-medium" style={{ color: 'var(--text-primary)' }}>{value}</div><div className="mt-1 truncate text-[11px]" style={{ color: 'var(--text-secondary)' }}>{detail}</div></div>
}

function Accordion({ title, subtitle, icon, defaultOpen = false, children }: { title: string; subtitle: string; icon: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  return <details open={defaultOpen || undefined} className="group overflow-hidden rounded-xl border" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface)' }}><summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4"><div className="flex min-w-0 items-center gap-3"><span className="text-gold">{icon}</span><div className="min-w-0"><h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{title}</h2><p className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{subtitle}</p></div></div><ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" style={{ color: 'var(--text-tertiary)' }} /></summary><div className="border-t" style={{ borderColor: 'var(--surface-border)' }}>{children}</div></details>
}

function ChampionRow({ champion, selected, onSelect }: { champion: EconomicsChampion; selected: boolean; onSelect: () => void }) {
  return <tr className={cn('cursor-pointer border-b last:border-0 hover-bg-warm', selected && 'bg-gold-soft')} style={{ borderColor: 'var(--surface-border)' }} onClick={onSelect}>
    <td className="px-4 py-3"><Hotkey hotkey={champion.minerHotkey} uid={champion.minerUid} /></td>
    <td className="px-4 py-3 font-mono" style={{ color: 'var(--text-secondary)' }}>{shortId(champion.candidateId)}</td>
    <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{champion.evaluationEpoch ?? '—'}</td>
    <td className="px-4 py-3"><StatusPill label={championStateLabel(champion.epochState)} tone={champion.epochState === 'earning' ? 'good' : champion.epochState === 'partial' ? 'warning' : champion.epochState === 'waiting' ? 'bad' : 'neutral'} /></td>
    <MetricCell metric={champion.improvementPoints} />
    <MetricCell metric={champion.desiredPerEpoch} />
    <MetricCell metric={champion.paidThisEpoch} tone={champion.paidThisEpoch.value ? 'good' : 'neutral'} />
    <MetricCell metric={champion.paidToDate} />
    <MetricCell metric={champion.remainingReward} />
    <MetricCell metric={champion.deferredThisEpoch} tone={champion.deferredThisEpoch.value ? 'warning' : 'neutral'} />
    <td className="px-4 py-3"><ChevronDown className={cn('h-3.5 w-3.5 transition-transform', selected && 'rotate-180')} style={{ color: 'var(--text-tertiary)' }} /></td>
  </tr>
}

function ChampionDetail({ champion }: { champion: EconomicsChampion }) {
  const score = champion.scoring
  return <div className="border-y p-5" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-base)' }}>
    <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
      <div className="rounded-lg border p-4" style={{ borderColor: 'var(--surface-border)' }}>
        <h3 className="text-xs font-medium text-gold">Reward obligation</h3>
        <div className="mt-4 grid grid-cols-2 gap-4"><MiniFact label="Reward start" value={String(champion.rewardStartEpoch ?? '—')} /><MiniFact label="Duration" value={champion.rewardDuration === null ? '—' : `${champion.rewardDuration} epochs`} /><MiniFact label="Nominal end" value={String(champion.nominalEndEpoch ?? '—')} /><MiniFact label="Replay" value={champion.replayState ?? 'Standard schedule'} /><MiniFact label="Intended lifetime" value={formatPercent(champion.intendedLifetimeReward)} /><MiniFact label="Status reason" value={champion.latestStatusReason ? humanize(champion.latestStatusReason) : '—'} /></div>
        {!champion.paidToDate.authoritative && <p className="mt-4 rounded-md bg-amber-warm-soft px-3 py-2 text-[11px] text-amber-warm">Calculated from payout history because the selected allocation did not include a persisted paid-to-date value.</p>}
      </div>
      <div className="rounded-lg border p-4" style={{ borderColor: 'var(--surface-border)' }}>
        <h3 className="text-xs font-medium text-gold">Scoring &amp; promotion</h3>
        {score ? <><div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4"><MiniFact label="Promotion" value={score.promotionDecision ?? '—'} /><MiniFact label="Candidate status" value={score.candidateStatus ?? '—'} /><MiniFact label="Public holdout" value={score.publicHoldoutResult ?? '—'} /><MiniFact label="Private holdout" value={score.privateHoldoutResult ?? '—'} /><MiniFact label="Candidate score" value={formatNumber(score.candidateScore)} /><MiniFact label="Baseline score" value={formatNumber(score.baselineScore)} /><MiniFact label="Mean delta" value={formatNumber(score.meanDelta)} /><MiniFact label="Delta LCB" value={formatNumber(score.deltaLcb)} /></div><div className="mt-4 rounded-md border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-secondary)' }}><span className="font-medium" style={{ color: 'var(--text-primary)' }}>Reward metric basis:</span> {score.metricBasis}</div>{score.icps.length > 0 && <IcpScoreChart champion={champion} />}</> : <p className="mt-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>Score bundle evidence is unavailable for this obligation.</p>}
      </div>
    </div>
  </div>
}

function IcpScoreChart({ champion }: { champion: EconomicsChampion }) {
  const score = champion.scoring
  if (!score) return null
  return <details className="mt-4"><summary className="cursor-pointer text-[11px] font-medium text-gold">Per-ICP score breakdown ({score.icps.length})</summary><div className="mt-3 flex justify-end"><ExportButton onClick={() => exportIcpScores(champion)} /></div><div className="mt-3 max-h-80 space-y-2 overflow-auto pr-1">{score.icps.map((icp) => {
    const max = Math.max(1, icp.baselineScore ?? 0, icp.candidateScore ?? 0)
    return <div key={icp.icpRef} className="rounded-md border p-3" style={{ borderColor: 'var(--surface-border)' }}><div className="flex items-center justify-between gap-3"><span className="truncate font-mono text-[10px]" style={{ color: 'var(--text-secondary)' }}>{shortId(icp.icpRef)}</span><StatusPill label={icp.excluded ? 'Excluded' : icp.status} tone={icp.excluded || icp.status === 'failed' ? 'bad' : 'neutral'} /></div><div className="mt-2 space-y-1.5"><ScoreBar label="Candidate" value={icp.candidateScore} max={max} color="#c9a96e" /><ScoreBar label="Baseline" value={icp.baselineScore} max={max} color="#6a655e" /></div>{icp.diagnostics && <p className="mt-2 text-[10px] text-burgundy">{icp.diagnostics}</p>}</div>
  })}</div></details>
}

function ScoreBar({ label, value, max, color }: { label: string; value: number | null; max: number; color: string }) {
  return <div className="grid grid-cols-[60px_1fr_44px] items-center gap-2 text-[10px]"><span style={{ color: 'var(--text-tertiary)' }}>{label}</span><div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-elevated)' }}><div className="h-full rounded-full" style={{ width: `${Math.max(0, ((value ?? 0) / max) * 100)}%`, background: color }} /></div><span className="text-right" style={{ color: 'var(--text-secondary)' }}>{formatNumber(value)}</span></div>
}

function ReimbursementRow({ award, selected, onSelect }: { award: EconomicsReimbursement; selected: boolean; onSelect: () => void }) {
  return <tr onClick={onSelect} className={cn('cursor-pointer border-b last:border-0 hover-bg-warm', selected && 'bg-gold-soft')} style={{ borderColor: 'var(--surface-border)' }}><td className="px-4 py-3"><Hotkey hotkey={award.minerHotkey} uid={award.minerUid} /></td><td className="px-4 py-3 font-mono" style={{ color: 'var(--text-secondary)' }}>{award.runId ? shortId(award.runId) : '—'}</td><td className="px-4 py-3"><StatusPill label={humanize(award.status)} tone={award.status.includes('paid') ? 'good' : award.status.includes('ineligible') || award.status.includes('void') ? 'bad' : 'neutral'} /></td><MetricCell metric={award.eligibleComputeCost} /><MetricCell metric={award.targetReimbursement} /><td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{award.scheduledStartEpoch ?? '—'}–{award.scheduledEndEpoch ?? '—'}</td><MetricCell metric={award.intendedThisEpoch} /><MetricCell metric={award.paidThisEpoch} tone={award.paidThisEpoch.value ? 'good' : 'neutral'} /><MetricCell metric={award.paidToDate} /><MetricCell metric={award.deferred} tone={award.deferred.value ? 'warning' : 'neutral'} /><td className="px-4 py-3"><ChevronDown className={cn('h-3.5 w-3.5 transition-transform', selected && 'rotate-180')} style={{ color: 'var(--text-tertiary)' }} /></td></tr>
}

function ReimbursementDetail({ award }: { award: EconomicsReimbursement }) {
  const eligibleUsd = (award.eligibleComputeCost.value ?? 0) / 1_000_000
  const targetUsd = (award.targetReimbursement.value ?? 0) / 1_000_000
  return <div className="border-y p-5" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-base)' }}><div className="grid gap-4 lg:grid-cols-2"><div className="rounded-lg border p-4" style={{ borderColor: 'var(--surface-border)' }}><h3 className="text-xs font-medium text-gold">Reimbursement calculation</h3><div className="mt-4 rounded-lg bg-gold-soft p-4"><div className="flex items-center justify-between text-xs"><span style={{ color: 'var(--text-secondary)' }}>Eligible compute cost</span><span style={{ color: 'var(--text-primary)' }}>${eligibleUsd.toFixed(6)}</span></div><div className="my-2 text-center text-[10px]" style={{ color: 'var(--text-tertiary)' }}>× rebate rate {award.rebateRate === null ? '—' : award.rebateRate.toFixed(4)}</div><div className="flex items-center justify-between border-t pt-2 text-xs" style={{ borderColor: 'var(--surface-border)' }}><span style={{ color: 'var(--text-secondary)' }}>Final target reimbursement</span><span className="font-medium text-gold">${targetUsd.toFixed(6)}</span></div></div><p className="mt-3 text-[11px] leading-5" style={{ color: 'var(--text-secondary)' }}>Then apply the per-run, per-hotkey daily, per-island daily, and global budget caps. The award is eligibility evidence; actual payment is proven only by epoch payout rows.</p><div className="mt-4 grid grid-cols-2 gap-4"><MiniFact label="Participation" value={formatNumber(award.participationScore)} /><MiniFact label="Fraction" value={formatNumber(award.participationFraction)} /><MiniFact label="Loop-start fee" value={award.loopStartFeeIncluded ? 'Included' : 'Not included'} /><MiniFact label="Failed run" value={award.failedRunReimbursement ? 'Eligible failed run' : 'No'} /></div></div><div className="rounded-lg border p-4" style={{ borderColor: 'var(--surface-border)' }}><h3 className="text-xs font-medium text-gold">Schedule &amp; actual payments</h3><div className="mt-4 grid grid-cols-2 gap-4"><MiniFact label="Duration" value={award.duration === null ? '—' : `${award.duration} epochs`} /><MiniFact label="Paid this epoch" value={formatPercent(award.paidThisEpoch)} /><MiniFact label="Paid to date" value={formatPercent(award.paidToDate)} /><MiniFact label="Remaining" value={formatPercent(award.remaining)} /></div><div className="mt-4 max-h-40 overflow-auto rounded-md border" style={{ borderColor: 'var(--surface-border)' }}>{award.scheduleEntries.length ? award.scheduleEntries.map((entry) => <div key={entry.epoch} className="flex items-center justify-between border-b px-3 py-2 text-[11px] last:border-0" style={{ borderColor: 'var(--surface-border)' }}><span style={{ color: 'var(--text-secondary)' }}>Epoch {entry.epoch}</span><span style={{ color: 'var(--text-primary)' }}>{entry.alphaPercent?.toFixed(6) ?? '—'}% · ${entry.amountUsd?.toFixed(6) ?? '—'}</span></div>) : <div className="p-4 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>No schedule entries persisted.</div>}</div></div></div></div>
}

function Hotkey({ hotkey, uid }: { hotkey: string; uid: number | null }) {
  const [copied, setCopied] = useState(false)
  return <div className="flex items-center gap-2"><div><div className="font-mono" style={{ color: 'var(--text-primary)' }}>{shortHotkey(hotkey)}</div><div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>UID {uid ?? '—'}</div></div><button aria-label="Copy miner hotkey" onClick={(event) => { event.stopPropagation(); void navigator.clipboard.writeText(hotkey); setCopied(true); window.setTimeout(() => setCopied(false), 1200) }} className="rounded p-1 hover-bg-warm" style={{ color: 'var(--text-tertiary)' }}>{copied ? <Check className="h-3 w-3 text-gold" /> : <Clipboard className="h-3 w-3" />}</button></div>
}

function MetricCell({ metric, tone = 'normal' }: { metric: EconomicsMetric; tone?: 'normal' | 'good' | 'warning' | 'bad' | 'neutral' }) {
  return <td className={cn('px-4 py-3', tone === 'good' && 'text-gold', tone === 'warning' && 'text-amber-warm', tone === 'bad' && 'text-burgundy')} style={tone === 'normal' || tone === 'neutral' ? { color: 'var(--text-secondary)' } : undefined} title={`${metric.source}${metric.formula ? ` · ${metric.formula}` : ''}${metric.authoritative ? ' · authoritative' : ' · derived'}`}>{formatMetric(metric)}</td>
}

function StatusPill({ label, tone }: { label: string; tone: 'good' | 'warning' | 'bad' | 'neutral' }) {
  return <span className={cn('inline-flex max-w-[220px] items-center rounded-full border px-2 py-0.5 text-[10px] leading-4', tone === 'good' && 'border-gold-soft bg-gold-soft text-gold', tone === 'warning' && 'border-amber-warm-soft bg-amber-warm-soft text-amber-warm', tone === 'bad' && 'border-burgundy-soft bg-burgundy-soft text-burgundy', tone === 'neutral' && 'border-white/[0.08] bg-white/[0.03]')} style={tone === 'neutral' ? { color: 'var(--text-secondary)' } : undefined}>{label}</span>
}

function MiniFact({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><div className="text-[10px] uppercase tracking-[0.1em]" style={{ color: 'var(--text-tertiary)' }}>{label}</div><div className="mt-1 break-words text-[11px]" style={{ color: 'var(--text-primary)' }}>{value}</div></div> }
function HealthFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div className="p-4" style={{ background: 'var(--surface)' }}><div className="text-[10px] uppercase tracking-[0.1em]" style={{ color: 'var(--text-tertiary)' }}>{label}</div><div className={cn('mt-2 text-xs', mono && 'font-mono')} style={{ color: 'var(--text-primary)' }}>{value}</div></div> }
function EmptyState({ message }: { message: string }) { return <div className="p-8 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>{message}</div> }
function ExportButton({ onClick }: { onClick: () => void }) { return <button onClick={onClick} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs hover-bg-warm" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-secondary)' }}><Download className="h-3.5 w-3.5" /> CSV</button> }

function PaginationControls({ pagination, loading, onPage }: { pagination: EconomicsPagination; loading: boolean; onPage: (page: number) => void }) {
  if (pagination.totalPages <= 1) return null
  return <div className="flex items-center justify-between border-t p-4 text-[11px]" style={{ borderColor: 'var(--surface-border)', color: 'var(--text-tertiary)' }}><span>Page {pagination.page} of {pagination.totalPages} · {pagination.total} rows</span><div className="flex gap-2"><button disabled={loading || pagination.page <= 1} onClick={() => onPage(pagination.page - 1)} className="rounded border px-3 py-1.5 disabled:opacity-30" style={{ borderColor: 'var(--surface-border)' }}>Previous</button><button disabled={loading || pagination.page >= pagination.totalPages} onClick={() => onPage(pagination.page + 1)} className="rounded border px-3 py-1.5 disabled:opacity-30" style={{ borderColor: 'var(--surface-border)' }}>Next</button></div></div>
}

function formatMetric(metric: EconomicsMetric): string {
  if (metric.value === null) return '—'
  if (metric.unit === 'alpha_percent') return `${metric.value.toFixed(6)}%`
  if (metric.unit === 'microusd') return `$${(metric.value / 1_000_000).toFixed(6)}`
  if (metric.unit === 'usd') return `$${metric.value.toFixed(6)}`
  if (metric.unit === 'points') return metric.value.toFixed(3)
  return metric.value.toLocaleString()
}

function formatPercent(metric: EconomicsMetric): string { return metric.value === null ? '—' : `${metric.value.toFixed(6)}%` }
function formatNumber(value: number | null): string { return value === null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 4 }) }
function shortId(value: string): string { return value.length <= 20 ? value : `${value.slice(0, 10)}…${value.slice(-7)}` }
function shortHash(value: string): string { return value.length <= 22 ? value : `${value.slice(0, 14)}…${value.slice(-8)}` }
function humanize(value: string): string { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) }
function championStateLabel(state: EconomicsChampion['epochState']): string { return state === 'earning' ? 'Earning this epoch' : state === 'partial' ? 'Partially funded' : state === 'waiting' ? 'Waiting for emission capacity' : 'Not paid this epoch' }
function weightStateLabel(state: string): string { return state === 'healthy' ? 'Chain finalized' : state === 'warning' ? 'Gateway only' : state === 'critical' ? 'Missing' : 'Unknown' }
function formatDuration(value: number | null): string { if (value === null) return '—'; const minutes = Math.round(value / 60_000); return minutes < 1 ? '<1 min' : `${minutes} min` }

function downloadCsv(filename: string, rows: Array<Record<string, string | number | null>>) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = [headers.map(escape).join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function exportChampions(champions: EconomicsChampion[], epoch: number) { downloadCsv(`research-lab-champions-${epoch}.csv`, champions.map((row) => ({ epoch, miner_hotkey: row.minerHotkey, miner_uid: row.minerUid, candidate_id: row.candidateId, score_bundle_id: row.scoreBundleId, reward_status: row.rewardStatus, improvement_points: row.improvementPoints.value, desired_alpha_percent: row.desiredPerEpoch.value, paid_this_epoch: row.paidThisEpoch.value, paid_to_date: row.paidToDate.value, remaining_reward: row.remainingReward.value, deferred_this_epoch: row.deferredThisEpoch.value }))) }
function exportQueue(payload: ResearchLabEconomicsPayload, epoch: number) { downloadCsv(`research-lab-champion-queue-${epoch}.csv`, payload.championQueue.map((row) => ({ epoch, position: row.position, miner_hotkey: row.minerHotkey, miner_uid: row.minerUid, candidate_id: row.candidateId, intended_alpha_percent: row.intendedThisEpoch.value, paid_alpha_percent: row.paidThisEpoch.value, deferred_alpha_percent: row.deferredThisEpoch.value, remaining_alpha_percent: row.remainingLifetimeReward.value, reason: row.queueReason }))) }
function exportReimbursements(payload: ResearchLabEconomicsPayload, epoch: number) { downloadCsv(`research-lab-reimbursements-${epoch}.csv`, payload.reimbursements.map((row) => ({ epoch, award_id: row.awardId, miner_hotkey: row.minerHotkey, run_id: row.runId, status: row.status, eligible_cost_microusd: row.eligibleComputeCost.value, target_reimbursement_microusd: row.targetReimbursement.value, intended_alpha_percent: row.intendedThisEpoch.value, paid_alpha_percent: row.paidThisEpoch.value, paid_to_date_alpha_percent: row.paidToDate.value, deferred_alpha_percent: row.deferred.value }))) }
function exportIcpScores(champion: EconomicsChampion) { downloadCsv(`research-lab-icp-scores-${shortId(champion.candidateId)}.csv`, (champion.scoring?.icps ?? []).map((row) => ({ candidate_id: champion.candidateId, score_bundle_id: champion.scoreBundleId, icp_ref: row.icpRef, status: row.status, baseline_score: row.baselineScore, candidate_score: row.candidateScore, delta: row.delta, company_count: row.companyCount, excluded: String(row.excluded), diagnostics: row.diagnostics }))) }
function exportHistory(rows: ResearchLabEconomicsPayload['history']) { downloadCsv('research-lab-epoch-history.csv', rows.map((row) => ({ epoch: row.epoch, created_at: row.createdAt, lab_cap_alpha_percent: row.labCap, reimbursement_alpha_percent: row.reimbursements, champion_alpha_percent: row.champions, queued_champion_alpha_percent: row.queuedChampions, source_add_alpha_percent: row.sourceAdd, unallocated_alpha_percent: row.unallocated, paid_miners: row.paidMinerCount, queued_rewards: row.queuedRewardCount, gateway_published: String(row.gatewayPublished), chain_finalized: String(row.chainFinalized) }))) }
