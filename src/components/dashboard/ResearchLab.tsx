'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useVisiblePolling } from '@/lib/hooks/useVisiblePolling'
import type { MetagraphData } from '@/lib/types'
import { formatLabAllocationPercent } from '@/lib/research-lab-emissions'
import {
  DEFAULT_REPO_URL,
  competitionSubmissionStatusLabel,
  competitionRoundOptions,
  formatCompetitionScore,
  normalizeCompetitionBenchmark,
  normalizeCompetitionCode,
  normalizeCompetitionResults,
  normalizeCompetitionSnapshot,
  normalizeCompetitionSubmissions,
  type CompetitionBenchmark,
  type CompetitionCode,
  type CompetitionIcp,
  type CompetitionRoundSummary,
  type CompetitionSnapshot,
  type CompetitionSubmission,
  type CompetitionSubmissionResults,
} from '@/lib/research-lab-competition'

type ResearchLabData = { labMinerSpend: LabMinerSpendRollup; fetchedAt: string }
type LabMinerSpendRollup = {
  byHotkey: Record<string, LabMinerSpendEntry>
  allTime: { byHotkey: Record<string, LabMinerAllTimeEntry> }
  currentAllocation: { epoch: number | null; source: string; byHotkey: Record<string, LabMinerCurrentAllocationEntry> }
}
type LabMinerSpendEntry = { computeSpendUsd: number; scheduledReimbursementUsd: number; activeAwardCount: number; reimbursementEpochs: number | null }
type LabMinerAllTimeEntry = { alphaEarned: number; computeSpendUsd: number; scheduledReimbursementUsd: number; awardCount: number; reimbursementEpochs: number | null; alphaAllocationCount: number }
type LabMinerCurrentAllocationEntry = { paidAlphaPercent: number; intendedAlphaPercent: number; overpaidAlphaPercent: number; spendUsd: number; labBucketSharePercent: number; allocationCount: number; reasons: string[] }
type ReleaseState = 'idle' | 'loading' | 'available' | 'gated' | 'error'

export function ResearchLab({
  onSync,
  metagraph,
  active = true,
}: { onSync?: () => void; metagraph?: MetagraphData | null; active?: boolean } = {}) {
  const [settlement, setSettlement] = useState<ResearchLabData | null>(null)
  const [competition, setCompetition] = useState<CompetitionSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    const [competitionRequest, settlementRequest] = await Promise.allSettled([
      fetchJson('/api/research-lab/competition'),
      fetchJson(`/api/research-lab?t=${Date.now()}`),
    ])
    let refreshed = false
    if (competitionRequest.status === 'fulfilled') {
      const normalized = normalizeCompetitionSnapshot(competitionRequest.value)
      if (normalized) {
        setCompetition(normalized)
        setSelectedRoundId((current) => current ?? normalized.latestRound?.roundId ?? normalized.latestCompletedRound?.roundId ?? normalized.openRound?.roundId ?? normalized.rounds[0]?.roundId ?? null)
        setError(null)
        refreshed = true
      } else setError('Competition data did not match the public contract.')
    } else setError(errorMessage(competitionRequest.reason, 'Competition data is temporarily unavailable.'))
    if (settlementRequest.status === 'fulfilled') {
      const body = asRecord(settlementRequest.value)
      if (body?.success === true && asRecord(body.data)) setSettlement(body.data as ResearchLabData)
      refreshed = true
    }
    if (refreshed) onSync?.()
    setLoading(false)
  }, [onSync])

  useVisiblePolling(fetchData, 60_000, { enabled: active })

  if (loading && !competition) return <ResearchLabLoading />
  const roundOptions = competition ? competitionRoundOptions(competition) : []
  const selectedRound = roundOptions.find((round) => round.roundId === selectedRoundId) ?? roundOptions[0] ?? null
  return (
    <div className="w-full">
      <CompetitionHeader competition={competition} />
      {!competition ? <Unavailable message="Competition data is temporarily unavailable. This page will retry automatically." /> : selectedRound ? <><RoundSummary competition={competition} round={selectedRound} rounds={roundOptions} onSelectRound={setSelectedRoundId} /><RoundWorkspace round={selectedRound} active={active} /></> : <p className="border-b border-[var(--line)] py-12 text-[14px] text-[var(--muted)]">No production competition round is available.</p>}
      <details className="group mt-12 border-t border-[var(--line)] pt-1">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 font-display text-[17px] text-[var(--muted)] focus:outline-none focus-visible:text-[var(--white)] [&::-webkit-details-marker]:hidden">
          <span>Competition settlement and emissions</span><span aria-hidden className="font-mono text-[11px] text-[var(--muted-2)] transition-transform group-open:rotate-45">+</span>
        </summary>
        <p className="mb-5 max-w-2xl text-[12px] leading-relaxed text-[var(--muted-2)]">Current competition allocation, metagraph emissions, reimbursement, and compute spend remain available for settlement review.</p>
        <LabEmissionSplit spend={settlement?.labMinerSpend ?? null} metagraph={metagraph} />
      </details>
      {error && competition ? <p className="mt-5 text-[12px] text-[var(--muted-2)]">Latest refresh failed: {error}</p> : null}
    </div>
  )
}

