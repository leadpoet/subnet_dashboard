'use client'

import { Fragment, createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useVisiblePolling } from '@/lib/hooks/useVisiblePolling'
import {
  COMPANY_CHECK_LABELS,
  COMPANY_CHECK_STATUS_LABELS,
  type CompetitionCompanyDiagnostic,
  competitionSubmissionEvaluationNotice,
  competitionSubmissionStatusLabel,
  competitionRoundOptions,
  competitionChampionHistory,
  type CompetitionScoreHistoryPoint,
  formatCompetitionScore,
  currentChampionRound,
  normalizeCompetitionBenchmark,
  normalizeCompetitionCode,
  normalizeCompetitionResults,
  normalizeCompetitionSnapshot,
  normalizeCompetitionHistory,
  type CompetitionHistoryPage,
  normalizeCompetitionSubmissions,
  normalizeValidatorNames,
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
const ValidatorNamesContext = createContext<Record<string, string>>({})

export function ResearchLab({
  onSync,
  active = true,
}: { onSync?: () => void; active?: boolean } = {}) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [competition, setCompetition] = useState<CompetitionSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [validatorNames, setValidatorNames] = useState<Record<string, string>>({})
  const refreshValidatorNames = useCallback(async () => {
    try { setValidatorNames(normalizeValidatorNames(await fetchJson('/api/metagraph'))) }
    catch { setValidatorNames({}) }
  }, [])
  useVisiblePolling(refreshValidatorNames, 300_000, { enabled: active })

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
  const championRound = competition ? currentChampionRound(competition) : null
  return (
    <ValidatorNamesContext.Provider value={validatorNames}><div className="w-full pb-12">
      <CompetitionHeader historyOpen={historyOpen} onHistory={() => setHistoryOpen((open) => !open)} />
      {historyOpen ? <CompetitionHistory active={active} /> : !competition ? <Unavailable message="Competition data is temporarily unavailable. This page will retry automatically." /> : selectedRound ? <><ChampionSummary round={championRound} history={competitionChampionHistory(competition)} /><RoundSummary round={selectedRound} /><RoundWorkspace round={selectedRound} active={active} /></> : <p className="border-b border-[var(--line)] py-12 text-[14px] text-[var(--muted)]">No production competition round is available.</p>}
      {error && competition ? <p className="mt-5 text-[12px] text-[var(--muted-2)]">Latest refresh failed: {error}</p> : null}
    </div></ValidatorNamesContext.Provider>
  )
}

function ResearchLabLoading() {
  return <div aria-busy="true" aria-label="Loading competition"><CompetitionHeader />
    <section aria-label="Current champion" className="grid min-w-0 gap-8 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:gap-12 md:p-8">
      <div className="flex flex-col justify-center"><h2 className="text-[13px] text-[var(--muted)]">Current champion</h2><div className="mt-4 h-[88px] w-48 shimmer rounded-md" /><div className="mt-5 h-4 w-56 shimmer rounded" /><div className="mt-2 h-3 w-36 shimmer rounded" /></div>
      <div><div className="text-[13px] text-[var(--platinum)]">Champion history <span className="text-[11px] text-[var(--muted-2)]">/100</span></div><div className="mt-3 h-[180px] shimmer rounded-md" /><div className="mt-2 h-3 w-36 shimmer rounded" /></div>
    </section>
    <section className="mt-8 border-y border-[var(--line)] py-5"><div className="grid gap-5 sm:grid-cols-[1fr_2fr]"><div className="h-12 w-32 shimmer rounded" /><div className="grid grid-cols-2 gap-5"><div className="h-12 shimmer rounded" /><div className="h-12 shimmer rounded" /></div></div><div className="mt-5 h-4 w-24 shimmer rounded" /></section>
    <section className="pt-10"><h3 className="font-display text-[22px] text-[var(--platinum)]">Submissions</h3><div className="my-5 h-10 shimmer rounded-md" /><SubmissionRowsLoading /></section>
  </div>
}

function SubmissionRowsLoading() {
  return <div aria-label="Loading submissions" role="status" className="overflow-hidden rounded-lg border border-[var(--line)]"><div className="h-10 bg-[var(--surface)]" />{[0, 1, 2, 3, 4].map((row) => <div key={row} className="grid grid-cols-[2fr_2fr_1fr] gap-5 border-t border-[var(--line)] px-4 py-4"><div className="h-4 shimmer rounded" /><div className="h-4 shimmer rounded" /><div className="h-4 shimmer rounded" /></div>)}</div>
}

function Unavailable({ message }: { message: string }) {
  return <p role="status" className="border-b border-[var(--line)] py-10 text-[14px] leading-relaxed text-[var(--muted)]">{message}</p>
}

function CompetitionHeader({ historyOpen = false, onHistory }: { historyOpen?: boolean; onHistory?: () => void }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-5 py-7 md:py-9">
      <div>
        <h1 className="font-display text-[28px] font-medium tracking-[-0.04em] text-[var(--white)] md:text-[36px]">{historyOpen ? 'Competition history' : 'Agent competition'}</h1>
        <p className="mt-2 text-[13px] text-[var(--muted)]">Open-source sales intelligence.</p>
      </div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={onHistory} disabled={!onHistory} aria-pressed={historyOpen} className="rounded-md border border-[var(--line-2)] px-4 py-2.5 text-[12px] text-[var(--platinum)] transition-colors hover:bg-white/5 disabled:opacity-50">{historyOpen ? 'Back to competition' : 'History'}</button><a href="https://github.com/leadpoet/champion_model" target="_blank" rel="noreferrer" className="inline-flex items-center gap-3 rounded-md border border-[var(--line-2)] px-4 py-2.5 text-[12px] text-[var(--platinum)] transition-colors hover:bg-white/5">Top Sales Agent Model <span aria-hidden>↗</span></a></div>
    </header>
  )
}

