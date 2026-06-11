import { describe, expect, it } from 'vitest'
import {
  PUBLIC_PROFILE_FIELDS,
  PUBLIC_CLUB_FIELDS,
  PUBLIC_UMPIRE_FIELDS,
} from '@/lib/publicProfileFields'

/**
 * Regression test for the public Profile Snapshot field set.
 *
 * History: an earlier audit found that PublicPlayerProfile / PublicClubProfile
 * fetched a typed subset of profile columns that did NOT include the columns
 * the ProfileSnapshot reads for its public ✓s (last_active_at,
 * accepted_reference_count, career_entry_count). The snapshot's `mode='public'`
 * filter then silently dropped every signal — a player with 5 references
 * and 3 career entries showed none of those public ✓s.
 *
 * This test fails loudly if the SELECT lists ever drop one of those columns
 * again. Each role's snapshot has its own minimum field set; this test
 * captures that contract per public-profile page.
 */

const playerCoachRequired = [
  'avatar_url',
  'position',
  'playing_category',
  'coaching_categories',
  'coach_specialization',
  'current_world_club_id',
  'highlight_video_url',
  'last_active_at',
  'accepted_reference_count',
  'career_entry_count',
  'open_to_play',
  'open_to_coach',
  'nationality',
  'nationality_country_id',
  // LastActivePill per-user opt-out (added 2026-05-08). Without
  // show_last_active in the SELECT, LastActivePill receives undefined
  // and falls through to its graceful "show" default — making the
  // Settings toggle visually present but functionally a no-op for any
  // visitor (the read-path bug Batch 8 staging QA caught).
  'show_last_active',
  // Bento Grid visitor cards read these denormalized counts on the
  // public profile. Missing any of them silently shows "0" while the
  // owner dashboard shows the real count (PR1 QA regression).
  'accepted_friend_count',
  'post_count',
  'full_game_video_count',
]

const clubRequired = [
  'avatar_url',
  'base_location',
  'nationality',
  'nationality_country_id',
  'club_bio',
  'website',
  'year_founded',
  'mens_league_division',
  'womens_league_division',
  // contact_email is selected as the masked generated column aliased back to
  // `contact_email` (anon can't read the raw column — migration 20260610100000).
  'contact_email:contact_email_masked',
  'last_active_at',
  'show_last_active',
]

const umpireRequired = [
  'avatar_url',
  'umpire_level',
  'federation',
  'officiating_specialization',
  'languages',
  'umpire_appointment_count',
  'accepted_reference_count',
  'bio',
  'last_active_at',
  'show_last_active',
]

describe('Public profile SELECT lists keep ProfileSnapshot source columns', () => {
  it('PUBLIC_PROFILE_FIELDS (player + coach) includes every snapshot signal source', () => {
    const fields = PUBLIC_PROFILE_FIELDS.split(',')
    for (const required of playerCoachRequired) {
      expect(fields).toContain(required)
    }
  })

  it('PUBLIC_CLUB_FIELDS includes every snapshot signal source', () => {
    const fields = PUBLIC_CLUB_FIELDS.split(',')
    for (const required of clubRequired) {
      expect(fields).toContain(required)
    }
  })

  it('PUBLIC_UMPIRE_FIELDS includes every snapshot signal source', () => {
    const fields = PUBLIC_UMPIRE_FIELDS.split(',')
    for (const required of umpireRequired) {
      expect(fields).toContain(required)
    }
  })
})
