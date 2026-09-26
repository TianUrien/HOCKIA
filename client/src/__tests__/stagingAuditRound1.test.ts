import { describe, it, expect } from 'vitest'
import {
  draftFromRow, draftToEditPatch, draftToRow, emptyDraft, levelHint, offerStepCopy, type PostRoleDraft,
} from '@/lib/postRole'
import { closeRolePatch, closeRoleToast, reopenRolePatch } from '@/lib/roleLifecycle'
import { APPLICATION_STATUS_LABELS, applicationNote, applicationStatusLabel, closedApplicationNote, isDecidableApplicationStatus, playerApplicationStatusBadge } from '@/lib/applicationStatus'
import { applicationStatusPill, roleHeadline, showFullMatchNudge } from '@/lib/opportunityCopy'
import { brandCategoryLabel, positionLabel } from '@/lib/identity'
import type { Vacancy } from '@/lib/supabase'

const base = (over: Partial<PostRoleDraft> = {}): PostRoleDraft => ({
  ...emptyDraft({ baseLocation: 'Kilkenny, Ireland', countryName: 'Ireland' }),
  position: 'midfielder', gender: 'Men', ...over,
})

describe('Post a role · copy', () => {
  it('level hint says applicants never see the level', () => {
    expect(levelHint('player')).toBe('Used to rank applicants. Players don’t see it.')
    expect(levelHint('coach')).toBe('Used to rank applicants. Coaches don’t see it.')
  })
  it('step 2 speaks to coaches on a coach role', () => {
    const coach = offerStepCopy('coach')
    expect(coach.euPassport).toBe('Only coaches with an EU passport can apply.')
    for (const line of Object.values(coach)) expect(line.toLowerCase()).not.toContain('player')
    expect(offerStepCopy('player').euPassport).toBe('Only players with an EU passport can apply.')
  })
})

describe('Edit a live role', () => {
  it('never sends status, published_at or club_id', () => {
    const patch = draftToEditPatch(base({ id: 'r1', title: 'Men’s 1st player' }), 'club-1') as Record<string, unknown>
    expect(patch).not.toHaveProperty('status')
    expect(patch).not.toHaveProperty('published_at')
    expect(patch).not.toHaveProperty('club_id')
    expect(patch).not.toHaveProperty('filled_via_hockia')
    expect(patch).not.toHaveProperty('closed_reason')
    expect(patch.title).toBe('Men’s 1st player')
    expect(patch.gender).toBe('Men')
  })
  it('keeps package keys the form has no tile for', () => {
    const d = draftFromRow({ id: 'r1', opportunity_type: 'player', position: 'midfielder', gender: 'Men', title: 'x', benefits: ['housing', 'meals'] } as unknown as Vacancy)
    expect(d.benefits).toEqual(['housing'])
    expect(d.otherBenefits).toEqual(['meals'])
    expect(draftToRow(d, 'c', 'open').benefits).toEqual(['housing', 'meals'])
  })
})

describe('Close / reopen a role', () => {
  it('maps Filled / Not filled onto closed_reason, never filled_via_hockia', () => {
    expect(closeRolePatch('filled')).toEqual({ status: 'closed', closed_reason: 'filled' })
    expect(closeRolePatch('withdrawn')).toEqual({ status: 'closed', closed_reason: 'withdrawn' })
    expect(closeRolePatch('filled')).not.toHaveProperty('filled_via_hockia')
    expect(closeRoleToast('withdrawn')).toBe('Role closed.')
  })
  it('reopen clears the close fields and extends a passed deadline 30 days', () => {
    const now = new Date('2026-09-26T10:00:00Z')
    expect(reopenRolePatch('2026-10-10', now)).toEqual({ status: 'open', closed_reason: null, filled_via_hockia: null, auto_closed_at: null, closed_at: null })
    expect(reopenRolePatch('2026-09-01', now).application_deadline).toBe('2026-10-26')
    expect(reopenRolePatch(null, now)).not.toHaveProperty('application_deadline')
  })
})

