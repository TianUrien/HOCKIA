import { render, screen, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Round 6: the profile Fit card measures (and names) the active "Ranked for"
 * role; a category mismatch is a no-chip miss; the Players tab ranks by player
 * roles only and the Coaches tab by coach roles only; a recruiting coach gets
 * the Fit card for its own role; the feed pop-up keeps the club logo; card
 * labels say where a tap goes; no raw position tokens.
 */

// ── mocks ───────────────────────────────────────────────────────────────────
const fromCalls: { table: string; op: string }[] = []
const rpc = vi.fn(() => Promise.resolve({ data: null, error: null }))
vi.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'neq']) chain[m] = () => chain
    chain.update = () => { fromCalls.push({ table, op: 'update' }); return chain }
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null })
    chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
    return chain
  }
  return { supabase: { from: (t: string) => builder(t), rpc: (...a: unknown[]) => (rpc as unknown as (...x: unknown[]) => unknown)(...a) } }
})

import { effectiveContextRow, contextKind, useRecruitingContextStore, type RecruitingContextRow } from '@/hooks/useRecruitingContext'
import { pickFitRole, type ClubRole, type ClubViewApplication } from '@/hooks/useClubViewOfPlayer'
import { fitRows, fitHasConfirmedMiss, roleTeamWord, type FitComponents } from '@/lib/clubRecruiting'
import { playerContexts } from '@/lib/findPlayers'
import { FitForRoleCard } from '@/components/profile/ClubViewCards'
import RecruiterCandidateCard from '@/components/recruiting/RecruiterCandidateCard'
import { positionLabel } from '@/lib/identity'

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')
const repo = (p: string) => readFileSync(resolve(__dirname, '../../..', p), 'utf8')

const row = (over: Partial<RecruitingContextRow>): RecruitingContextRow => ({
  availability_required: false, compensation_required: false, competition_id: null, created_at: '2026-09-01T00:00:00Z',
  eu_required: false, id: 'x', is_active: false, label: null, level_required: false, location_required: false,
  opportunity_id: null, owner_id: 'o', position_required: false, region: null, specialists_required: false,
  target_category: 'Men', target_compensation: null, target_level: null, target_location_country: null,
  target_position: null, target_problem: null, target_role: 'player', target_specialists: [], target_start_date: null,
  type: 'opportunity', updated_at: '2026-09-01T00:00:00Z', opportunity_status: 'open',
  ...over,
} as RecruitingContextRow)

