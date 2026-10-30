import { Suspense } from 'react'
import { lazyWithRetry } from '@/lib/lazyWithRetry'
import { useHockiaAiSheet } from './hockiaAiSheetStore'

// Its own chunk, loaded on the first open; a stale chunk after a deploy
// recovers like the routes do instead of flashing the error screen.
const HockiaAiSheet = lazyWithRetry(() => import('./HockiaAiSheet').then((m) => ({ default: m.HockiaAiSheet })))

/**
 * Hockia AI is one sheet for the whole app (founder ruling 2026-10-22,
 * docs/design-handoff/hockia-ai-one-sheet.md): mounted once here, opened from
 * any entry through useHockiaAiSheet. Screens never mount their own copy.
 */
export function GlobalHockiaAiSheet() {
  const open = useHockiaAiSheet((s) => s.open)
  if (!open) return null
  return <Suspense fallback={null}><HockiaAiSheet /></Suspense>
}
