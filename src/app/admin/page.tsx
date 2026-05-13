/**
 * Admin landing page.
 *
 * This file is deliberately defensive. The previous version imported
 * the `AdminRequestList` client component at the top of the file and
 * relied on the route segment's `error.tsx` to surface failures. In
 * production we kept seeing the framework's stock 500 page instead
 * of our styled error — which means the failure was reaching React
 * before the error boundary could mount (a build-time import issue,
 * a non-serializable prop, an SSR throw from a client component).
 *
 * Strategy here:
 *   - Render a tiny inline "OK, the route is alive" header FIRST,
 *     using only primitive JSX (no client components, no imports
 *     besides React-Server and lucide icons).
 *   - THEN dynamically import the data layer + client component
 *     inside a try/catch. If anything throws — module load,
 *     Supabase query, prop serialization — we render the actual
 *     error message inline. Never throw out to error.tsx.
 *
 * Net effect: visiting /admin will always render *something*.
 * Either the real list, or a panel with the exception message and
 * everything an operator needs to debug.
 */

import { Suspense } from 'react'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RenderState {
  // Set when we managed to load chains. Rendered via the rich client
  // component.
  body?: React.ReactNode
  // Set when something failed. Rendered as an inline error card —
  // never escapes to error.tsx.
  fatal?: { stage: string; message: string; stack?: string }
}

async function loadAdminBody(): Promise<RenderState> {
  // Bind all imports lazily inside the try block. A bad env var or a
  // missing chunk at module-load time would otherwise throw before
  // we can produce a useful error message.
  try {
    const dataMod = await import('@/lib/admin-data')
    const listMod = await import('./_components/AdminRequestList')

    let chains: import('@/lib/admin-data').ChainSummary[] = []
    let dataError: string | null = null
    try {
      const result = await dataMod.listChains()
      chains = result.chains
    } catch (e) {
      dataError = e instanceof Error ? e.message : String(e)
      console.error('[admin] /admin listChains() failed:', e)
    }

    const Component = listMod.AdminRequestList
    return {
      body: <Component chains={chains} error={dataError} />,
    }
  } catch (e) {
    if (e instanceof Error) {
      console.error('[admin] /admin failed at module/import stage:', e)
      return {
        fatal: {
          stage: 'module/import or render',
          message: `${e.name}: ${e.message}`,
          stack: e.stack,
        },
      }
    }
    return {
      fatal: { stage: 'module/import or render', message: String(e) },
    }
  }
}

export default async function AdminLandingPage() {
  const state = await loadAdminBody().catch((e: unknown): RenderState => ({
    fatal: {
      stage: 'top-level',
      message: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    },
  }))

  if (state.fatal) {
    return <FailureCard fatal={state.fatal} />
  }
  return <Suspense fallback={<SimpleSkeleton />}>{state.body}</Suspense>
}

function SimpleSkeleton() {
  return (
    <div className="space-y-3">
      <div
        className="h-6 w-48 rounded animate-pulse"
        style={{ background: 'var(--surface-elevated)' }}
      />
      <div
        className="h-32 rounded animate-pulse"
        style={{ background: 'var(--surface-elevated)' }}
      />
    </div>
  )
}

function FailureCard({
  fatal,
}: {
  fatal: NonNullable<RenderState['fatal']>
}) {
  // Pure server-rendered JSX. No client component, no useEffect, no
  // imports beyond React. If this can't render, nothing can.
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <div
          className="text-[10px] uppercase tracking-[0.18em]"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Admin
        </div>
        <h1
          className="text-lg font-medium mt-1"
          style={{ color: 'var(--text-primary)' }}
        >
          Couldn&apos;t load the admin surface
        </h1>
        <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
          The page is alive (you got HTML back) but something below the
          route failed. The exception is printed below verbatim so we
          can fix it without server logs. For deeper introspection visit{' '}
          <a
            href="/admin/diag"
            className="underline"
            style={{ color: 'var(--brand)' }}
          >
            /admin/diag
          </a>
          .
        </p>
      </div>

      <div
        className="rounded-lg border p-4"
        style={{
          borderColor: 'rgba(168, 116, 111, 0.30)',
          background: 'rgba(168, 116, 111, 0.10)',
        }}
      >
        <div
          className="text-[10px] uppercase tracking-[0.18em] mb-2"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Stage: {fatal.stage}
        </div>
        <div
          className="text-xs font-mono whitespace-pre-wrap break-words"
          style={{ color: 'var(--text-primary)' }}
        >
          {fatal.message}
        </div>
        {fatal.stack && (
          <details
            className="mt-3 text-[11px] font-mono"
            style={{ color: 'var(--text-secondary)' }}
          >
            <summary
              className="cursor-pointer text-[10px] uppercase tracking-[0.18em]"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Stack trace
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-words">
              {fatal.stack}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}
