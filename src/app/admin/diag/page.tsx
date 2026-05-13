/**
 * Operator diagnostic page.
 *
 * Hit this from a browser at /admin/_diag (session required, same as
 * the rest of /admin). It reports exactly what the running Node
 * process can see — env vars, Supabase reachability, and the actual
 * exception message if a query fails. That removes the guesswork
 * when /admin starts returning 500 after a deploy.
 *
 * Nothing here is sensitive: we mask key values to a length + prefix
 * fingerprint, never the secret itself. It's still session-gated so
 * the page isn't world-visible.
 */

import { headers } from 'next/headers'

export const dynamic = 'force-dynamic'

function fingerprint(value: string | undefined): string {
  if (!value) return '(not set)'
  if (value.length <= 8) return `set (${value.length} chars)`
  return `set (${value.length} chars, starts "${value.slice(0, 4)}…", ends "…${value.slice(-2)}")`
}

interface ProbeResult {
  ok: boolean
  detail: string
}

async function probeSupabase(): Promise<ProbeResult> {
  try {
    const { getAdminSupabase } = await import('@/lib/admin-supabase')
    const supabase = getAdminSupabase()
    const { error, count } = await supabase
      .from('fulfillment_requests')
      .select('request_id', { count: 'exact', head: true })
    if (error) {
      return { ok: false, detail: `Supabase error: ${error.message}` }
    }
    return { ok: true, detail: `OK · ${count ?? 0} rows in fulfillment_requests` }
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    }
  }
}

async function probeListChains(): Promise<ProbeResult> {
  try {
    const { listChains } = await import('@/lib/admin-data')
    const result = await listChains()
    return {
      ok: true,
      detail: `OK · listChains returned ${result.chains.length} chains (total ${result.total})`,
    }
  } catch (e) {
    if (e instanceof Error) {
      return {
        ok: false,
        detail: `${e.name}: ${e.message}\n\n${e.stack ?? '(no stack)'}`,
      }
    }
    return { ok: false, detail: String(e) }
  }
}

export default async function AdminDiagPage() {
  const h = await headers()
  const host = h.get('host') ?? '(unknown)'
  const xff = h.get('x-forwarded-for') ?? '(none)'

  const env = {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_SUPABASE_URL: fingerprint(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: fingerprint(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    SUPABASE_SECRET_KEY: fingerprint(process.env.SUPABASE_SECRET_KEY),
    ADMIN_USER: fingerprint(process.env.ADMIN_USER),
    ADMIN_PASS: fingerprint(process.env.ADMIN_PASS),
  }

  const supabaseProbe = await probeSupabase()
  const listChainsProbe = await probeListChains()

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1
          className="text-lg font-medium"
          style={{ color: 'var(--text-primary)' }}
        >
          Admin diagnostics
        </h1>
        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
          What the running Node process can actually see. Used when /admin
          returns 500 to find the failing layer in one page load.
        </p>
      </div>

      <Section title="Request">
        <KV k="host" v={host} />
        <KV k="x-forwarded-for" v={xff} />
        <KV k="now (server)" v={new Date().toISOString()} />
      </Section>

      <Section title="Environment">
        {Object.entries(env).map(([k, v]) => (
          <KV key={k} k={k} v={v ?? '(undefined)'} />
        ))}
      </Section>

      <Section title="Probe · Supabase round-trip">
        <Result ok={supabaseProbe.ok} detail={supabaseProbe.detail} />
      </Section>

      <Section title="Probe · listChains()">
        <Result ok={listChainsProbe.ok} detail={listChainsProbe.detail} />
      </Section>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section
      className="rounded-lg border p-4"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <div
        className="text-[10px] uppercase tracking-[0.18em] mb-3"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  )
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-3 text-xs font-mono">
      <span style={{ color: 'var(--text-tertiary)' }}>{k}</span>
      <span style={{ color: 'var(--text-primary)' }}>{v}</span>
    </div>
  )
}

function Result({ ok, detail }: { ok: boolean; detail: string }) {
  return (
    <div className="text-xs font-mono whitespace-pre-wrap break-words">
      <span
        className="inline-block mr-2 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-[0.14em]"
        style={{
          background: ok ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
          color: ok ? 'rgb(74, 222, 128)' : 'rgb(248, 113, 113)',
          border: `1px solid ${ok ? 'rgba(34, 197, 94, 0.35)' : 'rgba(239, 68, 68, 0.35)'}`,
        }}
      >
        {ok ? 'ok' : 'fail'}
      </span>
      <span style={{ color: 'var(--text-primary)' }}>{detail}</span>
    </div>
  )
}
