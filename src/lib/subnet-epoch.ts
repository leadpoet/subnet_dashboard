export interface SubnetEpochState {
  currentBlock: number | null
  tempo: number | null
  lastEpochBlock: number | null
  pendingEpochAt: number | null
}

function isNonNegativeInteger(value: number | null): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * Returns the exact number of chain blocks until the subnet's next epoch slot.
 *
 * Modern Subtensor schedules the normal slot from LastEpochBlock + Tempo. A
 * pending owner-triggered slot can move that boundary earlier. All inputs must
 * come from the same on-chain state snapshot.
 */
export function blocksUntilNextSubnetEpoch(state: SubnetEpochState): number | null {
  const { currentBlock, tempo, lastEpochBlock, pendingEpochAt } = state
  if (
    !isNonNegativeInteger(currentBlock) ||
    !isNonNegativeInteger(tempo) ||
    tempo === 0 ||
    !isNonNegativeInteger(lastEpochBlock) ||
    currentBlock < lastEpochBlock
  ) {
    return null
  }

  const normalEpochBlock = lastEpochBlock + tempo
  const manualEpochBlock = isNonNegativeInteger(pendingEpochAt) && pendingEpochAt > lastEpochBlock
    ? pendingEpochAt
    : null
  const nextEpochBlock = manualEpochBlock === null
    ? normalEpochBlock
    : Math.min(normalEpochBlock, manualEpochBlock)

  return Math.max(0, nextEpochBlock - currentBlock)
}
