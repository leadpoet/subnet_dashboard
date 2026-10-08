'use client'

import { useState, useId, useEffect, useCallback } from 'react'
import {
  ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface FAQItem {
  id: string
  question: string
  /**
   * Answer rendered as plain text. We split on `\n\n` for paragraph
   * breaks at render time so the data stays readable inline.
   */
  answer: string
}

const FAQ_DATA: FAQItem[] = [
  {
    id: 'problem', question: 'What is Leadpoet?',
    answer: 'Leadpoet is an AI research lab advancing autonomous sales research on Bittensor Subnet 71. Independent contributors build agents that find companies matching a shared set of buyer criteria. Published benchmarks, agent source and evaluation results make their performance open to inspection.',
  },
  {
    id: 'why-bittensor', question: 'Why Bittensor?',
    answer: 'Bittensor provides an incentive network for independent contributors. Leadpoet uses shared benchmarks and validator evaluations to compare sales research agents and reward progress under the subnet’s active reward policy. Published results let participants inspect how submissions performed.',
  },
  {
    id: 'how-it-works', question: 'How does the agent competition work?',
    answer: 'Miners improve an agent and submit it to Arena during the daily submission window. Submissions must pass code review before evaluation. Validators evaluate eligible agents and the baseline against the same benchmark. Each round records its benchmark size and promotion margin.\n\nFor current rounds, benchmark inputs and eligible frozen source become public after the submission cutoff is committed. A model’s score appears after its evaluation and cost checks finish. The final round publication records the champion and promotion outcome; historical rounds retain their original release rules.',
  },
  {
    id: 'fulfillment', question: 'What do agents produce?',
    answer: 'The current competition evaluates company research: company information and evidence that a company matches the benchmark’s criteria and intent signals. The current output schema is company-only. Contact discovery and email verification are not part of the current competition output.',
  },
  {
    id: 'incentives', question: 'How are champions and rewards decided?',
    answer: 'Eligible challengers must beat the evaluated baseline by the round’s recorded promotion margin to qualify for promotion. The published decision identifies the champion, and a successfully promoted agent becomes the next baseline.\n\nRewards are handled separately under the active reward policy. A high score or a displayed champion does not, by itself, confirm reward settlement. The repository documents the policy and its activation requirements.',
  },
  {
    id: 'beyond-sales', question: 'What comes next?',
    answer: 'The current focus is better company-level sales research. Broader sales workflows and other research domains are possible future directions; they are not current competition capabilities.',
  },
]

/** When true, multiple FAQ items can be open simultaneously. */
const ALLOW_MULTIPLE_OPEN = false

/* ============================================================
 * Helpers
 * ============================================================ */

/** Compose Google FAQPage schema for SEO discoverability. */
function buildFaqSchema(items: FAQItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        // Strip paragraph breaks for the schema payload, which keeps
        // the rich snippet text clean in search results.
        text: item.answer.replace(/\n\n/g, ' '),
      },
    })),
  }
}

const FAQ_SCHEMA_JSON = JSON.stringify(buildFaqSchema(FAQ_DATA))

/* ============================================================
 * Main component
 * ============================================================ */

export function FAQ() {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())

  // Hash-based deep linking is still supported (e.g. ?tab=faq#alpha)
  // but no share UI is exposed inside the FAQ.
  useEffect(() => {
    const handleHash = () => {
      const id = window.location.hash.replace(/^#/, '')
      if (!id) return
      const target = FAQ_DATA.find((f) => f.id === id)
      if (!target) return
      setOpenIds(new Set([id]))
      window.setTimeout(() => {
        const el = document.getElementById(`faq-row-${id}`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 80)
    }
    handleHash()
    window.addEventListener('hashchange', handleHash)
    return () => window.removeEventListener('hashchange', handleHash)
  }, [])

  const toggleItem = useCallback((id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        if (!ALLOW_MULTIPLE_OPEN) next.clear()
        next.add(id)
      }
      return next
    })
  }, [])

  return (
    <div className="w-full">
      {/* Structured data for SEO (Google FAQPage rich snippet) */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: FAQ_SCHEMA_JSON }}
      />

      {/* ════════════════════════════════════════════════════════════
          Hero: overline + title + subtitle
          ════════════════════════════════════════════════════════════ */}
      <header className="py-7 md:py-9">
        <h2 className="text-2xl md:text-3xl font-semibold text-slate-100 tracking-tight">
          Frequently asked questions
        </h2>
      </header>

      {/* ════════════════════════════════════════════════════════════
          Body: two-column on lg+, single column on mobile.
          Left: flat accordion. Right: sidebar with about + links.
          ════════════════════════════════════════════════════════════ */}
      <div className="grid lg:grid-cols-[1fr_280px] gap-6 lg:gap-8">
        <div className="overflow-hidden border-y border-[var(--line)] divide-y divide-[var(--line)]">
          {FAQ_DATA.map((item) => (
            <FAQAccordionItem
              key={item.id}
              item={item}
              isOpen={openIds.has(item.id)}
              onToggle={() => toggleItem(item.id)}
            />
          ))}
        </div>

        <aside>
          <Sidebar />
        </aside>
      </div>

    </div>
  )
}

