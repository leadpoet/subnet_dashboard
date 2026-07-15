import { LockKeyhole } from 'lucide-react'
import { safeAdminRedirectPath } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string | string[]
    next?: string | string[]
  }>
}) {
  const params = await searchParams
  const error = Array.isArray(params.error) ? params.error[0] : params.error
  const requestedNext = Array.isArray(params.next) ? params.next[0] : params.next
  const next = safeAdminRedirectPath(requestedNext ?? null)

  return (
    <div className="mx-auto flex min-h-[calc(100vh-10rem)] max-w-md items-center">
      <section
        className="w-full rounded-2xl border p-6 shadow-2xl sm:p-8"
        style={{
          borderColor: 'var(--surface-border)',
          background: 'var(--surface)',
        }}
      >
        <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-gold-soft text-gold">
          <LockKeyhole className="h-5 w-5" aria-hidden="true" />
        </div>

        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          Sign in to Admin
        </h1>
        <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
          Use the shared operator credentials. Your password manager can save and fill them on this device.
        </p>

        {error === 'invalid' ? (
          <div
            role="alert"
            className="mt-5 rounded-xl border px-3.5 py-3 text-sm"
            style={{
              color: '#e6b8b3',
              borderColor: 'rgba(168, 116, 111, 0.35)',
              background: 'rgba(168, 116, 111, 0.10)',
            }}
          >
            That username or password wasn&apos;t recognized.
          </div>
        ) : null}

        <form action="/api/admin/login" method="post" className="mt-6 space-y-5">
          <input type="hidden" name="next" value={next} />

          <div className="space-y-2">
            <label
              htmlFor="username"
              className="block text-xs font-medium uppercase tracking-[0.12em]"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              autoFocus
              className="premium-focus w-full rounded-xl border px-3.5 py-3 text-base outline-none transition sm:text-sm"
              style={{
                color: 'var(--text-primary)',
                borderColor: 'var(--surface-border)',
                background: 'var(--surface-base)',
              }}
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="password"
              className="block text-xs font-medium uppercase tracking-[0.12em]"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="premium-focus w-full rounded-xl border px-3.5 py-3 text-base outline-none transition sm:text-sm"
              style={{
                color: 'var(--text-primary)',
                borderColor: 'var(--surface-border)',
                background: 'var(--surface-base)',
              }}
            />
          </div>

          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold text-black transition hover:brightness-110"
            style={{ background: 'var(--brand)' }}
          >
            Sign in
          </button>
        </form>

        <p className="mt-5 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
          You&apos;ll stay signed in on this device for 30 days.
        </p>
      </section>
    </div>
  )
}
