import { useProfileVideos } from '@/hooks/useProfileVideos'
import { useVideoAccessSummary } from '@/hooks/useVideoAccessSummary'

export interface ProfileVideoTotalInput {
  /** player_videos rows the viewer can read (highlights + full matches + reels). */
  videoRows: number
  /** player_full_game_videos rows the viewer can read. */
  fullGameLinks: number
  /** Legacy profiles.highlight_video_url. */
  hasLegacyHighlight: boolean
  /** Recruiters-only rows RLS hid from this viewer (shown as locked tiles). */
  lockedFullMatches: number
  lockedHighlights: number
}

/**
 * Every video tile the viewer sees on a profile — the same sum as the phone
 * Videos screen: highlights (+ the legacy highlight link) + full matches
 * (uploaded + linked) + reels, plus the locked tiles for recruiters-only rows
 * RLS hides from this viewer (they're drawn, so they count).
 */
export function profileVideoTotal(i: ProfileVideoTotalInput): number {
  return i.videoRows + i.fullGameLinks + (i.hasLegacyHighlight ? 1 : 0) + i.lockedFullMatches + i.lockedHighlights
}

/**
 * The "Videos" number on the desktop profile. The phone gets it from the
 * long scroll; desktop never mounts that tree, so it used to fall back to
 * profiles.full_game_video_count (+1 for the legacy link) — which misses
 * uploaded highlights, full matches and reels. null while loading.
 */
export function useProfileVideoTotal(
  profile: { id: string; highlight_video_url?: string | null } | null | undefined,
  opts: { own: boolean; enabled: boolean },
): number | null {
  const id = profile?.id ?? null
  const { videos, links, loading } = useProfileVideos(id, opts.enabled)
  const access = useVideoAccessSummary(id, { enabled: opts.enabled && !opts.own })
  if (!opts.enabled || !id || loading) return null
  return profileVideoTotal({
    videoRows: videos.length,
    fullGameLinks: links.length,
    hasLegacyHighlight: Boolean(profile?.highlight_video_url),
    lockedFullMatches: opts.own ? 0 : access.lockedFullMatches,
    lockedHighlights: opts.own ? 0 : access.lockedHighlights,
  })
}
