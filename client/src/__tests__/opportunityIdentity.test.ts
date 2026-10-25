import { describe, expect, it } from 'vitest'
import { applySubline, asksHeading, clubShortName, messageLabel, noteHeading, offersHeading, onBehalfNote, postedByLine, reviewsLine, roleIdentity, sentLine, wordsHeading } from '@/lib/opportunityIdentity'

describe('roleIdentity', () => {
  it('a club posting is the hiring club, nobody "posted by"', () => {
    const id = roleIdentity({ publisherRole: 'club', publisherName: 'HC Rotterdam', publisherAvatar: 'crest.png' })
    expect(id).toMatchObject({ kind: 'club', hiringClub: { name: 'HC Rotterdam', logo: 'crest.png' }, postedBy: null, displayName: 'HC Rotterdam' })
    expect(postedByLine(id)).toBeNull()
    expect(offersHeading(id)).toBe('What HC Rotterdam offers')
    expect(wordsHeading(id)).toBe('In the club’s words')
    expect(messageLabel(id)).toBe('Message the club')
    expect(reviewsLine(id)).toBe('The club reviews it and replies here')
    expect(onBehalfNote(id)).toBeNull()
    expect(applySubline(id)).toBe('HC Rotterdam')
  })
  it('a coach posting for a directory club: hiring club from the directory, posted by the coach', () => {
    const id = roleIdentity({ publisherRole: 'coach', publisherName: 'Ana García', publisherAvatar: 'ana.jpg', publisherCoachRole: 'head_coach', worldClub: { name: 'KBH Brumbies', avatarUrl: 'kbh.png' } })
    expect(id).toMatchObject({ kind: 'coach-for-club', hiringClub: { name: 'KBH Brumbies', logo: 'kbh.png' }, postedBy: { name: 'Ana García', firstName: 'Ana', roleLabel: 'Head coach' }, displayName: 'KBH Brumbies', displayLogo: 'kbh.png' })
    expect(postedByLine(id)).toBe('Posted by Ana García')
    expect(offersHeading(id)).toBe('What KBH Brumbies offers')
    expect(asksHeading(id)).toBe('What they’re looking for')
    expect(reviewsLine(id)).toBe('Ana reviews it and replies here')
    expect(onBehalfNote(id)).toBe('Ana posted this opportunity on behalf of KBH Brumbies. Messages go to the coach.')
    expect(applySubline(id)).toBe('KBH Brumbies · posted by Ana García')
    expect(sentLine(id)).toMatch(/^Ana will review your profile/)
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
    expect(offersHeading(id)).toBe('What Luis offers')
    expect(applySubline(id)).toBe('Coach Luis Pérez')
  })
  it('clubShortName trims long club suffixes for headings', () => {
    expect(clubShortName('Lazio Hockey')).toBe('Lazio Hockey')
    expect(clubShortName('Holcombe Hockey Club')).toBe('Holcombe')
    expect(clubShortName('Kilkenny HC')).toBe('Kilkenny HC')
  })
})
