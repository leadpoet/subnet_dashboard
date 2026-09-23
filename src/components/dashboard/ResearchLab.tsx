'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useVisiblePolling } from '@/lib/hooks/useVisiblePolling'
import {
  DEFAULT_REPO_URL,
  COMPANY_CHECK_LABELS,
  COMPANY_CHECK_STATUS_LABELS,
  type CompetitionCompanyDiagnostic,
  competitionSubmissionEvaluationNotice,
  competitionSubmissionStatusLabel,
  competitionRoundOptions,
  formatCompetitionScore,
  latestPublishedBaselineRound,
  normalizeCompetitionBenchmark,
  normalizeCompetitionCode,
  normalizeCompetitionResults,
  normalizeCompetitionSnapshot,
  normalizeCompetitionSubmissions,
  isCompetitionReviewExcluded,
  type CompetitionBenchmark,
  type CompetitionCode,
  type CompetitionIcp,
  type CompetitionRoundSummary,
  type CompetitionScoringAttribution,
  type CompetitionSnapshot,
  type CompetitionSubmission,
  type CompetitionSubmissionResults,
} from '@/lib/research-lab-competition'

type ReleaseState = 'idle' | 'loading' | 'available' | 'gated' | 'error'

export function ResearchLab({
  onSync,
  active = true,
}: { onSync?: () => void; active?: boolean } = {}) {
  const [competition, setCompetition] = useState<CompetitionSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const response = await fetchJson('/api/research-lab/competition')
      const normalized = normalizeCompetitionSnapshot(response)
      if (normalized) {
        setCompetition(normalized)
        setError(null)
        onSync?.()
      } else setError('Competition data did not match the public contract.')
    } catch (requestError) {
      setError(errorMessage(requestError, 'Competition data is temporarily unavailable.'))
    } finally {
      setLoading(false)
    }
  }, [onSync])

  useVisiblePolling(fetchData, 60_000, { enabled: active })

  if (loading && !competition) return <ResearchLabLoading />
  const roundOptions = competition ? competitionRoundOptions(competition) : []
  const selectedRound = roundOptions[0] ?? null
  const publishedBaselineRound = competition ? latestPublishedBaselineRound(competition, selectedRound) : null
  return (
    <div className="w-full">
      <CompetitionHeader competition={competition} />
      {!competition ? <Unavailable message="Competition data is temporarily unavailable. This page will retry automatically." /> : selectedRound ? <>{publishedBaselineRound ? <LatestPublishedBaseline round={publishedBaselineRound} /> : null}<RoundSummary round={selectedRound} /><RoundWorkspace round={selectedRound} active={active} /></> : <p className="border-b border-[var(--line)] py-12 text-[14px] text-[var(--muted)]">No production competition round is available.</p>}
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

function RoundSummary({ round }: { round: CompetitionRoundSummary }) {
  const baselineScore = round.baseline?.finalScore ?? null
  const championScore = round.champion?.finalScore ?? null
  const evaluationComplete = round.status === 'published'
  return (
    <section className="border-b border-[var(--line)] py-10 md:py-12">
      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.13em] text-[var(--muted-2)]"><span>{roundStatusLabel(round.status)}</span>{round.cancelReason ? <><span aria-hidden>·</span><span>{humanize(round.cancelReason)}</span></> : null}</div>
          <div className="mt-4 font-display text-[clamp(42px,7vw,76px)] font-medium leading-[0.9] tracking-[-0.045em] text-[var(--platinum)]">{baselineScore === null ? 'Not published' : formatCompetitionScore(baselineScore)}{baselineScore === null ? null : <span className="ml-3 align-baseline text-[20px] tracking-normal text-[var(--faint)]">/100 baseline</span>}</div>
          <p className="mt-5 max-w-[610px] text-[13px] leading-[1.7] text-[var(--muted)]">{baselineScore === null ? 'No final baseline score has been published for this round.' : 'Final score for the public baseline in this production round.'}</p>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-[var(--muted-2)]">Promotion margin · +{formatCompetitionScore(round.promotionMargin)} points above the baseline.</p>
      <CompetitionSchedule round={round} />
      <div className="mt-8 grid gap-px overflow-hidden rounded-md border border-[var(--line)] bg-[var(--line)] sm:grid-cols-3">
        <SummaryMetric label="Round baseline" value="Public agent" detail={round.baseline ? `${formatCompetitionScore(baselineScore)} · ${shortHotkey(round.baseline.minerHotkey)}` : 'Score unavailable'} />
        <SummaryMetric label="Round status" value={roundStatusLabel(round.status)} detail={round.publishedAt ? formatUtc(round.publishedAt) : round.createdAt ? `Created ${formatUtc(round.createdAt)}` : round.roundId} />
        {round.champion
          ? <SummaryMetric label="Champion" value={shortHotkey(round.champion.minerHotkey)} detail={championMetricDetail(round, championScore)} />
          : round.cancelReason
            ? <SummaryMetric label="Cancellation" value={humanize(round.cancelReason)} detail="No champion was published" />
            : <SummaryMetric label="Promotion" value={evaluationComplete ? humanize(round.promotionStatus ?? 'not required') : 'Pending'} detail={evaluationComplete ? 'No champion was published' : 'Decision follows completed evaluation'} />}
      </div>
    </section>
  )
}