function ChampionSummary({ round, history = [] }: { round: CompetitionRoundSummary | null; history?: CompetitionScoreHistoryPoint[] }) {
  const champion = round?.champion
  return (
    <section aria-label="Current champion" className="grid min-w-0 gap-8 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:gap-12 md:p-8">
      <div className="flex min-w-0 flex-col justify-center">
        <h2 className="text-[13px] text-[var(--muted)]">Current champion</h2>
        <div className="mt-4 font-display text-[clamp(64px,7vw,88px)] font-medium leading-none tracking-[-0.06em] text-[var(--white)]">
          {formatCompetitionScore(champion?.finalScore ?? null)}<span className="ml-3 text-[22px] tracking-normal text-[var(--muted-2)]">/100</span>
        </div>
        {round && champion ? <div className="mt-5 space-y-1.5 text-[12px] text-[var(--muted)]">
          <p>Winning score · {formatUtcDate(round.evaluationDate)}</p>
          <p className="font-mono text-[11px] text-[var(--muted-2)]" title={champion.minerHotkey}>{shortHotkey(champion.minerHotkey)}</p>
          {champion.finalScore === null ? <p>Champion score unavailable.</p> : null}
        </div> : <p className="mt-5 text-[12px] text-[var(--muted)]">No promoted champion in published history.</p>}
      </div>
      <ChampionScoreHistory points={history} />
    </section>
  )
}

function RoundSummary({ round }: { round: CompetitionRoundSummary }) {
  const baselineScore = round.baseline?.finalScore ?? null
  const evaluationComplete = round.status === 'published'
  return (
    <section aria-label="Current round" className="mt-8 border-y border-[var(--line)]">
      <div className="grid gap-5 py-5 sm:grid-cols-[1fr_2fr] sm:gap-8">
        <div>
          <div className="text-[12px] text-[var(--muted)]">Current round</div>
          <div className="mt-2 flex items-center gap-2 text-[14px] text-[var(--platinum)]"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--white)]" />{roundStatusLabel(round.status)}</div>
        </div>
        <CompetitionSchedule round={round} />
      </div>
      <details className="group border-t border-[var(--line)]">
        <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-[12px] text-[var(--muted)] transition-colors hover:text-[var(--white)] [&::-webkit-details-marker]:hidden">Round details<span aria-hidden className="text-[16px] transition-transform group-open:rotate-45">+</span></summary>
        <div className="grid gap-5 pb-5 text-[12px] leading-relaxed text-[var(--muted)] sm:grid-cols-2">
          <div className="space-y-2">
            <p>Baseline score · <span className="font-mono text-[var(--platinum)]">{baselineScore === null ? 'Awaiting score' : formatCompetitionScore(baselineScore)}</span></p>
            <p>{baselineScore === null ? 'Available after evaluation and cost checks.' : evaluationComplete ? `${round.publishedAt ? `Published ${formatUtc(round.publishedAt)}` : 'Published result'}` : round.status === 'scored' ? 'Evaluations complete. Publication pending.' : 'Baseline evaluated. Round still in progress.'}</p>
            <p>Promotion margin · +{formatCompetitionScore(round.promotionMargin)} points above baseline</p>
            {round.submissionCutoff ? <p>Submissions close · {formatUtc(round.submissionCutoff)}</p> : null}
            {round.publicAt ? <p>ICPs publish · {formatUtc(round.publicAt)}. Scores follow evaluation.</p> : null}
          </div>
          <div className="space-y-2">
            {round.champion ? <><p className="text-[var(--platinum)]">Champion · {shortHotkey(round.champion.minerHotkey)}</p><p>{championMetricDetail(round, round.champion.finalScore)}</p></>
              : round.cancelReason ? <p>No champion was published · {humanize(round.cancelReason)}</p>
                : <><p>Promotion · {evaluationComplete ? humanize(round.promotionStatus ?? 'not required') : 'Pending'}</p><p>{evaluationComplete ? 'No champion was published' : 'Decision follows completed evaluation'}</p></>}
            {round.champion && round.promotionStatus === 'superseded' ? <p>This round’s champion was not promoted because a newer evaluation day was published.</p> : null}
            <p className="font-mono text-[11px] text-[var(--muted-2)]">{round.roundId} · {round.benchmarkIcpCount} ICPs</p>
          </div>
        </div>
      </details>
    </section>
  )
}

function ChampionScoreHistory({ points }: { points: CompetitionScoreHistoryPoint[] }) {
  const publishedScores = points.filter((point) => point.score !== null)
  const maxScore = Math.max(0, ...publishedScores.map((point) => point.score ?? 0))
  const upperBound = Math.max(5, Math.ceil((maxScore + Math.max(1, maxScore / 10)) / 5) * 5)
  const ticks = [0, upperBound / 2, upperBound]
  return <div className="min-w-0" role="region" aria-label="Champion score history">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h4 className="text-[13px] text-[var(--platinum)]">Champion history <span className="text-[11px] text-[var(--muted-2)]">/100</span></h4>
      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--muted-2)]">Past competitions</span>
    </div>
    {publishedScores.length ? <>
      <div className="mt-3 h-[180px] w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={points} accessibilityLayer margin={{ top: 8, right: 9, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 5" />
            <XAxis dataKey="timestamp" type="number" scale="time" domain={points.length === 1 ? [points[0].timestamp - 43_200_000, points[0].timestamp + 43_200_000] : ['dataMin', 'dataMax']} ticks={historyTicks(points)} tickFormatter={formatHistoryDate} stroke="var(--line)" tick={{ fill: 'var(--muted-2)', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={25} tickMargin={10} />
            <YAxis domain={[0, upperBound]} ticks={ticks} tick={{ fill: 'var(--muted-2)', fontSize: 10 }} tickLine={false} axisLine={false} width={30} tickMargin={8} />
            <Tooltip content={<ScoreHistoryTooltip />} cursor={{ stroke: 'var(--line-3)', strokeDasharray: '3 3' }} />
            <Line type="linear" dataKey="score" name="Champion score" stroke="var(--brand)" strokeWidth={2} connectNulls dot={{ r: 3, strokeWidth: 0, fill: 'var(--brand)' }} activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[10px] text-[var(--muted-2)]">{publishedScores.length === 1 ? 'First published champion' : `${formatHistoryDate(points[0].timestamp)} – ${formatHistoryDate(points[points.length - 1].timestamp)} · UTC`}</p>
    </> : <div className="mt-3 flex h-[180px] items-center justify-center rounded-md border border-dashed border-[var(--line)] text-[12px] text-[var(--muted-2)]">No champion scores yet.</div>}
  </div>
}

function ScoreHistoryTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: CompetitionScoreHistoryPoint }> }) {
  const point = payload?.[0]?.payload
  if (!active || !point || point.score === null) return null
  return <div className="rounded-md border border-[var(--line-3)] bg-[#101010] px-3 py-2 text-[11px] shadow-lg"><div className="text-[var(--muted)]">Evaluation · {formatUtcDate(point.evaluationDate)}</div><div className="mt-1 font-mono text-[var(--platinum)]">Champion {formatCompetitionScore(point.score)} /100</div>{point.promotionStatus && point.promotionStatus !== 'promoted' ? <div className="mt-1 text-[var(--muted)]">{humanize(point.promotionStatus)}</div> : null}</div>
}

