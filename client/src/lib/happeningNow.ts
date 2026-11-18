import type { HomeFeedItem } from '@/types/homeFeed'
import { tCommunity } from '@/i18n/ns/community'

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
  if (role === 'coach') return `/coaches/id/${id}`
  if (role === 'umpire') return `/umpires/id/${id}`
  return `/players/id/${id}`
}

export function feedItemToMove(item: HomeFeedItem): HappeningMove | null {
  switch (item.item_type) {
    case 'opportunity_posted':
      return {
        id: item.feed_item_id,
        kind: 'role_opened',
        actor: item.club_name ?? tCommunity('happeningNow.aClub'),
        action: tCommunity('happeningNow.posted', { title: item.title }),
        avatarUrl: item.club_logo,
        actorRole: item.publisher_role ?? 'club',
        createdAt: item.created_at,
        path: `/opportunities/${item.opportunity_id}`,
      }
    case 'role_filled':
      // Vacancies can be coach-published — then club_id/club_name carry the
      // COACH's profile, and a hardcoded club path 404s ("Club profile not
      // found"). Route by the publisher's author_role (merged in by the RPC;
      // 'club' fallback covers cached pre-migration payloads).
      return {
        id: item.feed_item_id,
        kind: 'role_filled',
        actor: item.club_name ?? tCommunity('happeningNow.aClub'),
        action: tCommunity('happeningNow.filled', { title: item.title }),
        avatarUrl: item.club_avatar_url,
        actorRole: item.author_role ?? 'club',
        createdAt: item.created_at,
        path: profilePath(item.author_role ?? 'club', item.club_id),
      }
    case 'open_to_play_confirmed':
      return {
        id: item.feed_item_id,
        kind: 'open_to_play',
        actor: item.player_name ?? tCommunity('happeningNow.aPlayer'),
        action: tCommunity('happeningNow.openToPlay'),
        avatarUrl: item.player_avatar_url,
        actorRole: item.player_role,
        createdAt: item.created_at,
        path: profilePath(item.player_role, item.player_id),
      }
    case 'media_added':
      return {
        id: item.feed_item_id,
        kind: 'media',
        actor: item.uploader_name ?? tCommunity('happeningNow.aMember'),
        action: tCommunity('happeningNow.photos', { count: item.count }),
        avatarUrl: item.uploader_avatar_url,
        actorRole: item.uploader_role,
        createdAt: item.created_at,
        path: profilePath(item.uploader_role, item.uploader_id),
      }
    case 'video_added':
      return {
        id: item.feed_item_id,
        kind: 'video',
        actor: item.uploader_name ?? tCommunity('happeningNow.aMember'),
        action: item.kind === 'full_match' ? tCommunity('happeningNow.fullMatch') : tCommunity('happeningNow.highlight'),
        avatarUrl: item.uploader_avatar_url,
        actorRole: item.uploader_role,
        createdAt: item.created_at,
        path: profilePath(item.uploader_role, item.uploader_id),
      }
    case 'club_responded':
      // Same coach-publisher caveat as role_filled: route by author_role.
      return {
        id: item.feed_item_id,
        kind: 'responded',
        actor: item.club_name ?? tCommunity('happeningNow.aClub'),
        action: tCommunity('happeningNow.reviewed', { count: item.response_count }),
        avatarUrl: item.club_avatar_url,
        actorRole: item.author_role ?? 'club',
        createdAt: item.created_at,
        path: profilePath(item.author_role ?? 'club', item.club_id),
      }
    case 'career_move': {
      if (item.direction === 'signing') {
        return {
          id: item.feed_item_id,
          kind: 'signing',
          actor: item.club_name ?? tCommunity('happeningNow.aClub'),
          action: tCommunity('happeningNow.signed', { name: item.mover_name ?? tCommunity('happeningNow.aPlayerLower') }),
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
        actor: item.mover_name ?? tCommunity('happeningNow.aPlayer'),
        action: item.club_name ? tCommunity('happeningNow.joined', { club: item.club_name }) : tCommunity('happeningNow.madeMove'),
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
          actor: item.author_name ?? tCommunity('happeningNow.aPlayer'),
          action: tCommunity('happeningNow.joined', { club: item.metadata.club_name }),
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
          actor: item.author_name ?? tCommunity('happeningNow.aClub'),
          action: tCommunity('happeningNow.signed', { name: item.metadata.person_name }),
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