function ResearchLabLoading() {
  return <div className="w-full"><div className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--muted-2)]">Open Source Agent Competition</div><div className="mt-10 space-y-4"><div className="h-20 w-48 shimmer rounded-md" /><div className="h-4 w-96 max-w-full shimmer rounded" /></div></div>
}

function Unavailable({ message }: { message: string }) {
  return <p role="status" className="border-b border-[var(--line)] py-10 text-[14px] leading-relaxed text-[var(--muted)]">{message}</p>
}

function CompetitionHeader({ competition }: { competition: CompetitionSnapshot | null }) {
  return (
    <header className="flex flex-col justify-between gap-6 border-b border-[var(--line)] pb-8 md:flex-row md:items-end">
      <div>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--muted-2)]">{competition ? `SN ${competition.netuid} · ${competition.networkName} · ${competition.mode}` : 'Public benchmark'}</div>
        <h2 className="mt-3 max-w-[760px] font-display text-[32px] font-medium leading-[1.04] tracking-[-0.035em] text-[var(--white)] md:text-[46px]">Open Source Agent Competition</h2>
        <p className="mt-4 max-w-[680px] text-[14px] leading-[1.7] text-[var(--muted)]">Improve the public agent and compete on the same daily ICPs.</p>
      </div>
      <a href={competition?.repoUrl ?? DEFAULT_REPO_URL} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center justify-center rounded-md border border-[var(--line-3)] px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--platinum)] transition-colors hover:border-[var(--muted-2)] hover:text-[var(--white)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]">Open benchmark repository ↗</a>
    </header>
  )
}

function RoundSummary({ competition, round, rounds, onSelectRound }: { competition: CompetitionSnapshot; round: CompetitionRoundSummary; rounds: CompetitionRoundSummary[]; onSelectRound: (roundId: string) => void }) {
  const baselineScore = round.baseline?.finalScore ?? null
  const championScore = round.champion?.finalScore ?? null
  return (
    <section className="border-b border-[var(--line)] py-10 md:py-12">
      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.13em] text-[var(--muted-2)]"><span>{roundStatusLabel(round.status)}</span>{round.cancelReason ? <><span aria-hidden>·</span><span>{humanize(round.cancelReason)}</span></> : null}</div>
          <div className="mt-4 font-display text-[clamp(42px,7vw,76px)] font-medium leading-[0.9] tracking-[-0.045em] text-[var(--platinum)]">{baselineScore === null ? 'Not published' : formatCompetitionScore(baselineScore)}{baselineScore === null ? null : <span className="ml-3 align-baseline text-[20px] tracking-normal text-[var(--faint)]">/100 baseline</span>}</div>
          <p className="mt-5 max-w-[610px] text-[13px] leading-[1.7] text-[var(--muted)]">{baselineScore === null ? 'No final baseline score has been published for this round.' : 'Final score for the public baseline in this production round.'}</p>
        </div>
        <label className="block min-w-[250px]"><span className="mb-2 block font-mono text-[9.5px] uppercase tracking-[0.13em] text-[var(--muted-2)]">Competition round</span><select value={round.roundId} onChange={(event) => onSelectRound(event.target.value)} className="w-full rounded-md border border-[var(--line)] bg-[#0d0d0d] px-3 py-2.5 font-mono text-[11px] text-[var(--platinum)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]">{rounds.map((option) => <option key={option.roundId} value={option.roundId}>{roundOptionLabel(option, competition)}</option>)}</select></label>
      </div>
      <CompetitionSchedule round={round} />
      <div className="mt-8 grid gap-px overflow-hidden rounded-md border border-[var(--line)] bg-[var(--line)] sm:grid-cols-3">
        <SummaryMetric label="Round baseline" value="PydanticAI" detail={round.baseline ? `${formatCompetitionScore(baselineScore)} · ${shortHotkey(round.baseline.minerHotkey)}` : 'Score unavailable'} />
        <SummaryMetric label="Round status" value={roundStatusLabel(round.status)} detail={round.publishedAt ? formatUtc(round.publishedAt) : round.createdAt ? `Created ${formatUtc(round.createdAt)}` : round.roundId} />
        {round.champion
          ? <SummaryMetric label="Champion" value={shortHotkey(round.champion.minerHotkey)} detail={championMetricDetail(round, championScore)} />
          : round.cancelReason
            ? <SummaryMetric label="Cancellation" value={humanize(round.cancelReason)} detail="No champion was published" />
            : <SummaryMetric label="Promotion" value={humanize(round.promotionStatus ?? 'not required')} detail="No champion was published" />}
      </div>
    </section>
  )
}

