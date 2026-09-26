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
