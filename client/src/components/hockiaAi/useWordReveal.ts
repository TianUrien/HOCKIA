import { useEffect, useState } from 'react'
import { prefersReducedMotion } from '@/lib/spring'

/**
 * Reveal `text` word by word (Hockia AI answers, handoff 2026-10-17). About
 * 30 ms a word, never longer than ~1.6 s in total; Reduce Motion or an
 * inactive reveal shows everything at once. Calls onDone once.
 */
export function useWordReveal(text: string, active: boolean, onDone: () => void): string {
  const words = text.split(/(\s+)/)
  const total = words.length
  const [shown, setShown] = useState(active && !prefersReducedMotion() ? 0 : total)
  useEffect(() => {
    if (!active || prefersReducedMotion()) { setShown(total); return }
    setShown(0)
    const step = Math.max(1, Math.ceil(total / 54))
    const id = window.setInterval(() => {
      setShown((n) => {
        const next = Math.min(total, n + step)
        if (next >= total) window.clearInterval(id)
        return next
      })
    }, 30)
    return () => window.clearInterval(id)
  }, [active, text, total])
  useEffect(() => { if (active && shown >= total) onDone() }, [active, shown, total, onDone])
  return shown >= total ? text : words.slice(0, shown).join('')
}