function LatestPublishedBaseline({ round }: { round: CompetitionRoundSummary }) {
  const score = round.baseline?.finalScore ?? null
  return (
    <section aria-label="Latest published baseline" className="border-b border-[var(--line)] py-5">
      <div className="flex flex-col justify-between gap-3 rounded-md border border-[var(--line)] bg-[#0b0b0b] px-4 py-4 sm:flex-row sm:items-center">
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.13em] text-[var(--muted-2)]">Latest published baseline</div>
          <div className="mt-2 text-[12px] text-[var(--muted)]">Public agent · Evaluation {formatUtcDate(round.evaluationDate)} · Round <span className="font-mono">{round.roundId}</span></div>
        </div>
        <div className="shrink-0 font-display text-[28px] font-medium tracking-[-0.025em] text-[var(--platinum)]">{formatCompetitionScore(score)}<span className="ml-2 font-mono text-[11px] tracking-normal text-[var(--muted-2)]">/100</span></div>
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
    <div><div className="font-mono text-[9.5px] uppercase tracking-[0.13em] text-[var(--muted-2)]">{nextDay ? 'Day 1 · Evaluation' : 'Evaluation'}</div><div className="mt-2 text-[14px] text-[var(--platinum)]">{formatUtcDate(round.evaluationDate)}</div><div className="mt-1 text-[11px] text-[var(--muted-2)]">{round.publicAt ? `ICPs publish ${formatUtc(round.publicAt)}. Scores follow after evaluation.` : 'ICPs publish first. Scores follow after evaluation.'}</div></div>
  </div>
}

function SummaryMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="min-w-0 bg-[#0b0b0b] px-4 py-4"><div className="font-mono text-[9.5px] uppercase tracking-[0.13em] text-[var(--muted-2)]">{label}</div><div className="mt-2 truncate font-mono text-[12px] text-[var(--platinum)]" title={value}>{value}</div><div className="mt-1 truncate text-[11px] text-[var(--muted-2)]" title={detail}>{detail}</div></div>
}