function historyTicks(points: CompetitionScoreHistoryPoint[]): number[] {
  if (points.length <= 1) return points.map((point) => point.timestamp)
  return [...new Set([points[0].timestamp, points[Math.floor((points.length - 1) / 2)].timestamp, points[points.length - 1].timestamp])]
}

function formatHistoryDate(value: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value))
}

function CompetitionSchedule({ round }: { round: CompetitionRoundSummary }) {
  if (!round.icpSetDate && !round.evaluationDate && !round.publicAt) return null
  const submissionDate = utcCalendarDate(round.submissionOpen) ?? round.icpSetDate
  return <div className="grid grid-cols-2 gap-4">
    <div><div className="text-[12px] text-[var(--muted)]">Submission day</div><div className="mt-2 text-[13px] text-[var(--platinum)]">{formatDay(submissionDate)}</div></div>
    <div><div className="text-[12px] text-[var(--muted)]">Evaluation day</div><div className="mt-2 text-[13px] text-[var(--platinum)]">{formatDay(round.evaluationDate)}</div></div>
  </div>
}

function RoundWorkspace({ round, active, initialSubmissionId = null, inspectionOnly = false }: { round: CompetitionRoundSummary; active: boolean; initialSubmissionId?: string | null; inspectionOnly?: boolean }) {
  // Summary polling returns a new object each time. Depend on the validation
  // fields so an unchanged round does not restart detail polling or results.
  const { roundId, icpSetDate, publicAt, benchmarkIcpCount } = round
  const [submissions, setSubmissions] = useState<CompetitionSubmission[]>([])
  const [benchmark, setBenchmark] = useState<CompetitionBenchmark | null>(null)
  const [benchmarkState, setBenchmarkState] = useState<ReleaseState>('loading')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(initialSubmissionId)
  const [inspectionOpen, setInspectionOpen] = useState(inspectionOnly)
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
    setInspectionOpen(inspectionOnly)
    setPage(0)
    setRoundLoading(true); setRoundError(null); setBenchmark(null); setBenchmarkState('loading'); setSubmissions([]); selectSubmission(initialSubmissionId)
    return () => { roundRequestRef.current += 1 }
  }, [roundId, selectSubmission, initialSubmissionId, inspectionOnly])

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
      selectSubmission(inspectionOnly ? initialSubmissionId : current && next.some((submission) => submission.submissionId === current)
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
  }, [roundId, icpSetDate, publicAt, benchmarkIcpCount, selectSubmission, inspectionOnly, initialSubmissionId])

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

  const filtered = filterSubmissions(submissions, query, statusFilter)
  const pageCount = Math.max(1, Math.ceil(filtered.length / 15))
  const currentPage = Math.min(page, pageCount - 1)
  const inspection = selectedSubmission ? <div className="p-4 sm:p-6" aria-label="Submission evaluation">
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h4 className="text-[14px] text-[var(--white)]">Agent evaluation</h4><p className="mt-1 text-[12px] text-[var(--muted)]">{formatDay(round.evaluationDate)}</p><p className="mt-2 break-all font-mono text-[10px] text-[var(--muted-2)]">Submission · {selectedSubmission.submissionId}</p><p className="mt-1 break-all font-mono text-[10px] text-[var(--muted-2)]">Miner hotkey · {selectedSubmission.minerHotkey}</p></div><button type="button" onClick={() => { setInspectionOpen(false); document.getElementById(`evaluation-toggle-${selectedSubmission.submissionId}`)?.focus() }} className={`${inspectionOnly ? 'hidden' : ''} rounded border border-[var(--line-2)] px-3 py-1.5 text-[11px] text-[var(--muted)]`}>Close evaluation</button></div>
    <div className="mb-4 text-[11px] text-[var(--muted)]"><SubmissionStatus submission={selectedSubmission} round={round} /></div>
    <EvaluationRunSummary submission={selectedSubmission} />
    <div className="grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1.5fr)_minmax(260px,0.5fr)]"><PublishedResults benchmark={benchmark} benchmarkState={benchmarkState} results={results} resultsState={resultsState} round={round} submission={selectedSubmission} /><SourcePanel submission={selectedSubmission} cancelled={round.status === 'cancelled'} code={code} codeState={codeState} selectedFile={selectedCodeFile} onSelectFile={setSelectedFile} onRequest={() => void requestCode()} /></div>
  </div> : null
  if (inspectionOnly) return roundLoading ? <div className="p-5"><SubmissionRowsLoading /></div> : inspection ?? <InlineNotice>{roundError ?? 'Submission details are unavailable.'}</InlineNotice>
  return <section className="pt-10" aria-label="Current submissions">
    <div className="mb-5 flex items-end justify-between gap-4"><div><h3 className="font-display text-[22px] font-medium tracking-[-0.025em] text-[var(--platinum)]">Submissions</h3><p className="mt-1 text-[12px] text-[var(--muted-2)]">{formatDay(round.evaluationDate)}</p></div><span className="font-mono text-[10px] text-[var(--muted-2)]">{submissions.length} total</span></div>
    <div className="mb-4 flex flex-col gap-3 sm:flex-row"><label className="flex-1"><span className="sr-only">Find your miner</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} placeholder="Search miner hotkey or submission" className={filterClass} /></label><label><span className="sr-only">Submission status</span><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(0) }} className={filterClass}><option value="all">All statuses</option><option value="evaluating">Evaluating</option><option value="queued">Queued</option><option value="retrying">Retrying</option><option value="failed">Failed</option><option value="review">Code review</option><option value="rejected">Review rejected</option><option value="scored">Completed</option></select></label></div>
    {roundError ? <div className="mb-3"><InlineNotice>{roundError} Last known submissions are shown below.</InlineNotice></div> : null}
    {roundLoading ? <SubmissionRowsLoading /> : filtered.length ? <><SubmissionTable submissions={filtered.slice(currentPage * 15, (currentPage + 1) * 15)} round={round} selectedId={inspectionOpen ? selectedSubmissionId : null} expandedContent={inspectionOpen ? inspection : null} onSelect={(id) => { selectSubmission(id); setInspectionOpen(id !== selectedSubmissionId || !inspectionOpen) }} /><Pagination page={currentPage} hasNext={currentPage + 1 < pageCount} onPrevious={() => setPage(currentPage - 1)} onNext={() => setPage(currentPage + 1)} label={`${filtered.length} ${query || statusFilter !== 'all' ? 'matches' : 'submissions'}`} /></> : <InlineNotice>{submissions.length ? 'No miners match these filters.' : 'No submissions are public for this round.'}</InlineNotice>}
  </section>
}

