'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AdminResearchLabPayload, AdminLabMonitoredValidator } from '@/app/api/admin/research-lab/route'
export type { AdminResearchLabPayload } from '@/app/api/admin/research-lab/route'

export function AdminResearchLab({ payload: initialPayload, error: initialError }: { payload: AdminResearchLabPayload | null; error: string | null }) {
  const [payload, setPayload] = useState<AdminResearchLabPayload | null>(initialPayload)
  const [error, setError] = useState(initialError)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/research-lab?t=${Date.now()}`, { cache: 'no-store' })
      const body = await response.json() as AdminResearchLabPayload & { error?: string }
      if (!response.ok) throw new Error(body.error || `Research Lab API returned ${response.status}`)
      setPayload(body)
      setError(null)
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Failed to load Arena status')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 30_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  async function updateValidator(action: 'upsert_validator_monitor' | 'remove_validator_monitor', validator: AdminLabMonitoredValidator) {
    setBusy(true)
    try {
      const response = await fetch('/api/admin/research-lab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, hotkey: validator.hotkey, label: validator.label, enabled: validator.enabled, monitorPcr0: validator.monitorPcr0, monitorOffchainWeights: validator.monitorOffchainWeights, monitorOnchainWeights: validator.monitorOnchainWeights, expectedPcr0: validator.expectedPcr0 }) })
      const body = await response.json() as { error?: string }
      if (!response.ok) throw new Error(body.error || `Validator update returned ${response.status}`)
      await refresh()
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Validator update failed')
    } finally {
      setBusy(false)
    }
  }

  if (error && !payload) return <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-200">{error}</div>
  if (!payload) return <div className="rounded-xl border border-white/[0.08] p-4 text-sm text-white/50">Loading Arena status…</div>

  const { arena, ops } = payload
  return <div className="space-y-5">
    {error ? <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-100">{error}</div> : null}
    <section className="grid gap-4 md:grid-cols-2">
      <StatusCard title="Arena round" value={arena.activeRound?.status ?? 'Unavailable'} detail={arena.activeRound ? `Round ${arena.activeRound.roundId}` : 'The gateway did not return an active round.'} />
      <StatusCard title="Public baseline" value={arena.publishedBaseline ? arena.publishedBaseline.score.toFixed(2) : 'Unavailable'} detail={arena.publishedBaseline ? `Published round ${arena.publishedBaseline.roundId}; rank ${arena.publishedBaseline.rank ?? '—'}.` : 'No published baseline result is available.'} />
      <StatusCard title="Current king" value={arena.publishedWinner ? arena.publishedWinner.score.toFixed(2) : 'Unavailable'} detail={arena.publishedWinner ? `${arena.publishedWinner.submissionId}; rank ${arena.publishedWinner.rank ?? '—'}.` : 'No published competition winner is available.'} />
    </section>

    <section className="rounded-xl border border-white/[0.08] p-4">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-white">Runtime and competition health</h2><span className="text-xs uppercase tracking-wide text-white/45">{ops.state}</span></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{ops.healthSignals.map((signal) => <div key={signal.id} className="rounded-lg border border-white/[0.06] p-3"><div className="text-xs text-white/45">{signal.label}</div><div className="mt-1 text-sm font-medium text-white">{signal.value}</div><div className="mt-1 text-xs text-white/50">{signal.detail}</div></div>)}</div>
    </section>

    <section className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-white/[0.08] p-4"><h2 className="mb-3 text-sm font-semibold text-white">Gateway and validator</h2><RuntimeRow label="Gateway" value={ops.gateway.sourceAvailable ? 'Available' : 'Unavailable'} detail={ops.gateway.unavailableReason ?? ops.gateway.commitSha ?? 'No deployment identity reported.'} /><RuntimeRow label="Validator runtime" value={ops.validatorDeployment.currentRuntimeVerified ? 'Ready' : 'Attention'} detail={ops.validatorDeployment.verificationReason ?? ops.validatorDeployment.commitSha ?? 'No runtime attestation reported.'} /><RuntimeRow label="PCR0 check" value={ops.gateway.pcr0.accepted === true ? 'Accepted' : ops.gateway.pcr0.checked ? 'Rejected' : 'Unavailable'} detail={ops.gateway.pcr0.detail} /></div>
      <div className="rounded-xl border border-white/[0.08] p-4"><h2 className="mb-3 text-sm font-semibold text-white">Active alerts</h2><div className="mb-3 text-xs text-white/55">{ops.alerts.activeCount} active · {ops.alerts.totalLast24h} in the last 24 hours · paging {ops.alerts.operations.deliveryReady ? 'ready' : 'attention'}</div>{ops.alerts.recent.slice(0, 8).map((alert) => <div key={alert.fingerprint} className="border-t border-white/[0.06] py-2"><div className="flex justify-between gap-3 text-xs"><span className="text-white">{alert.title}</span><span className="text-white/45">{alert.severity}</span></div><div className="text-xs text-white/45">{alert.detail}</div></div>)}{ops.alerts.recent.length === 0 ? <div className="text-xs text-white/45">No persisted alerts.</div> : null}</div>
    </section>

    <section className="rounded-xl border border-white/[0.08] p-4"><h2 className="mb-3 text-sm font-semibold text-white">Validator alert registry</h2><div className="space-y-2">{ops.alerts.operations.validators.map((validator) => <div key={validator.hotkey} className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] py-2"><div><div className="text-xs text-white">{validator.label || validator.hotkey}</div><div className="text-[11px] text-white/40">{validator.hotkey}</div></div><div className="flex items-center gap-2 text-xs text-white/55"><span>{validator.enabled ? 'enabled' : 'disabled'}</span><button disabled={busy} onClick={() => void updateValidator('upsert_validator_monitor', { ...validator, enabled: !validator.enabled })} className="rounded border border-white/10 px-2 py-1 hover:bg-white/5">{validator.enabled ? 'Disable' : 'Enable'}</button><button disabled={busy} onClick={() => void updateValidator('remove_validator_monitor', validator)} className="rounded border border-red-300/20 px-2 py-1 text-red-200 hover:bg-red-300/10">Remove</button></div></div>)}{ops.alerts.operations.validators.length === 0 ? <div className="text-xs text-white/45">No validator registry rows. Environment-configured monitors remain active in the alert worker.</div> : null}</div></section>
  </div>
}

function StatusCard({ title, value, detail }: { title: string; value: string; detail: string }) { return <div className="rounded-xl border border-white/[0.08] p-4"><div className="text-xs uppercase tracking-wide text-white/45">{title}</div><div className="mt-2 text-xl font-semibold text-white">{value}</div><div className="mt-1 text-xs text-white/50">{detail}</div></div> }
function RuntimeRow({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="border-t border-white/[0.06] py-2"><div className="flex justify-between gap-3 text-xs"><span className="text-white/60">{label}</span><span className="text-white">{value}</span></div><div className="mt-1 text-xs text-white/45">{detail}</div></div> }
