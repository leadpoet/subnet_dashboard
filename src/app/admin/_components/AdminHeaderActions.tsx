'use client'

import { usePathname } from 'next/navigation'
import { AdminRefreshButton } from './AdminRefreshButton'

export function AdminHeaderActions() {
  const pathname = usePathname()
  if (pathname === '/admin/login') return null

  return (
    <>
      <AdminRefreshButton />
      <form action="/api/admin/logout" method="post">
        <button
          type="submit"
          className="text-xs transition-colors hover:text-white"
          style={{ color: 'var(--text-secondary)' }}
        >
          Sign out
        </button>
      </form>
      <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] bg-gold-soft border-gold-soft border text-gold">
        <span className="dot-gold inline-block h-1 w-1 rounded-full live-pulse" />
        Internal only
      </span>
    </>
  )
}