describe('Application status words — one set everywhere', () => {
  it('My applications labels are the canonical labels', () => {
    expect(applicationStatusLabel('maybe')).toBe('Replied')
    expect(applicationStatusLabel('pending')).toBe('In review')
    expect(applicationStatusLabel('rejected')).toBe('Not selected')
    expect(applicationStatusLabel('nope')).toBeNull()
  })
  it('the timeline badge and My applications pill agree for every responded status', () => {
    for (const s of ['shortlisted', 'maybe', 'rejected', 'no_response']) {
      expect(playerApplicationStatusBadge(s)?.label).toBe(applicationStatusPill(s, null, true).label)
      expect(playerApplicationStatusBadge(s)?.label).toBe(APPLICATION_STATUS_LABELS[s])
    }
    expect(applicationStatusPill('pending', null, true).label).toBe('In review')
  })
})

describe('Applicant note', () => {
  it('reads metadata.message, trimmed; null when absent', () => {
    expect(applicationNote({ message: '  [QA] Test note — available now  ' })).toBe('[QA] Test note — available now')
    expect(applicationNote({ message: '   ' })).toBeNull()
    expect(applicationNote({ status_reason: 'timing' })).toBeNull()
    expect(applicationNote(null)).toBeNull()
    expect(applicationNote(['x'])).toBeNull()
    expect(applicationNote({ message: 'a'.repeat(1200) })?.length).toBe(1000)
  })
})

describe('Role headline', () => {
  it('title first, position · team second', () => {
    expect(roleHeadline({ title: '[QA] Midfielder test', position: 'midfielder', opportunity_type: 'player', gender: 'Men' }))
      .toEqual({ title: '[QA] Midfielder test', detail: "Midfielder · Men's" })
    expect(roleHeadline({ title: 'Head coach, 1st team', position: 'head_coach', opportunity_type: 'coach', gender: 'Boys' }))
      .toEqual({ title: 'Head coach, 1st team', detail: 'Head coach · Boys' })
    expect(roleHeadline({ title: '  ', position: 'forward', opportunity_type: 'player', gender: null }).title).toBe('Forward')
  })
})

describe('Application sent · full match nudge', () => {
  it('only for a player with zero full matches', () => {
    expect(showFullMatchNudge('player', 0)).toBe(true)
    expect(showFullMatchNudge('player', 2)).toBe(false)
    expect(showFullMatchNudge('player', null)).toBe(false)
    expect(showFullMatchNudge('coach', 0)).toBe(false)
  })
})

describe('Enum labels in feed cards', () => {
  it('never renders raw enums', () => {
    expect(positionLabel('head_coach')).toBe('Head coach')
    expect(positionLabel('strength_conditioning')).toBe('Strength & conditioning')
    expect(positionLabel('midfielder')).toBe('Midfielder')
    expect(positionLabel('other_coach')).toBe('Coach')
    expect(positionLabel(null)).toBeNull()
    expect(brandCategoryLabel('coaching')).toBe('Coaching & Training')
  })
})

describe('Round 1 follow-up', () => {
  it('"No reply · Nd" is grey for the player, and still flags the long wait', () => {
    const now = new Date('2026-09-26T12:00:00Z')
    const pill = applicationStatusPill('pending', '2026-09-06T12:00:00Z', true, now)
    expect(pill).toEqual({ label: 'No reply · 20d', tone: 'grey', waitingLong: true })
    expect(applicationStatusPill('pending', '2026-09-20T12:00:00Z', true, now).waitingLong).toBeUndefined()
    for (const s of ['pending', 'shortlisted', 'maybe', 'rejected', 'withdrawn', 'no_response', 'filled']) {
      expect(applicationStatusPill(s, '2026-01-01T00:00:00Z', true, now).tone).not.toBe('amber')
    }
  })
  it('only open review statuses get the decision bar', () => {
    for (const s of ['pending', 'shortlisted', 'maybe', 'rejected']) expect(isDecidableApplicationStatus(s)).toBe(true)
    for (const s of ['filled', 'withdrawn', 'no_response', 'offered', 'signed', null]) expect(isDecidableApplicationStatus(s)).toBe(false)
    expect(closedApplicationNote('filled', 'Ana')).toBe('This role was filled. You can still message Ana.')
    expect(closedApplicationNote('no_response', 'Ana')).toMatch(/^This application closed without a reply/)
  })
})