function CompetitionSchedule({ round }: { round: CompetitionRoundSummary }) {
  if (!round.icpSetDate && !round.evaluationDate && !round.publicAt) return null
  const submissionDate = utcCalendarDate(round.submissionOpen) ?? round.icpSetDate
  const nextDay = submissionDate === round.icpSetDate
    && isNextUtcDay(submissionDate, round.evaluationDate)
    && utcCalendarDate(round.publicAt) === round.evaluationDate
  return <div className="mt-8 grid gap-5 border-y border-[var(--line)] py-5 sm:grid-cols-2">
    <div><div className="font-mono text-[9.5px] uppercase tracking-[0.13em] text-[var(--muted-2)]">{nextDay ? 'Day 0 · Submissions' : 'Submissions'}</div><div className="mt-2 text-[14px] text-[var(--platinum)]">{formatUtcDate(submissionDate)}</div><div className="mt-1 text-[11px] text-[var(--muted-2)]">{round.submissionCutoff ? `Closes ${formatUtc(round.submissionCutoff)}` : 'Submit an agent for this ICP set.'}</div></div>
    <div><div className="font-mono text-[9.5px] uppercase tracking-[0.13em] text-[var(--muted-2)]">{nextDay ? 'Day 1 · Evaluation' : 'Evaluation'}</div><div className="mt-2 text-[14px] text-[var(--platinum)]">{formatUtcDate(round.evaluationDate)}</div><div className="mt-1 text-[11px] text-[var(--muted-2)]">{round.publicAt ? `ICPs publish ${formatUtc(round.publicAt)}. Source and scores follow after evaluation.` : 'ICPs publish first. Source and scores follow after evaluation.'}</div></div>
  </div>
}

function SummaryMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="min-w-0 bg-[#0b0b0b] px-4 py-4"><div className="font-mono text-[9.5px] uppercase tracking-[0.13em] text-[var(--muted-2)]">{label}</div><div className="mt-2 truncate font-mono text-[12px] text-[var(--platinum)]" title={value}>{value}</div><div className="mt-1 truncate text-[11px] text-[var(--muted-2)]" title={detail}>{detail}</div></div>
}

