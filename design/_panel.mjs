export const meta = {
  name: 'premium-redesign-panel',
  description: 'Generate, judge, and synthesize an extremely-premium no-gold technical redesign of the Research Lab dashboard',
  phases: [
    { title: 'Generate', detail: '5 distinct premium directions, full HTML each' },
    { title: 'Critique', detail: '3 adversarial taste judges score all candidates' },
    { title: 'Synthesize', detail: 'merge winner + best grafts into final prototype' },
  ],
}

const CONTENT = [
  'CONTENT TO RENDER (keep this exact information architecture and data across every version - only the aesthetic differs):',
  '',
  '- Masthead: wordmark "Leadpoet" + secondary "Research Lab". A small chip "Subnet 71 / Bittensor". A "Synced just now" indicator with a gently pulsing live dot.',
  '- Nav tabs (segmented): Research Lab (active), Fulfillment, FAQ.',
  '- Hero: a small eyebrow "Current model benchmark / v2026.06". A confident technical headline (rewrite tastefully, e.g. "Autonomous lead research, scored in the open" - no marketing fluff). A very large primary score "72.4" with a muted "/100". A small band label "Strong". A delta "+3.1 since last cycle". A one-line narrative: evaluated on a rolling 7-day window of live client ICPs, produced by a four-tier validator pipeline, independently verifiable from the benchmark hash. A 12-cycle sparkline trending up (low 61.2 to now 72.4). A faint "next benchmark in 2d 14h".',
  '- KPI rail (4): Active loops 18 ("research runs in progress"); Scored this cycle 142 ("+22% week over week"); Companies researched 3,847 ("all-time, verified"); Active contributors 9 ("running loops now").',
  '- Benchmark detail section: "Jun 25, 2026 / rolling 7-day window". A "Verifiable" affordance + mono hash "sha256 5a9957...4e30" with a copy control + a "Methodology" link. A score-distribution strip across bands zero/weak/fair/strong/frontier with counts 3/7/15/17/8. A ranked leaderboard of 5 ICPs (rank, title, tags, a small "signal" line, score with a thin bar, company count):',
  '  01  Data and Analytics / Cloud Data Platforms / BI and analytics tooling - United States / 200-500 / Data leaders - signal: Launched or announced a new product - 88.2 - 34 companies  (emphasize this top row, but NOT with gold)',
  '  02  Information Technology / Managed IT and Cloud Infrastructure - United States / 200-500 / IT directors - signal: Expanded to new markets - 81.5 - 28',
  '  03  Professional Services / Management and Technology Consulting - United States / 500-1000 / Ops VPs - signal: Acquired another company - 76.0 - 21',
  '  04  Transportation / Logistics and Mobility Technology - United States / 10-50 / Founders - signal: Recent facility or store opening - 69.3 - 12',
  '  05  Information Technology / IT Services and Consulting - United States / 50-200 / CTOs - signal: Just closed a funding round - 64.8 - 9',
  '- Live research activity (3 rows): a "18 running" live label; row = mono hotkey "5F3a...9kQ2" / area "Cloud Data Platforms" / outcome badge "Promoted"; meta "240 candidates / 31 scored / 4m ago". Row2: 5Gw7...pL4x / Logistics Tech / "Promising" / 180 candidates / 22 scored / 11m ago. Row3: 5Dn2...rT8v / IT Services / "No gain" / 95 candidates / 12 scored / 26m ago. (Three distinct tasteful outcome states - promoted / promising / no-gain - without using gold.)',
  '- Research directions (3 grouped): Cloud Data Platforms - 6 running / 18 scored / 4 promising (progress ~72%); Managed IT and Cloud - 4 / 12 / 2 (~48%); Logistics and Mobility Tech - 3 / 9 / 1 (~34%).',
  '- Methodology footer: "How every score is produced" with 4 tiers - Tier 1 ICP fit (industry/role/seniority/geography/size); Tier 2 Data accuracy (email + company data verified via live APIs); Tier 3 Attribute proof (required attributes confirmed via independent web evidence); Tier 4 Intent signal (buying-intent evidence, time-decayed). A provenance line: "Subnet 71 / epoch 1428 / commit-reveal scored on-chain / benchmark 5a9957...4e30 verifiable by any validator".',
].join('\n')

