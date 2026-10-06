/**
 * Bounds on the chat history a client sends to an LLM-backed function, so a
 * crafted request can't inflate the prompt (and the bill).
 *
 *   - at most `maxTurns` most-recent turns with a valid role and string content
 *   - each turn's content cut to `perTurnChars`
 *   - the total kept to `totalChars`, newest turns first (older turns drop
 *     out; the oldest kept turn may be cut to fit)
 */

export const HISTORY_MAX_TURNS = 10
export const HISTORY_TURN_MAX_CHARS = 1000
export const HISTORY_TOTAL_MAX_CHARS = 6000

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export function boundHistory(
  raw: unknown,
  opts: { maxTurns?: number; perTurnChars?: number; totalChars?: number } = {},
): ChatTurn[] {
  const maxTurns = opts.maxTurns ?? HISTORY_MAX_TURNS
  const perTurn = opts.perTurnChars ?? HISTORY_TURN_MAX_CHARS
  const total = opts.totalChars ?? HISTORY_TOTAL_MAX_CHARS
  if (!Array.isArray(raw)) return []
  const valid: ChatTurn[] = raw
    .filter((t): t is ChatTurn =>
      !!t && typeof t === 'object' &&
      ((t as ChatTurn).role === 'user' || (t as ChatTurn).role === 'assistant') &&
      typeof (t as ChatTurn).content === 'string')
    .slice(-maxTurns)
    .map((t) => ({ role: t.role, content: t.content.slice(0, perTurn) }))

  const kept: ChatTurn[] = []
  let budget = total
  for (let i = valid.length - 1; i >= 0 && budget > 0; i--) {
    const turn = valid[i]
    const content = turn.content.length > budget ? turn.content.slice(0, budget) : turn.content
    kept.unshift({ role: turn.role, content })
    budget -= content.length
  }
  return kept
}

/** Window in which a "Show more" for the same question counts as a continuation. */
export const CONTINUATION_WINDOW_MINUTES = 30