// Stretch the native button over its row, preserving keyboard and table semantics.
const evaluationRowButtonClass = 'text-left after:absolute after:inset-0 after:cursor-pointer focus-visible:outline-none focus-visible:after:ring-1 focus-visible:after:ring-inset focus-visible:after:ring-[var(--platinum)]'

const filterClass = 'h-10 w-full rounded-md border border-[var(--line-2)] bg-[var(--surface)] px-3 text-[12px] text-[var(--platinum)] placeholder:text-[var(--muted-2)]'

function filterSubmissions(submissions: CompetitionSubmission[], query: string, status: string) {
  const needle = query.trim().toLowerCase()
  return submissions.filter((submission) => {
    if (needle && !`${submission.minerHotkey} ${submission.submissionId}`.toLowerCase().includes(needle)) return false
    if (status === 'evaluating') return submission.evaluation?.state === 'evaluating'
    if (status === 'queued') return submission.evaluation?.state === 'queued' || ['accepted', 'queued'].includes(submission.status)
    if (status === 'retrying') return isSubmissionRetrying(submission)
    if (status === 'failed') return submission.evaluation?.state === 'failed' || ['scoring_failed', 'review_failed', 'review_rejected'].includes(submission.status)
    if (status === 'rejected') return submission.status === 'review_rejected'
    if (status === 'review') return submission.status === 'review_failed' || ['pending', 'running', 'in_progress', 'error'].includes(submission.codeReview.status ?? '')
    if (status === 'scored') return submission.evaluation?.state === 'completed' || ['scored', 'champion'].includes(submission.status)
    return true
  }).sort((left, right) => Number(right.isBaseline) - Number(left.isBaseline))
}

function isSubmissionRetrying(submission: CompetitionSubmission) {
  return ['scoring', 'queued', 'accepted'].includes(submission.status) && (submission.evaluation?.state === 'retrying'
    || (submission.evaluation?.counts?.retrying ?? 0) > 0
    || (submission.codeReview.status === 'error' && submission.codeReview.retryable === true))
}

function EvaluationRunSummary({ submission }: { submission: CompetitionSubmission }) {
  const evaluation = submission.evaluation
  const versions = evaluation?.codeVersions
  if (!evaluation && !['scoring', 'scoring_failed', 'scored', 'champion'].includes(submission.status)) return null
  return <details className="group mb-6 border-y border-[var(--line)]">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 text-[12px] text-[var(--muted)] [&::-webkit-details-marker]:hidden"><span>Evaluation run versions</span><span aria-hidden className="transition-transform group-open:rotate-45">+</span></summary>
    <div className="space-y-3 pb-4 text-[11px] text-[var(--muted)]">{evaluation?.counts ? <p>Tasks · {evaluation.counts.queued} queued · {evaluation.counts.active} active · {evaluation.counts.completed} completed · {evaluation.counts.failed} failed · {evaluation.counts.retrying} retrying</p> : null}
      <p className="text-[var(--muted-2)]">Execution and scoring runs. Accepted scoring attribution below identifies the original judgments, including reused judgments.</p>
      {versions?.length ? versions.map((version, index) => <div key={`${version.validatorHotkey}-${version.phase}-${version.commit}-${index}`}><p>{version.phase === 'executing' ? 'Execution' : 'Scoring'} · <ValidatorIdentity hotkey={version.validatorHotkey} full /></p><div className="mt-1 break-all"><ValidatorCodeVersion commit={version.commit} workingTree={version.workingTree} full /></div></div>) : <p>Evaluation run versions were not recorded.</p>}
    </div>
  </details>
}

function Pagination({ page, hasNext, onPrevious, onNext, label, loading = false }: { page: number; hasNext: boolean; onPrevious: () => void; onNext: () => void; label?: string; loading?: boolean }) {
  return <nav aria-label="Submission pages" className="mt-4 flex items-center justify-between gap-3 text-[11px] text-[var(--muted)]"><span aria-live="polite">{label ? `${label} · ` : ''}Page {page + 1}</span><div className="flex gap-2"><button type="button" disabled={loading || page === 0} onClick={onPrevious} className="rounded border border-[var(--line-2)] px-3 py-2 disabled:opacity-30 hover:bg-white/5">Previous</button><button type="button" disabled={loading || !hasNext} onClick={onNext} className="rounded border border-[var(--line-2)] px-3 py-2 disabled:opacity-30 hover:bg-white/5">Next</button></div></nav>
}

