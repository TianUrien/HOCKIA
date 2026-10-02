import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Round 7 (QA findings 2 Oct): "See the offer" lands on the tapped role's
 * offer with a fixed 2 s ring; withdrawn ≠ closed without a reply; the club's
 * signing line names the role (thread + inbox preview); a skipped offer step
 * is a grey dash; the career refreshes after confirm_signing; Make an offer
 * never swallows the first tap; held decisions survive a reload; one clock
 * format in the chat; shortlisted notifications name the role; sentence
 * case; day-first dates everywhere; a future-dated signing reads "From";
 * the entry's own country wins the flag; Community keeps the typed search.
 */

// ── mocks ───────────────────────────────────────────────────────────────────
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response(null, { status: 204 })))
const invokeMock = vi.fn()
const updateEq = vi.fn()
vi.mock('@/lib/supabase', () => ({
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  supabase: {
    functions: { invoke: (...a: unknown[]) => invokeMock(...a) },
    from: () => ({ update: () => ({ eq: (...a: unknown[]) => ({ select: () => updateEq(...a) }) }) }),
  },
}))

vi.mock('@/hooks/useSigning', () => ({
  useSigningActions: () => ({ busy: false, withdrawApplication: vi.fn() }),
  useOwnOfferMade: () => null,
}))

import { findOfferAnchor, ANCHOR_HIGHLIGHT_MS } from '@/features/chat-v2/utils'
import { closedBreakdown, pipelineOf, toReviewClosedNote } from '@/lib/clubRecruiting'
import { recruitingEventLine, recruitingPreviewLine, roadSteps, shortDayOf } from '@/lib/signing'
import { careerSpan, flagForCountryName, isCurrentEntry, startsLater } from '@/lib/careerCopy'
import { holdDecision, flushDecisions, keepaliveRequest, undoDecision } from '@/lib/pendingDecisions'
import { AUTH_STORAGE_KEY } from '@/lib/authStorageKey'
import { getNotificationConfig } from '@/components/notifications/config'
import type { NotificationRecord } from '@/lib/api/notifications'
import { appliedLine, appliedOnLine, whenLine } from '@/lib/opportunityCopy'
import { monthDay } from '@/lib/findPlayers'
import { pathWithSearch, searchQueryOf } from '@/components/community/communityFilters'
import { RoadToSigningCard } from '@/components/club/RoadToSigningCard'
import { CareerRow } from '@/components/profile/mobile/ProfileLongScroll'
import { CommunitySegments } from '@/components/community/CommunitySegments'
import OwnApplicationRoad from '@/components/opportunities/OwnApplicationRoad'
import type { ScrollCareerEntry } from '@/hooks/useProfileScrollData'
import type { Vacancy } from '@/lib/supabase'

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')
const inRouter = (ui: React.ReactElement, path = '/') => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>)

const NOW = new Date(2026, 9, 2, 12) // 2 Oct 2026, local

// ── 1 · "See the offer" lands on the tapped role's offer card ────────────────
describe('1 · See the offer anchors the offer of the role it was tapped on', () => {
  const offer = (id: string, applicationId: string) => ({ id, metadata: { type: 'opportunity_offer', offer_id: `o-${id}`, application_id: applicationId, opportunity_id: 'r' } })
  const thread = [
    { id: 'm1', metadata: undefined },
    offer('m2', 'app-A'),
    offer('m3', 'app-A'), // the edit: a newer card for the same role
    offer('m4', 'app-B'), // another role's offer, newest in the thread
    { id: 'm5', metadata: { type: 'application_event', event: 'x' } },
  ]
  it('picks the newest card for THAT application, not the newest in the thread', () => {
    expect(findOfferAnchor(thread, 'app-A')?.id).toBe('m3')
    expect(findOfferAnchor(thread, 'app-B')?.id).toBe('m4')
  })
  it('falls back to the newest offer card only when no application is given; never another role’s', () => {
    expect(findOfferAnchor(thread, null)?.id).toBe('m4')
    expect(findOfferAnchor(thread, undefined)?.id).toBe('m4')
    expect(findOfferAnchor(thread, 'app-C')).toBeNull()
    expect(findOfferAnchor([{ id: 'x' }], null)).toBeNull()
  })
  it('the ring is a fixed 2 s, kept outside the anchor effect so a thread update cannot cancel it', () => {
    expect(ANCHOR_HIGHLIGHT_MS).toBe(2000)
    const chat = src('features/chat-v2/ChatWindowV2.tsx')
    expect(chat).toContain('anchorRingRef')
    expect(chat).toContain('findOfferAnchor(messages, anchorApplicationId)')
    expect(chat).not.toContain('2200')
  })
  it('OwnApplicationRoad hands the application id to onSeeOffer; the role page and inbox carry it in state', () => {
    const onSeeOffer = vi.fn()
    inRouter(<OwnApplicationRoad applicationId="app-A" status="offered" onMessage={vi.fn()} onSeeOffer={onSeeOffer} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByTestId('own-application-see-offer'))
    expect(onSeeOffer).toHaveBeenCalledWith('app-A')
    expect(src('pages/OpportunityDetailPage.tsx')).toContain('anchorApplicationId: seeOffer ? applicationId ?? null : undefined')
    expect(src('pages/MessagesPage.tsx')).toContain('anchorApplicationId={')
  })
})

