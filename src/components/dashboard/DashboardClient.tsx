'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FAQ, ResearchLab } from '@/components/dashboard'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { cn } from '@/lib/utils'
import {
  getDashboardTabs,
  normalizeDashboardTab,
  type DashboardTabKey,
} from '@/lib/dashboard-tabs'

export function DashboardClient() {
  const visibleTabs = getDashboardTabs()
  const [activeTab, setActiveTab] = useState<DashboardTabKey>('research-lab')
  const [mountedTabs, setMountedTabs] = useState<Set<DashboardTabKey>>(
    () => new Set(['research-lab']),
  )
  const navWrapRef = useRef<HTMLDivElement>(null)
  const tabIndicatorRef = useRef<HTMLSpanElement>(null)

  const activateTab = useCallback((tab: DashboardTabKey) => {
    setMountedTabs((current) => new Set(current).add(tab))
    setActiveTab(tab)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tab = params.get('tab')
    if (tab) activateTab(normalizeDashboardTab(tab, visibleTabs))
    if (params.has('tab')) {
      params.delete('tab')
      const query = params.toString()
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
      )
    }
  }, [activateTab, visibleTabs])

  useEffect(() => {
    const wrap = navWrapRef.current
    const indicator = tabIndicatorRef.current
    if (!wrap || !indicator) return
    const position = () => {
      const active = wrap.querySelector('[data-state="active"]') as HTMLElement | null
      if (!active) {
        indicator.style.opacity = '0'
        return
      }
      indicator.style.opacity = '1'
      indicator.style.left = `${active.offsetLeft}px`
      indicator.style.width = `${active.offsetWidth}px`
    }
    const raf = requestAnimationFrame(position)
    const observer = new ResizeObserver(position)
    observer.observe(wrap)
    window.addEventListener('resize', position)
    void document.fonts?.ready.then(position).catch(() => {})
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      window.removeEventListener('resize', position)
    }
  }, [activeTab])

  return (
    <div className="relative min-h-screen">
      <div className="relative z-10 max-w-[1500px] mx-auto px-5 py-4 md:py-6 overflow-auto">
        <header className="relative mb-7 md:mb-9 pt-6 md:pt-10 pb-6 md:pb-8 border-b border-[var(--line)]">
          <div className="flex items-center justify-between gap-4">
            <span className="font-display text-[20px] md:text-[22px] font-semibold tracking-[-0.02em] text-[var(--white)]">
              Leadpoet Subnet Dashboard
            </span>
            <span className="font-mono text-[10px] md:text-[10.5px] uppercase tracking-[0.18em] text-[var(--muted-2)] whitespace-nowrap">
              SN&nbsp;71 · Bittensor
            </span>
          </div>
        </header>

        <Tabs
          value={activeTab}
          onValueChange={(value) => activateTab(normalizeDashboardTab(value, visibleTabs))}
          className="space-y-4 md:space-y-6"
        >
          <div ref={navWrapRef} className="relative">
            <TabsList className={cn('flex w-full justify-start gap-8 sm:gap-10 overflow-x-auto no-scrollbar rounded-none border-0 border-b border-[var(--line)] bg-transparent h-auto p-0')}>
              <DashboardTabTrigger value="research-lab" label="Open Source Agent Competition" shortLabel="Competition" />
              <DashboardTabTrigger value="faq" label="FAQ" />
            </TabsList>
            <span
              ref={tabIndicatorRef}
              aria-hidden
              className="pointer-events-none absolute bottom-[-0.5px] left-0 h-[1.5px] w-0 bg-[var(--white)] opacity-0 transition-[left,width,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
            />
          </div>

          {mountedTabs.has('research-lab') && (
            <TabsContent value="research-lab" keepMounted className="data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-300">
              <ErrorBoundary label="ResearchLab">
                <ResearchLab active={activeTab === 'research-lab'} />
              </ErrorBoundary>
            </TabsContent>
          )}
          {mountedTabs.has('faq') && (
            <TabsContent value="faq" keepMounted className="data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-300">
              <ErrorBoundary label="FAQ"><FAQ /></ErrorBoundary>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  )
}

function DashboardTabTrigger({
  value,
  label,
  shortLabel,
}: {
  value: DashboardTabKey
  label: string
  shortLabel?: string
}) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        'relative flex-none inline-flex items-center justify-center rounded-none border-0 bg-transparent',
        'h-10 px-1 font-mono text-[11px] uppercase tracking-[0.14em] whitespace-nowrap transition-colors duration-200',
        'text-[var(--muted-2)] dark:text-[var(--muted-2)] hover:bg-transparent',
        'hover:text-[var(--platinum)] dark:hover:text-[var(--platinum)]',
        'focus:outline-none focus-visible:text-[var(--platinum)]',
        'data-[state=active]:bg-transparent dark:data-[state=active]:bg-transparent',
        'data-[state=active]:text-[var(--white)] dark:data-[state=active]:text-[var(--white)]',
        'data-[state=active]:shadow-none data-[state=active]:border-transparent dark:data-[state=active]:border-transparent',
      )}
    >
      <span className="inline md:hidden">{shortLabel ?? label}</span>
      <span className="hidden md:inline">{label}</span>
    </TabsTrigger>
  )
}