// ── 1. The Fit card measures the active "Ranked for" role ────────────────────
describe('Fit card: which role it measures', () => {
  const gk: ClubRole = { id: 'gk', title: '[QA] Goalkeeper R6', gender: 'Men' }
  const mid: ClubRole = { id: 'mid', title: '[QA] Midfielder R6', gender: 'Men' }
  const applied = { id: 'a1', status: 'pending', appliedAt: null, metadata: {}, role: mid, expiryDays: 14 } as ClubViewApplication

  it('the active Ranked-for role wins over the role the player applied to', () => {
    expect(pickFitRole({ application: applied, roles: [gk, mid], activeOpportunityId: 'gk' })).toBe(gk)
  })
  it('no active role (or one that is not an open role of this kind) → the applied role, else the only open role', () => {
    expect(pickFitRole({ application: applied, roles: [gk, mid], activeOpportunityId: null })).toBe(mid)
    expect(pickFitRole({ application: applied, roles: [gk, mid], activeOpportunityId: 'coach-role' })).toBe(mid)
    expect(pickFitRole({ application: null, roles: [gk], activeOpportunityId: null })).toBe(gk)
    expect(pickFitRole({ application: null, roles: [gk, mid], activeOpportunityId: null })).toBeNull()
  })

  const player = { playing_category: 'adult_men', last_active_at: new Date().toISOString(), current_club: null, full_name: 'Sam Player' }
  const fit = (state: 'green' | 'yellow' | 'grey', components: FitComponents) => ({ state, components, playerLeagueBanded: true, clubLeagueBanded: true })

  it('the card names the role; a goalkeeper role on a midfielder shows with no chip', () => {
    render(<FitForRoleCard role={gk} player={player} fit={fit('grey', { gender_match: 1, competition_proximity: 1, availability: 1, recency: 1, position_match: 0, role_position: 'goalkeeper', candidate_position: 'midfielder' })} />)
    expect(screen.getByTestId('fit-card-title').textContent).toBe('Fit for [QA] Goalkeeper R6')
    expect(screen.queryByTestId('fit-chip')).toBeNull()
    expect(screen.getByText('Midfielder — the role is for a Goalkeeper')).toBeTruthy()
    expect(screen.queryByText(/matches$/)).toBeNull()
  })
  it('a plain grey fit (no confirmed miss) still hides the card', () => {
    const { container } = render(<FitForRoleCard role={mid} player={{ ...player, playing_category: null }} fit={fit('grey', { gender_match: 0, competition_proximity: 0, availability: 0, recency: 0 })} />)
    expect(container.innerHTML).toBe('')
  })
  it('green keeps the chip and the role name', () => {
    render(<FitForRoleCard role={mid} player={player} fit={fit('green', { gender_match: 1, competition_proximity: 1, availability: 1, recency: 1, position_match: 1, role_position: 'midfielder', candidate_position: 'midfielder' })} />)
    expect(screen.getByTestId('fit-card-title').textContent).toBe('Fit for [QA] Midfielder R6')
    expect(screen.getByTestId('fit-chip').textContent).toContain('Strong fit')
  })
  it('the profile hook reads the context of the profile\'s kind (not a coach role)', () => {
    const hook = src('hooks/useClubViewOfPlayer.ts')
    expect(hook).toContain('effectiveContextRow(available, kind, kindNone)')
  })
})

// ── 2. Category mismatch = no chip ───────────────────────────────────────────
describe('category mismatch', () => {
  const base = { firstName: 'Sam', lastActiveDays: 0, playerClub: null, playerLeagueKnown: true, clubLeagueKnown: true }
  it('women on a Men\'s role: "Adult women — the role is for Men’s"', () => {
    const rows = fitRows({ gender_match: 0, competition_proximity: 1, availability: 1, recency: 1 }, { ...base, roleGender: 'Men', playerCategoryLabel: 'Adult women' })
    const cat = rows.find((r) => r.key === 'category')!
    expect(cat.ok).toBe(false)
    expect(cat.detail).toBe('Adult women — the role is for Men’s')
  })
  it('men on a Women\'s role, youth and Mixed wording', () => {
    const miss = (g: string) => fitRows({ gender_match: 0 }, { ...base, roleGender: g, playerCategoryLabel: 'Adult men' }).find((r) => r.key === 'category')!.detail
    expect(miss('Women')).toBe('Adult men — the role is for Women’s')
    expect(miss('Girls')).toBe('Adult men — the role is for Girls')
    const ok = fitRows({ gender_match: 1 }, { ...base, roleGender: 'Mixed', playerCategoryLabel: 'Adult men' }).find((r) => r.key === 'category')!.detail
    expect(ok).toBe('Adult men — matches a Mixed role')
    expect(roleTeamWord('Boys')).toBe('Boys')
    expect(roleTeamWord(null)).toBeNull()
  })
  it('a category miss is a confirmed miss (card shows, no chip); no category is not', () => {
    expect(fitHasConfirmedMiss({ gender_match: 0 }, 'adult_women')).toBe(true)
    expect(fitHasConfirmedMiss({ gender_match: 0 }, null)).toBe(false)
    expect(fitHasConfirmedMiss({ gender_match: 1, position_match: 0, candidate_position: null }, 'adult_men')).toBe(false)
  })
  it('women on a Men\'s role renders without a chip', () => {
    render(<FitForRoleCard role={{ id: 'm', title: 'Men’s midfielder', gender: 'Men' }} player={{ playing_category: 'adult_women', full_name: 'Alex' }} fit={{ state: 'grey', components: { gender_match: 0, competition_proximity: 1, availability: 1, recency: 1 }, playerLeagueBanded: true, clubLeagueBanded: true }} />)
    expect(screen.queryByTestId('fit-chip')).toBeNull()
    expect(screen.getByText(/the role is for Men’s$/)).toBeTruthy()
  })
  it('the migration caps a confirmed category miss and keeps the security model', () => {
    const sql = repo('supabase/migrations/20260930200000_club_fit_category_cap.sql')
    expect(sql).toContain('v_category_miss := TRUE')
    expect(sql).toMatch(/IF v_category_miss THEN\s+v_score := LEAST\(v_score, 0\.39\);/)
    expect(sql).toContain("IF NOT public.is_recruiter(auth.uid()) THEN")
    expect(sql).not.toMatch(/SECURITY DEFINER/)
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.compute_club_fit(uuid, uuid, text, text, uuid) TO authenticated;')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.compute_club_fit(uuid, uuid, text, text, uuid) FROM anon;')
    expect(sql).toContain('DELETE FROM public.club_fit_cache;')
    expect(repo('supabase/rollbacks/20260930200000_club_fit_category_cap.down.sql')).not.toContain('v_category_miss')
  })
})

