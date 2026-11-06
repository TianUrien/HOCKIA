import { Suspense, useEffect, useState } from 'react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { lazyWithRetry } from '@/lib/lazyWithRetry'
import { useHockiaAiSheet } from './hockiaAiSheetStore'

// Its own chunk, loaded on the first open; a stale chunk after a deploy
// recovers like the routes do instead of flashing the error screen.
const PANEL_CLOSE_MS = 200

const HockiaAiSheet = lazyWithRetry(() => import('./HockiaAiSheet').then((m) => ({ default: m.HockiaAiSheet })))

/**
 * Hockia AI is one sheet for the whole app (founder ruling 2026-10-22,
 * docs/design-handoff/hockia-ai-one-sheet.md): mounted once here, opened from
 * any entry through useHockiaAiSheet. Screens never mount their own copy.
 */
export function GlobalHockiaAiSheet() {
  const open = useHockiaAiSheet((s) => s.open)
  // The web side panel slides out before it unmounts (200 ms, design review
  // 2026-11-06); the phone sheet closes at once, as before.
  const panel = useMediaQuery('(min-width: 1024px)')
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  if (!open && mounted && !panel) setMounted(false)
  useEffect(() => {
    if (open || !mounted) return
    const timer = setTimeout(() => setMounted(false), PANEL_CLOSE_MS)
    return () => clearTimeout(timer)
  }, [open, mounted])
  if (!mounted) return null
  return <Suspense fallback={null}><HockiaAiSheet leaving={!open} /></Suspense>
}
