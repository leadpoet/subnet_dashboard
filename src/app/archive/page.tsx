import type { Metadata } from 'next'
import Link from 'next/link'
import { ArenaArchive } from '@/components/dashboard/ArenaArchive'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'

export const metadata: Metadata = { title: 'Arena archive' }

export default function ArchivePage() {
  return <main className="dashboard-surface min-h-screen">
    <div className="relative z-10 mx-auto max-w-[1240px] px-5 md:px-8">
      <header className="border-b border-[var(--line)] py-6 md:py-8">
        <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--white)]">← Sales research lab</Link>
      </header>
      <ErrorBoundary label="Arena archive"><ArenaArchive /></ErrorBoundary>
    </div>
  </main>
}