// ── 3. Players tab = player roles, Coaches tab = coach roles ─────────────────
describe('recruiting context per tab kind', () => {
  const coachCtx = row({ id: 'c', target_role: 'coach', is_active: true, label: 'Head coach', updated_at: '2026-09-27T10:00:00Z' })
  const oldPlayer = row({ id: 'p-old', label: 'Old', updated_at: '2026-09-01T00:00:00Z', opportunity_id: 'o1' })
  const recentPlayer = row({ id: 'p-new', label: 'Recent', updated_at: '2026-09-20T00:00:00Z', opportunity_id: 'o2' })
  const olderCoach = row({ id: 'c-old', target_role: 'coach', label: 'Older coach', updated_at: '2026-08-01T00:00:00Z' })
  const rows = [coachCtx, oldPlayer, recentPlayer, olderCoach]

  it('a coach context on the Players tab → the most recent player context; the stored one is untouched', () => {
    expect(effectiveContextRow(rows, 'player')?.id).toBe('p-new')
    expect(effectiveContextRow(rows, 'coach')?.id).toBe('c')
    expect(effectiveContextRow(rows, null)?.id).toBe('c')
    expect(rows.find((r) => r.is_active)?.id).toBe('c')
  })
  it('a player context on the Coaches tab → the most recent coach context (defaults to one)', () => {
    const r2 = rows.map((r) => ({ ...r, is_active: r.id === 'p-old' }))
    expect(effectiveContextRow(r2, 'coach')?.id).toBe('c')
    expect(effectiveContextRow(r2, 'player')?.id).toBe('p-old')
  })
  it('"No context" picked on one kind; nothing stored → none on either tab', () => {
    expect(effectiveContextRow(rows, 'player', { player: true, coach: false })).toBeNull()
    expect(effectiveContextRow(rows.map((r) => ({ ...r, is_active: false })), 'player')).toBeNull()
    expect(effectiveContextRow([coachCtx], 'player')).toBeNull()
    expect(contextKind({ target_role: null })).toBe('player')
  })
  it('the fallback must be an OPEN role of that kind: closed / draft roles and saved searches are skipped; none → no context', () => {
    const closedNewest = row({ id: 'p-closed', updated_at: '2026-09-26T00:00:00Z', opportunity_status: 'closed' })
    const draft = row({ id: 'p-draft', updated_at: '2026-09-25T00:00:00Z', opportunity_status: 'draft' })
    const saved = row({ id: 'p-saved', type: 'custom', updated_at: '2026-09-24T00:00:00Z', opportunity_id: null, opportunity_status: null })
    expect(effectiveContextRow([coachCtx, closedNewest, draft, saved, recentPlayer], 'player')?.id).toBe('p-new')
    expect(effectiveContextRow([coachCtx, closedNewest, draft, saved], 'player')).toBeNull()
    const closedCoach = row({ id: 'c-closed', target_role: 'coach', opportunity_status: 'closed' })
    expect(effectiveContextRow([recentPlayer, closedCoach].map((r) => ({ ...r, is_active: r.id === 'p-new' })), 'coach')).toBeNull()
    // A stored active context whose role closed counts as none (QA round 9):
    // the most recent open role of that kind stands in, else none.
    expect(effectiveContextRow([{ ...closedNewest, is_active: true }], 'player')).toBeNull()
    expect(effectiveContextRow([{ ...closedNewest, is_active: true }, recentPlayer], 'player')?.id).toBe('p-new')
  })
  it('the store embeds each role\'s status', () => {
    expect(src('hooks/useRecruitingContext.ts')).toContain("opportunity:opportunities!recruiting_context_opportunity_id_fkey(status)")
  })
  it('the Recruiting for sheet on the Players tab never lists a coach role', () => {
    const active = effectiveContextRow(rows, 'player')
    const listed = playerContexts(rows, new Set(['o1', 'o2']), active?.id ?? null).map((r) => r.id)
    expect(listed).toEqual(['p-old', 'p-new'])
  })

  beforeEach(() => {
    fromCalls.length = 0
    useRecruitingContextStore.setState({ ownerId: 'o', eligibleRole: 'club', rows, loading: false, error: null, fetchedForOwner: 'o', viewKind: null, kindNone: { player: false, coach: false } })
  })
  it('store: selectors follow the screen kind', () => {
    act(() => useRecruitingContextStore.getState().setViewKind('player'))
    const s = useRecruitingContextStore.getState()
    expect(effectiveContextRow(s.rows, s.viewKind, s.kindNone)?.id).toBe('p-new')
  })
  it('store: "No context" on the Players tab while a coach role is stored does not clear it', async () => {
    act(() => useRecruitingContextStore.getState().setViewKind('player'))
    await act(async () => { await useRecruitingContextStore.getState().clearActive() })
    const s = useRecruitingContextStore.getState()
    expect(fromCalls).toEqual([])
    expect(s.rows.find((r) => r.is_active)?.id).toBe('c')
    expect(s.kindNone.player).toBe(true)
    expect(effectiveContextRow(s.rows, 'player', s.kindNone)).toBeNull()
    expect(effectiveContextRow(s.rows, 'coach', s.kindNone)?.id).toBe('c')
  })
  it('screens declare their kind', () => {
    expect(src('pages/CommunityPage.tsx')).toContain("useRecruitingViewKind(tab === 'players' ? 'player' : tab === 'coaches' ? 'coach' : null)")
    for (const f of ['components/club/FindPlayersScreen.tsx', 'components/club/ShortlistScreen.tsx', 'components/club/ClubOpportunitiesScreen.tsx']) {
      expect(src(f)).toContain("useRecruitingViewKind('player')")
    }
    const sheet = src('components/recruiting/ContextEditSheet.tsx')
    expect(sheet).toContain("if (viewKind) q = q.eq('opportunity_type', viewKind)")
  })
})

