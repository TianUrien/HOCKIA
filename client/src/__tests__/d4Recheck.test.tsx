/**
 * D4 re-check (QA 2 Oct 2026):
 *  1. A career entry confirm_signing created carries the "Signed through
 *     Hockia" pill wherever the career renders.
 *  2. Withdrawn applications reach the club: under Closed with a grey
 *     "Withdrawn" tag, counted, read-only. Road applicants (offered …
 *     signed) stay under Shortlisted with their step tag.
 */
import { useRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applicantChipFor,
  closedApplicantTag,
  indefiniteArticle,
  offerCardState,
  offerDeclinedNote,
  offerStartLine,
  playerRoadSteps,
  recruitingEventLine,
  roadHeaderLine,
  roadSteps,
  shortDayOf,
  signedTitle,
} from '@/lib/signing'
import { appliedSinceLine, pipelineOf } from '@/lib/clubRecruiting'
import type { CareerTimelineEntry } from '@/hooks/useCareerTimeline'
import type { Applicant } from '@/hooks/useRoleApplicants'
import type { ChatMessage } from '@/types/chat'
import type { Vacancy } from '@/lib/supabase'

const fx = vi.hoisted(() => ({
  career: [] as unknown[],
  applicants: [] as unknown[],
  offerMade: null as boolean | null,
}))

vi.mock('@/hooks/useSigning', () => ({
  useSigningActions: () => ({ busy: false, withdrawApplication: vi.fn() }),
  useOwnOfferMade: () => fx.offerMade,
}))

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('@/lib/auth', () => {
  const state = { user: { id: 'club1' }, profile: { id: 'club1', role: 'club', full_name: 'E2E Test FC' } }
  return { useAuthStore: (sel?: (s: unknown) => unknown) => (sel ? sel(state) : state) }
})
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [{ id: 1, name: 'Argentina', code: 'AR', flag_emoji: '🇦🇷' }] }) }))
vi.mock('@/hooks/useCareerTimeline', () => ({
  useCareerTimeline: () => ({ entries: fx.career, loading: false, failed: false, refresh: vi.fn() }),
}))
vi.mock('@/hooks/useRoleApplicants', () => ({
  useRoleApplicants: () => ({
    loading: false, error: null, expiryDays: 14, refresh: vi.fn(), setLocalStatus: vi.fn(),
    role: { id: 'r1', club_id: 'club1', status: 'open', title: 'Men’s 1st player', position: 'midfielder', gender: 'Men', opportunity_type: 'player' },
    applicants: fx.applicants,
  }),
}))
vi.mock('@/components/club/RoleActions', () => ({ RoleActions: () => null }))

import CareerScreen from '@/components/profile/mobile/CareerScreen'
import ApplicantsScreen from '@/components/club/ApplicantsScreen'
import OwnApplicationRoad from '@/components/opportunities/OwnApplicationRoad'
import { OpportunityDetailMobile } from '@/components/opportunities/OpportunityDetailMobile'
import { MessageList } from '@/features/chat-v2/components/MessageList'

const inRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

const careerEntry = (p: Partial<CareerTimelineEntry>): CareerTimelineEntry => ({
  id: 'c1', entryType: 'club', clubName: 'E2E Test FC', positionRole: 'midfielder', divisionLeague: 'Primera', locationCity: 'Buenos Aires',
  locationCountry: null, startDate: '2026-10-01', endDate: null, years: '', highlights: [], representedCountryId: null, crestUrl: null, clubFlag: null,
  signedViaHockia: false,
  row: {} as CareerTimelineEntry['row'],
  ...p,
})

const person = (id: string, fullName: string): Applicant['person'] => ({
  id, fullName, avatarUrl: null, role: 'player', position: 'midfielder', secondaryPosition: null, nationalityCountryId: 1,
  nationality2CountryId: null, baseLocation: null, playingCategory: 'adult_men', lastActiveAt: null, currentClub: null, currentWorldClubId: null,
})
const applicant = (id: string, status: string, name: string, p: Partial<Applicant> = {}): Applicant => ({
  applicationId: id, status, appliedAt: '2026-09-20T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', metadata: {}, viewed: true, invited: false, fit: null,
  person: person(`p-${id}`, name), ...p,
})

beforeEach(() => {
  fx.career = []
  fx.applicants = []
  fx.offerMade = null
})