function RoundWorkspace({ round, active }: { round: CompetitionRoundSummary; active: boolean }) {
  const [submissions, setSubmissions] = useState<CompetitionSubmission[]>([])
  const [benchmark, setBenchmark] = useState<CompetitionBenchmark | null>(null)
  const [benchmarkState, setBenchmarkState] = useState<ReleaseState>('loading')
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null)
  const [roundLoading, setRoundLoading] = useState(true)
  const [roundError, setRoundError] = useState<string | null>(null)
  const [results, setResults] = useState<CompetitionSubmissionResults | null>(null)
  const [resultsState, setResultsState] = useState<ReleaseState>('idle')
  const [code, setCode] = useState<CompetitionCode | null>(null)
  const [codeState, setCodeState] = useState<ReleaseState>('idle')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [roundRevision, setRoundRevision] = useState(0)
  const roundRequestRef = useRef(0)
  const roundSnapshotRef = useRef(false)
  const benchmarkReleasedRef = useRef(false)
  const selectedSubmissionIdRef = useRef<string | null>(null)
  selectedSubmissionIdRef.current = selectedSubmissionId
  const selectSubmission = useCallback((submissionId: string | null) => {
    selectedSubmissionIdRef.current = submissionId
    setSelectedSubmissionId(submissionId)
  }, [])

  useEffect(() => {
    benchmarkReleasedRef.current = false
    roundSnapshotRef.current = false
    setRoundLoading(true); setRoundError(null); setBenchmark(null); setBenchmarkState('loading'); setSubmissions([]); selectSubmission(null)
    return () => { roundRequestRef.current += 1 }
  }, [round.roundId, selectSubmission])

  const refreshRound = useCallback(async () => {
    const initial = !roundSnapshotRef.current
    const request = ++roundRequestRef.current
    const [submissionRequest, benchmarkRequest] = await Promise.allSettled([
      fetchReleasedJson(`/api/research-lab/rounds/${encodeURIComponent(round.roundId)}/submissions`),
      fetchReleasedJson(`/api/research-lab/rounds/${encodeURIComponent(round.roundId)}/benchmark`),
    ])
    if (request !== roundRequestRef.current) return
    if (submissionRequest.status === 'fulfilled' && submissionRequest.value.state === 'available') {
      const next = normalizeCompetitionSubmissions(submissionRequest.value.body)
      setSubmissions(next)
      const current = selectedSubmissionIdRef.current
      selectSubmission(current && next.some((submission) => submission.submissionId === current)
        ? current
        : next.find((submission) => submission.isBaseline)?.submissionId ?? next.find((submission) => submission.isChampion)?.submissionId ?? next[0]?.submissionId ?? null)
      setRoundError(null)
    } else if (initial) {
      setSubmissions([])
      if (submissionRequest.status === 'rejected') setRoundError(errorMessage(submissionRequest.reason, 'Submissions are temporarily unavailable.'))
    } else {
      setRoundError(submissionRequest.status === 'rejected'
        ? `Latest submission refresh failed: ${errorMessage(submissionRequest.reason, 'request failed')}`
        : 'Latest submission refresh did not return public data.')
    }
    if (benchmarkRequest.status === 'fulfilled' && benchmarkRequest.value.state === 'available') {
      const next = normalizeCompetitionBenchmark(benchmarkRequest.value.body, round)
      benchmarkReleasedRef.current = next !== null
      setBenchmark(next); setBenchmarkState(next ? 'available' : 'error')
    } else if (benchmarkRequest.status === 'fulfilled') {
      if (!benchmarkReleasedRef.current) {
        setBenchmark(null); setBenchmarkState(benchmarkRequest.value.state)
      } else if (!initial) setRoundError('Latest benchmark refresh failed. The last public snapshot remains shown.')
    } else if (initial) setBenchmarkState('error')
    else setRoundError(`Latest benchmark refresh failed: ${errorMessage(benchmarkRequest.reason, 'request failed')}. The last public snapshot remains shown.`)
    roundSnapshotRef.current = true
    setRoundLoading(false)
    setRoundRevision((current) => current + 1)
  }, [round, selectSubmission])

  useVisiblePolling(refreshRound, 60_000, { enabled: active })

  useEffect(() => {
    setResults(null); setCode(null); setCodeState('idle'); setSelectedFile(null)
    if (!selectedSubmissionId) { setResultsState('idle'); return }
    setResultsState('loading')
  }, [round.roundId, selectedSubmissionId])

  useEffect(() => {
    if (!selectedSubmissionId) return
    const requestedRoundId = round.roundId
    const requestedSubmissionId = selectedSubmissionId
    let active = true
    setResultsState((current) => current === 'available' ? current : 'loading')
    fetchReleasedJson(`/api/research-lab/rounds/${encodeURIComponent(requestedRoundId)}/results/${encodeURIComponent(requestedSubmissionId)}`).then((response) => {
      if (!active) return
      if (response.state !== 'available') { setResultsState(response.state); return }
      const normalized = normalizeCompetitionResults(response.body)
      if (
        selectedSubmissionIdRef.current !== requestedSubmissionId
        || normalized?.roundId !== requestedRoundId
        || normalized.submissionId !== requestedSubmissionId
      ) {
        setResults(null); setResultsState('error'); return
      }
      setResults(normalized); setResultsState('available')
    }).catch(() => { if (active) setResultsState('error') })
    return () => { active = false }
  }, [round.roundId, roundRevision, selectedSubmissionId])

  const selectedSubmission = submissions.find((submission) => submission.submissionId === selectedSubmissionId) ?? null
  const selectedCodeFile = code?.files.find((file) => file.path === selectedFile) ?? code?.files[0] ?? null
  const requestCode = async () => {
    if (!selectedSubmission) return
    const requestedSubmissionId = selectedSubmission.submissionId
    setCodeState('loading')
    try {
      const response = await fetchReleasedJson(`/api/research-lab/submissions/${encodeURIComponent(requestedSubmissionId)}/code`)
      if (selectedSubmissionIdRef.current !== requestedSubmissionId) return
      if (response.state !== 'available') { setCodeState(response.state); return }
      const normalized = normalizeCompetitionCode(response.body)
      if (normalized?.submissionId !== requestedSubmissionId) { setCodeState('error'); return }
      setCode(normalized); setSelectedFile(normalized?.files[0]?.path ?? null); setCodeState(normalized ? 'available' : 'error')
    } catch { if (selectedSubmissionIdRef.current === requestedSubmissionId) setCodeState('error') }
  }

  return (
    <section className="pt-10">
      <div className="mb-5 flex items-end justify-between gap-4"><div><h3 className="font-display text-[22px] font-medium tracking-[-0.025em] text-[var(--platinum)]">Submissions</h3><p className="mt-1 text-[12px] text-[var(--muted-2)]">Select a submission to inspect its published public-ICP scores and released source.</p></div><span className="font-mono text-[10px] text-[var(--muted-2)]">{submissions.length} total</span></div>
      {roundLoading ? <div className="h-24 shimmer rounded-md" /> : submissions.length === 0 ? <InlineNotice>{roundError ?? 'No submissions are public for this round.'}</InlineNotice> : <>{roundError ? <div className="mb-3"><InlineNotice>{roundError} Last known submissions are shown below.</InlineNotice></div> : null}<SubmissionTable submissions={submissions} round={round} selectedId={selectedSubmissionId} onSelect={selectSubmission} /></>}
      {selectedSubmission ? <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.55fr)]"><PublishedResults benchmark={benchmark} benchmarkState={benchmarkState} results={results} resultsState={resultsState} round={round} submission={selectedSubmission} /><SourcePanel submission={selectedSubmission} cancelled={round.status === 'cancelled'} code={code} codeState={codeState} selectedFile={selectedCodeFile} onSelectFile={setSelectedFile} onRequest={() => void requestCode()} /></div> : null}
    </section>
  )
}

