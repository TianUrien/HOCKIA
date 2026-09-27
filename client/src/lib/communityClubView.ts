import { rankScoutRows } from '@/lib/findPlayers'
import type { FitState } from '@/lib/clubRecruiting'

/**
 * Community in club view (Figma D1 · D1.17 352:995; DEV NOTE 355:905).
 * Phone only, clubs and coaches who recruit, Players selected. Pure helpers:
 * the ranking and the sort labels. CLUB-facing only — fit never reaches a
 * player surface.
 */

export interface ClubViewFit {
  state: FitState
  score: number
}

export interface ClubViewRankable {
  id: string
  role: string
  open_to_play?: boolean | null
  full_game_video_count?: number | null
  career_entry_count?: number | null
  last_active_at?: string | null
}

/**
 * "Best fit" order: open to play first (founder ruling 2026-09-26, club-facing
 * lists), then compute_club_fit score for the active context, then evidence —
 * full matches, highlights, career — then most recently active. Same order as
 * Find players (DEV NOTE 332:741). `byFit: false` (no context, or the club's
 * league has no level) ranks by evidence only.
 */
export function rankCommunityClubView<T extends ClubViewRankable>(
  members: T[],
  fit: Map<string, ClubViewFit>,
  highlights: Map<string, number>,
  opts: { byFit: boolean },
): T[] {
  const rows = members.map((m) => ({
    m,
    fitScore: fit.get(m.id)?.score ?? null,
    full_game_video_count: m.full_game_video_count ?? null,
    highlights: highlights.get(m.id) ?? 0,
    career_entry_count: m.career_entry_count ?? null,
    last_active_at: m.last_active_at ?? null,
  }))
  const ranked = rankScoutRows(rows, opts)
  // Array.prototype.sort is stable, so this keeps the fit/evidence order inside each group.
  return ranked
    .sort((a, b) => Number(b.m.open_to_play === true) - Number(a.m.open_to_play === true))
    .map((r) => r.m)
}

/** The sort menu in club view: "Best fit" replaces "Newest" while a player context ranks the grid. */
export function clubViewSortOptions(fitActive: boolean): { value: 'newest' | 'evidence' | 'completeness'; label: string }[] {
  return [
    { value: 'newest', label: fitActive ? 'Best fit' : 'Newest' },
    { value: 'evidence', label: 'Strongest evidence' },
    { value: 'completeness', label: 'Most complete' },
  ]
}
