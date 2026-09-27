import type { ProfileVideo } from '@/hooks/useProfileVideos'

export interface PlayerVideoChecklist {
  hasHighlight: boolean
  hasFullMatch: boolean
}

/**
 * The owner's "Highlight video" / "Full match video" checklist ticks. A
 * highlight is the legacy profiles.highlight_video_url OR an uploaded
 * highlight; a full match is a linked full game (full_game_video_count) OR an
 * uploaded full match. `videos` = the owner's ready player_videos rows
 * (useProfileVideos). Client display only — the server score has its own rule.
 */
export function playerVideoChecklist(
  profile: { highlight_video_url?: string | null; full_game_video_count?: number | null },
  videos: Pick<ProfileVideo, 'kind'>[],
): PlayerVideoChecklist {
  return {
    hasHighlight: Boolean(profile.highlight_video_url?.trim()) || videos.some((v) => v.kind === 'highlight'),
    hasFullMatch: (profile.full_game_video_count ?? 0) > 0 || videos.some((v) => v.kind === 'full_match'),
  }
}

export interface PlayerMediaCounts {
  highlights: number
  fullMatches: number
}

/**
 * Highlight / full-match COUNTS for the desktop Media tile and the scouting
 * card's Media line. Same sources as the checklist: the legacy highlight link
 * (0 or 1) + uploaded highlights; linked full games (full_game_video_count) +
 * uploaded full matches. `videos` = the ready player_videos rows the viewer can
 * read (useProfileVideos). Reels count as neither.
 */
export function playerMediaCounts(
  profile: { highlight_video_url?: string | null; full_game_video_count?: number | null },
  videos: Pick<ProfileVideo, 'kind'>[],
): PlayerMediaCounts {
  return {
    highlights: (profile.highlight_video_url?.trim() ? 1 : 0) + videos.filter((v) => v.kind === 'highlight').length,
    fullMatches: (profile.full_game_video_count ?? 0) + videos.filter((v) => v.kind === 'full_match').length,
  }
}