function RoundWorkspace({ round, active }: { round: CompetitionRoundSummary; active: boolean }) {
  // Summary polling returns a new object each time. Depend on the validation
  // fields so an unchanged round does not restart detail polling or results.
  const { roundId, icpSetDate, publicAt, benchmarkIcpCount } = round
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
  }, [roundId, selectSubmission])

  const refreshRound = useCallback(async () => {
    const initial = !roundSnapshotRef.current
    const request = ++roundRequestRef.current
    const [submissionRequest, benchmarkRequest] = await Promise.allSettled([
      fetchReleasedJson(`/api/research-lab/rounds/${encodeURIComponent(roundId)}/submissions`),
      fetchReleasedJson(`/api/research-lab/rounds/${encodeURIComponent(roundId)}/benchmark`),
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
      const next = normalizeCompetitionBenchmark(benchmarkRequest.value.body, { roundId, icpSetDate, publicAt, benchmarkIcpCount })
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
  }, [roundId, icpSetDate, publicAt, benchmarkIcpCount, selectSubmission])

  useVisiblePolling(refreshRound, 60_000, { enabled: active })

  useEffect(() => {
    setResults(null); setCode(null); setCodeState('idle'); setSelectedFile(null)
    if (!selectedSubmissionId) { setResultsState('idle'); return }
    setResultsState('loading')
  }, [roundId, selectedSubmissionId])

  const selectedSubmission = submissions.find((submission) => submission.submissionId === selectedSubmissionId) ?? null
  const reviewExcluded = selectedSubmission ? isCompetitionReviewExcluded(selectedSubmission) : false

  useEffect(() => {
    if (!selectedSubmissionId || reviewExcluded) return
    const requestedRoundId = roundId
    const requestedSubmissionId = selectedSubmissionId
    let active = true
    setResultsState((current) => current === 'available' ? current : 'loading')
    fetchReleasedJson(`/api/research-lab/rounds/${encodeURIComponent(requestedRoundId)}/results/${encodeURIComponent(requestedSubmissionId)}`).then((response) => {
      if (!active) return
      if (response.state !== 'available') { setResultsState(response.state); return }
      const normalized = normalizeCompetitionResults(response.body, { roundId, benchmarkIcpCount })
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
  }, [reviewExcluded, roundId, benchmarkIcpCount, roundRevision, selectedSubmissionId])

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
  const evaluationNotice = competitionSubmissionEvaluationNotice(submission, round)
  const attributionSummary = <ScoringAttributionSummary attribution={results?.scoringAttribution ?? null} loading={resultsState === 'loading'} />
  if (isCompetitionReviewExcluded(submission)) return <ResultFrame><InlineNotice>{evaluationNotice}</InlineNotice>{benchmarkState === 'available' && benchmark ? <div className="mt-5"><IcpList title={`Public ICPs (${benchmark.benchmarkIcpCount})`} icpSetDate={benchmark.icpSetDate} icps={benchmark.icps} scores={new Map()} /></div> : null}</ResultFrame>
  if (round.status === 'cancelled' || results?.incomplete) return <ResultFrame><InlineNotice>This round was cancelled. Aggregate and per-ICP scores were not published.</InlineNotice>{benchmarkState === 'available' && benchmark ? <div className="mt-5"><IcpList title={`Public ICPs (${benchmark.benchmarkIcpCount})`} icpSetDate={benchmark.icpSetDate} icps={benchmark.icps} scores={new Map()} /></div> : null}</ResultFrame>
  if (benchmarkState === 'loading') return <ResultFrame>{attributionSummary}<div className="h-24 shimmer rounded-md" /></ResultFrame>
  if (benchmarkState === 'gated') return <ResultFrame>{attributionSummary}<InlineNotice>All {round.benchmarkIcpCount} ICPs become public{round.publicAt ? ` at ${formatUtc(round.publicAt)}` : ' at the scheduled release'}. Scores follow after evaluation.</InlineNotice></ResultFrame>
  if (!benchmark || benchmarkState === 'error') return <ResultFrame>{attributionSummary}<InlineNotice>Published public-ICP details are temporarily unavailable.</InlineNotice></ResultFrame>
  if (evaluationNotice) return <PendingIcpResults benchmark={benchmark}>{evaluationNotice}</PendingIcpResults>
  if (submission.status === 'scoring_failed') return <PendingIcpResults benchmark={benchmark}>{competitionSubmissionStatusLabel(submission, round)}. No complete evaluation score is available.</PendingIcpResults>
  if (!submission.isBaseline && resultsState === 'error') return <PendingIcpResults benchmark={benchmark}>The ICPs are public. Published scores are temporarily unavailable.</PendingIcpResults>
  if (!submission.isBaseline && (resultsState === 'loading' || resultsState === 'gated' || !results || results.publicIcpStatus !== 'ready')) return <PendingIcpResults benchmark={benchmark}>Scores appear when evaluation is complete.</PendingIcpResults>
  const scores = submission.isBaseline
    ? new Map(benchmark.icps.flatMap((icp) => icp.baselineScore === null ? [] : [[icp.position, icp.baselineScore] as const]))
    : results?.publicScores ?? new Map<number, number>()
  return <ResultFrame><div className="mb-5 flex flex-wrap gap-5 font-mono text-[10.5px] text-[var(--muted-2)]"><span>Final {formatCompetitionScore(results?.finalScore ?? submission.finalScore)}</span><span>{submission.isBaseline ? 'Public baseline' : shortHotkey(submission.minerHotkey)}</span></div><ScoringAttributionSummary attribution={results?.scoringAttribution ?? null} /><IcpList title={`Public ICPs (${benchmark.benchmarkIcpCount})`} icpSetDate={benchmark.icpSetDate} icps={benchmark.icps} scores={scores} scoringAttribution={results?.scoringAttribution ?? null} companyDiagnostics={results?.companyDiagnostics ?? null} /></ResultFrame>
}

function ResultFrame({ children }: { children: ReactNode }) { return <div><h3 className="font-display text-[19px] font-medium text-[var(--platinum)]">Published results</h3><div className="mt-4">{children}</div></div> }

function PendingIcpResults({ benchmark, children }: { benchmark: CompetitionBenchmark; children: ReactNode }) { return <ResultFrame><InlineNotice>{children}</InlineNotice><div className="mt-5"><IcpList title={`Public ICPs (${benchmark.benchmarkIcpCount})`} icpSetDate={benchmark.icpSetDate} icps={benchmark.icps} scores={new Map()} /></div></ResultFrame> }

function ScoringAttributionSummary({ attribution, loading = false }: { attribution: CompetitionScoringAttribution | null; loading?: boolean }) {
  return <div className="mb-5 rounded-md border border-[var(--line)] bg-[#090909] px-4 py-4"><div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--muted-2)]">Scored by</div>{loading ? <p className="mt-2 text-[11.5px] text-[var(--muted)]">Loading validator attribution…</p> : attribution?.validators.length ? <div className="mt-3 space-y-3">{attribution.validators.map((validator) => <div key={validator.hotkey}><div className="break-all font-mono text-[10px] leading-relaxed text-[var(--platinum)]">{validator.hotkey}</div><div className="mt-1 text-[10.5px] text-[var(--muted-2)]">{formatIcpCount(validator.icpCount)} · {validator.reusedIcpCount} reused</div></div>)}</div> : <p className="mt-2 text-[11.5px] text-[var(--muted)]">Unavailable</p>}{!loading && attribution ? <p className="mt-3 font-mono text-[9.5px] text-[var(--muted-2)]">Unattributed ICPs {attribution.unattributedIcpCount}</p> : !loading ? <p className="mt-2 text-[10.5px] text-[var(--muted-2)]">Validator attribution is unavailable for this result.</p> : null}</div>
}

function IcpList({ title, icpSetDate, icps, scores, scoringAttribution = null, companyDiagnostics = null }: { title: string; icpSetDate: string; icps: CompetitionIcp[]; scores: Map<number, number>; scoringAttribution?: CompetitionScoringAttribution | null; companyDiagnostics?: CompetitionCompanyDiagnostic[] | null }) {
  const attributionByPosition = new Map(scoringAttribution?.icps.map((item) => [item.icpPosition, item]))
  return <div><div className="mb-1 flex flex-wrap items-center justify-between gap-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--muted-2)]"><span>{title}</span><span>ICP set · {formatUtcDate(icpSetDate)}</span></div><p className="mb-3 text-[11px] text-[var(--muted-2)]">All {icps.length} ICPs are public for this round.</p><div className="overflow-hidden rounded-md border border-[var(--line)]">{icps.map((icp) => { const attribution = attributionByPosition.get(icp.position); return <details key={`${icp.position}-${icp.id}`} className="group border-b border-[var(--line)] last:border-b-0"><summary className="grid cursor-pointer list-none grid-cols-[36px_minmax(0,1fr)_52px_16px] items-center gap-2 px-3 py-3 focus:outline-none focus-visible:bg-[rgba(236,234,230,0.04)] [&::-webkit-details-marker]:hidden"><span className="font-mono text-[10px] text-[var(--muted-2)]">{String(icp.position + 1).padStart(2, '0')}</span><span className="truncate text-[12px] text-[var(--platinum)]">{icp.prompt}</span><span className="text-right font-mono text-[11px] text-[var(--white)]">{formatCompetitionScore(scores.get(icp.position) ?? null)}</span><span aria-hidden className="font-mono text-[11px] text-[var(--muted-2)] transition-transform group-open:rotate-45">+</span></summary><div className="border-t border-[var(--line)] bg-[#090909] px-4 py-4"><dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2"><IcpDetail label="Industry" value={[icp.industry, icp.subIndustry].filter(Boolean).join(' · ')} /><IcpDetail label="Geography" value={icp.geography ?? icp.country} /><IcpDetail label="Company size" value={icp.employeeCount.join(', ')} /><IcpDetail label="Company stage" value={icp.companyStage} /><IcpDetail label="Product or service" value={icp.productService} /><IcpDetail label="Required attribute" value={icp.requiredAttribute} /><IcpDetail label={icp.intentCategory ? `Intent · ${humanize(icp.intentCategory)}` : 'Intent'} value={icp.intentSignal} wide /><IcpScoringAttribution attributionAvailable={scoringAttribution !== null} attribution={attribution} /></dl><CompanyDiagnostics rows={companyDiagnostics?.filter((row) => row.icpPosition === icp.position) ?? null} /></div></details> })}</div></div>
}

function IcpDetail({ label, value, wide = false }: { label: string; value: string | null; wide?: boolean }) { if (!value) return null; return <div className={wide ? 'sm:col-span-2' : ''}><dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--muted-2)]">{label}</dt><dd className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted)]">{value}</dd></div> }

function CompanyDiagnostics({ rows }: { rows: CompetitionCompanyDiagnostic[] | null }) {
  return <div className="mt-5 border-t border-[var(--line)] pt-4">
    <h4 className="text-[12px] text-[var(--platinum)]">Company checks</h4>
    <p className="mt-1 text-[11px] text-[var(--muted-2)]">Recorded evaluation results. Later checks can be skipped after an earlier failure.</p>
    {rows === null ? <p className="mt-2 text-[11px] text-[var(--muted)]">Company checks are unavailable.</p>
      : rows.length === 0 ? <p className="mt-2 text-[11px] text-[var(--muted)]">No company checks were recorded for this ICP.</p>
      : rows.map((row) => <details key={row.companyIndex} className="mt-3 rounded border border-[var(--line)] px-3 py-2">
        <summary className="cursor-pointer text-[12px] text-[var(--platinum)]">{row.companyName} · {row.qualified ? 'Qualified' : 'Not qualified'}{row.missingContact ? ' · Missing contact' : ''}{row.duplicateCompany ? ' · Duplicate company' : ''}</summary>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">{(Object.keys(COMPANY_CHECK_LABELS) as Array<keyof typeof COMPANY_CHECK_LABELS>).map((name) => <div key={name} className="flex justify-between gap-3 text-[11px]"><dt className="text-[var(--muted-2)]">{COMPANY_CHECK_LABELS[name]}</dt><dd className="text-[var(--muted)]">{COMPANY_CHECK_STATUS_LABELS[row.checks[name]]}</dd></div>)}</dl>
        {row.contactFailure ? <p className="mt-2 text-[11px] text-[var(--muted)]">Contact check stopped at: {row.contactFailure}.</p> : null}
      </details>)}
  </div>
}

function IcpScoringAttribution({ attributionAvailable, attribution }: { attributionAvailable: boolean; attribution: CompetitionScoringAttribution['icps'][number] | undefined }) {
  const state = attributionAvailable ? attribution ? null : 'Not judged' : 'Unavailable'
  return <><div><dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--muted-2)]">Scored by</dt><dd className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted)]">{state ?? (attribution?.validatorHotkeys.length ? <span className="space-y-1">{attribution.validatorHotkeys.map((hotkey) => <span key={hotkey} className="block break-all font-mono text-[10px]">{hotkey}</span>)}</span> : 'Unavailable')}</dd></div><IcpDetail label="Reused judgment" value={state ?? (attribution?.reusedJudgment ? 'Yes' : 'No')} /></>
}

