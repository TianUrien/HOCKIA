import { describe, expect, it } from 'vitest'
import { asksHeading, messageLabel, noteHeading, offersHeading, postedByLine, roleIdentity, wordsHeading } from '@/lib/opportunityIdentity'

describe('roleIdentity', () => {
  it('a club posting is the hiring club, nobody "posted by"', () => {
    const id = roleIdentity({ publisherRole: 'club', publisherName: 'HC Rotterdam', publisherAvatar: 'crest.png' })
    expect(id).toMatchObject({ kind: 'club', hiringClub: { name: 'HC Rotterdam', logo: 'crest.png' }, postedBy: null, displayName: 'HC Rotterdam' })
    expect(postedByLine(id)).toBeNull()
    expect(offersHeading(id)).toBe('What the club offers')
    expect(wordsHeading(id)).toBe('In the club’s words')
    expect(messageLabel(id)).toBe('Message the club')
  })
  it('a coach posting for a directory club: hiring club from the directory, posted by the coach', () => {
    const id = roleIdentity({ publisherRole: 'coach', publisherName: 'Ana García', publisherAvatar: 'ana.jpg', worldClub: { name: 'KBH Brumbies', avatarUrl: 'kbh.png' } })
    expect(id).toMatchObject({ kind: 'coach-for-club', hiringClub: { name: 'KBH Brumbies', logo: 'kbh.png' }, postedBy: { name: 'Ana García', firstName: 'Ana' }, displayName: 'KBH Brumbies', displayLogo: 'kbh.png' })
    expect(postedByLine(id)).toBe('Posted by Ana García')
    expect(offersHeading(id)).toBe('What we offer')
    expect(asksHeading(id)).toBe('What we ask')
    expect(wordsHeading(id)).toBe('In Ana’s words')
    expect(noteHeading(id)).toBe('A note to Ana')
    expect(messageLabel(id)).toBe('Message Ana')
  })
  it('a coach with a typed club name, no directory link: hiring club named, no logo', () => {
    const id = roleIdentity({ publisherRole: 'coach', publisherName: 'Luis Pérez', organizationName: 'Club Atlético', publisherCurrentClub: 'Other Club' })
    expect(id).toMatchObject({ kind: 'coach-for-club', hiringClub: { name: 'Club Atlético', logo: null }, displayName: 'Club Atlético' })
  })
  it('an independent coach is the title; no "posted by" line (it would repeat the title)', () => {
    const id = roleIdentity({ publisherRole: 'coach', publisherName: 'Luis Pérez', publisherAvatar: 'luis.jpg' })
    expect(id).toMatchObject({ kind: 'independent-coach', hiringClub: null, displayName: 'Luis Pérez', displayLogo: 'luis.jpg' })
    expect(postedByLine(id)).toBeNull()
    expect(wordsHeading(id)).toBe('In Luis’s words')
  })
})