// ── 2 · withdrawn is not "closed without a reply" ────────────────────────────
describe('2 · a withdrawn application is never described as unanswered', () => {
  it('the pipeline splits closed by why', () => {
    const p = pipelineOf(['pending', 'withdrawn', 'no_response', 'no_response', 'filled'])
    expect(p).toMatchObject({ toReview: 1, closed: 4, noReply: 2, filled: 1, withdrawn: 1, total: 5 })
  })
  it('role card: "1 withdrawn" alone after a withdrawal; no-reply and withdrawn named separately', () => {
    expect(closedBreakdown({ noReply: 0, filled: 0, withdrawn: 1 }, 14)).toBe('1 withdrawn')
    expect(closedBreakdown({ noReply: 2, filled: 0, withdrawn: 1 }, 14)).toBe('2 closed without a reply after 14 days · 1 withdrawn')
    expect(closedBreakdown({ noReply: 0, filled: 1, withdrawn: 0 }, 14)).toBe('1 closed when the role was filled')
    expect(closedBreakdown({ noReply: 0, filled: 0, withdrawn: 0 }, 14)).toBeNull()
  })
  it('To review note: only real no-reply closes count as "closed on this role"', () => {
    expect(toReviewClosedNote({ noReply: 0, withdrawn: 1 })).toBe('1 withdrawn')
    expect(toReviewClosedNote({ noReply: 1, withdrawn: 0 })).toBe('1 has closed without a reply on this role so far')
    expect(toReviewClosedNote({ noReply: 2, withdrawn: 1 })).toBe('2 have closed without a reply on this role so far · 1 withdrawn')
    expect(toReviewClosedNote({ noReply: 0, withdrawn: 0 })).toBeNull()
    expect(src('components/club/ApplicantsScreen.tsx')).toContain('toReviewClosedNote(p)')
    expect(src('components/club/ClubOpportunitiesScreen.tsx')).toContain('closedBreakdown(p, expiryDays)')
  })
})

// ── 3 + 7 · the club's signing line names the role, in the thread and the inbox ──
describe('3 · "You marked <name> as signed for <role>"', () => {
  const line = 'E2E Test FC marked you as signed for Men’s 1st player. Confirm it on Hockia to add the signing to your career.'
  it('reuses the role title the server line carries', () => {
    expect(recruitingEventLine('signing_marked', line, { isMine: true, otherFirstName: 'Facundo' })).toBe('You marked Facundo as signed for Men’s 1st player. Waiting for them to confirm.')
    expect(recruitingEventLine('signing_marked', line, { isMine: false, otherFirstName: 'E2E' })).toBe(line)
    // An unexpected shape still reads, without a role.
    expect(recruitingEventLine('signing_marked', 'Something else', { isMine: true, otherFirstName: 'Facundo' })).toBe('You marked Facundo as signed. Waiting for them to confirm.')
  })
  it('7 · the inbox preview recognises the line by shape and rewords it for the club only', () => {
    expect(recruitingPreviewLine(line, { isMine: true, otherFirstName: 'Facundo' })).toBe('You marked Facundo as signed for Men’s 1st player. Waiting for them to confirm.')
    expect(recruitingPreviewLine(line, { isMine: false, otherFirstName: 'E2E' })).toBe(line)
    expect(recruitingPreviewLine('See you at training', { isMine: true, otherFirstName: 'Facundo' })).toBe('See you at training')
    expect(src('components/ConversationList.tsx')).toContain('recruitingPreviewLine(conversation.lastMessage.content')
  })
})

