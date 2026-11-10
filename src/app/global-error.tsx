'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  if (typeof window !== 'undefined') {
    // Log to console for client-side debugging / production telemetry pipelines.
    console.error('[GlobalError] unrecoverable error:', error)
  }
  // This page replaces the root layout, so it cannot rely on the app stylesheet.
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0b0d10', color: '#f3f5f7', font: '14px/1.5 system-ui, sans-serif', colorScheme: 'dark' }}>
        <main style={{ display: 'flex', minHeight: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 20 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 500, letterSpacing: '-0.04em' }}>Something went wrong</h1>
          <button
            type="button"
            onClick={() => reset()}
            style={{ minHeight: 44, padding: '0 16px', borderRadius: 6, border: '1px solid rgba(224, 232, 242, 0.24)', background: 'transparent', color: '#e1e5e9', font: 'inherit', cursor: 'pointer' }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  )
}
