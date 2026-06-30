'use client'

import { useMemo, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'

type IcpDetails = {
  prompt?: string
  company_country?: string | string[]
  company_region?: string
  contact_country?: string | string[]
  contact_region?: string
  country?: string
  geography?: string
  industry?: string | string[]
  sub_industry?: string | string[]
  target_roles?: string[]
  target_role_types?: string[]
  employee_count?: string
  product_service?: string
  target_seniority?: string
  num_leads?: number
}

export type EmissionConsensus = {
  request_id: string
  miner_hotkey: string
  is_winner: boolean
  reward_pct?: number | null
  computed_at?: string
}

export type EmissionRequestMap = Record<
  string,
  {
    icp_details?: IcpDetails | null
    num_leads?: number
    status?: string
  }
>

type AllocationSegment = {
  id: string
  requestId: string
  hotkey: string
  purpose: string
  emissionsPct: number
  heightPct: number
  leadCount: number
  lastComputedAt: string | null
  rank: number
}

type AllocationModel = {
  segments: AllocationSegment[]
  legendSegments: AllocationSegment[]
  totalAllocatedPct: number
  availablePct: number
  overflowPct: number
  availableHeightPct: number
  winnerRows: number
  rewardRows: number
}

interface EmissionAllocationVialProps {
  consensus: EmissionConsensus[]
  requestMap: EmissionRequestMap
  requestIds?: string[]
  onMinerSelect?: (hotkey: string) => void
  compact?: boolean
  className?: string
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === 'string' && x.length > 0).join(', ')
  }
  if (value == null) return ''
  return String(value)
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}...`
}

function truncateHotkey(hotkey: string): string {
  if (hotkey.length <= 12) return hotkey
  return `${hotkey.slice(0, 6)}...${hotkey.slice(-4)}`
}

function formatPct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '0.0'
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function rewardPct(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function purposeForRequest(requestId: string, requestMap: EmissionRequestMap): string {
  const icp = requestMap[requestId]?.icp_details
  const industry = [asText(icp?.industry), asText(icp?.sub_industry)]
    .filter(Boolean)
    .join(' / ')
  const role = Array.isArray(icp?.target_roles)
    ? icp.target_roles.find((x) => typeof x === 'string' && x.length > 0)
    : ''
  const geography =
    asText(icp?.company_country ?? icp?.country) ||
    asText(icp?.company_region ?? icp?.geography) ||
    asText(icp?.contact_country ?? icp?.contact_region)
  const fallback = asText(icp?.prompt) || `Request ${requestId.slice(0, 8)}`
  return [industry || truncate(fallback, 44), role, geography]
    .filter(Boolean)
    .slice(0, 3)
    .join(' - ')
}

function buildAllocationModel(
  consensus: EmissionConsensus[],
  requestMap: EmissionRequestMap,
  requestIds?: string[],
): AllocationModel {
  const visible = requestIds ? new Set(requestIds) : null
  const grouped = new Map<string, Omit<AllocationSegment, 'heightPct' | 'rank'>>()
  let winnerRows = 0
  let rewardRows = 0
  let totalAllocatedPct = 0

  for (const row of consensus) {
    if (!row.is_winner || !row.miner_hotkey) continue
    if (visible && !visible.has(row.request_id)) continue
    winnerRows++

    const pct = rewardPct(row.reward_pct)
    if (pct <= 0) continue
    rewardRows++
    totalAllocatedPct += pct

    const key = `${row.miner_hotkey}::${row.request_id}`
    const existing = grouped.get(key)
    const nextLast =
      row.computed_at && (!existing?.lastComputedAt || row.computed_at > existing.lastComputedAt)
        ? row.computed_at
        : existing?.lastComputedAt ?? row.computed_at ?? null

    if (existing) {
      grouped.set(key, {
        ...existing,
        emissionsPct: existing.emissionsPct + pct,
        leadCount: existing.leadCount + 1,
        lastComputedAt: nextLast,
      })
    } else {
      grouped.set(key, {
        id: key,
        requestId: row.request_id,
        hotkey: row.miner_hotkey,
        purpose: purposeForRequest(row.request_id, requestMap),
        emissionsPct: pct,
        leadCount: 1,
        lastComputedAt: nextLast,
      })
    }
  }

  const scaleMax = Math.max(100, totalAllocatedPct)
  const availablePct = Math.max(0, 100 - totalAllocatedPct)
  const availableHeightPct = scaleMax > 0 ? (availablePct / scaleMax) * 100 : 100
  const overflowPct = Math.max(0, totalAllocatedPct - 100)

  const legendSegments = Array.from(grouped.values())
    .sort((a, b) => b.emissionsPct - a.emissionsPct)
    .map((segment, index) => ({
      ...segment,
      heightPct: scaleMax > 0 ? (segment.emissionsPct / scaleMax) * 100 : 0,
      rank: index + 1,
    }))

  const segments = [...legendSegments].sort((a, b) => a.emissionsPct - b.emissionsPct)

  return {
    segments,
    legendSegments,
    totalAllocatedPct,
    availablePct,
    overflowPct,
    availableHeightPct,
    winnerRows,
    rewardRows,
  }
}

function segmentFill(rank: number): string {
  const opacity = Math.max(0.28, 0.82 - rank * 0.055)
  const right = Math.max(0.18, opacity - 0.18)
  return `linear-gradient(90deg, rgba(232, 240, 255, ${opacity}) 0%, rgba(236, 234, 230, ${right}) 100%)`
}

export function EmissionAllocationVial({
  consensus,
  requestMap,
  requestIds,
  onMinerSelect,
  compact = false,
  className,
}: EmissionAllocationVialProps) {
  const model = useMemo(
    () => buildAllocationModel(consensus, requestMap, requestIds),
    [consensus, requestMap, requestIds],
  )

  const hasAllocations = model.segments.length > 0
  const legendRows = compact ? model.legendSegments.slice(0, 4) : model.legendSegments.slice(0, 8)
  const hiddenRows = Math.max(0, model.legendSegments.length - legendRows.length)
  const allocatedLabel = formatPct(Math.min(100, model.totalAllocatedPct))
  const headerNote =
    model.rewardRows > 0
      ? `${model.rewardRows} emitted ${model.rewardRows === 1 ? 'lead' : 'leads'}`
      : model.winnerRows > 0
        ? `${model.winnerRows} fulfilled; reward pending`
        : 'No emitted rewards yet'

  return (
    <section
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--surface-border)] bg-[rgba(13,12,10,0.76)]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-800/60 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--white)] live-pulse" />
            <h3 className="text-xs font-semibold text-slate-100">Emissions vial</h3>
          </div>
          <div className="mt-1 truncate font-mono text-[10px] text-slate-500">{headerNote}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-sm font-semibold text-[var(--white)] tabular-nums">
            {allocatedLabel}%
          </div>
          <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-slate-500">
            allocated
          </div>
        </div>
      </div>

      <div
        className={cn(
          'min-h-0 flex-1 gap-4 p-4',
          compact ? 'grid grid-cols-[88px_minmax(0,1fr)]' : 'flex flex-col',
        )}
      >
        <div className={cn('flex justify-center', compact ? 'items-start' : 'shrink-0')}>
          <div className="flex flex-col items-center">
            <div className="h-4 w-14 rounded-t-[0.875rem] border border-b-0 border-[var(--line-2)] bg-[rgba(236,234,230,0.035)]" />
            <div
              className={cn(
                'relative w-[88px] overflow-hidden rounded-b-[2rem] rounded-t-[1.125rem] border border-[var(--line-3)] bg-[rgba(236,234,230,0.025)] shadow-[inset_0_0_24px_rgba(232,240,255,0.055)]',
                compact ? 'h-[260px]' : 'h-[300px] xl:h-[340px]',
              )}
              role="img"
              aria-label={`Emission allocation vial. ${formatPct(model.availablePct)} percent available and ${formatPct(model.totalAllocatedPct)} percent allocated.`}
            >
              <div
                className="flex h-full w-full flex-col"
                style={{
                  background:
                    'linear-gradient(90deg, rgba(255,255,255,0.08) 0%, transparent 18%, transparent 82%, rgba(255,255,255,0.06) 100%)',
                }}
              >
                {model.availableHeightPct > 0 && (
                  <div
                    className="flex items-center justify-center border-b border-dashed border-[var(--line-2)] bg-[rgba(236,234,230,0.018)] px-1 text-center"
                    style={{ height: `${model.availableHeightPct}%` }}
                    title={`${formatPct(model.availablePct)}% available`}
                  >
                    {model.availableHeightPct >= 12 && (
                      <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-slate-600">
                        Available
                      </span>
                    )}
                  </div>
                )}

                {hasAllocations ? (
                  model.segments.map((segment) => {
                    const style: CSSProperties = {
                      height: `${segment.heightPct}%`,
                      background: segmentFill(segment.rank),
                      transition: 'height 420ms cubic-bezier(0.16, 1, 0.3, 1)',
                    }
                    const labelFits = segment.heightPct >= 8
                    return (
                      <button
                        key={segment.id}
                        type="button"
                        onClick={() => onMinerSelect?.(segment.hotkey)}
                        className="group flex w-full min-h-[2px] items-center justify-center overflow-hidden border-t border-black/20 px-1 text-center transition-[filter] hover:brightness-125"
                        style={style}
                        title={`${truncateHotkey(segment.hotkey)} - ${formatPct(segment.emissionsPct)}% - ${segment.purpose}`}
                        aria-label={`${formatPct(segment.emissionsPct)} percent to miner ${segment.hotkey} for ${segment.purpose}`}
                      >
                        <span
                          className={cn(
                            'max-w-full truncate font-mono text-[9px] font-semibold text-slate-950 opacity-85',
                            !labelFits && 'sr-only',
                          )}
                        >
                          {truncateHotkey(segment.hotkey)}
                        </span>
                      </button>
                    )
                  })
                ) : (
                  <div className="flex flex-1 items-end justify-center px-2 pb-5 text-center">
                    <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-slate-600">
                      Empty
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className={cn('min-w-0', compact ? '' : 'min-h-0 flex-1 overflow-y-auto pr-1')}>
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Available" value={`${formatPct(model.availablePct)}%`} />
            <MiniStat label="Allocated" value={`${formatPct(model.totalAllocatedPct)}%`} />
          </div>

          {model.overflowPct > 0 && (
            <div className="mt-2 rounded-md border border-[var(--line)] bg-slate-900/35 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-slate-500">
              Visible rewards sum {formatPct(model.overflowPct)}% over the pool, so the vial is
              normalized to fit.
            </div>
          )}

          {legendRows.length === 0 ? (
            <div className="mt-3 rounded-md border border-dashed border-slate-800/80 px-3 py-4 text-center text-[11px] text-slate-500">
              No positive reward_pct allocations in this view yet.
            </div>
          ) : (
            <div className="mt-3 space-y-1.5">
              {legendRows.map((segment) => (
                <button
                  key={segment.id}
                  type="button"
                  onClick={() => onMinerSelect?.(segment.hotkey)}
                  className="w-full rounded-md border border-slate-800/60 bg-slate-900/30 px-2.5 py-2 text-left transition-colors hover:bg-slate-800/50"
                  title={`${segment.hotkey} - ${segment.purpose}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-5 w-1.5 shrink-0 rounded-full"
                      style={{ background: segmentFill(segment.rank) }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <code className="truncate font-mono text-[11px] text-slate-100">
                          {truncateHotkey(segment.hotkey)}
                        </code>
                        <span className="shrink-0 font-mono text-[10px] text-slate-500">
                          {segment.leadCount} {segment.leadCount === 1 ? 'lead' : 'leads'}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-slate-500">
                        {segment.purpose}
                      </div>
                    </div>
                    <div className="shrink-0 text-right font-mono text-[11px] font-semibold text-[var(--white)] tabular-nums">
                      {formatPct(segment.emissionsPct)}%
                    </div>
                  </div>
                </button>
              ))}
              {hiddenRows > 0 && (
                <div className="px-1 pt-0.5 text-center font-mono text-[10px] text-slate-600">
                  +{hiddenRows} smaller allocations
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-800/70 bg-slate-900/30 px-2 py-1.5 text-center">
      <div className="font-mono text-[11px] font-semibold text-slate-100 tabular-nums">{value}</div>
      <div className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-slate-500">
        {label}
      </div>
    </div>
  )
}