const CONSTRAINTS = [
  'HARD CONSTRAINTS (a violation = automatic failure):',
  '- DARK, near-black canvas. The product is a frontier-AI-lab benchmark dashboard for investors, contributors and the public. It must feel EXTREMELY premium, restrained, expensive, and technically credible - like Linear, Vercel, Stripe, Mercury, Teenage Engineering, a serious eval/instrument - not a generic SaaS dashboard.',
  '- ABSOLUTELY NO gold, champagne, amber, bronze, or yellow anywhere. The client finds gold tacky. Use ONLY your assigned accent strategy.',
  '- AIRY. Generous whitespace and vertical rhythm. Prefer hairline rules and negative space to separate sections rather than heavy bordered boxes. Give the hero room to breathe. Do not cram. Noticeably more spacious than a typical dense dashboard.',
  '- TECHNICAL REGISTER. A grotesk/sans display face for headings + numbers, and a monospace for all data, labels, metadata, hashes, and tracked eyebrows. NO serif fonts anywhere.',
  '- COLOR DISCIPLINE. Near-monochrome, or a single ultra-restrained accent used on under ~10% of the surface (live/active states, the key number, the active nav, the sparkline). No rainbow categorical color, no neon, no glow, no decorative multi-stop gradients. At most one barely-perceptible single-hue radial depth wash.',
  '- Self-contained single HTML document. Google Fonts loaded only from fonts.googleapis.com / fonts.gstatic.com (use real families that exist there: Space Grotesk, Inter, Geist, Geist Mono, IBM Plex Mono, IBM Plex Sans, JetBrains Mono, Archivo).',
  '- MOTION: subtle and tasteful only - count-up on the hero number + KPIs on load, sparkline draw-in, gentle pulse on live dots, soft row hover lift. Nothing gaudy.',
  '- Impeccable type scale and rhythm; tabular numerals for every figure; accessible contrast; no meaningful text below 11px.',
  '- Output a COMPLETE valid HTML document: doctype, html, head with style, body, script.',
].join('\n')

const DIRECTIONS = [
  {
    key: 'platinum',
    thesis: 'PLATINUM MONOCHROME - zero chromatic accent. Warm-neutral near-black canvas (~#0a0a0b), surfaces ~#111113, platinum text (~#ededec) with muted greys (~#8a8a86). The accent is pure near-white (#ffffff) used extremely sparingly plus brightness/weight contrast - color never carries meaning, hierarchy does. Hairline 1px separators, almost no card borders, vast whitespace. Fonts: Space Grotesk (display/numbers) + Inter (UI) + Geist Mono or IBM Plex Mono (data). The timeless Linear/Vercel confident-absence-of-color bet - the safest path to looking expensive.',
  },
  {
    key: 'ice',
    thesis: 'COOL STEEL INSTRUMENT - cool near-black canvas (~#08090b), desaturated slate-neutral greys with a faint cool undertone, and ONE restrained ice accent (~#a8c7d6 / #9db4c0, low chroma) used only for live/active states, the key number, and the sparkline. Mono-forward and precise - reads like a serious quant/eval instrument. Hairline grid, tight tracked mono labels, generous gutters. Fonts: IBM Plex Mono / Space Mono lead + Inter or Space Grotesk for display.',
  },
  {
    key: 'bone',
    thesis: 'BONE AND GRAPHITE - warm but absolutely no gold. Warm graphite canvas (~#0b0a09), and a single bone/ivory light (~#ece7dd, no chroma) as the lone highlight. Warm-grey neutrals. Calm editorial spacing but a strictly grotesk/technical type system (Inter Display / Space Grotesk + IBM Plex Mono). Very airy, paper-like restraint on black. Accent is warmth-of-neutral and light, never a hue.',
  },
  {
    key: 'eclipse',
    thesis: 'ECLIPSE - deepest near-black (~#060608), maximal negative space, oversized confident grotesk display. ONE very desaturated cold pop (muted periwinkle/slate-violet ~#8b8fc7, low chroma) reserved strictly for active/live states and the single hero figure - everything else monochrome. Minimal chrome, no visible card borders, sections divided by space alone. Big type, tiny mono labels. Fonts: Space Grotesk (large display) + Inter + JetBrains Mono.',
  },
  {
    key: 'carbon',
    thesis: 'CARBON MONO-LUX - terminal de luxe. Almost entirely monospace (Geist Mono / JetBrains Mono / IBM Plex Mono) with a tight grotesk only for the largest display number. Monochrome graphite with crisp white highlights, hairline rules instead of cards, abundant air, micro tracked uppercase labels. The most technical register of the set - Berkeley-Mono / engineering-instrument restraint, but luxurious in spacing and precision. No hue at all.',
  },
]

