import { describe, it, expect } from 'vitest'
import { feedItemToMove, toHappeningMoves } from '@/lib/happeningNow'
import type { HomeFeedItem, UserPostFeedItem } from '@/types/homeFeed'

/**
 * The Pulse "Happening now" digest mapper: movement types compress to
 * one-liners; posts/brand/milestone content stays on the Feed tab (null).
 */

const base = { feed_item_id: 'f1', created_at: '2026-07-11T10:00:00Z' }

const userPost = (overrides: Partial<UserPostFeedItem>): HomeFeedItem =>
  ({
    ...base,
    item_type: 'user_post',
    post_id: 'p1',
    author_id: 'u1',
    author_name: 'Ana',
    author_avatar: null,
    author_role: 'player',
    content: '',
    images: null,
    like_count: 0,
    comment_count: 0,
    has_liked: false,
    ...overrides,
  }) as HomeFeedItem

describe('feedItemToMove', () => {
  it('maps opportunity_posted to a role-opened move', () => {
    const move = feedItemToMove({
      ...base,
      item_type: 'opportunity_posted',
      opportunity_id: 'o1',
      title: 'Goalkeeper wanted',
      opportunity_type: 'player',
      position: 'goalkeeper',
      gender: 'Women',
      location_city: null,
      location_country: null,
      club_id: 'c1',
      club_name: 'HC Buenos Aires',
      club_logo: null,
      priority: null,
      start_date: null,
    } as HomeFeedItem)
    expect(move).toMatchObject({
      kind: 'role_opened',
      actor: 'HC Buenos Aires',
      action: 'posted Goalkeeper wanted',
      path: '/opportunities/o1',
    })
  })

  it('maps role_filled to the club profile', () => {
    const move = feedItemToMove({
      ...base,
      item_type: 'role_filled',
      opportunity_id: 'o1',
      title: 'Goalkeeper wanted',
      position: 'goalkeeper',
      opportunity_type: 'player',
      filled_via_hockia: true,
      club_id: 'c1',
      club_name: 'HC Buenos Aires',
      club_avatar_url: null,
    } as HomeFeedItem)
    expect(move).toMatchObject({
      kind: 'role_filled',
      action: 'filled Goalkeeper wanted',
      path: '/clubs/id/c1',
    })
  })

  it('maps open_to_play, media (pluralized), video (by kind) and club_responded', () => {
    expect(
      feedItemToMove({
        ...base,
        item_type: 'open_to_play_confirmed',
        player_id: 'u1',
        player_name: 'Ana',
        player_role: 'player',
        player_avatar_url: null,
        country_id: null,
        position: null,
        playing_category: null,
        available_from: null,
        open_to_opportunities: true,
        confirmed_at: null,
        first_confirmed_at: null,
      } as HomeFeedItem),
    ).toMatchObject({ kind: 'open_to_play', action: 'is open to play', path: '/players/id/u1' })

    const media = (count: number) =>
      feedItemToMove({
        ...base,
        item_type: 'media_added',
        uploader_id: 'u2',
        uploader_name: 'Leo',
        uploader_role: 'umpire',
        uploader_avatar_url: null,
        media_kind: 'photo',
        day: '2026-07-11',
        count,
        sample_urls: [],
        last_added_at: null,
      } as HomeFeedItem)
    expect(media(3)).toMatchObject({ action: 'added 3 new photos', path: '/umpires/id/u2' })
    expect(media(1)).toMatchObject({ action: 'added 1 new photo' })

    const video = (kind: 'highlight' | 'full_match') =>
      feedItemToMove({
        ...base,
        item_type: 'video_added',
        media_kind: 'video',
        video_source: 'native',
        video_id: 'v1',
        kind,
        title: null,
        duration_seconds: null,
        visibility: 'public',
        uploader_id: 'u3',
        uploader_name: 'Marta',
        uploader_role: 'player',
        uploader_avatar_url: null,
      } as HomeFeedItem)
    expect(video('highlight')).toMatchObject({ action: 'added a new highlight' })
    expect(video('full_match')).toMatchObject({ action: 'added a full match video' })

    expect(
      feedItemToMove({
        ...base,
        item_type: 'club_responded',
        club_id: 'c2',
        club_name: 'CASI',
        club_avatar_url: null,
        week_start: '2026-07-06',
        response_count: 4,
        responsiveness_tier: null,
        last_response_at: null,
      } as HomeFeedItem),
    ).toMatchObject({ action: 'reviewed 4 applications this week', path: '/clubs/id/c2' })
  })

  // Vacancies can be COACH-published: the club_* fields of club_responded /
  // role_filled then carry the coach's PROFILE id — routing them to the club
  // page 404s ("Club profile not found", live prod repro 2026-07-21). The
  // RPCs merge home_feed_items.author_role since 20260722; the mapper must
  // route by it, with 'club' as the pre-migration-cache fallback.
  it('routes coach-published club_responded / role_filled to the coach profile', () => {
    const responded = feedItemToMove({
      ...base,
      item_type: 'club_responded',
      author_role: 'coach',
      club_id: 'coach-1',
      club_name: 'Rodrigo Levy',
      club_avatar_url: null,
      week_start: '2026-07-20',
      response_count: 2,
      responsiveness_tier: null,
      last_response_at: null,
    } as HomeFeedItem)
    expect(responded).toMatchObject({
      kind: 'responded',
      actorRole: 'coach',
      path: '/coaches/id/coach-1',
    })

    const filled = feedItemToMove({
      ...base,
      item_type: 'role_filled',
      author_role: 'coach',
      opportunity_id: 'o9',
      title: 'Forward wanted',
      position: 'forward',
      opportunity_type: 'player',
      filled_via_hockia: false,
      club_id: 'coach-1',
      club_name: 'Rodrigo Levy',
      club_avatar_url: null,
    } as HomeFeedItem)
    expect(filled).toMatchObject({
      kind: 'role_filled',
      actorRole: 'coach',
      path: '/coaches/id/coach-1',
    })

    // Explicit club publisher keeps the club route.
    const clubResponded = feedItemToMove({
      ...base,
      item_type: 'club_responded',
      author_role: 'club',
      club_id: 'c9',
      club_name: 'CASI',
      club_avatar_url: null,
      week_start: '2026-07-20',
      response_count: 1,
      responsiveness_tier: null,
      last_response_at: null,
    } as HomeFeedItem)
    expect(clubResponded).toMatchObject({ path: '/clubs/id/c9', actorRole: 'club' })
  })

  it('maps transfer and signing announcements, drops plain posts', () => {
    expect(
      feedItemToMove(
        userPost({
          post_type: 'transfer',
          metadata: {
            club_name: 'Club Ciudad',
            club_country_id: null,
            club_country_code: null,
            club_country_name: null,
            club_avatar_url: null,
            world_club_id: null,
            club_profile_id: null,
            is_known_club: false,
          },
        }),
      ),
    ).toMatchObject({ kind: 'transfer', actor: 'Ana', action: 'joined Club Ciudad' })

    expect(
      feedItemToMove(
        userPost({
          author_name: 'HC Buenos Aires',
          author_role: 'club',
          post_type: 'signing',
          metadata: {
            person_name: 'Juan',
            person_role: 'player',
            person_avatar_url: null,
            person_profile_id: 'u9',
            person_position: null,
          },
        }),
      ),
    ).toMatchObject({ kind: 'signing', action: 'signed Juan', path: '/clubs/id/u1' })

    expect(feedItemToMove(userPost({ post_type: 'text' }))).toBeNull()
    expect(feedItemToMove(userPost({}))).toBeNull()
  })

  it('maps career_move rows (the digest-only type) by direction', () => {
    const careerMove = (direction: 'transfer' | 'signing', clubProfileId: string | null) =>
      feedItemToMove({
        ...base,
        item_type: 'career_move',
        post_id: 'p1',
        direction,
        mover_profile_id: 'u1',
        mover_name: 'Ana',
        mover_role: 'player',
        mover_avatar_url: null,
        club_name: 'Club Ciudad',
        club_world_club_id: null,
        club_avatar_url: null,
        club_profile_id: clubProfileId,
      } as HomeFeedItem)

    expect(careerMove('transfer', null)).toMatchObject({
      kind: 'transfer',
      actor: 'Ana',
      action: 'joined Club Ciudad',
      path: '/players/id/u1',
    })
    expect(careerMove('signing', 'c1')).toMatchObject({
      kind: 'signing',
      actor: 'Club Ciudad',
      action: 'signed Ana',
      path: '/clubs/id/c1',
    })
    // Unlinked club on a signing → fall back to the mover's profile.
    expect(careerMove('signing', null)).toMatchObject({ path: '/players/id/u1' })
  })

  it('drops non-movement types', () => {
    expect(
      feedItemToMove({
        ...base,
        item_type: 'milestone_achieved',
        milestone_type: 'first_video',
        profile_id: 'u1',
        full_name: 'Ana',
        avatar_url: null,
        role: 'player',
      } as HomeFeedItem),
    ).toBeNull()
  })
})

describe('toHappeningMoves', () => {
  it('keeps feed order, skips non-moves, respects max', () => {
    const items: HomeFeedItem[] = [
      userPost({ post_type: 'text' }),
      userPost({ feed_item_id: 'f2', post_type: 'transfer', metadata: { club_name: 'A', club_country_id: null, club_country_code: null, club_country_name: null, club_avatar_url: null, world_club_id: null, club_profile_id: null, is_known_club: false } } as Partial<UserPostFeedItem>),
      userPost({ feed_item_id: 'f3', post_type: 'transfer', metadata: { club_name: 'B', club_country_id: null, club_country_code: null, club_country_name: null, club_avatar_url: null, world_club_id: null, club_profile_id: null, is_known_club: false } } as Partial<UserPostFeedItem>),
    ]
    const moves = toHappeningMoves(items, 1)
    expect(moves).toHaveLength(1)
    expect(moves[0].id).toBe('f2')
  })
})