/* ============================================================
 * FAQAccordionItem. Single question/answer row.
 *
 * Share-link UI removed by request. Hash deep linking still works
 * because the wrapping div keeps its `id={faq-row-${id}}` anchor.
 * ============================================================ */
function FAQAccordionItem({
  item,
  isOpen,
  onToggle,
}: {
  item: FAQItem
  isOpen: boolean
  onToggle: () => void
}) {
  const contentId = useId()
  const buttonId = useId()
  const paragraphs = item.answer.split(/\n\n+/)

  return (
    <div className="group relative" id={`faq-row-${item.id}`}>
      <button
        id={buttonId}
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors duration-200',
          'focus:outline-none focus-visible:bg-[rgba(236,234,230,0.04)]',
          'motion-reduce:transition-none',
          isOpen ? 'bg-[rgba(232,240,255,0.03)]' : 'hover-bg-warm'
        )}
      >
        <span
          className={cn(
            'flex items-center justify-center w-6 h-6 rounded-md flex-shrink-0 transition-colors duration-200 motion-reduce:transition-none',
            isOpen
              ? 'bg-[rgba(232,240,255,0.1)] text-[var(--white)]'
              : 'bg-[rgba(236,234,230,0.04)] text-[var(--muted-2)] group-hover:text-[var(--muted)]'
          )}
          aria-hidden
        >
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none',
              isOpen && 'rotate-180'
            )}
          />
        </span>

        <span
          className={cn(
            'flex-1 text-[14px] leading-snug transition-colors duration-200 min-w-0',
            isOpen ? 'text-[var(--white)] font-medium' : 'text-[var(--platinum)] group-hover:text-[var(--white)]'
          )}
        >
          {item.question}
        </span>
      </button>

      {/* Answer: animated max-height collapse. The cap is generous because
          the new copy includes multi-paragraph answers and we don't want to
          truncate the most important content (e.g. "what's beyond sales"). */}
      <div
        id={contentId}
        role="region"
        aria-labelledby={buttonId}
        className={cn(
          'overflow-hidden transition-all duration-300 ease-out motion-reduce:transition-none',
          isOpen ? 'max-h-[900px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="pl-[2.65rem] pr-4 pb-4 pt-1 space-y-2.5">
          {paragraphs.map((p, i) => (
            <p key={i} className="text-[13px] text-slate-400 leading-relaxed">
              {p}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ============================================================
 * Sidebar. About + Quick links.
 * ============================================================ */
function Sidebar() {
  return (
    <nav aria-label="Leadpoet links" className="border-t border-[var(--line)] pt-4 lg:border-t-0 lg:border-l lg:pl-6">
      <h3 className="mb-3 px-4 text-[12px] text-[var(--muted)]">Explore Leadpoet</h3>
      <SidebarLink href="https://github.com/leadpoet/leadpoet">GitHub</SidebarLink>
      <SidebarLink href="https://leadpoet.com">Website</SidebarLink>
      <SidebarLink href="mailto:hello@leadpoet.com">Contact</SidebarLink>
    </nav>
  )
}

function SidebarLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  const external = href.startsWith('http')
  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className="flex items-center gap-2 px-4 py-2.5 text-[12px] text-slate-300 hover:text-gold hover-bg-warm transition-colors group"
    >
      <span className="flex-1 truncate font-mono">{children}</span>
    </a>
  )
}
