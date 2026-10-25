import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

vi.mock('@/lib/supabase', () => ({ supabase: {}, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' }))

import { summaryFacts } from '@/lib/applicantsSummary'
import type { Applicant } from '@/hooks/useRoleApplicants'

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8')
const applicant = (over: Partial<Applicant>): Applicant => ({
  applicationId: 'a1', status: 'pending', appliedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), updatedAt: null, metadata: {}, viewed: false, invited: false,
  fit: { state: 'green' as never, components: { position_match: 1, gender_match: 1, availability: 0.8, competition_proximity: 0.9 } },
  person: { id: 'p', fullName: 'Lucía Fernández', avatarUrl: null, role: 'player', position: 'goalkeeper', secondaryPosition: null, nationalityCountryId: 9, nationality2CountryId: null, baseLocation: 'Madrid', playingCategory: 'adult_women', lastActiveAt: null, currentClub: null, currentWorldClubId: null },
  ...over,
})

describe('Hockia AI · applicants summary (C3)', () => {
  it('sends only first names and fit facts — never age, nationality or location', () => {
    const [f] = summaryFacts([applicant({})], 14)
    expect(f).toEqual({ name: 'Lucía', daysLeft: 11, position: 'primary', category: true, open: true, level: 'close', invited: false })
    expect(Object.keys(f)).not.toContain('nationality')
    expect(JSON.stringify(f)).not.toMatch(/Madrid|adult_women|9/)
  })
  it('maps partial and unknown facts honestly', () => {
    const [f] = summaryFacts([applicant({ fit: { state: 'grey' as never, components: { position_match: 0.5, competition_proximity: 0 } } })], 14)
    expect(f).toMatchObject({ position: 'secondary', category: null, open: null, level: 'unknown' })
  })
  it('only the publisher sees it, under To review', () => {
    expect(read('../components/club/ApplicantsScreen.tsx')).toContain("chip === 'pending' && !selecting && role && clubId && role.club_id === clubId")
    expect(read('../components/club/ApplicantsAiSummary.tsx')).toContain('Hockia AI · Summary · Beta')
  })
})

describe('Hockia AI · Ask about this opportunity (B3/B4)', () => {
  it('shows on open opportunities for players and coaches who did not post them', () => {
    expect(read('../components/hockiaAi/RoleAiEntry.tsx')).toContain("if (role !== 'player' && role !== 'coach') return null")
    expect(read('../components/opportunities/OpportunityDetailMobile.tsx')).toContain('{!closed && !isPublisher && (')
    expect(read('../components/opportunities/OpportunityDetailDesktop.tsx')).toContain("{closedView === 'open' && !isPublisher && (")
  })
  it('sends questions to the opportunity mode while a role is attached', () => {
    expect(read('../components/hockiaAi/HockiaAiSheet.tsx')).toContain("roleContext ? { mode: 'role_ask', opportunity_id: roleContext.id } : undefined")
  })
})