// ── 4 · skipped offer step ───────────────────────────────────────────────────
describe('4 · a skipped offer on the club road is a grey dash, not a tick', () => {
  it('roadSteps: signed straight from shortlist → Offer skipped, Signed stays current until done', () => {
    const pending = roadSteps({ status: 'signed_pending_confirmation', talked: true, trial: false, firstName: 'Sam', offer: null, now: NOW })
    const offer = pending.find((s) => s.key === 'offer')!
    expect(offer).toMatchObject({ done: false, skipped: true, detail: 'Skipped', current: false })
    expect(pending.find((s) => s.current)?.key).toBe('signed')
    const accepted = roadSteps({ status: 'signed', talked: true, trial: false, firstName: 'Sam', offer: { status: 'accepted', open_until: '2026-10-09', responded_at: '2026-10-01T10:00:00Z', sent_at: '2026-09-28T10:00:00Z' }, now: NOW })
    expect(accepted.find((s) => s.key === 'offer')).toMatchObject({ done: true, skipped: false })
  })
  it('RoadToSigningCard renders the dash with data-skipped and no done mark', () => {
    const steps = roadSteps({ status: 'signed', talked: true, trial: false, firstName: 'Sam', offer: null, signedAt: '2026-10-02T10:00:00Z', now: NOW })
    render(<RoadToSigningCard steps={steps} onMessage={vi.fn()} />)
    const offer = screen.getByTestId('road-step-offer')
    expect(offer.getAttribute('data-skipped')).toBe('true')
    expect(offer.getAttribute('data-done')).toBe('false')
    expect(offer.querySelector('.bg-positive')).toBeNull()
    expect(offer.textContent).toContain('Skipped')
    expect(screen.getByTestId('road-step-signed').getAttribute('data-done')).toBe('true')
  })
})

// ── 5 · career refresh after confirm_signing ────────────────────────────────
describe('5 · the career count refreshes right after confirming a signing', () => {
  it('ConfirmSigningPage drops the long-scroll cache, the Journey counts and refreshes the profile', () => {
    const s = src('pages/ConfirmSigningPage.tsx')
    expect(s).toContain('clearProfileScrollCache(me.id)')
    expect(s).toContain('qk.journeyCounts(me.id)')
    expect(s).toContain('refreshProfile?.()')
  })
})

// ── 6 · Make an offer never swallows the first tap ──────────────────────────
describe('6 · Make an offer opens on the first tap', () => {
  it('the sheet chunks preload on the road and the main button is not gated on the road data', () => {
    const s = src('components/club/ApplicantReviewScreen.tsx')
    expect(s).toContain("void import('./OfferSheet')")
    expect(s).toContain("void import('./MarkSignedSheet')")
    expect(s).toContain("disabled={mainAction === 'edit_offer' && !liveOffer}")
    expect(s).not.toContain(': !roadData}')
  })
})