function SourcePanel({ submission, cancelled, code, codeState, selectedFile, onSelectFile, onRequest }: { submission: CompetitionSubmission; cancelled: boolean; code: CompetitionCode | null; codeState: ReleaseState; selectedFile: CompetitionCode['files'][number] | null; onSelectFile: (path: string) => void; onRequest: () => void }) {
  if (isCompetitionReviewExcluded(submission)) return <aside><h3 className="font-display text-[19px] font-medium text-[var(--platinum)]">Source code</h3><div className="mt-4"><InlineNotice>Source was not published because this submission was not evaluated.</InlineNotice></div></aside>
  if (cancelled && !submission.code.available) return <aside><h3 className="font-display text-[19px] font-medium text-[var(--platinum)]">Source code</h3><div className="mt-4"><InlineNotice>This round was cancelled. Source code was not published.</InlineNotice></div></aside>
  const availableAt = submission.code.availableAt ? formatUtc(submission.code.availableAt) : null
  return <aside><h3 className="font-display text-[19px] font-medium text-[var(--platinum)]">Source code</h3><p className="mt-2 text-[12px] leading-relaxed text-[var(--muted-2)]">Submitted code is frozen for this round. Released files are read-only.</p>
    {codeState === 'idle' ? <div className="mt-4"><button type="button" disabled={!submission.code.available} onClick={onRequest} className="rounded-md border border-[var(--line-3)] px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.11em] text-[var(--platinum)] transition-colors hover:text-[var(--white)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-45">{submission.code.available ? 'View released source' : 'Source locked'}</button>{!submission.code.available ? <p className="mt-2 font-mono text-[9.5px] text-[var(--muted-2)]">{availableAt ? `Available ${availableAt}` : 'Awaiting source release'}</p> : null}</div> : null}
    {codeState === 'loading' ? <div className="mt-4 h-20 shimmer rounded-md" /> : null}{codeState === 'gated' ? <div className="mt-4"><InlineNotice>Source is not public yet. Release follows this round’s schedule.</InlineNotice></div> : null}{codeState === 'error' ? <div className="mt-4"><InlineNotice>Released source is temporarily unavailable.</InlineNotice></div> : null}
    {codeState === 'available' && code ? <div className="mt-4 overflow-hidden rounded-md border border-[var(--line)]"><div className="max-h-36 overflow-y-auto border-b border-[var(--line)] bg-[#090909] p-1.5">{code.files.map((file) => <button key={file.path} type="button" onClick={() => onSelectFile(file.path)} className={`block w-full truncate rounded px-2 py-1.5 text-left font-mono text-[10px] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--brand)] ${file.path === selectedFile?.path ? 'bg-[rgba(236,234,230,0.07)] text-[var(--white)]' : 'text-[var(--muted-2)] hover:text-[var(--platinum)]'}`} title={file.path}>{file.path}</button>)}</div>{selectedFile ? <pre className="max-h-[420px] overflow-auto bg-[#070707] p-3 text-[10px] leading-[1.65] text-[var(--muted)]"><code>{selectedFile.content}</code></pre> : <p className="p-3 text-[11px] text-[var(--muted-2)]">No text files were released.</p>}{code.truncated ? <p className="border-t border-[var(--line)] px-3 py-2 text-[10px] text-[var(--muted-2)]">Some files are omitted from this preview.</p> : null}</div> : null}
  </aside>
}