// ── Follow-up: the viewer never lists themself ──────────────────────────────
describe('Community lists exclude the viewer', () => {
  it('the grid drops the viewer and the total count does too', () => {
    const plv = src('components/community/PeopleListView.tsx')
    expect(plv).toContain('result = result.filter(m => m.id !== currentUserProfile.id)')
    expect(plv).toContain("rows.some((r) => r.id === me?.id) ? n - 1 : n")
  })
})

// ── Follow-up: category labels in sentence case ─────────────────────────────
describe('category labels', () => {
  it('sentence case everywhere', async () => {
    const { categoryToDisplay, opportunityGenderToDisplay } = await import('@/lib/hockeyCategories')
    expect(['adult_men', 'adult_women', 'boys', 'girls', 'mixed'].map(categoryToDisplay)).toEqual(['Adult men', 'Adult women', 'Boys', 'Girls', 'Mixed'])
    expect(opportunityGenderToDisplay('Men')).toBe('Adult men')
  })
})

// ── 5. Feed pop-up keeps the club logo ───────────────────────────────────────
describe('feed role pop-up logo', () => {
  it('the feed card hands its logo to the pop-up, which uses it and warms it', () => {
    expect(src('components/home/cards/OpportunityPostedCard.tsx')).toContain('clubLogo={item.club_logo}')
    const overlay = src('components/OpportunityDetailOverlay.tsx')
    expect(overlay).toContain("getImageUrl(clubLogo, 'avatar-md')")
    expect(overlay).toContain('clubInfo={club.avatar_url || !clubLogo ? club : { ...club, avatar_url: clubLogo }}')
  })
})

