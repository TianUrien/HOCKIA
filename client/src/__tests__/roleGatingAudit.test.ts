/**
 * Design audit 2026-10-21, A7: role gating.
 * - Brands have followers, not friends: Message is the Primary, "Invite as
 *   ambassador" (Tonal) only for players, never "Add friend".
 * - A coach on a player role gets a reason and keeps Message; brands and
 *   umpires browse only, with no apply copy.
 * - Hockia AI choices are role-aware; "Do I fit?" is gone; no Marketplace.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { ambassadorInviteError, personActionGate } from '@/lib/ambassadorInvite'
import { BRAND_BROWSE_NOTE, COACH_ON_PLAYER_ROLE_NOTE, UMPIRE_BROWSE_NOTE, roleViewerGate } from '@/lib/roleViewerGate'
import { CHECK_PROFILE_AGAINST_ROLE, aiIntroFor, exampleQueriesFor, recruiterExamples } from '@/lib/hockiaAi'

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

describe('personActionGate', () => {
  it('brand viewing a player: no Add friend, Message primary, Invite as ambassador', () => {
    expect(personActionGate('brand', 'player')).toEqual({ addFriend: false, inviteAmbassador: true, messagePrimary: true })
  })
  it('brand viewing a coach or umpire: no Add friend and no ambassador invite (players only)', () => {
    expect(personActionGate('brand', 'coach')).toEqual({ addFriend: false, inviteAmbassador: false, messagePrimary: true })
    expect(personActionGate('brand', 'umpire').inviteAmbassador).toBe(false)
  })
  it('everyone else keeps Add friend', () => {
    for (const r of ['player', 'coach', 'club', 'umpire', null]) {
      expect(personActionGate(r, 'player')).toEqual({ addFriend: true, inviteAmbassador: false, messagePrimary: false })
    }
  })
  it('maps the RPC errors to plain words', () => {
    expect(ambassadorInviteError('Request already pending')).toEqual({ message: 'Invite already sent.', already: true })
    expect(ambassadorInviteError('Player is already an ambassador').already).toBe(true)
    expect(ambassadorInviteError('anything').already).toBe(false)
  })
  it('the public profile, deck and preview sheet use the gate (no Add friend-only bar for brands)', () => {
    expect(src('components/profile/v2/PlayerProfileV2.tsx')).not.toContain("viewer?.role === 'brand' ? [friendButton]")
    expect(src('components/profile/v2/PlayerProfileV2.tsx')).toContain('personActionGate(')
    expect(src('components/community/photo/MemberFullPreview.tsx')).toContain('personActionGate(')
    expect(src('components/community/MemberPreviewSheet.tsx')).toContain('personActionGate(')
  })
})

describe('roleViewerGate', () => {
  const g = (viewerRole: string | null, roleType: string, extra: Partial<{ isPublisher: boolean; signedIn: boolean }> = {}) =>
    roleViewerGate({ viewerRole, roleType, isPublisher: false, signedIn: true, ...extra })

  it('players on player roles and coaches on coach roles are applicants', () => {
    expect(g('player', 'player')).toMatchObject({ kind: 'applicant', applyCopy: true, note: null })
    expect(g('coach', 'coach')).toMatchObject({ kind: 'applicant', applyCopy: true })
  })
  it('a coach on a player role gets the reason and keeps Message', () => {
    expect(g('coach', 'player')).toEqual({ kind: 'wrong_type', note: COACH_ON_PLAYER_ROLE_NOTE, applyCopy: false, messageOnly: true })
    expect(COACH_ON_PLAYER_ROLE_NOTE).toBe('This role is for players. Coaching roles are in Opportunities.')
  })
  it('brands and umpires browse only, with no apply copy', () => {
    expect(g('brand', 'player')).toEqual({ kind: 'browse_only', note: BRAND_BROWSE_NOTE, applyCopy: false, messageOnly: true })
    expect(g('umpire', 'player')).toEqual({ kind: 'browse_only', note: UMPIRE_BROWSE_NOTE, applyCopy: false, messageOnly: true })
  })
  it('the publisher and guests are unchanged', () => {
    expect(g('club', 'player', { isPublisher: true }).kind).toBe('publisher')
    expect(g(null, 'player', { signedIn: false })).toMatchObject({ kind: 'guest', applyCopy: true })
  })
  it('no note copy carries an em dash', () => {
    for (const n of [COACH_ON_PLAYER_ROLE_NOTE, BRAND_BROWSE_NOTE, UMPIRE_BROWSE_NOTE]) expect(n).not.toContain('—')
  })
})

describe('Hockia AI is role-aware', () => {
  it('recruiters: find players for the role, draft a role, summarise applicants', () => {
    expect(exampleQueriesFor({ role: 'club' }, 'Midfielder')).toEqual(['Find available players for Midfielder', 'Draft a role', 'Summarise my applicants'])
    expect(exampleQueriesFor({ role: 'coach', coach_recruits_for_team: true }, null)).toEqual(recruiterExamples(null))
  })
  it('brands find ambassadors and never hear about a Marketplace', () => {
    const b = exampleQueriesFor({ role: 'brand' })
    expect(b[0]).toMatch(/ambassador/i)
    expect(b.join(' ')).not.toMatch(/Marketplace/)
    expect(aiIntroFor({ role: 'brand' })).toMatch(/ambassador/)
  })
  it('umpires work on their officiating record', () => {
    expect(exampleQueriesFor({ role: 'umpire' })[0]).toMatch(/officiating record/)
    expect(aiIntroFor({ role: 'umpire' })).toMatch(/officiating record/)
  })
  it('players keep theirs; candidate coaches get no recruiter prompts', () => {
    expect(exampleQueriesFor({ role: 'player' })).toContain('What should I improve in my profile?')
    expect(exampleQueriesFor({ role: 'coach', coach_recruits_for_team: false }).join(' ')).not.toMatch(/Draft a role|applicants/)
  })
  it('"Do I fit?" is replaced everywhere', () => {
    expect(CHECK_PROFILE_AGAINST_ROLE).toBe('Check my profile against this role')
    expect(src('components/hockiaAi/RoleAiEntry.tsx')).not.toContain('Do I fit')
    expect(src('components/hockiaAi/HockiaAiSheet.tsx')).not.toContain('Do I fit')
  })
})