function InlineNotice({ children }: { children: ReactNode }) { return <p className="rounded-md border border-[var(--line)] bg-[#0a0a0a] px-4 py-4 text-[12px] leading-relaxed text-[var(--muted-2)]">{children}</p> }

function formatIcpCount(count: number): string {
  return `${count} ICP${count === 1 ? '' : 's'}`
}

async function fetchJson(url: string): Promise<unknown> { const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } }); if (!response.ok) throw new Error(`Request failed (${response.status})`); return response.json() }
async function fetchReleasedJson(url: string): Promise<{ state: 'available'; body: unknown } | { state: 'gated'; body: null }> { const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } }); if (response.status === 403) return { state: 'gated', body: null }; if (!response.ok) throw new Error(`Request failed (${response.status})`); return { state: 'available', body: await response.json() } }
function championMetricDetail(round: CompetitionRoundSummary, championScore: number | null): string {
  if (round.promotionStatus === 'promoted') return `Becomes next baseline · ${formatCompetitionScore(championScore)}`
  if (round.promotionStatus === 'pending') return `Promotion pending · ${formatCompetitionScore(championScore)}`
  return `${humanize(round.champion?.outcome ?? 'champion')} · ${formatCompetitionScore(championScore)}`
}
function roundStatusLabel(value: string): string { if (value === 'published') return 'Published result'; if (value === 'cancelled') return 'Cancelled round'; if (value === 'open') return 'Open for submissions'; if (['committed', 'stage1', 'stage1_scored', 'stage2'].includes(value)) return 'Scoring'; if (value === 'scored') return 'Publishing results'; return humanize(value) }
function humanize(value: string): string { const normalized = value.trim().replaceAll('_', ' '); return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : 'Unavailable' }
function shortId(value: string): string { return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-6)}` : value }
function shortHotkey(value: string): string { return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-6)}` : value }
function formatUtc(value: string): string { const date = new Date(value); return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC` : value }
function formatUtcDate(value: string | null): string { if (!value) return 'Date unavailable'; const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) ? `${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date)} · UTC` : value }
function utcCalendarDate(value: string | null): string | null { if (!value) return null; const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null }
function isNextUtcDay(start: string | null, end: string | null): boolean { if (!start || !end) return false; const startDate = new Date(`${start}T00:00:00Z`); const endDate = new Date(`${end}T00:00:00Z`); return endDate.getTime() - startDate.getTime() === 86_400_000 }
function errorMessage(value: unknown, fallback: string): string { return value instanceof Error ? value.message : fallback }