// ── 6. Card labels say where the tap goes ────────────────────────────────────
describe('Community card accessibility label', () => {
  const member = { id: 'p1', role: 'player', full_name: 'Sam Player', avatar_url: null, position: 'midfielder' } as never
  it('"Opens profile." when the tap opens the full profile', () => {
    render(<RecruiterCandidateCard member={member} fitState="green" opensProfile onPreview={() => {}} />)
    expect(screen.getByTestId('member-tile').getAttribute('aria-label')).toMatch(/Strong fit\. Opens profile\.$/)
  })
  it('"Tap to preview." where the preview still opens', () => {
    render(<RecruiterCandidateCard member={member} onPreview={() => {}} />)
    const label = screen.getByTestId('member-tile').getAttribute('aria-label')!
    expect(label).toMatch(/Tap to preview\.$/)
    expect(label).not.toContain('Opens profile')
  })
  it('Community passes opensProfile on the direct-to-profile branches', () => {
    const plv = src('components/community/PeopleListView.tsx')
    expect(plv.match(/opensProfile/g)?.length).toBeGreaterThanOrEqual(3)
  })
})

// ── 7. No raw position tokens ────────────────────────────────────────────────
describe('position labels', () => {
  it('members list and invite search use the label helper', () => {
    expect(src('components/ClubMembersTab.tsx')).toContain('positionLabel(member.position)')
    expect(src('components/club/InviteMembersModal.tsx')).toContain('positionLabel(m.position)')
    for (const f of ['components/ClubMembersTab.tsx', 'components/club/InviteMembersModal.tsx']) {
      expect(src(f)).not.toMatch(/position\.charAt\(0\)\.toUpperCase\(\)/)
    }
    expect(positionLabel('head_coach')).toBe('Head coach')
  })
  it('the edge label map matches the client map (the email says "Head coach")', () => {
    const edge = repo('supabase/functions/_shared/display-labels.ts')
    const block = edge.slice(edge.indexOf('export const POSITION_LABELS'))
    for (const token of ['goalkeeper', 'defender', 'midfielder', 'forward', 'head_coach', 'assistant_coach', 'youth_coach', 'goalkeeper_coach', 'strength_conditioning', 'performance_analyst', 'sports_scientist', 'other_coach']) {
      const m = block.match(new RegExp(`\\b${token}: '([^']+)'`))
      expect(m?.[1], token).toBe(positionLabel(token))
    }
    const email = repo('supabase/functions/_shared/vacancy-email.ts')
    expect(email).toContain('positionLabel(vacancy.position)')
    expect(email).not.toMatch(/vacancy\.position\.charAt\(0\)/)
  })
})