function SubmissionTable({ submissions, round, selectedId, onSelect }: { submissions: CompetitionSubmission[]; round: CompetitionRoundSummary; selectedId: string | null; onSelect: (submissionId: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-md border border-[var(--line)]"><table className="w-full min-w-[640px] border-collapse text-left"><thead className="border-b border-[var(--line)] bg-[rgba(236,234,230,0.018)] font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--muted-2)]"><tr><th className="px-3 py-2.5 font-normal">Submission</th><th className="px-3 py-2.5 font-normal">Miner hotkey</th><th className="px-3 py-2.5 font-normal">Status</th><th className="px-3 py-2.5 text-right font-normal">Final</th></tr></thead><tbody>
      {submissions.map((submission) => { const selected = submission.submissionId === selectedId; return <tr key={submission.submissionId} className={`border-b border-[var(--line)] last:border-b-0 ${selected ? 'bg-[rgba(236,234,230,0.045)]' : 'hover:bg-[rgba(236,234,230,0.02)]'}`}><td className="p-0"><button type="button" onClick={() => onSelect(submission.submissionId)} className="w-full px-3 py-3 text-left font-mono text-[11px] text-[var(--platinum)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand)]" aria-pressed={selected}>{shortId(submission.submissionId)} {submission.isBaseline ? <span className="ml-1.5 text-[9px] uppercase tracking-wide text-[var(--brand)]">Baseline</span> : null}</button></td><td className="px-3 py-3 font-mono text-[11px] text-[var(--muted)]" title={submission.minerHotkey}>{shortHotkey(submission.minerHotkey)}</td><td className="px-3 py-3 text-[11px] text-[var(--muted)]">{competitionSubmissionStatusLabel(submission, round)}</td><td className="px-3 py-3 text-right font-mono text-[11px] text-[var(--platinum)]">{formatCompetitionScore(submission.finalScore)}</td></tr> })}
      </tbody></table></div>
  )
}