const GEN_SCHEMA = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    thesis: { type: 'string', description: 'one-line summary of the aesthetic you executed' },
    html: { type: 'string', description: 'a COMPLETE self-contained HTML document implementing the full page' },
    palette: {
      type: 'object',
      properties: {
        canvas: { type: 'string' }, surface: { type: 'string' },
        textPrimary: { type: 'string' }, textMuted: { type: 'string' },
        accent: { type: 'string' }, accentUsage: { type: 'string' },
      },
      required: ['canvas', 'accent', 'accentUsage'],
    },
    fonts: {
      type: 'object',
      properties: { display: { type: 'string' }, ui: { type: 'string' }, mono: { type: 'string' } },
      required: ['display', 'mono'],
    },
    notes: { type: 'string', description: 'the 3-4 most important design decisions and why they read as premium' },
  },
  required: ['key', 'thesis', 'html', 'palette', 'fonts', 'notes'],
}

phase('Generate')
const candidates = (await parallel(DIRECTIONS.map((d) => () =>
  agent(
    'You are a world-class product designer (think the people behind Linear, Vercel, Stripe, Teenage Engineering) building ONE screen: the flagship Research Lab benchmark page of a frontier AI lab public dashboard.\n\nExecute THIS aesthetic direction with total conviction:\n' + d.thesis + '\n\n' + CONSTRAINTS + '\n\n' + CONTENT + '\n\nReturn the full standalone HTML document plus your palette, font stack, and key decisions. Make it the most premium, restrained, technically-credible thing you have ever produced. Every pixel should say expensive and serious.',
    { schema: GEN_SCHEMA, label: 'gen:' + d.key, phase: 'Generate', effort: 'high' }
  )
))).filter(Boolean)

const byKey = {}
candidates.forEach((c) => { byKey[c.key] = c })
const corpus = candidates.map((c) =>
  '### CANDIDATE "' + c.key + '"\nthesis: ' + c.thesis + '\npalette: ' + JSON.stringify(c.palette) + '\nfonts: ' + JSON.stringify(c.fonts) + '\nnotes: ' + c.notes + '\n\nFULL HTML:\n' + c.html
).join('\n\n--------------------------------\n\n')

const LENSES = [
  { key: 'luxury', brief: 'You are a luxury/brand creative director with an unforgiving eye. Score how EXTREMELY PREMIUM and expensive each feels. Aggressively penalize anything tacky, generic, templated, SaaS-default, over-decorated, or that uses gold/amber/yellow at all. Reward restraint, confidence, and the sense that real taste and money are behind it.' },
  { key: 'frontier', brief: 'You are the design lead at a frontier AI research lab (Anthropic/OpenAI calibre). Score how credibly each reads as a serious research instrument / eval surface for investors and technical contributors: technical register, data legibility, trustworthiness (the provenance/verifiable framing), and information hierarchy. Penalize marketing fluff or anything that feels like a toy.' },
  { key: 'craft', brief: 'You are a typography and layout craft obsessive (Rauno Freiberg / Berkeley Graphics calibre). Score pure execution: type scale and pairing, vertical rhythm, spacing/airiness done well (not just empty), hairline detailing, color discipline, alignment, and micro-interaction taste. Penalize density, muddy hierarchy, weak type, and any color that does not encode meaning.' },
]

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          premium: { type: 'number' }, technical: { type: 'number' },
          airiness: { type: 'number' }, craft: { type: 'number' },
          overall: { type: 'number', description: '0-100 weighted overall for THIS lens' },
          strongest: { type: 'string' },
          weakest: { type: 'string' },
          tackyFlags: { type: 'string', description: 'anything that reads cheap/tacky, or none' },
        },
        required: ['key', 'overall', 'strongest', 'weakest', 'tackyFlags'],
      },
    },
    ranking: { type: 'array', items: { type: 'string' }, description: 'candidate keys best-to-worst' },
    bestOverall: { type: 'string' },
    graft: { type: 'array', items: { type: 'string' }, description: 'specific concrete elements worth stealing into the final, each naming the source candidate' },
  },
  required: ['lens', 'scores', 'ranking', 'bestOverall', 'graft'],
}

