import { useCallback, useState } from 'react'
import { invokeNlSearch } from '@/hooks/useDiscover'
import { parseRefineResponse, type RefineAnswer } from '@/lib/roleSuggestions'

export interface RefineTurn {
  id: string
  question: string
  answer: RefineAnswer | null
}

/**
 * D5.2 conversation, local to the screen: each question goes to nl-search
 * mode role_suggestions_refine, which reads ONLY the stored suggestions'
 * profile facts and counts toward the daily Hockia AI cap.
 */
export function useSuggestRefine(roleId: string | null | undefined, poolIds: string[]) {
  const [turns, setTurns] = useState<RefineTurn[]>([])
  const [pending, setPending] = useState(false)
  const poolKey = poolIds.join(',')

  const ask = useCallback(async (question: string) => {
    const q = question.trim()
    if (!q || !roleId || pending) return
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const history = turns
      .flatMap((t) => [
        { role: 'user' as const, content: t.question },
        ...(t.answer?.kind === 'answer' && t.answer.message ? [{ role: 'assistant' as const, content: t.answer.message }] : []),
      ])
      .slice(-6)
    setTurns((cur) => [...cur, { id, question: q, answer: null }])
    setPending(true)
    let answer: RefineAnswer
    try {
      const { data, error } = await invokeNlSearch({ mode: 'role_suggestions_refine', opportunity_id: roleId, query: q, history })
      answer = error ? { kind: 'error', message: '', matchIds: [], chips: [] } : parseRefineResponse(data, poolKey ? poolKey.split(',') : [])
    } catch {
      answer = { kind: 'error', message: '', matchIds: [], chips: [] }
    }
    setTurns((cur) => cur.map((t) => (t.id === id ? { ...t, answer } : t)))
    setPending(false)
  }, [roleId, pending, turns, poolKey])

  return { turns, pending, ask }
}
