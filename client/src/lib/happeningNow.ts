import type { HomeFeedItem } from '@/types/homeFeed'

/**
 * "Happening now" (Home redesign V2, Pulse): compress feed items into
 * one-line market moves — who moved, joined, opened or filled a role, went
 * open-to-play, added evidence. Only MOVEMENT types map; posts/brand content/
 * milestones return null (they live on the Feed tab).
 *
 * Data comes from useHomeFeed (the get_home_feed RPC) — NEVER from a direct
 * home_feed_items read, which would bypass the hidden/test/blocked fences
 * that only exist inside the RPC + hook.
 */

export type MoveKind =
  | 'role_opened'
  | 'role_filled'
  | 'open_to_play'
  | 'transfer'
  | 'signing'
  | 'media'
  | 'video'
  | 'responded'

export interface HappeningMove {
  id: string
  kind: MoveKind
  /** Bolded subject of the one-liner. */
  actor: string
  /** Rest of the sentence, starts lowercase ("posted Goalkeeper wanted"). */
  action: string
  avatarUrl: string | null
  actorRole: string | null
  createdAt: string
  /** In-app path to the move's natural destination. */
  path: string
}

function profilePath(role: string | null | undefined, id: string): string {
  if (role === 'club') return `/clubs/id/${id}`
  if (role === 'umpire') return `/umpires/id/${id}`
  return `/players/id/${id}`
}

export function feedItemToMove(item: HomeFeedItem): HappeningMove | null {
  switch (item.item_type) {
    case 'opportunity_posted':
      return {
        id: item.feed_item_id,
        kind: 'role_opened',
        actor: item.club_name ?? 'A club',
        action: `posted ${item.title}`,
        avatarUrl: item.club_logo,
        actorRole: item.publisher_role ?? 'club',
        createdAt: item.created_at,
        path: `/opportunities/${item.opportunity_id}`,
      }
    case 'role_filled':
      return {
        id: item.feed_item_id,
        kind: 'role_filled',
        actor: item.club_name ?? 'A club',
        action: `filled ${item.title}`,
        avatarUrl: item.club_avatar_url,
        actorRole: 'club',
        createdAt: item.created_at,
        path: `/clubs/id/${item.club_id}`,
      }
    case 'open_to_play_confirmed':
      return {
        id: item.feed_item_id,
        kind: 'open_to_play',
        actor: item.player_name ?? 'A player',
        action: 'is open to play',
        avatarUrl: item.player_avatar_url,
        actorRole: item.player_role,
        createdAt: item.created_at,
        path: profilePath(item.player_role, item.player_id),
      }
    case 'media_added':
      return {
        id: item.feed_item_id,
        kind: 'media',
        actor: item.uploader_name ?? 'A member',
        action: `added ${item.count} new photo${item.count === 1 ? '' : 's'}`,
        avatarUrl: item.uploader_avatar_url,
        actorRole: item.uploader_role,
        createdAt: item.created_at,
        path: profilePath(item.uploader_role, item.uploader_id),
      }
    case 'video_added':
      return {
        id: item.feed_item_id,
        kind: 'video',
        actor: item.uploader_name ?? 'A member',
        action: item.kind === 'full_match' ? 'added a full match video' : 'added a new highlight',
        avatarUrl: item.uploader_avatar_url,
        actorRole: item.uploader_role,
        createdAt: item.created_at,
        path: profilePath(item.uploader_role, item.uploader_id),
      }
    case 'club_responded':
      return {
        id: item.feed_item_id,
        kind: 'responded',
        actor: item.club_name ?? 'A club',
        action: `reviewed ${item.response_count} application${item.response_count === 1 ? '' : 's'} this week`,
        avatarUrl: item.club_avatar_url,
        actorRole: 'club',
        createdAt: item.created_at,
        path: `/clubs/id/${item.club_id}`,
      }
    case 'career_move': {
      if (item.direction === 'signing') {
        return {
          id: item.feed_item_id,
          kind: 'signing',
          actor: item.club_name ?? 'A club',
          action: `signed ${item.mover_name ?? 'a player'}`,
          avatarUrl: item.club_avatar_url,
          actorRole: 'club',
          createdAt: item.created_at,
          path: item.club_profile_id
            ? `/clubs/id/${item.club_profile_id}`
            : profilePath(item.mover_role, item.mover_profile_id),
        }
      }
      return {
        id: item.feed_item_id,
        kind: 'transfer',
        actor: item.mover_name ?? 'A player',
        action: item.club_name ? `joined ${item.club_name}` : 'made a move',
        avatarUrl: item.mover_avatar_url,
        actorRole: item.mover_role,
        createdAt: item.created_at,
        path: profilePath(item.mover_role, item.mover_profile_id),
      }
    }
    case 'user_post': {
      if (item.post_type === 'transfer' && item.metadata && 'club_name' in item.metadata) {
        return {
          id: item.feed_item_id,
          kind: 'transfer',
          actor: item.author_name ?? 'A player',
          action: `joined ${item.metadata.club_name}`,
          avatarUrl: item.author_avatar,
          actorRole: item.author_role,
          createdAt: item.created_at,
          path: profilePath(item.author_role, item.author_id),
        }
      }
      if (item.post_type === 'signing' && item.metadata && 'person_name' in item.metadata) {
        return {
          id: item.feed_item_id,
          kind: 'signing',
          actor: item.author_name ?? 'A club',
          action: `signed ${item.metadata.person_name}`,
          avatarUrl: item.author_avatar,
          actorRole: item.author_role,
          createdAt: item.created_at,
          path: profilePath(item.author_role, item.author_id),
        }
      }
      return null // plain text/photo posts belong to the Feed tab
    }
    default:
      return null
  }
}

/** Newest-first movement digest from a feed page. */
export function toHappeningMoves(items: HomeFeedItem[], max: number): HappeningMove[] {
  const moves: HappeningMove[] = []
  for (const item of items) {
    const move = feedItemToMove(item)
    if (move) moves.push(move)
    if (moves.length >= max) break
  }
  return moves
}