function PublishedResults({ benchmark, benchmarkState, results, resultsState, round, submission }: { benchmark: CompetitionBenchmark | null; benchmarkState: ReleaseState; results: CompetitionSubmissionResults | null; resultsState: ReleaseState; round: CompetitionRoundSummary; submission: CompetitionSubmission }) {
  if (round.status === 'cancelled' || results?.incomplete) return <ResultFrame><InlineNotice>This round was cancelled. Aggregate and per-ICP scores were not published.</InlineNotice>{benchmarkState === 'available' && benchmark ? <div className="mt-5"><IcpList title="Public ICPs (20)" icpSetDate={benchmark.icpSetDate} icps={benchmark.icps} scores={new Map()} /></div> : null}</ResultFrame>
  if (benchmarkState === 'loading') return <ResultFrame><div className="h-24 shimmer rounded-md" /></ResultFrame>
  if (benchmarkState === 'gated') return <ResultFrame><InlineNotice>All 20 ICPs become public{round.publicAt ? ` at ${formatUtc(round.publicAt)}` : ' at the start of Day 1'}. Source code and scores follow after evaluation.</InlineNotice></ResultFrame>
  if (!benchmark || benchmarkState === 'error') return <ResultFrame><InlineNotice>Published public-ICP details are temporarily unavailable.</InlineNotice></ResultFrame>
  if (!submission.isBaseline && resultsState === 'error') return <PendingIcpResults benchmark={benchmark}>The ICPs are public. Published scores are temporarily unavailable.</PendingIcpResults>
  if (!submission.isBaseline && (resultsState === 'loading' || resultsState === 'gated' || !results || results.publicIcpStatus !== 'ready')) return <PendingIcpResults benchmark={benchmark}>Scores and source code appear when evaluation is complete.</PendingIcpResults>
  const scores = submission.isBaseline
    ? new Map(benchmark.icps.flatMap((icp) => icp.baselineScore === null ? [] : [[icp.position, icp.baselineScore] as const]))
    : results?.publicScores ?? new Map<number, number>()
  return <ResultFrame><div className="mb-5 flex flex-wrap gap-5 font-mono text-[10.5px] text-[var(--muted-2)]"><span>Final {formatCompetitionScore(results?.finalScore ?? submission.finalScore)}</span><span>{submission.isBaseline ? 'Public baseline' : shortHotkey(submission.minerHotkey)}</span></div><IcpList title="Public ICPs (20)" icpSetDate={benchmark.icpSetDate} icps={benchmark.icps} scores={scores} /></ResultFrame>
}

function ResultFrame({ children }: { children: ReactNode }) { return <div><h3 className="font-display text-[19px] font-medium text-[var(--platinum)]">Published results</h3><div className="mt-4">{children}</div></div> }

function PendingIcpResults({ benchmark, children }: { benchmark: CompetitionBenchmark; children: ReactNode }) { return <ResultFrame><InlineNotice>{children}</InlineNotice><div className="mt-5"><IcpList title="Public ICPs (20)" icpSetDate={benchmark.icpSetDate} icps={benchmark.icps} scores={new Map()} /></div></ResultFrame> }

function IcpList({ title, icpSetDate, icps, scores }: { title: string; icpSetDate: string; icps: CompetitionIcp[]; scores: Map<number, number> }) {
  return <div><div className="mb-1 flex flex-wrap items-center justify-between gap-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--muted-2)]"><span>{title}</span><span>ICP set · {formatUtcDate(icpSetDate)}</span></div><p className="mb-3 text-[11px] text-[var(--muted-2)]">All 20 ICPs are public for this round.</p><div className="overflow-hidden rounded-md border border-[var(--line)]">{icps.map((icp) => <details key={`${icp.position}-${icp.id}`} className="group border-b border-[var(--line)] last:border-b-0"><summary className="grid cursor-pointer list-none grid-cols-[36px_minmax(0,1fr)_52px_16px] items-center gap-2 px-3 py-3 focus:outline-none focus-visible:bg-[rgba(236,234,230,0.04)] [&::-webkit-details-marker]:hidden"><span className="font-mono text-[10px] text-[var(--muted-2)]">{String(icp.position + 1).padStart(2, '0')}</span><span className="truncate text-[12px] text-[var(--platinum)]">{icp.prompt}</span><span className="text-right font-mono text-[11px] text-[var(--white)]">{formatCompetitionScore(scores.get(icp.position) ?? null)}</span><span aria-hidden className="font-mono text-[11px] text-[var(--muted-2)] transition-transform group-open:rotate-45">+</span></summary><div className="border-t border-[var(--line)] bg-[#090909] px-4 py-4"><dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2"><IcpDetail label="Industry" value={[icp.industry, icp.subIndustry].filter(Boolean).join(' · ')} /><IcpDetail label="Geography" value={icp.geography ?? icp.country} /><IcpDetail label="Company size" value={icp.employeeCount.join(', ')} /><IcpDetail label="Company stage" value={icp.companyStage} /><IcpDetail label="Product or service" value={icp.productService} /><IcpDetail label="Required attribute" value={icp.requiredAttribute} /><IcpDetail label={icp.intentCategory ? `Intent · ${humanize(icp.intentCategory)}` : 'Intent'} value={icp.intentSignal} wide /></dl></div></details>)}</div></div>
}

function IcpDetail({ label, value, wide = false }: { label: string; value: string | null; wide?: boolean }) { if (!value) return null; return <div className={wide ? 'sm:col-span-2' : ''}><dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--muted-2)]">{label}</dt><dd className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted)]">{value}</dd></div> }