function CompetitionHistory({ active }: { active: boolean }) {
  const [day, setDay] = useState('')
  const [hotkey, setHotkey] = useState('')
  const [filters, setFilters] = useState({ day: '', hotkey: '' })
  const [page, setPage] = useState(0)
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const cursor = cursors[page] ?? null
  const [history, setHistory] = useState<CompetitionHistoryPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const request = useRef(0)
  const refresh = useCallback(async () => {
    const id = ++request.current
    setLoading(true); setError(null)
    const query = new URLSearchParams({ hotkey: filters.hotkey })
    if (cursor) query.set('cursor', cursor)
    if (filters.day) query.set('day', filters.day)
    try {
      const data = normalizeCompetitionHistory(await fetchJson(`/api/research-lab/history?${query}`))
      if (id !== request.current) return
      if (!data) throw new Error('History data is unavailable.')
      setHistory(data)
    } catch (error) { if (id === request.current) { setHistory(null); setError(errorMessage(error, 'History is temporarily unavailable.')) } }
    finally { if (id === request.current) setLoading(false) }
  }, [cursor, filters])
  useEffect(() => { setHistory(null); setSelected(null); return () => { request.current += 1 } }, [page, filters])
  useVisiblePolling(refresh, 300_000, { enabled: active })
  return <section aria-label="Competition history" className="pb-8">
    <form className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); setPage(0); setCursors([null]); setFilters({ day, hotkey: hotkey.trim() }) }}>
      <label className="flex-1"><span className="mb-2 block text-[11px] text-[var(--muted)]">Miner hotkey</span><input type="search" value={hotkey} maxLength={128} pattern="[A-Za-z0-9]*" onChange={(event) => setHotkey(event.target.value)} placeholder="All miners" className={filterClass} /></label>
      <label><span className="mb-2 block text-[11px] text-[var(--muted)]">Evaluation day</span><input type="date" value={day} onChange={(event) => setDay(event.target.value)} className={filterClass} /></label>
      <button type="submit" className="h-10 rounded-md bg-[var(--white)] px-5 text-[12px] font-medium text-black">Search history</button>
      {(day || hotkey || filters.day || filters.hotkey) ? <button type="button" onClick={() => { setDay(''); setHotkey(''); setPage(0); setCursors([null]); setFilters({ day: '', hotkey: '' }) }} className="h-10 px-2 text-[12px] text-[var(--muted)]">Clear</button> : null}
    </form>
    {loading && !history ? <SubmissionRowsLoading /> : error ? <InlineNotice>{error} <button type="button" className="underline" onClick={() => void refresh()}>Retry</button></InlineNotice> : history?.entries.length ? <div className="overflow-x-auto rounded-lg border border-[var(--line)]"><table className="w-full text-left"><thead className="bg-[var(--surface)] text-[11px] text-[var(--muted)]"><tr><th className="px-4 py-3 font-normal" scope="col">Miner</th><th className="px-3 py-3 font-normal" scope="col">Evaluation day</th><th className="px-4 py-3 text-right font-normal" scope="col">Score</th></tr></thead><tbody>{history.entries.map(({ round, submission }) => {
      const key = `${round.roundId}:${submission.submissionId}`
      return <Fragment key={key}><tr className={`relative cursor-pointer border-t border-[var(--line)] transition-colors ${selected === key ? 'bg-white/[0.045]' : 'hover:bg-white/[0.025]'}`}><td className="px-4 py-3"><button type="button" aria-expanded={selected === key} aria-controls={`evaluation-${key}`} onClick={() => setSelected(selected === key ? null : key)} className={evaluationRowButtonClass} title={submission.minerHotkey}><span className="block font-mono text-[11px] text-[var(--platinum)]">{shortHotkey(submission.minerHotkey)}</span><span className="mt-1 block text-[10px] text-[var(--muted)]">{submission.isBaseline ? 'Baseline · ' : submission.isChampion ? 'Champion · ' : ''}{selected === key ? 'Close evaluation −' : 'View evaluation +'}</span></button></td><td className="px-3 py-3 text-[11px] text-[var(--muted)]">{formatDay(round.evaluationDate)}</td><td className="px-4 py-3 text-right font-mono text-[12px] text-[var(--platinum)]">{formatCompetitionScore(submission.finalScore)}</td></tr>{selected === key ? <tr id={`evaluation-${key}`}><td colSpan={3} className="border-t border-[var(--line)] bg-[var(--surface)]"><RoundWorkspace key={key} round={round} active={active} initialSubmissionId={submission.submissionId} inspectionOnly /></td></tr> : null}</Fragment>
    })}</tbody></table></div> : <InlineNotice>{history?.nextCursor ? 'No matches on this page. Continue to earlier rounds or filter by day.' : 'No published submissions match these filters.'}</InlineNotice>}
    <Pagination page={page} hasNext={Boolean(history?.nextCursor)} loading={loading} onPrevious={() => setPage((page) => Math.max(0, page - 1))} onNext={() => { if (history?.nextCursor) { setCursors((items) => [...items.slice(0, page + 1), history.nextCursor]); setPage(page + 1) } }} />
  </section>
}