phase('Critique')
const judgments = (await parallel(LENSES.map((l) => () =>
  agent(
    l.brief + '\n\nThe target: an EXTREMELY premium, airy, technical-register (grotesk + mono, no serif), strictly NO-GOLD, dark frontier-AI-lab benchmark dashboard.\n\nHere are the candidate designs as full HTML. Read the HTML/CSS as a design spec - evaluate palette, type, spacing, hierarchy, color discipline, motion, and overall feel. Be adversarial and specific.\n\n' + corpus + '\n\nScore every candidate, rank them, name the single best overall for your lens, and list specific elements worth grafting into a final synthesis (each grafted element must name its source candidate).',
    { schema: JUDGE_SCHEMA, label: 'judge:' + l.key, phase: 'Critique', effort: 'high' }
  )
))).filter(Boolean)

const agg = {}
candidates.forEach((c) => { agg[c.key] = { sum: 0, n: 0 } })
judgments.forEach((j) => (j.scores || []).forEach((s) => {
  if (agg[s.key]) { agg[s.key].sum += (s.overall || 0); agg[s.key].n += 1 }
}))
const ranked = Object.keys(agg)
  .map((k) => ({ key: k, avg: agg[k].n ? Math.round((agg[k].sum / agg[k].n) * 10) / 10 : 0 }))
  .sort((a, b) => b.avg - a.avg)
const winnerKey = ranked[0] ? ranked[0].key : candidates[0].key
const runnerKey = ranked[1] ? ranked[1].key : winnerKey
const graft = judgments.flatMap((j) => j.graft || [])
const critiqueDigest = judgments.map((j) =>
  'LENS ' + j.lens + ': best=' + j.bestOverall + '; ranking=' + (j.ranking || []).join(' > ') + '\n' +
  (j.scores || []).map((s) => '  ' + s.key + ' ' + Math.round(s.overall) + ' | +' + s.strongest + ' | -' + s.weakest + ' | tacky:' + s.tackyFlags).join('\n')
).join('\n\n')

log('Panel ranking: ' + ranked.map((r) => r.key + ' ' + r.avg).join('  /  ') + ' - winner: ' + winnerKey)

const SYNTH_SCHEMA = {
  type: 'object',
  properties: {
    html: { type: 'string', description: 'the final COMPLETE self-contained HTML document' },
    paletteSummary: { type: 'string' },
    fontStack: { type: 'string' },
    decisions: { type: 'array', items: { type: 'string' }, description: '6-10 crisp bullets explaining the premium design decisions' },
  },
  required: ['html', 'decisions'],
}

phase('Synthesize')
const synth = await agent(
  'You are the principal designer making the FINAL, definitive version of this screen - the one that ships. It must feel EXTREMELY premium, airy, technical, and contain NO gold/amber/yellow whatsoever.\n\n' +
  'The judge panel ranked the candidates and the winner is "' + winnerKey + '" (runner-up "' + runnerKey + '"). Use the winner as your structural and aesthetic base, then graft in the specific best elements the judges identified from the others. Resolve any conflicts in favor of the most restrained, most premium choice.\n\n' +
  'JUDGE DIGEST:\n' + critiqueDigest + '\n\nELEMENTS TO GRAFT (each names its source):\n' + graft.map((g) => '- ' + g).join('\n') + '\n\n' +
  'WINNER HTML ("' + winnerKey + '"):\n' + byKey[winnerKey].html + '\n\n' +
  (runnerKey !== winnerKey ? 'RUNNER-UP HTML ("' + runnerKey + '") for grafting reference:\n' + byKey[runnerKey].html + '\n\n' : '') +
  CONSTRAINTS + '\n\n' + CONTENT + '\n\n' +
  'Produce the single best possible final HTML document. Tighten the type scale, increase airiness where it helps, perfect the color discipline, and make every detail intentional. This is the artifact that proves the lab has taste.',
  { schema: SYNTH_SCHEMA, label: 'synthesize:final', phase: 'Synthesize', effort: 'xhigh' }
)

return {
  ranked,
  winnerKey,
  runnerKey,
  winnerMeta: { thesis: byKey[winnerKey].thesis, palette: byKey[winnerKey].palette, fonts: byKey[winnerKey].fonts },
  critiqueDigest,
  paletteSummary: synth.paletteSummary,
  fontStack: synth.fontStack,
  decisions: synth.decisions,
  html: synth.html,
}