function SourcePanel({ submission, cancelled, code, codeState, selectedFile, onSelectFile, onRequest }: { submission: CompetitionSubmission; cancelled: boolean; code: CompetitionCode | null; codeState: ReleaseState; selectedFile: CompetitionCode['files'][number] | null; onSelectFile: (path: string) => void; onRequest: () => void }) {
  if (cancelled) return <aside><h3 className="font-display text-[19px] font-medium text-[var(--platinum)]">Source code</h3><div className="mt-4"><InlineNotice>This round was cancelled. Source code was not published.</InlineNotice></div></aside>
  const availableAt = submission.code.availableAt ? formatUtc(submission.code.availableAt) : null
  return <aside><h3 className="font-display text-[19px] font-medium text-[var(--platinum)]">Source code</h3><p className="mt-2 text-[12px] leading-relaxed text-[var(--muted-2)]">Code becomes public when Day 1 evaluation is complete.</p>
    {codeState === 'idle' ? <div className="mt-4"><button type="button" disabled={!submission.code.available} onClick={onRequest} className="rounded-md border border-[var(--line-3)] px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.11em] text-[var(--platinum)] transition-colors hover:text-[var(--white)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-45">{submission.code.available ? 'View released source' : 'Source locked'}</button>{!submission.code.available ? <p className="mt-2 font-mono text-[9.5px] text-[var(--muted-2)]">{availableAt ? `Available ${availableAt}` : 'Available after evaluation'}</p> : null}</div> : null}
    {codeState === 'loading' ? <div className="mt-4 h-20 shimmer rounded-md" /> : null}{codeState === 'gated' ? <div className="mt-4"><InlineNotice>Source is not public yet. It appears when evaluation is complete.</InlineNotice></div> : null}{codeState === 'error' ? <div className="mt-4"><InlineNotice>Released source is temporarily unavailable.</InlineNotice></div> : null}
    {codeState === 'available' && code ? <div className="mt-4 overflow-hidden rounded-md border border-[var(--line)]"><div className="max-h-36 overflow-y-auto border-b border-[var(--line)] bg-[#090909] p-1.5">{code.files.map((file) => <button key={file.path} type="button" onClick={() => onSelectFile(file.path)} className={`block w-full truncate rounded px-2 py-1.5 text-left font-mono text-[10px] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--brand)] ${file.path === selectedFile?.path ? 'bg-[rgba(236,234,230,0.07)] text-[var(--white)]' : 'text-[var(--muted-2)] hover:text-[var(--platinum)]'}`} title={file.path}>{file.path}</button>)}</div>{selectedFile ? <pre className="max-h-[420px] overflow-auto bg-[#070707] p-3 text-[10px] leading-[1.65] text-[var(--muted)]"><code>{selectedFile.content}</code></pre> : <p className="p-3 text-[11px] text-[var(--muted-2)]">No text files were released.</p>}{code.truncated ? <p className="border-t border-[var(--line)] px-3 py-2 text-[10px] text-[var(--muted-2)]">Some files are omitted from this preview.</p> : null}</div> : null}
  </aside>
}

function InlineNotice({ children }: { children: ReactNode }) { return <p className="rounded-md border border-[var(--line)] bg-[#0a0a0a] px-4 py-4 text-[12px] leading-relaxed text-[var(--muted-2)]">{children}</p> }

