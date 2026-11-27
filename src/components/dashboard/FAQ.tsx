'use client'

import { useState, useId, useEffect, useCallback } from 'react'
import {
  ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ENROLLMENT_GUIDE, SALES_AGENT } from '@/lib/collection'

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
    id: 'how-it-works', question: 'How do I enroll?',
    answer: 'Use a registered Subnet 71 hotkey and the miner CLI. Run leadpoet collection-terms to see the available tasks and prices. Follow the enrollment guide to sign the offer you want to fund. Each signature covers that offer and its spending limits.',
  },
  {
    id: 'keys', question: 'Which OpenRouter keys do I need?',
    answer: 'Create a dedicated, funded OpenRouter API key and a read-only management key in the same workspace. Enter both through the miner CLI. The gateway uses the management key to verify ownership and settings, and stores the funding key encrypted.',
  },
  {
    id: 'spending', question: 'How do I limit or stop spending?',
    answer: 'Set a rolling 24-hour spending cap when you enroll. Each offer also shows a maximum spend per run. Your private miner statement shows assignments, charges and outstanding reservations. Revoke the enrollment in the CLI to stop new assignments.',
  },
  {
    id: 'fulfillment', question: 'What data does a run produce?',
    answer: 'Our public agent runs an assigned sales workflow. In a research task it searches a simulated company archive, checks dated sources and cites evidence for its qualification decision. We retain the prompts, responses, reasoning the model exposes, tool calls and results, and the final outcome. Failed runs can also provide training examples.',
  },
  {
    id: 'incentives', question: 'How are rewards calculated?',
    answer: 'You see a fixed quote before spending. It targets 1.25 times the measured cost of that model and task. A run becomes eligible when its result and trace pass verification. Failed work can still use OpenRouter credits. If eligible quotes exceed available emissions, they scale proportionally. Validator votes and token prices affect what you receive.',
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
      <div className="py-7 md:py-9">
        <h1 className="font-display text-[28px] font-medium tracking-[-0.04em] text-[var(--white)] md:text-[36px]">
          Frequently asked questions
        </h1>
      </div>

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
        aria-hidden={!isOpen}
        className={cn(
          'overflow-hidden transition-all duration-300 ease-out motion-reduce:transition-none',
          isOpen ? 'max-h-[900px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="pl-[2.65rem] pr-4 pb-4 pt-1 space-y-2.5">
          {paragraphs.map((p, i) => (
            <p key={i} className="text-[14px] text-[var(--muted)] leading-relaxed">
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
    <nav aria-label="Subnet 71 links" className="border-t border-[var(--line)] pt-4 lg:border-t-0 lg:border-l lg:pl-6">
      <h2 className="mb-3 px-4 text-[12px] text-[var(--muted)]">Explore Subnet 71</h2>
      <SidebarLink href={ENROLLMENT_GUIDE}>Miner enrollment</SidebarLink>
      <SidebarLink href={SALES_AGENT}>Public sales agent</SidebarLink>
      <SidebarLink href="https://github.com/leadpoet/leadpoet">GitHub</SidebarLink>
      <SidebarLink href="https://discord.gg/dVxQZmJwxB">Discord</SidebarLink>
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
      className="flex items-center gap-2 px-4 py-2.5 text-[12px] text-[var(--platinum)] hover:text-[var(--white)] hover-bg-warm transition-colors group"
    >
      <span className="flex-1 truncate font-mono">{children}</span>
    </a>
  )
}
