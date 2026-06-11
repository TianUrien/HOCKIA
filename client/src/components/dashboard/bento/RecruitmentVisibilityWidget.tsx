/**
 * RecruitmentVisibilityWidget — Spec G.10.
 *
 * Replaces the generic "Profile completeness %" arc on the
 * player/coach's own dashboard with a private 5-item recruitment-
 * readiness checklist. Owner-only (never rendered to visitors). No
 * percentage label — recruitment readiness is binary per item;
 * "X of 5 added" gives a progress feel without inviting the user to
 * optimize for a number.
 *
 * The 5 items differ by role — each set is the facts recruiters scan
 * for first when deciding whether to message that person:
 *
 *   PLAYER
 *     1. Highlight video — primary scouting artifact
 *     2. Full match video — secondary, high-signal
 *     3. Current club + league — drives Club Fit competition_proximity
 *     4. References ≥1 — social proof from coaches/clubs
 *     5. Representative team — national/regional selection in Journey
 *
 *   COACH
 *     1. Specialization — head/assistant/GK/etc. Clubs filter by this.
 *     2. Coaching categories — adult men/women, youth, etc.
 *     3. Current club + league — placement, drives perceived level
 *     4. Coaching experience — ≥1 career_history entry
 *     5. References ≥1 — social proof from clubs/players
 *
 * Each row deep-links via the same ProfileStrengthAction dispatch used
 * by HeroIdentityCard's old checklist, so Player/CoachDashboard's
 * existing handleProfileStrengthAction wiring routes everything.
 */

import { useEffect, useState } from 'react'
import { Check, Circle, Eye } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { Profile } from '@/lib/supabase'
import type { ProfileStrengthBucket } from '@/hooks/useProfileStrength'

interface RecruitmentVisibilityWidgetProps {
  profile: Profile
  /** Same dispatcher Player/CoachDashboard already wires for the
   *  HeroIdentityCard checklist — routes between edit-profile / tab /
   *  add-video. */
  onAction: (bucket: ProfileStrengthBucket) => void
}

interface VisibilityItem {
  id: string
  label: string
  /** Sub-line shown beneath the label on incomplete items only. Gives
   *  recruiters' perspective ("Clubs use this to gauge fit") so the
   *  ask doesn't feel arbitrary. */
  hint: string
  actionLabel: string
  completed: boolean
  bucket: ProfileStrengthBucket
}

export default function RecruitmentVisibilityWidget({
  profile,
  onAction,
}: RecruitmentVisibilityWidgetProps) {
  const isCoach = profile.role === 'coach'

  // Player's "Representative team" row needs a count from career_history
  // (national-team entries aren't denormalized on the profile row).
  // Coaches use career_entry_count directly, so they skip this query.
  // `null` while in flight, boolean once resolved. For coaches, we
  // initialise to `true` so headlineReady evaluates immediately.
  const [hasRepTeam, setHasRepTeam] = useState<boolean | null>(isCoach ? true : null)

  useEffect(() => {
    if (isCoach) return
    let cancelled = false
    const fetchRepTeam = async () => {
      const { count, error } = await supabase
        .from('career_history')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .eq('entry_type', 'national_team')
      if (cancelled) return
      if (error) {
        logger.warn('[RecruitmentVisibilityWidget] career_history count failed', error)
        setHasRepTeam(false)
        return
      }
      setHasRepTeam((count ?? 0) > 0)
    }
    void fetchRepTeam()
    return () => {
      cancelled = true
    }
  }, [profile.id, isCoach])

  const items = isCoach
    ? buildCoachItems(profile)
    : buildPlayerItems(profile, hasRepTeam ?? false)

  const completedCount = items.filter((i) => i.completed).length
  const total = items.length
  // Don't tease the headline number while the rep-team query is in flight.
  const headlineReady = hasRepTeam !== null

  return (
    <section
      className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 md:p-6"
      data-testid="recruitment-visibility-widget"
    >
      <header className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#8026FA]/10 text-[#8026FA]">
          <Eye className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-gray-900 leading-tight">
            How clubs see you
          </h3>
          <p className="mt-1 text-sm text-gray-500 leading-snug">
            {headlineReady
              ? completedCount === total
                ? 'Your profile shows every signal recruiters look for.'
                : `${completedCount} of ${total} added — each one unlocks a stronger match.`
              : 'Checking your recruitment signals…'}
          </p>
        </div>
      </header>

      <ul className="mt-5 space-y-3" data-testid="recruitment-visibility-list">
        {items.map((item) => (
          <VisibilityRow
            key={item.id}
            item={item}
            onAction={() => onAction(item.bucket)}
          />
        ))}
      </ul>

      <p className="mt-5 text-[11px] text-gray-400 leading-relaxed">
        Only you see this checklist. Visitors see your profile, not your visibility status.
      </p>
    </section>
  )
}