function SubmissionTable({ submissions, round, selectedId, onSelect, expandedContent }: { submissions: CompetitionSubmission[]; round: CompetitionRoundSummary; selectedId: string | null; onSelect: (submissionId: string) => void; expandedContent?: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--line)]">
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-[var(--surface)] text-[11px] text-[var(--muted)]">
          <tr><th scope="col" className="px-4 py-3 font-normal">Submission</th><th scope="col" className="hidden px-4 py-3 font-normal sm:table-cell">Miner</th><th scope="col" className="px-3 py-3 font-normal">Status</th><th scope="col" className="px-4 py-3 text-right font-normal">Score</th></tr>
        </thead>
        <tbody>{submissions.map((submission) => {
          const selected = submission.submissionId === selectedId
          return <Fragment key={submission.submissionId}><tr className={`relative cursor-pointer border-t border-[var(--line)] transition-colors ${selected ? 'bg-white/[0.045]' : 'hover:bg-white/[0.02]'}`}>
            <td className="p-0">
              <button id={`evaluation-toggle-${submission.submissionId}`} type="button" onClick={() => onSelect(submission.submissionId)} className={`w-full px-4 py-3 ${evaluationRowButtonClass}`} aria-expanded={selected} aria-controls={`submission-${submission.submissionId}`} title={submission.submissionId}>
                <span className="block max-w-[110px] truncate font-mono text-[11px] text-[var(--platinum)] sm:max-w-none">{shortId(submission.submissionId)}</span>
                {submission.isBaseline ? <span className="mt-1 block text-[10px] text-[var(--muted)]">Baseline</span> : null}
                <span className="mt-1 block max-w-[110px] truncate font-mono text-[10px] text-[var(--muted-2)] sm:hidden" title={submission.minerHotkey}>{shortHotkey(submission.minerHotkey)}</span>
              </button>
            </td>
            <td className="hidden px-4 py-3 font-mono text-[11px] text-[var(--muted)] sm:table-cell" title={submission.minerHotkey}>{shortHotkey(submission.minerHotkey)}</td>
            <td className="px-3 py-3 text-[11px] text-[var(--muted)]"><SubmissionStatus submission={submission} round={round} /></td>
            <td className="px-4 py-3 text-right font-mono text-[12px] text-[var(--platinum)]">{formatCompetitionScore(submission.finalScore)}</td>
          </tr>{selected && expandedContent ? <tr id={`submission-${submission.submissionId}`}><td colSpan={4} className="border-t border-[var(--line)] bg-[var(--surface)]">{expandedContent}</td></tr> : null}</Fragment>
        })}</tbody>
      </table>
    </div>
  )
}

function ValidatorIdentity({ hotkey, full = false }: { hotkey: string; full?: boolean }) {
  const names = useContext(ValidatorNamesContext)
  const name = Object.hasOwn(names, hotkey) ? names[hotkey] : null
  return <span title={hotkey} className="break-words">{name ?? (full ? 'Validator' : shortHotkey(hotkey))}{name && !full ? <span className="font-mono"> · {shortHotkey(hotkey)}</span> : null}{full ? <span className="mt-1 block break-all font-mono text-[10px] text-[var(--muted-2)]">{hotkey}</span> : null}</span>
}

function SubmissionStatus({ submission, round }: { submission: CompetitionSubmission; round: CompetitionRoundSummary }) {
  const evaluating = submission.status === 'scoring' && submission.evaluation?.state === 'evaluating'
  const retrying = isSubmissionRetrying(submission) && submission.evaluation?.state === 'evaluating'
  return <div><span className={evaluating ? 'text-[var(--platinum)]' : ''}>{competitionSubmissionStatusLabel(submission, round)}</span>{retrying ? <span className="ml-1">· retrying tasks</span> : null}{evaluating ? <div className="mt-1 space-y-1 text-[10px] text-[var(--muted-2)]">{submission.evaluation?.validators.filter((validator, index, validators) => validators.findIndex((item) => item.hotkey === validator.hotkey && item.phase === validator.phase) === index).map(({ hotkey, phase }) => <div key={`${hotkey}-${phase}`}>{phase === 'scoring' ? 'Scoring' : 'Running'} · <ValidatorIdentity hotkey={hotkey} /></div>)}</div> : null}</div>
}

function ValidatorCodeVersion({ commit, workingTree, full = false }: { commit: string | null; workingTree: 'clean' | 'dirty' | 'unknown'; full?: boolean }) {
  return <span>{commit ? <a href={`https://github.com/leadpoet/leadpoet/commit/${commit}`} target="_blank" rel="noreferrer" className="relative z-10 font-mono text-[var(--platinum)] underline underline-offset-4" title={commit}>{full ? commit : commit.slice(0, 12)}</a> : 'Commit not recorded'}{commit ? ` · ${workingTree === 'dirty' ? 'local modifications' : workingTree === 'clean' ? 'clean checkout' : 'checkout state unknown'}` : ''}</span>
}

function PublishedResults({ benchmark, benchmarkState, results, resultsState, round, submission }: { benchmark: CompetitionBenchmark | null; benchmarkState: ReleaseState; results: CompetitionSubmissionResults | null; resultsState: ReleaseState; round: CompetitionRoundSummary; submission: CompetitionSubmission }) {
  const evaluationNotice = competitionSubmissionEvaluationNotice(submission, round)
  const attributionSummary = <ScoringAttributionSummary attribution={results?.scoringAttribution ?? null} loading={resultsState === 'loading'} />
  if (isCompetitionReviewExcluded(submission)) return <ResultFrame><InlineNotice>{evaluationNotice}</InlineNotice>{benchmarkState === 'available' && benchmark ? <div className="mt-5"><IcpList title={`Public ICPs (${benchmark.benchmarkIcpCount})`} icpSetDate={benchmark.icpSetDate} icps={benchmark.icps} scores={new Map()} /></div> : null}</ResultFrame>
  if (round.status === 'cancelled' || results?.incomplete) return <ResultFrame><InlineNotice>This round was cancelled. Aggregate and per-ICP scores were not published.</InlineNotice>{benchmarkState === 'available' && benchmark ? <div className="mt-5"><IcpList title={`Public ICPs (${benchmark.benchmarkIcpCount})`} icpSetDate={benchmark.icpSetDate} icps={benchmark.icps} scores={new Map()} /></div> : null}</ResultFrame>
  if (benchmarkState === 'loading') return <ResultFrame>{attributionSummary}<div className="h-24 shimmer rounded-md" /></ResultFrame>
  if (benchmarkState === 'gated') return <ResultFrame>{attributionSummary}<InlineNotice>All {round.benchmarkIcpCount} ICPs become public{round.publicAt ? ` at ${formatUtc(round.publicAt)}` : ' at the scheduled release'}. Each model’s score appears when its evaluation is complete.</InlineNotice></ResultFrame>
  if (!benchmark || benchmarkState === 'error') return <ResultFrame>{attributionSummary}<InlineNotice>Published public-ICP details are temporarily unavailable.</InlineNotice></ResultFrame>
  if (evaluationNotice) return <PendingIcpResults benchmark={benchmark}>{evaluationNotice}</PendingIcpResults>
  if (submission.status === 'scoring_failed') return <PendingIcpResults benchmark={benchmark}>{competitionSubmissionStatusLabel(submission, round)}. No complete evaluation score is available.</PendingIcpResults>
  if ((!submission.isBaseline || round.status !== 'published') && resultsState === 'error') return <PendingIcpResults benchmark={benchmark}>The ICPs are public. Published scores are temporarily unavailable.</PendingIcpResults>
  if ((!submission.isBaseline || round.status !== 'published') && (resultsState === 'loading' || resultsState === 'gated' || !results || results.publicIcpStatus !== 'ready')) return <PendingIcpResults benchmark={benchmark}>This model’s score and diagnostics appear when its evaluation and cost checks are complete.</PendingIcpResults>
  const scores = submission.isBaseline && round.status === 'published'
    ? new Map(benchmark.icps.flatMap((icp) => icp.baselineScore === null ? [] : [[icp.position, icp.baselineScore] as const]))
    : results?.publicScores ?? new Map<number, number>()
  return <ResultFrame><div className="mb-5 flex flex-wrap gap-5 font-mono text-[10.5px] text-[var(--muted-2)]"><span>Score {formatCompetitionScore(results?.finalScore ?? submission.finalScore)}</span><span>{submission.isBaseline ? 'Public baseline' : shortHotkey(submission.minerHotkey)}</span></div><ScoringAttributionSummary attribution={results?.scoringAttribution ?? null} /><IcpList title={`Public ICPs (${benchmark.benchmarkIcpCount})`} icpSetDate={benchmark.icpSetDate} icps={benchmark.icps} scores={scores} scoringAttribution={results?.scoringAttribution ?? null} companyDiagnostics={results?.companyDiagnostics ?? null} /></ResultFrame>
}

