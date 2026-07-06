export function isDeepResearchEnabled(): boolean {
  return process.env.DEEP_RESEARCH_ENABLED === 'true' &&
    process.env.DEEP_RESEARCH_DISABLED !== 'true' &&
    process.env.DEEP_RESEARCH_SWEEP_DISABLED !== 'true'
}

