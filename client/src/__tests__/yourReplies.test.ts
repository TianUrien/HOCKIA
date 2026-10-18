import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { YOUR_REPLIES_MIN, yourReplies, yourRepliesCopy } from '@/lib/yourReplies'

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8')

describe('Club speed CS8 · Your replies, last 30 days', () => {
  it('counts decisions as answered and no_response as unanswered; waiting and withdrawn are left out', () => {
    const r = yourReplies(['shortlisted', 'maybe', 'rejected', 'filled', 'signed', 'no_response', 'pending', 'pending', 'withdrawn'])
    expect(r).toEqual({ answered: 5, unanswered: 1, total: 6 })
  })
  it(`shows nothing below ${YOUR_REPLIES_MIN} counted applicants`, () => {
    expect(yourReplies(['rejected', 'rejected', 'no_response', 'pending', 'pending', 'pending', 'pending'])).toBeNull()
  })
  it('says what happened, with Figma’s line and no comparisons', () => {
    expect(yourRepliesCopy({ answered: 18, total: 20, unanswered: 2 })).toEqual({ title: 'You answered 18 of 20 applicants', detail: '2 closed without a reply. Players remember the clubs that answer.' })
    expect(yourRepliesCopy({ answered: 5, total: 5, unanswered: 0 }).detail).toBeNull()
    const card = read('../components/club/ClubOpportunitiesScreen.tsx')
    expect(card).toContain('data-testid="your-replies"')
    expect(card).not.toMatch(/other clubs|faster|slower|average/i)
  })
  it('never reads publisher_responsiveness', () => {
    expect(read('../hooks/useYourReplies.ts')).not.toContain('publisher_responsiveness')
  })
})