function LabEmissionSplit({ spend, metagraph }: { spend: LabMinerSpendRollup | null; metagraph?: MetagraphData | null }) {
  const rows = useMemo(() => {
    const current = spend?.currentAllocation?.byHotkey ?? {}; const recent = spend?.byHotkey ?? {}; const allTime = spend?.allTime?.byHotkey ?? {}; const keys = new Set([...Object.keys(current), ...Object.keys(recent), ...Object.keys(allTime), ...Object.keys(metagraph?.incentives ?? {})])
    return Array.from(keys).map((hotkey) => ({ hotkey, metagraphPct: Math.max(0, Number(metagraph?.incentives?.[hotkey] ?? 0) * 100), paidAlphaPct: Math.max(0, Number(current[hotkey]?.paidAlphaPercent ?? 0)), computeSpendUsd: Math.max(0, Number(recent[hotkey]?.computeSpendUsd ?? 0)), reimbursementUsd: Math.max(0, Number(recent[hotkey]?.scheduledReimbursementUsd ?? 0)), alphaEarned: Math.max(0, Number(allTime[hotkey]?.alphaEarned ?? 0)) })).filter((row) => row.metagraphPct > 0 || row.paidAlphaPct > 0 || row.computeSpendUsd > 0 || row.alphaEarned > 0).sort((a, b) => b.metagraphPct - a.metagraphPct || b.alphaEarned - a.alphaEarned || a.hotkey.localeCompare(b.hotkey))
  }, [metagraph?.incentives, spend])
  if (rows.length === 0) return <p className="pb-4 text-[13px] text-[var(--muted-2)]">No current competition allocation or settlement data is available.</p>
  return <div className="mb-4 overflow-hidden rounded-md border border-[var(--line)]"><div className="hidden grid-cols-[minmax(0,1fr)_130px_130px_130px_130px] gap-3 border-b border-[var(--line)] bg-[rgba(236,234,230,0.018)] px-3 py-2 font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--muted-2)] md:grid"><span>Hotkey</span><span className="text-right">Metagraph</span><span className="text-right">Competition</span><span className="text-right">Compute / repay</span><span className="text-right">Alpha earned</span></div>{rows.map((row) => <div key={row.hotkey} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-[var(--line)] px-3 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_130px_130px_130px_130px] md:items-center"><span className="font-mono text-[11px] text-[var(--platinum)]">{shortHotkey(row.hotkey)}</span><span className="text-right font-mono text-[11px] text-[var(--muted)]">{formatLabAllocationPercent(row.metagraphPct)}</span><span className="hidden text-right font-mono text-[11px] text-[var(--muted)] md:block">{formatLabAllocationPercent(row.paidAlphaPct)}</span><span className="text-right font-mono text-[11px] text-[var(--muted)]">{formatUsd(row.computeSpendUsd)} / {formatUsd(row.reimbursementUsd)}</span><span className="hidden text-right font-mono text-[11px] text-[var(--muted)] md:block">{formatAlpha(row.alphaEarned)}</span></div>)}</div>
}

async function fetchJson(url: string): Promise<unknown> { const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } }); if (!response.ok) throw new Error(`Request failed (${response.status})`); return response.json() }
async function fetchReleasedJson(url: string): Promise<{ state: 'available'; body: unknown } | { state: 'gated'; body: null }> { const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } }); if (response.status === 403) return { state: 'gated', body: null }; if (!response.ok) throw new Error(`Request failed (${response.status})`); return { state: 'available', body: await response.json() } }
function asRecord(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null }
function roundOptionLabel(round: CompetitionRoundSummary, competition: CompetitionSnapshot): string { const tags = [roundStatusLabel(round.status)]; if (round.roundId === competition.latestRound?.roundId) tags.push('latest'); if (round.roundId === competition.latestCompletedRound?.roundId) tags.push('last completed'); if (round.roundId === competition.openRound?.roundId) tags.push('open round'); return `${round.roundId} — ${tags.join(' · ')}` }
function championMetricDetail(round: CompetitionRoundSummary, championScore: number | null): string {
  if (round.promotionStatus === 'promoted') return `Becomes next baseline · ${formatCompetitionScore(championScore)}`
  if (round.promotionStatus === 'pending') return `Promotion pending · ${formatCompetitionScore(championScore)}`
  return `${humanize(round.champion?.outcome ?? 'champion')} · ${formatCompetitionScore(championScore)}`
}
function roundStatusLabel(value: string): string { if (value === 'published') return 'Published result'; if (value === 'cancelled') return 'Cancelled round'; if (value === 'open') return 'Open for submissions'; return humanize(value) }
function humanize(value: string): string { const normalized = value.trim().replaceAll('_', ' '); return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : 'Unavailable' }
function shortId(value: string): string { return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-6)}` : value }
function shortHotkey(value: string): string { return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-6)}` : value }
function formatUtc(value: string): string { const date = new Date(value); return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC` : value }
function formatUtcDate(value: string | null): string { if (!value) return 'Date unavailable'; const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) ? `${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date)} · UTC` : value }
function utcCalendarDate(value: string | null): string | null { if (!value) return null; const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null }
function isNextUtcDay(start: string | null, end: string | null): boolean { if (!start || !end) return false; const startDate = new Date(`${start}T00:00:00Z`); const endDate = new Date(`${end}T00:00:00Z`); return endDate.getTime() - startDate.getTime() === 86_400_000 }
function formatUsd(value: number): string { if (!Number.isFinite(value) || value <= 0) return '$0.00'; if (value >= 1) return `$${value.toFixed(2)}`; return '<$0.01' }
function formatAlpha(value: number): string { if (!Number.isFinite(value) || value <= 0) return '0.0000'; return value >= 1 ? value.toFixed(2) : value.toFixed(4) }
function errorMessage(value: unknown, fallback: string): string { return value instanceof Error ? value.message : fallback }