// ── 10 · held decisions survive a reload ────────────────────────────────────
describe('10 · a held Shortlist is written as a keepalive request on pagehide / beforeunload', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockClear()
    updateEq.mockReset()
    invokeMock.mockReset()
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ access_token: 'jwt-123', refresh_token: 'r' }))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
  })

  it('builds the same write as the client: PostgREST PATCH / the feedback function, keepalive, with the session token', () => {
    const status = keepaliveRequest({ kind: 'status', applicationId: 'a1', status: 'shortlisted', metadata: { x: 1 } }, 'jwt-123')
    expect(status.url).toBe('https://proj.supabase.co/rest/v1/opportunity_applications?id=eq.a1')
    expect(status.init).toMatchObject({ method: 'PATCH', keepalive: true, headers: { apikey: 'anon-key', Authorization: 'Bearer jwt-123', Prefer: 'return=minimal' } })
    expect(JSON.parse(String(status.init.body))).toEqual({ status: 'shortlisted', metadata: { x: 1 } })
    const decline = keepaliveRequest({ kind: 'decline', applicationId: 'a2', reason: 'timing', message: 'Thanks.' }, 'jwt-123')
    expect(decline.url).toBe('https://proj.supabase.co/functions/v1/application-feedback')
    expect(decline.init).toMatchObject({ method: 'POST', keepalive: true })
    expect(JSON.parse(String(decline.init.body))).toEqual({ mode: 'decline', application_id: 'a2', reason: 'timing', message: 'Thanks.' })
  })

  it('pagehide during the Undo window fires the request at once; nothing is left to undo', () => {
    holdDecision({ kind: 'status', applicationId: 'a1', status: 'shortlisted', metadata: {} })
    window.dispatchEvent(new Event('pagehide'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toContain('id=eq.a1')
    expect(updateEq).not.toHaveBeenCalled()
    expect(undoDecision('a1')).toBe(false)
  })

  it('beforeunload does the same; a hidden tab keeps the normal write', async () => {
    holdDecision({ kind: 'decline', applicationId: 'a3', reason: 'timing', message: 'Thanks.' })
    window.dispatchEvent(new Event('beforeunload'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/functions/v1/application-feedback')
    expect(invokeMock).not.toHaveBeenCalled()

    updateEq.mockResolvedValue({ data: [{ id: 'a4' }], error: null })
    holdDecision({ kind: 'status', applicationId: 'a4', status: 'maybe', metadata: {} })
    flushDecisions()
    await vi.runAllTimersAsync()
    expect(updateEq).toHaveBeenCalledWith('id', 'a4')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('without a stored session the unload path still attempts the normal write', async () => {
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
    updateEq.mockResolvedValue({ data: [{ id: 'a5' }], error: null })
    holdDecision({ kind: 'status', applicationId: 'a5', status: 'shortlisted', metadata: {} })
    flushDecisions({ unloading: true })
    await vi.runAllTimersAsync()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(updateEq).toHaveBeenCalledWith('id', 'a5')
  })
})

// ── 11 · one clock format in the chat ───────────────────────────────────────
describe('11 · chat separators use the bubble’s clock format', () => {
  it('no 24-hour format left in MessageBubble', () => {
    const s = src('features/chat-v2/components/MessageBubble.tsx')
    expect(s).not.toContain("'HH:mm'")
    expect(s.match(/'h:mm a'/g)?.length).toBe(2)
  })
})

// ── 12 · shortlisted notification names the role ────────────────────────────
describe('12 · "You’re being considered for <role title>"', () => {
  const notification = (metadata: Record<string, unknown>): NotificationRecord => ({
    id: 'n1', kind: 'vacancy_application_status', sourceEntityId: 's1', metadata, targetUrl: null,
    createdAt: '2026-10-02T00:00:00Z', readAt: null, seenAt: null, clearedAt: null,
    actor: { id: 'c1', fullName: 'E2E Test FC', role: 'club', username: 'e2e', avatarUrl: null, baseLocation: null },
  } as NotificationRecord)
  it('uses vacancy_title; falls back to the position when there is none', () => {
    const n = notification({ status: 'shortlisted', club_name: 'E2E Test FC', vacancy_title: 'Men’s 1st player', position: 'midfielder' })
    expect(getNotificationConfig(n).getDescription?.(n)).toBe("You're being considered for Men’s 1st player.")
    const bare = notification({ status: 'shortlisted', club_name: 'E2E Test FC', position: 'midfielder' })
    expect(getNotificationConfig(bare).getDescription?.(bare)).toBe("You're being considered for Midfielder.")
  })
})

// ── 13 · sentence case ──────────────────────────────────────────────────────
describe('13 · "Starts immediately" on the desktop role page', () => {
  it('no title-case variant remains', () => {
    expect(src('components/OpportunityDetailView.tsx')).toContain("'Starts immediately'")
    expect(src('components/OpportunityDetailView.tsx')).not.toContain('Starts Immediately')
  })
})

// ── 14 · day-first dates through one helper ─────────────────────────────────
describe('14 · dates outside the road read day first ("2 Oct")', () => {
  it('shortDayOf is the one helper: the club screens and findPlayers delegate to it', () => {
    expect(shortDayOf('2026-10-02T10:00:00', NOW)).toBe('2 Oct')
    expect(monthDay('2026-10-01T10:00:00')).toBe(shortDayOf('2026-10-01T10:00:00'))
    for (const f of ['components/club/ApplicantsScreen.tsx', 'components/club/ClubOpportunitiesScreen.tsx', 'components/club/ApplicantReviewScreen.tsx', 'lib/findPlayers.ts', 'lib/clubProfileCopy.ts', 'lib/clubInbox.ts', 'lib/profileD2.ts']) {
      expect(src(f), f).toContain('shortDayOf')
      expect(src(f), f).not.toContain('${MONTH[d.getMonth()]} ${d.getDate()}')
    }
  })
  it('My applications and the role card follow', () => {
    const applied = new Date(NOW); applied.setDate(applied.getDate() - 40)
    expect(appliedLine(applied.toISOString(), NOW)).toMatch(/^Applied \d{1,2} [A-Z][a-z]{2}$/)
    expect(appliedOnLine('2026-09-03T10:00:00')).toBe('Applied 3 Sep 2026')
    expect(whenLine({ start_date: '2026-11-16T00:00:00', duration_text: '3' } as Pick<Vacancy, 'start_date' | 'duration_text'>, NOW)).toBe('16 Nov · 3 months')
  })
})

// ── 8 + 9 · the signed career entry ─────────────────────────────────────────
describe('8 · a signing that starts later reads "From Nov 2026" and is not "Now" yet', () => {
  const entry = { startDate: '2026-11-01', endDate: null, years: '2026–27' }
  it('careerSpan / isCurrentEntry are date-aware', () => {
    expect(startsLater('2026-11-01', NOW)).toBe(true)
    expect(startsLater('2026-10-02', NOW)).toBe(false)
    expect(careerSpan(entry, NOW)).toBe('From Nov 2026')
    expect(isCurrentEntry(entry, NOW)).toBe(false)
    const started = new Date(2026, 10, 1, 9)
    expect(careerSpan(entry, started)).toBe('Nov 2026 – now')
    expect(isCurrentEntry(entry, started)).toBe(true)
    // Legacy rows keep their text rule.
    expect(isCurrentEntry({ startDate: null, endDate: null, years: '2020 – present' }, NOW)).toBe(true)
  })
})

describe('9 · the flag beside the entry comes from its own country before the linked world club', () => {
  const countries = [
    { id: 1, name: 'United Kingdom', common_name: 'England', flag_emoji: '🏴' },
    { id: 2, name: 'Australia', common_name: null, flag_emoji: '🇦🇺' },
  ]
  it('flagForCountryName matches name or common name, case-insensitive', () => {
    expect(flagForCountryName(countries, 'England')).toBe('🏴')
    expect(flagForCountryName(countries, 'australia')).toBe('🇦🇺')
    expect(flagForCountryName(countries, 'Narnia')).toBeNull()
    expect(flagForCountryName(countries, null)).toBeNull()
  })
  it('CareerRow: location flag wins; the row reads "From Nov 2026" with no Now badge until the start date', () => {
    const entry: ScrollCareerEntry = {
      id: 'c1', entryType: 'club', clubName: 'E2E Test FC', positionRole: 'midfielder', divisionLeague: 'Premier', locationCity: 'Manchester',
      locationCountry: 'England', startDate: '2099-11-01', endDate: null, years: '2099–00', representedLevel: null, representedCountryId: null,
      worldClub: { id: 'w1', club_name: 'E2E Test FC', avatar_url: null, flag: '🇦🇺' }, signedViaHockia: true,
    }
    render(<CareerRow entry={entry} last flag={null} locationFlag={flagForCountryName(countries, entry.locationCountry)} />)
    expect(screen.getByText('🏴 Manchester · From Nov 2099')).toBeTruthy()
    expect(screen.queryByText('Now')).toBeNull()
    expect(screen.getByText('Signed through Hockia')).toBeTruthy()
  })
})

// ── 15 · Community keeps the typed search across member-type chips ──────────
describe('15 · the search box survives Players → All', () => {
  it('pathWithSearch / searchQueryOf', () => {
    expect(pathWithSearch('/community', 'ana')).toBe('/community?q=ana')
    expect(pathWithSearch('/community', '  ')).toBe('/community')
    expect(pathWithSearch('/community/players', 'a b&c')).toBe('/community/players?q=a%20b%26c')
    expect(searchQueryOf('?q=ana&x=1')).toBe('ana')
    expect(searchQueryOf('')).toBe('')
  })
  it('the chips navigate with ?q= carried over', () => {
    Element.prototype.scrollIntoView = vi.fn()
    const Probe = () => { const l = useLocation(); return <output data-testid="loc">{l.pathname}{l.search}</output> }
    render(
      <MemoryRouter initialEntries={['/community/players?q=ana']}>
        <CommunitySegments activeTab="players" />
        <Routes><Route path="*" element={<Probe />} /></Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'All' }))
    expect(screen.getByTestId('loc').textContent).toBe('/community?q=ana')
    fireEvent.click(screen.getByRole('tab', { name: 'Coaches' }))
    expect(screen.getByTestId('loc').textContent).toBe('/community/coaches?q=ana')
    expect(src('pages/CommunityPage.tsx')).toContain('pathWithSearch(roleToPath(role), searchQuery)')
  })
})