describe('1 · career entry mark', () => {
  it('See all: the signed entry carries the pill, a normal one does not', () => {
    fx.career = [careerEntry({ id: 'c1', signedViaHockia: true }), careerEntry({ id: 'c2', clubName: 'Old Club', signedViaHockia: false })]
    inRouter(<CareerScreen profileId="p1" mode="public" onBack={vi.fn()} />)
    const pills = screen.getAllByTestId('signed-through-hockia')
    expect(pills).toHaveLength(1)
    expect(pills[0].textContent).toBe('Signed through Hockia')
    expect(pills[0].closest('li')?.textContent).toContain('E2E Test FC')
  })

  it('own view shows the same pill', () => {
    fx.career = [careerEntry({ signedViaHockia: true })]
    inRouter(<CareerScreen profileId="p1" mode="own" onBack={vi.fn()} />)
    expect(screen.getByTestId('signed-through-hockia')).toBeTruthy()
  })
})

describe('2 · withdrawn applicants reach the club', () => {
  it('withdrawn and filled sit under Closed; the road stays under Shortlisted', () => {
    expect(applicantChipFor('withdrawn')).toBe('no_response')
    expect(applicantChipFor('filled')).toBe('no_response')
    expect(applicantChipFor('no_response')).toBe('no_response')
    expect(applicantChipFor('signed')).toBe('shortlisted')
    expect(closedApplicantTag('withdrawn')).toBe('Withdrawn')
    expect(closedApplicantTag('filled')).toBe('Role filled')
    expect(closedApplicantTag('no_response')).toBeNull()
  })

  it('counts withdrawn in the header and the Closed total', () => {
    const p = pipelineOf(['pending', 'withdrawn', 'no_response', 'signed'])
    expect(p.closed).toBe(2)
    expect(p.withdrawn).toBe(1)
    expect(p.total).toBe(4)
    expect(appliedSinceLine([{ status: 'withdrawn', appliedAt: '2026-09-12T00:00:00Z' }, { status: 'pending', appliedAt: '2026-09-20T00:00:00Z' }], () => 'Sep 12')).toBe('2 applied since Sep 12')
  })

  it('Applicants: Closed chip counts and lists the withdrawn row with a grey Withdrawn tag', () => {
    fx.applicants = [
      applicant('a1', 'pending', 'Guido Piergiacomi', { viewed: false }),
      applicant('a2', 'withdrawn', 'Facundo Diaz'),
      applicant('a3', 'offered', 'Ana Pérez'),
    ]
    inRouter(<ApplicantsScreen roleId="r1" />)
    expect(screen.getByText(/3 applied since/)).toBeTruthy()
    // To review holds only the pending one.
    expect(screen.getAllByTestId('applicant-row')).toHaveLength(1)
    expect(screen.queryByTestId('applicant-status-tag')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Closed · 1' }))
    const closed = screen.getAllByTestId('applicant-row')
    expect(closed).toHaveLength(1)
    expect(closed[0].textContent).toContain('Facundo Diaz')
    const tag = closed[0].querySelector('[data-testid="applicant-status-tag"]')
    expect(tag?.textContent).toBe('Withdrawn')
    expect(tag?.className).not.toMatch(/amber/)
    expect(screen.getByText(/withdrawn by the applicant/)).toBeTruthy()

    // The offered applicant stays under Shortlisted with the step as a grey tag.
    fireEvent.click(screen.getByRole('tab', { name: 'Shortlisted' }))
    const shortlisted = screen.getAllByTestId('applicant-row')
    expect(shortlisted).toHaveLength(1)
    expect(shortlisted[0].textContent).toContain('Ana Pérez')
    expect(shortlisted[0].querySelector('[data-testid="applicant-status-tag"]')?.textContent).toBe('Offer sent')
  })
})

describe('3 · the decline reason reaches the club', () => {
  const NOW = new Date('2026-10-02T12:00:00Z')

  it('club card: "<name> declined — <reason>", grey; without a reason just "<name> declined"', () => {
    const withReason = offerCardState({ viewer: 'club', status: 'declined', openUntil: null, playerFirstName: 'Sam', declineReason: 'Moving abroad next season', now: NOW })
    expect(withReason.line).toBe('Sam declined — Moving abroad next season')
    expect(withReason.muted).toBe(true)
    expect(withReason.deadlineTone).toBe('grey')
    expect(offerCardState({ viewer: 'club', status: 'declined', openUntil: null, playerFirstName: 'Sam', declineReason: '  ', now: NOW }).line).toBe('Sam declined')
  })

  it('player card is unchanged and never repeats the reason', () => {
    const s = offerCardState({ viewer: 'player', status: 'declined', openUntil: null, declineReason: 'Moving abroad', now: NOW })
    expect(s.line).toBe('You declined this offer')
  })

  it('applicant review: a grey note under the road only after the newest offer was declined', () => {
    const offer = { status: 'declined' as const, decline_reason: 'Moving abroad next season' }
    expect(offerDeclinedNote('Sam', offer)).toBe('Sam declined your offer — “Moving abroad next season”')
    expect(offerDeclinedNote('Sam', { status: 'declined', decline_reason: null })).toBe('Sam declined your offer.')
    expect(offerDeclinedNote('Sam', { status: 'live', decline_reason: null })).toBeNull()
    expect(offerDeclinedNote('Sam', null)).toBeNull()
  })
})

const NOW = new Date('2026-10-02T12:00:00Z')
const CLUB = 'club1'
const signingMarked: ChatMessage = {
  id: 'm-signed', conversation_id: 'c1', sender_id: CLUB, read_at: null, sent_at: '2026-10-02T10:00:00Z',
  content: 'E2E Test FC marked you as signed for Men’s 1st player. Confirm it on Hockia to add the signing to your career.',
  metadata: { type: 'application_event', event: 'signing_marked', application_id: 'a1', opportunity_id: 'r1' },
}

function Thread({ messages, viewer }: { messages: ChatMessage[]; viewer: string }) {
  const ref = useRef<HTMLDivElement | null>(null)
  return (
    <div ref={ref} className="chat-scroll-container">
      <MessageList
        messages={messages}
        currentUserId={viewer}
        scrollContainerRef={ref}
        queueReadReceipt={vi.fn()}
        retryMessage={vi.fn()}
        deleteFailedMessage={vi.fn()}
        editMessage={vi.fn().mockResolvedValue(true)}
        deleteMessage={vi.fn().mockResolvedValue(true)}
        isLoadingMore={false}
        unreadMetadata={{ firstUnreadId: null, unreadCount: 0 }}
        otherParticipantName="Facundo Diaz"
      />
    </div>
  )
}

describe('4a · the club reads its own signing step in club-facing words', () => {
  it('rewrites only signing_marked for the sender; the player keeps the server line', () => {
    expect(recruitingEventLine('signing_marked', signingMarked.content, { isMine: true, otherFirstName: 'Facundo' })).toBe('You marked Facundo as signed for Men’s 1st player. Waiting for them to confirm.')
    expect(recruitingEventLine('signing_marked', signingMarked.content, { isMine: true, otherFirstName: '' })).toBe('You marked the player as signed for Men’s 1st player. Waiting for them to confirm.')
    expect(recruitingEventLine('signing_marked', signingMarked.content, { isMine: false, otherFirstName: 'E2E' })).toBe(signingMarked.content)
    expect(recruitingEventLine('offer_withdrawn', 'E2E Test FC withdrew its offer for X.', { isMine: true, otherFirstName: 'Facundo' })).toBe('E2E Test FC withdrew its offer for X.')
  })

  it('in the thread: the club sees "You marked Facundo as signed…"', () => {
    inRouter(<Thread messages={[signingMarked]} viewer={CLUB} />)
    expect(screen.getByTestId('recruiting-event-line').textContent).toBe('You marked Facundo as signed for Men’s 1st player. Waiting for them to confirm.')
    expect(screen.queryByTestId('signing-prompt')).toBeNull()
  })
})

describe('4b · player steps: Offer reads skipped when no offer was made', () => {
  it('a signing without an accepted offer: Offer not done, skipped; unknown keeps it done', () => {
    const skipped = playerRoadSteps('signed', false)!
    expect(skipped[1]).toMatchObject({ label: 'Offer', done: false, skipped: true })
    expect(skipped[2].done).toBe(true)
    expect(playerRoadSteps('signed_pending_confirmation', false)![1]).toMatchObject({ done: false, skipped: true })
    expect(playerRoadSteps('signed', true)![1]).toMatchObject({ done: true, skipped: false })
    expect(playerRoadSteps('signed', null)![1]).toMatchObject({ done: true, skipped: false })
    // Statuses before a signing never read skipped.
    expect(playerRoadSteps('accepted', false)![1]).toMatchObject({ done: true, skipped: false })
    expect(playerRoadSteps('offered', false)![1]).toMatchObject({ done: false, current: true, skipped: false })
  })

  it('renders the skipped step grey with "· skipped"', () => {
    fx.offerMade = false
    inRouter(<OwnApplicationRoad applicationId="a1" status="signed" onChanged={vi.fn()} />)
    const offer = screen.getByTestId('player-road-steps').querySelector('[data-skipped="true"]')
    expect(offer?.textContent).toBe('Offer · skipped')
    expect(offer?.getAttribute('data-done')).toBe('false')
  })
})

describe('4c · "See the offer" asks for the offer card, not just the chat', () => {
  it('calls onSeeOffer when given, else onMessage', () => {
    const onMessage = vi.fn()
    const onSeeOffer = vi.fn()
    const { unmount } = inRouter(<OwnApplicationRoad applicationId="a1" status="offered" onMessage={onMessage} onSeeOffer={onSeeOffer} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByTestId('own-application-see-offer'))
    expect(onSeeOffer).toHaveBeenCalledTimes(1)
    expect(onMessage).not.toHaveBeenCalled()
    unmount()
    inRouter(<OwnApplicationRoad applicationId="a1" status="offered" onMessage={onMessage} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByTestId('own-application-see-offer'))
    expect(onMessage).toHaveBeenCalledTimes(1)
  })
})

const openVacancy = {
  id: 'r1', club_id: 'club-9', title: 'Men’s 1st player', opportunity_type: 'player', position: 'midfielder', gender: 'Men', status: 'open',
  location_city: 'Amsterdam', location_country: 'Netherlands', created_at: '2026-09-01T00:00:00Z', application_deadline: null, start_date: null,
  duration_text: null, benefits: [], custom_benefits: [], specialist_skills_wanted: [], requirements: [], description: null, compensation: null,
  eu_passport_required: false,
} as unknown as Vacancy

describe('4d · role page after withdrawing', () => {
  it('phone: only the grey Withdrawn state — no "Applied" button, no second pill', () => {
    inRouter(
      <OpportunityDetailMobile
        vacancy={openVacancy} clubName="QA Club" clubLogo={null} clubId="club-9" publisherRole="club" countryFlag={null} league={null}
        hasApplied applicationStatus="withdrawn" canApply={false} isPublisher={false} onApply={vi.fn()} onMessage={vi.fn()}
      />,
    )
    const state = screen.getByTestId('withdrawn-state')
    expect(state.textContent?.trim()).toBe('Withdrawn')
    expect(state.className).toContain('bg-surface-grouped')
    expect(screen.queryByText('Applied')).toBeNull()
    expect(screen.getAllByText('Withdrawn')).toHaveLength(1)
    expect(screen.getByText('View my applications')).toBeTruthy()
  })
})

describe('4e · a / an before the club name', () => {
  it('uses the vowel sound, initialisms read letter by letter', () => {
    expect(indefiniteArticle('E2E Test FC')).toBe('an')
    expect(indefiniteArticle('FC Barcelona')).toBe('an')
    expect(indefiniteArticle('Amsterdam HC')).toBe('an')
    expect(indefiniteArticle('Hockey Club')).toBe('a')
    expect(indefiniteArticle('Universidad')).toBe('a')
    expect(indefiniteArticle('UCD')).toBe('a')
    expect(signedTitle('E2E Test FC', 'player')).toBe('You’re an E2E Test FC player')
    expect(signedTitle('Club Atlético', 'coach')).toBe('You’re a Club Atlético coach')
  })
})

describe('4f · a role without a start date starts immediately', () => {
  it('offer start line never reads "Not set"', () => {
    expect(offerStartLine(null, '7 months')).toBe('Immediately · 7 months')
    expect(offerStartLine(null, null)).toBe('Immediately')
    expect(offerStartLine('2026-10-01', '7 months')).toBe('1 Oct 2026 · 7 months')
  })
})

describe('4g · one date format on the road and the offer card', () => {
  it('day first everywhere: "2 Oct", "open until 9 Oct", "applied 17 Sep"', () => {
    expect(shortDayOf('2026-10-02T15:00:00Z', NOW)).toBe('2 Oct')
    expect(shortDayOf('2025-12-24T15:00:00Z', NOW)).toBe('24 Dec 2025')
    const accepted = roadSteps({ status: 'accepted', talked: true, trial: false, firstName: 'Sam', now: NOW, offer: { status: 'accepted', open_until: '2026-10-09', responded_at: '2026-10-02T15:00:00Z', sent_at: '2026-09-30T10:00:00Z' } })
    expect(accepted.find((s) => s.key === 'offer')?.detail).toBe('Sam accepted · 2 Oct')
    const sent = roadSteps({ status: 'offered', talked: true, trial: false, firstName: 'Sam', now: NOW, offer: { status: 'live', open_until: '2026-10-09', responded_at: null, sent_at: '2026-09-30T10:00:00Z' } })
    expect(sent.find((s) => s.key === 'offer')?.detail).toBe('Sent · open until 9 Oct')
    expect(roadHeaderLine('2026-10-02T09:00:00Z', '2026-09-17T09:00:00Z', NOW)).toBe('Shortlisted today · applied 17 Sep')
    const signed = roadSteps({ status: 'signed', talked: true, trial: false, firstName: 'Sam', now: NOW, signedAt: '2026-10-02T15:00:00Z' })
    expect(signed.find((s) => s.key === 'signed')?.detail).toBe('Signed through Hockia · 2 Oct')
  })
})