function buildPlayerItems(profile: Profile, hasRepTeam: boolean): VisibilityItem[] {
  return [
    {
      id: 'highlight-video',
      label: 'Highlight video',
      hint: 'Recruiters watch this first — the single highest-signal artifact on your profile.',
      actionLabel: 'Add',
      completed: Boolean(profile.highlight_video_url?.trim()),
      bucket: {
        id: 'highlight-video',
        label: 'Highlight video',
        description: '',
        unlockCopy: '',
        weight: 0,
        completed: Boolean(profile.highlight_video_url?.trim()),
        action: { type: 'add-video' },
      },
    },
    {
      id: 'full-match-video',
      label: 'Full match video',
      hint: 'Shows decision-making across 60+ minutes — the depth recruiters look for after the highlight.',
      actionLabel: 'Upload',
      completed: (profile.full_game_video_count ?? 0) > 0,
      bucket: {
        id: 'full-match-footage',
        label: 'Full match footage',
        description: '',
        unlockCopy: '',
        weight: 0,
        completed: (profile.full_game_video_count ?? 0) > 0,
        action: { type: 'tab', tab: 'media' },
      },
    },
    {
      id: 'current-club-league',
      label: 'Current club + league',
      hint: 'Lets recruiters place your competition level — drives the Club Fit competition score.',
      actionLabel: 'Set',
      completed: Boolean(profile.current_world_club_id),
      bucket: {
        id: 'basic-info',
        label: 'Current club',
        description: '',
        unlockCopy: '',
        weight: 0,
        completed: Boolean(profile.current_world_club_id),
        action: { type: 'edit-profile' },
      },
    },
    {
      id: 'references',
      label: 'At least one reference',
      hint: 'Trusted endorsement from a coach or clubmate — the social proof clubs want before reaching out.',
      actionLabel: 'Request',
      completed: (profile.accepted_reference_count ?? 0) > 0,
      bucket: {
        id: 'references',
        label: 'References',
        description: '',
        unlockCopy: '',
        weight: 0,
        completed: (profile.accepted_reference_count ?? 0) > 0,
        action: { type: 'tab', tab: 'references' },
      },
    },
    {
      id: 'representative-team',
      label: 'Representative team',
      hint: 'National, regional, or development squad selection — signals where you sit relative to peers.',
      actionLabel: 'Add',
      completed: hasRepTeam,
      bucket: {
        id: 'journey',
        label: 'Representative team',
        description: '',
        unlockCopy: '',
        weight: 0,
        completed: hasRepTeam,
        action: { type: 'tab', tab: 'journey' },
      },
    },
  ]
}

function buildCoachItems(profile: Profile): VisibilityItem[] {
  const hasSpecialization = Boolean(profile.coach_specialization)
  const coachingCategories = profile.coaching_categories
  const hasCategories = Array.isArray(coachingCategories) && coachingCategories.length > 0
  const hasCurrentClub = Boolean(profile.current_world_club_id)
  const hasExperience = (profile.career_entry_count ?? 0) > 0
  const hasReferences = (profile.accepted_reference_count ?? 0) > 0

  return [
    {
      id: 'specialization',
      label: 'Coaching specialization',
      hint: 'Head coach, assistant, goalkeeper coach — clubs filter searches by specialization first.',
      actionLabel: 'Set',
      completed: hasSpecialization,
      bucket: {
        id: 'specialization',
        label: 'Specialization',
        description: '',
        unlockCopy: '',
        weight: 0,
        completed: hasSpecialization,
        action: { type: 'edit-profile' },
      },
    },
    {
      id: 'coaching-categories',
      label: 'Coaching categories',
      hint: 'Which groups you coach (adult men/women, youth) — narrows you to the right opportunities.',
      actionLabel: 'Set',
      completed: hasCategories,
      bucket: {
        id: 'basic-info',
        label: 'Coaching categories',
        description: '',
        unlockCopy: '',
        weight: 0,
        completed: hasCategories,
        action: { type: 'edit-profile' },
      },
    },
    {
      id: 'current-club-league',
      label: 'Current club + league',
      hint: 'Where you currently coach — gives clubs a quick read on the level you operate at.',
      actionLabel: 'Set',
      completed: hasCurrentClub,
      bucket: {
        id: 'basic-info',
        label: 'Current club',
        description: '',
        unlockCopy: '',
        weight: 0,
        completed: hasCurrentClub,
        action: { type: 'edit-profile' },
      },
    },
    {
      id: 'coaching-experience',
      label: 'Coaching experience',
      hint: 'Past roles in your career history — clubs want to see the teams you have built and developed.',
      actionLabel: 'Add',
      completed: hasExperience,
      bucket: {
        id: 'journey',
        label: 'Coaching experience',
        description: '',
        unlockCopy: '',
        weight: 0,
        completed: hasExperience,
        action: { type: 'tab', tab: 'journey' },
      },
    },
    {
      id: 'references',
      label: 'At least one reference',
      hint: 'A former player or club vouching for you — the social proof clubs trust before reaching out.',
      actionLabel: 'Request',
      completed: hasReferences,
      bucket: {
        id: 'references',
        label: 'References',
        description: '',
        unlockCopy: '',
        weight: 0,
        completed: hasReferences,
        action: { type: 'tab', tab: 'references' },
      },
    },
  ]
}

interface VisibilityRowProps {
  item: VisibilityItem
  onAction: () => void
}

function VisibilityRow({ item, onAction }: VisibilityRowProps) {
  return (
    <li className="flex items-start gap-3">
      {item.completed ? (
        <span
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white mt-0.5"
          aria-hidden="true"
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      ) : (
        <Circle
          className="h-5 w-5 flex-shrink-0 text-gray-300 mt-0.5"
          aria-hidden="true"
        />
      )}
      <div className="flex-1 min-w-0">
        <p className={item.completed ? 'text-sm text-gray-600' : 'text-sm font-medium text-gray-900'}>
          {item.label}
        </p>
        {!item.completed && (
          <p className="mt-0.5 text-xs text-gray-500 leading-snug">{item.hint}</p>
        )}
      </div>
      {item.completed ? (
        <span className="flex-shrink-0 inline-flex items-center rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
          Added
        </span>
      ) : (
        <button
          type="button"
          onClick={onAction}
          className="flex-shrink-0 inline-flex items-center rounded-md border border-[#8026FA]/30 bg-white px-2.5 py-1 text-xs font-medium text-[#8026FA] hover:bg-[#8026FA]/5 transition-colors"
        >
          {item.actionLabel}
        </button>
      )}
    </li>
  )
}