function ResultFrame({ children }: { children: ReactNode }) { return <div><h3 className="font-display text-[19px] font-medium text-[var(--platinum)]">Evaluation results</h3><div className="mt-4">{children}</div></div> }

function PendingIcpResults({ benchmark, children }: { benchmark: CompetitionBenchmark; children: ReactNode }) { return <ResultFrame><InlineNotice>{children}</InlineNotice><div className="mt-5"><IcpList title={`Public ICPs (${benchmark.benchmarkIcpCount})`} icpSetDate={benchmark.icpSetDate} icps={benchmark.icps} scores={new Map()} /></div></ResultFrame> }

function ScoringAttributionSummary({ attribution, loading = false }: { attribution: CompetitionScoringAttribution | null; loading?: boolean }) {
  const names = useContext(ValidatorNamesContext)
  return <details className="group mb-5 border-y border-[var(--line)]">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 text-[12px] text-[var(--muted)] [&::-webkit-details-marker]:hidden">
      <span>Scored by <span className="ml-1 text-[var(--platinum)]">{loading ? 'Loading…' : attribution?.validators.length ? attribution.validators.map(({ hotkey }) => Object.hasOwn(names, hotkey) ? `${names[hotkey]} (${shortHotkey(hotkey)})` : shortHotkey(hotkey)).join(', ') : 'Unavailable'}</span></span>
      <span aria-hidden className="transition-transform group-open:rotate-45">+</span>
    </summary>
    <div className="space-y-3 pb-4">{attribution?.validators.map((validator) => {
      const codeVersions = attribution.codeVersions?.filter((version) => version.validatorHotkey === validator.hotkey) ?? []
      const missingCommitCount = Math.max(0, validator.icpCount - new Set(codeVersions.flatMap((version) => version.icpPositions)).size)
      return <div key={validator.hotkey}>
      <div className="text-[12px] leading-relaxed text-[var(--platinum)]"><ValidatorIdentity hotkey={validator.hotkey} full /></div>
      <div className="mt-1 text-[11px] text-[var(--muted)]">{formatIcpCount(validator.icpCount)} · {validator.reusedIcpCount} reused</div>
      <div className="mt-3 space-y-1 text-[11px] text-[var(--muted)]">
        <p className="mb-2 text-[10px] text-[var(--muted-2)]">Validator code commits</p>
        {codeVersions.length ? codeVersions.map((version) => <p className="break-all" key={`${version.commit}-${version.workingTree}`}><ValidatorCodeVersion commit={version.commit} workingTree={version.workingTree} full /> · {formatIcpCount(version.icpPositions.length)}</p>) : <p>Commit not recorded for accepted judgments.</p>}
        {codeVersions.length > 0 && missingCommitCount > 0 ? <p>Commit not recorded for {formatIcpCount(missingCommitCount)}.</p> : null}
      </div>
    </div>})}
    {!loading && attribution ? <p className="text-[11px] text-[var(--muted)]">Unattributed ICPs {attribution.unattributedIcpCount}</p> : <p className="text-[11px] text-[var(--muted)]">{loading ? 'Loading validator attribution…' : 'Validator attribution is unavailable for this result.'}</p>}</div>
  </details>
}

