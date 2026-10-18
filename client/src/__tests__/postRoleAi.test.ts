import { describe, expect, it } from 'vitest'
import { emptyDraft } from '@/lib/postRole'
import { aiDraftFailedCopy, applyAiDraft, checkSummary, type AiRoleDraft } from '@/lib/postRoleAi'

const base = emptyDraft({ baseLocation: 'Rome', countryName: 'Italy' })
const ai: AiRoleDraft = {
  type: 'player', position: 'defender', team: 'Men', title: 'Left back', level: null, skills: [],
  startDate: '2027-01-01', duration: 'Full season', pay: 'paid', package: ['housing'], euPassport: false,
  description: 'We’re looking for a left back for our men’s 1st team from January.',
}

describe('Club speed CS2 · Start with Hockia AI', () => {
  it('fills steps 1–3 and keeps the location from the club profile', () => {
    const d = applyAiDraft(base, ai)
    expect(d).toMatchObject({ type: 'player', position: 'defender', gender: 'Men', title: 'Left back', pay: 'paid', benefits: ['housing'], duration: 'Full season', startDate: '2027-01-01' })
    expect(d.city).toBe(base.city)
    expect(d.country).toBe(base.country)
    expect(d.description).toContain('left back')
  })

  it('summarises the four parts, with Not set · optional and Needed', () => {
    const [role, offer, where, about] = checkSummary(applyAiDraft(base, ai), { fromClub: true })
    expect(role.lines[0]).toBe("Defender · Left back · Men's team")
    expect(role.optionalMissing).toEqual(['level'])
    expect(role.neededMissing).toEqual([])
    expect(offer.lines).toEqual(['Starts 1 Jan 2027 · Full season', 'Paid · Housing'])
    expect(where.lines[0]).toMatch(/from your club profile$/)
    expect(about.lines[0]).toContain('left back')

    const bare = checkSummary(applyAiDraft(base, { ...ai, position: null, team: null, pay: null, duration: null, startDate: null, package: [], description: '' }), { fromClub: true })
    expect(bare[0].neededMissing).toEqual(['position', 'team'])
    expect(bare[1].optionalMissing).toEqual(['start', 'length', 'pay'])
    expect(bare[3].optionalMissing).toEqual(['description'])
  })

  it('a coach draft drops player-only fields', () => {
    const d = applyAiDraft(base, { ...ai, type: 'coach', position: 'head_coach', team: 'Girls', level: 'elite', skills: ['pressing'] })
    expect(d.level).toBeNull()
    expect(d.skills).toEqual([])
    expect(d.gender).toBe('Girls')
  })

  it('says why it could not draft, and that the words were kept', () => {
    expect(aiDraftFailedCopy('limit')).toContain('today’s Hockia AI drafts')
    expect(aiDraftFailedCopy(null)).toContain('Your words are in “About the role”')
  })
})
