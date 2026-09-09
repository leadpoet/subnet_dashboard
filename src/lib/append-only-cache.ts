/** Only use with a fixed read scope and tables that reject updates/deletes. */
export function createAppendOnlyCache<T>() {
  let cached: { count: number; value: T } | null = null

  return async (
    readCount: () => Promise<number>,
    load: (expectedCount: number) => Promise<T>,
  ): Promise<T> => {
    const count = await readCount()
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error('Append-only history count unavailable')
    }
    if (cached?.count === count) return cached.value

    const value = await load(count)
    // A concurrent append can shift offset pagination. Do not retain or serve
    // that mixed snapshot; the next request retries after the flight clears.
    if (await readCount() !== count) {
      throw new Error('Append-only history changed during refresh; retry required')
    }
    cached = { count, value }
    return value
  }
}
