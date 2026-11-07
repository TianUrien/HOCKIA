/**
 * Community photo grid order (iOS audit 2026-11-06). A club card spans the whole
 * row, so a club placed after a half-filled row leaves a hole beside the last
 * person card. Hold each club back until the person cards before it fill their
 * row, then let it through. Clubs still held at the end go before the last,
 * unfinished row of people, so the only gap left is at the very end of the list.
 * A club moves by less than one row of people.
 */
export function packWideCards<T>(items: readonly T[], isWide: (item: T) => boolean, columns: number): T[] {
  if (columns <= 1) return [...items]
  const out: T[] = []
  const held: T[] = []
  let inRow = 0
  for (const item of items) {
    if (isWide(item)) {
      if (inRow === 0) out.push(item)
      else held.push(item)
      continue
    }
    out.push(item)
    inRow = (inRow + 1) % columns
    if (inRow === 0 && held.length > 0) out.push(...held.splice(0))
  }
  if (held.length > 0) out.splice(out.length - inRow, 0, ...held)
  return out
}
