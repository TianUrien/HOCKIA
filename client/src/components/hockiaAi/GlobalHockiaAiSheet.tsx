import { Suspense, useEffect, useState } from 'react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { lazyWithRetry } from '@/lib/lazyWithRetry'
import { useHockiaAiSheet } from './hockiaAiSheetStore'
import { useHockiaAiSuggestion } from './hockiaAiSuggestionStore'
import { useAuthStore } from '@/lib/auth'
import { trackDbEvent } from '@/lib/trackDbEvent'

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
  const profile = useAuthStore((s) => s.profile)
  const refresh = useHockiaAiSuggestion((s) => s.refresh)
  // What Hockia AI has for this member: read on sign-in and when they come back to the app.
  const viewerId = profile?.id ?? null
  const viewerRole = profile?.role ?? null
  const hasPhoto = Boolean(profile?.avatar_url)
  const hasBio = Boolean(profile?.bio?.trim())
  useEffect(() => {
    const viewer = profile && viewerId ? { id: viewerId, role: viewerRole, coach_recruits_for_team: profile.coach_recruits_for_team, avatar_url: profile.avatar_url, bio: profile.bio, is_test_account: profile.is_test_account } : null
    void refresh(viewer, true)
    if (!viewer) return
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(viewer) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // The profile object changes identity on every store update: key on the facts the suggestion reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId, viewerRole, hasPhoto, hasBio, refresh])
  // Every open, whatever the entry point: how many members reach Hockia AI at all (founder, 2026-11-21).
  useEffect(() => {
    if (!open) { useHockiaAiSuggestion.getState().clearShown(); return }
    const { entry, mode } = useHockiaAiSheet.getState()
    const suggestion = useHockiaAiSuggestion.getState().fresh?.kind ?? null
    trackDbEvent('hockia_ai_open', undefined, undefined, { entry, mode, suggestion })
    useHockiaAiSuggestion.getState().markOpened()
  }, [open])
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
