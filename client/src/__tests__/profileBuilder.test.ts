import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { builderErrorCopy, cvProblem, draftItemCount, linksInText, type ProfileDraft } from '@/lib/profileBuilder'

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8')
const draft: ProfileDraft = {
  career: [
    { key: 'c0', club_name: 'Banco Provincia', world_club_id: 'x', matched: true, city: 'Buenos Aires', country: 'Argentina', league: 'Metro A', role: null, start_date: '2019-01-01', end_date: '2022-01-01', current: false, years: '2019 – 2022' },
    { key: 'c1', club_name: 'Club de Campo', world_club_id: null, matched: false, city: 'Madrid', country: 'Spain', league: null, role: null, start_date: '2022-01-01', end_date: null, current: true, years: '2022 – Present' },
  ],
  passports: [{ country_id: 48, name: 'Argentina', code: 'AR', flag: '🇦🇷' }],
  date_of_birth: '2001-05-12', dob_note: null, position: 'defender', secondary_position: null,
  videos: [{ url: 'https://youtu.be/a', provider: 'youtube', title: 'Highlights', thumbnail_url: null }, { url: 'https://vimeo.com/1', provider: 'vimeo', title: 'Second', thumbnail_url: null }],
  socials: [{ platform: 'instagram', url: 'https://instagram.com/x' }],
  photos: [{ index: 0, ok: true }, { index: 1, ok: false }],
}

describe('Hockia AI · Fill my profile for me', () => {
  it('finds links typed in the message, without trailing punctuation', () => {
    expect(linksInText('Highlights: https://youtu.be/abc, and instagram.com/flor. Club: www.clubdecampo.es/hockey!')).toEqual(['https://youtu.be/abc', 'instagram.com/flor', 'www.clubdecampo.es/hockey'])
    expect(linksInText('No links here')).toEqual([])
  })
  it('only takes a CV as a PDF up to 4 MB', () => {
    expect(cvProblem(new File(['x'], 'cv.pdf', { type: 'application/pdf' }))).toBeNull()
    expect(cvProblem(new File(['x'], 'cv.docx', { type: 'application/msword' }))).toMatch(/PDF/)
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'cv.pdf', { type: 'application/pdf' })
    expect(cvProblem(big)).toMatch(/over 4 MB/)
  })
  it('counts the items on the card: one video (the highlight), kept photos only', () => {
    expect(draftItemCount(draft, 1)).toBe(2 + 1 + 1 + 1 + 1 + 1 + 1)
  })
  it('says why it could not read, kindly', () => {
    expect(builderErrorCopy('limit')).toMatch(/Everything else in Hockia works as usual/)
    expect(builderErrorCopy('error')).toMatch(/Your message is safe/)
  })
  it('never writes before Save all, keeps the founder rules, and never accepts ID documents', () => {
    const lib = read('../lib/profileBuilder.ts')
    expect(lib).toContain("if (free[0] == null && add.length)") // passports: only empty slots
    expect(lib).toContain("if (d.date_of_birth && !p.date_of_birth)") // DOB only when none is set
    expect(lib).toContain("rpc('declare_date_of_birth'")
    const ui = read('../components/hockiaAi/ProfileBuilder.tsx')
    expect(ui).toContain('Never add ID documents or passport photos')
    expect(ui).toContain('data-testid="builder-under18"')
    expect(ui.indexOf('saveProfileDraft(')).toBeGreaterThan(ui.indexOf('const saveAll'))
  })
  it('is offered to players and coaches from the chat and from a thin own profile', () => {
    expect(read('../components/hockiaAi/HockiaAiSheet.tsx')).toContain("const canBuild = profile?.role === 'player' || profile?.role === 'coach'")
    expect(read('../components/profile/v2/PlayerProfileV2.tsx')).toContain("showAi('profile', 'builder')")
  })
})
