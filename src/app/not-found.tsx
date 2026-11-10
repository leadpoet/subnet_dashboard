import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="dashboard-surface flex min-h-screen flex-col items-center justify-center gap-5 px-5 text-center">
      <h1 className="font-display text-[28px] font-medium tracking-[-0.04em] text-[var(--white)]">Page not found</h1>
      <Link href="/" className="text-[14px] text-[var(--muted)] transition-colors hover:text-[var(--white)]">Back to the competition</Link>
    </main>
  )
}