function IcpList({ title, icpSetDate, icps, scores, scoringAttribution = null, companyDiagnostics = null }: { title: string; icpSetDate: string; icps: CompetitionIcp[]; scores: Map<number, number>; scoringAttribution?: CompetitionScoringAttribution | null; companyDiagnostics?: CompetitionCompanyDiagnostic[] | null }) {
  const attributionByPosition = new Map(scoringAttribution?.icps.map((item) => [item.icpPosition, item]))
  return <div><div className="mb-1 flex flex-wrap items-center justify-between gap-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--muted-2)]"><span>{title}</span><span>ICP set · {formatUtcDate(icpSetDate)}</span></div><div className="overflow-hidden rounded-md border border-[var(--line)]">{icps.map((icp) => { const attribution = attributionByPosition.get(icp.position); return <details key={`${icp.position}-${icp.id}`} className="group border-b border-[var(--line)] last:border-b-0"><summary className="grid cursor-pointer list-none grid-cols-[36px_minmax(0,1fr)_52px_16px] items-center gap-2 px-3 py-3 focus:outline-none focus-visible:bg-[rgba(236,234,230,0.04)] [&::-webkit-details-marker]:hidden"><span className="font-mono text-[10px] text-[var(--muted-2)]">{String(icp.position + 1).padStart(2, '0')}</span><span className="truncate text-[12px] text-[var(--platinum)]">{icp.prompt}</span><span className="text-right font-mono text-[11px] text-[var(--white)]">{formatCompetitionScore(scores.get(icp.position) ?? null)}</span><span aria-hidden className="font-mono text-[11px] text-[var(--muted-2)] transition-transform group-open:rotate-45">+</span></summary><div className="border-t border-[var(--line)] bg-[#090909] px-4 py-4"><dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2"><IcpDetail label="Industry" value={[icp.industry, icp.subIndustry].filter(Boolean).join(' · ')} /><IcpDetail label="Geography" value={icp.geography ?? icp.country} /><IcpDetail label="Company size" value={icp.employeeCount.join(', ')} /><IcpDetail label="Company stage" value={icp.companyStage} /><IcpDetail label="Product or service" value={icp.productService} /><IcpDetail label="Required attribute" value={icp.requiredAttribute} /><IcpDetail label={icp.intentCategory ? `Intent · ${humanize(icp.intentCategory)}` : 'Intent'} value={icp.intentSignal} wide /><IcpScoringAttribution attributionAvailable={scoringAttribution !== null} attribution={attribution} /></dl><CompanyDiagnostics rows={companyDiagnostics?.filter((row) => row.icpPosition === icp.position) ?? null} /></div></details> })}</div></div>
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
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">{(Object.keys(COMPANY_CHECK_LABELS) as Array<keyof typeof COMPANY_CHECK_LABELS>).map((name) => { const status = row.checks[name]; return status === undefined ? null : <div key={name} className="flex justify-between gap-3 text-[11px]"><dt className="text-[var(--muted-2)]">{COMPANY_CHECK_LABELS[name]}</dt><dd className="text-[var(--muted)]">{COMPANY_CHECK_STATUS_LABELS[status]}</dd></div> })}</dl>
        {row.contactFailure ? <p className="mt-2 text-[11px] text-[var(--muted)]">Contact check stopped at: {row.contactFailure}.</p> : null}
      </details>)}
  </div>
}

function IcpScoringAttribution({ attributionAvailable, attribution }: { attributionAvailable: boolean; attribution: CompetitionScoringAttribution['icps'][number] | undefined }) {
  const state = attributionAvailable ? attribution ? null : 'Not judged' : 'Unavailable'
  return <><div><dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--muted-2)]">Scored by</dt><dd className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted)]">{state ?? (attribution?.validatorHotkeys.length ? <span className="space-y-1">{attribution.validatorHotkeys.map((hotkey) => <span key={hotkey} className="block"><ValidatorIdentity hotkey={hotkey} full /></span>)}</span> : 'Unavailable')}</dd></div><IcpDetail label="Reused judgment" value={state ?? (attribution?.reusedJudgment ? 'Yes' : 'No')} /></>
}

function SourcePanel({ submission, cancelled, code, codeState, selectedFile, onSelectFile, onRequest }: { submission: CompetitionSubmission; cancelled: boolean; code: CompetitionCode | null; codeState: ReleaseState; selectedFile: CompetitionCode['files'][number] | null; onSelectFile: (path: string) => void; onRequest: () => void }) {
  if (isCompetitionReviewExcluded(submission)) return <aside><h3 className="font-display text-[19px] font-medium text-[var(--platinum)]">Source code</h3><div className="mt-4"><InlineNotice>Source was not published because this submission was not evaluated.</InlineNotice></div></aside>
  if (cancelled && !submission.code.available) return <aside><h3 className="font-display text-[19px] font-medium text-[var(--platinum)]">Source code</h3><div className="mt-4"><InlineNotice>This round was cancelled. Source code was not published.</InlineNotice></div></aside>
  const availableAt = submission.code.availableAt ? formatUtc(submission.code.availableAt) : null
  return <aside><h3 className="font-display text-[19px] font-medium text-[var(--platinum)]">Source code</h3>
    {codeState === 'idle' ? <div className="mt-4"><button type="button" disabled={!submission.code.available} onClick={onRequest} className="rounded-md border border-[var(--line-3)] px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.11em] text-[var(--platinum)] transition-colors hover:text-[var(--white)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-45">{submission.code.available ? 'View source' : 'Source locked'}</button>{!submission.code.available ? <p className="mt-2 font-mono text-[9.5px] text-[var(--muted-2)]">{availableAt ? `Available ${availableAt}` : 'Awaiting source release'}</p> : null}</div> : null}
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
  if (round.promotionStatus === 'superseded') return `Superseded · ${formatCompetitionScore(championScore)}`
  return `${humanize(round.champion?.outcome ?? 'champion')} · ${formatCompetitionScore(championScore)}`
}
function roundStatusLabel(value: string): string { if (value === 'published') return 'Published result'; if (value === 'cancelled') return 'Cancelled round'; if (value === 'open') return 'Open for submissions'; if (['committed', 'stage1', 'stage1_scored', 'stage2'].includes(value)) return 'Scoring'; if (value === 'scored') return 'Publishing results'; return humanize(value) }
function humanize(value: string): string { const normalized = value.trim().replaceAll('_', ' '); return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : 'Unavailable' }
function shortId(value: string): string { return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-6)}` : value }
function shortHotkey(value: string): string { return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-6)}` : value }
function formatUtc(value: string): string { const date = new Date(value); return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC` : value }
function formatDay(value: string | null): string { return formatUtcDate(value).replace(' · UTC', '') }
function formatUtcDate(value: string | null): string { if (!value) return 'Date unavailable'; const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) ? `${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date)} · UTC` : value }
function utcCalendarDate(value: string | null): string | null { if (!value) return null; const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null }
function errorMessage(value: unknown, fallback: string): string { return value instanceof Error ? value.message : fallback }
