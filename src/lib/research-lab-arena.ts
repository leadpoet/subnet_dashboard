export type ResearchLabArenaRound = {
  roundId: string
  status: string
}

export type ResearchLabArenaBaseline = {
  roundId: string
  submissionId: string
  score: number
  rank: number | null
  publishedAt: string | null
}

export type ResearchLabArenaSnapshot = {
  activeRound: ResearchLabArenaRound | null
  publishedBaseline: ResearchLabArenaBaseline | null
}

type JsonRecord = Record<string, unknown>

export function normalizeResearchLabArenaSnapshot(
  currentValue: unknown,
  activeRoundValue: unknown,
  publishedRoundValue: unknown,
): ResearchLabArenaSnapshot {
  const current = record(currentValue)
  const activeRound = record(activeRoundValue)
  const currentRound = record(current?.round)
  const activeRoundId = text(activeRound?.round_id) || text(currentRound?.round_id)
  const activeStatus = text(activeRound?.status) || text(currentRound?.status)
  const publishedRound = record(current?.published_round)
  const publishedRoundId = text(publishedRound?.status) === 'published'
    ? text(publishedRound?.round_id)
    : ''

  return {
    activeRound: activeRoundId && activeStatus
      ? { roundId: activeRoundId, status: activeStatus }
      : null,
    publishedBaseline: normalizePublishedBaseline(publishedRoundValue, publishedRoundId),
  }
}

function normalizePublishedBaseline(value: unknown, expectedRoundId: string): ResearchLabArenaBaseline | null {
  const round = record(value)
  if (
    !round ||
    !expectedRoundId ||
    text(round.status) !== 'published' ||
    text(round.round_id) !== expectedRoundId
  ) return null

  const participants = arrayOfRecords(round.participants)
  const baselines = participants.filter((participant) =>
    participant.is_baseline === true || participant.is_king === true
  )
  if (baselines.length !== 1) return null
  const baseline = baselines[0]
  const submissionId = text(baseline?.submission_id)
  if (!submissionId) return null

  const ranking = arrayOfRecords(round.final_ranking)
  const entry = ranking.find((row) => text(row.submission_id) === submissionId)
  const score = finiteNumber(entry?.final_score)
  if (score === null || score < 0 || score > 100) return null

  const publication = record(round.publication)
  return {
    roundId: text(round.round_id),
    submissionId,
    score,
    rank: nonNegativeInteger(entry?.rank),
    publishedAt: text(publication?.published_at) || null,
  }
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function arrayOfRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record).filter((row): row is JsonRecord => row !== null) : []
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}
