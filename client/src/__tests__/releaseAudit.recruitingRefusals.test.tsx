/**
 * Release audit 2026-10-05 · invite → offer → signing, where the server says no.
 *
 * The recruiting SQL functions are the authority for every rule (ADR-0002);
 * the client only mirrors them. No CI job runs those functions against a
 * database (the probes are hand-run), and every component test mocks
 * `useSigningActions` away. So this file pins, without a database:
 *
 *   A. the client mirrors against the NEWEST SQL text in supabase/migrations:
 *      every refusal a person can hit has words, every action button is one
 *      the server would accept for that status;
 *   B. every application / offer / invite status renders something sane;
 *   C. the real hooks: a refusal becomes the server's sentence, is not
 *      reported as a crash, fires no analytics event, and the button unlocks.
 */
import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  report: vi.fn(),
  track: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...a: unknown[]) => h.rpc(...a), from: vi.fn() },
}))
vi.mock('@/lib/sentryHelpers', () => ({ reportSupabaseError: (...a: unknown[]) => h.report(...a) }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: (...a: unknown[]) => h.track(...a) }))
vi.mock('@/lib/auth', () => {
  const state = { user: { id: 'club1' }, profile: { id: 'club1', role: 'club', full_name: 'Test FC' } }
  return { useAuthStore: (sel?: (s: unknown) => unknown) => (sel ? sel(state) : state) }
})
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { Constants } from '@/lib/database.types'
import { useToastStore } from '@/lib/toast'
import { useSigningActions } from '@/hooks/useSigning'
import { useDeclineInvite, useSendInvite } from '@/hooks/useInvites'
import {
  WITHDRAWABLE_STATUSES,
  applicantChipFor,
  canWithdraw,
  clubRoadTag,
  isOnRoad,
  offerCardState,
  playerRoadSteps,
  roadMainAction,
  roadMenu,
  signingErrorMessage,
  withdrawBody,
  type OfferStatus,
} from '@/lib/signing'
import { inviteCardState, inviteErrorMessage, inviteLimitReason, respondErrorMessage, type InviteStatus } from '@/lib/invites'
import { APPLICATION_STATUS_LABELS, applicationStatusLabel, closedApplicationNote, isDecidableApplicationStatus, playerApplicationStatusBadge } from '@/lib/applicationStatus'
import { applicationStatusPill } from '@/lib/opportunityCopy'
import { NEW_CONVERSATION_LIMIT_CODE, NEW_CONVERSATION_LIMIT_MESSAGE, isNewConversationLimitError } from '@/lib/newConversationLimit'
import { newestFunction, raisesOf, statusesAllowedBefore } from './fixtures/sqlSource'

const APPLICATION_STATUSES = Constants.public.Enums.application_status as readonly string[]
const FALLBACK = '__fallback__'
/** A refusal a person can reach through the UI (a rule), as opposed to "not yours / not signed in". */
const isRule = (errcode: string | null) => errcode === 'P0001' || errcode === '22023'

// ═════════════════════════════════════════════════════════════════════════════
// A · client mirrors ↔ the newest SQL
// ═════════════════════════════════════════════════════════════════════════════

describe('A · SQL source of truth is the release under audit', () => {
  it('the functions this release redefines are read from 20261004200000', () => {
    for (const name of ['send_invite', 'make_offer', 'withdraw_offer', 'mark_signed', 'undo_mark_signed', 'confirm_signing']) {
      expect(newestFunction(name).file, name).toBe('20261004200000_role_organisation_name.sql')
    }
    expect(newestFunction('_enforce_new_conversation_limit').file).toBe('20261004300000_new_conversation_limits.sql')
  })
})

describe('A · every rule the server can refuse with has its own words on the client', () => {
  const SIGNING_FUNCTIONS = ['make_offer', 'withdraw_offer', 'respond_offer', 'mark_signed', 'undo_mark_signed', 'confirm_signing', 'set_trial', 'withdraw_application']

  it('offer / signing / withdraw: each P0001 and 22023 refusal is shown as the server wrote it, not as "try again"', () => {
    // Argument validation the client can never trip: respondOffer always sends a boolean.
    const UNREACHABLE = ['Answer is required']
    let checked = 0
    for (const name of SIGNING_FUNCTIONS) {
      for (const raise of raisesOf(newestFunction(name)).filter((r) => isRule(r.errcode) && !UNREACHABLE.includes(r.message))) {
        const shown = signingErrorMessage({ message: raise.message, details: raise.detail ?? undefined }, FALLBACK)
        expect(shown, `${name}: "${raise.message}"`).not.toBe(FALLBACK)
        // Same sentence, typographic apostrophe, one full stop.
        expect(shown, name).toBe(`${raise.message.replace("'", '’')}.`)
        checked += 1
      }
    }
    // 7 functions' worth of rules; a parser that silently finds nothing must fail.
    expect(checked).toBeGreaterThanOrEqual(18)
  })

  it('offer / signing: authorisation refusals (42501) stay generic — internal wording is not shown', () => {
    for (const name of SIGNING_FUNCTIONS) {
      for (const raise of raisesOf(newestFunction(name)).filter((r) => r.errcode === '42501')) {
        expect(signingErrorMessage({ message: raise.message }, FALLBACK), `${name}: "${raise.message}"`).toBe(FALLBACK)
      }
    }
  })

  it('send_invite: each rule has its own sentence; the daily cap names the number the server sent', () => {
    const generic = inviteErrorMessage({ message: 'boom' })
    const rules = raisesOf(newestFunction('send_invite')).filter((r) => isRule(r.errcode))
    expect(rules.length).toBeGreaterThanOrEqual(7)
    for (const raise of rules) {
      const message = raise.message.replace('(% per day)', '(20 per day)')
      expect(inviteErrorMessage({ message }), `"${raise.message}"`).not.toBe(generic)
    }
    expect(inviteErrorMessage({ message: 'Daily invite limit reached (5 per day)' })).toBe(inviteLimitReason(5))
    expect(inviteErrorMessage({ message: 'Daily invite limit reached (20 per day)' })).toBe(inviteLimitReason(20))
    expect(inviteLimitReason(5)).not.toBe(inviteLimitReason(20))
  })

  it('respond_invite (decline is the only response this client sends): both reachable rules are explained', () => {
    const generic = respondErrorMessage({ message: 'boom' })
    const all = raisesOf(newestFunction('respond_invite')).filter((r) => isRule(r.errcode)).map((r) => r.message)
    // Raised only on the apply branch, which the client does not call
    // (a player applies through the role page, not through respond_invite).
    const APPLY_ONLY = ['Response must be apply or decline', 'This role is for a different profile type', 'The note can be up to 1000 characters', 'You have already applied to this role']
    const reachable = all.filter((m) => !APPLY_ONLY.includes(m))
    expect(reachable.sort()).toEqual(['This invite has already been answered', 'This invite has expired'])
    for (const message of reachable) expect(respondErrorMessage({ message }), message).not.toBe(generic)
  })

  it('new-conversation allowance: the client constant is the server sentence, letter for letter', () => {
    const [refusal] = raisesOf(newestFunction('_enforce_new_conversation_limit'))
    // The client recognises the refusal by DETAIL or, failing that, by the exact
    // sentence, and shows its own copy of the sentence: all three must agree.
    expect(refusal.message).toBe(NEW_CONVERSATION_LIMIT_MESSAGE)
    expect(refusal.detail).toBe(NEW_CONVERSATION_LIMIT_CODE)
    expect(refusal.errcode).toBe('P0001')
    expect(isNewConversationLimitError({ code: 'P0001', message: refusal.message, details: refusal.detail })).toBe(true)
    // PostgREST may omit details; the sentence alone still identifies it.
    expect(isNewConversationLimitError({ code: 'P0001', message: refusal.message })).toBe(true)
    // …and an unrelated P0001 is not mistaken for it.
    expect(isNewConversationLimitError({ code: 'P0001', message: 'This role is not open' })).toBe(false)
  })
})

describe('A · the club only ever sees a button the server would accept', () => {
  const makeOffer = statusesAllowedBefore(newestFunction('make_offer'), 'Offers can be made to shortlisted applicants only')
  const markSigned = statusesAllowedBefore(newestFunction('mark_signed'), 'Only a shortlisted applicant or an accepted offer can be marked as signed')
  const undo = statusesAllowedBefore(newestFunction('undo_mark_signed'), 'Only a signing still waiting for the player can be undone')
  const confirm = statusesAllowedBefore(newestFunction('confirm_signing'), 'There is no signing waiting for your confirmation')
  const withdrawOffer = statusesAllowedBefore(newestFunction('withdraw_offer'), 'Only an offer still waiting for an answer can be withdrawn')
  const withdrawApplication = statusesAllowedBefore(newestFunction('withdraw_application'), 'This application is already closed')
  const setTrial = statusesAllowedBefore(newestFunction('set_trial'), 'A trial can be recorded for shortlisted applicants only')

  it('reads the guards (sanity)', () => {
    expect(makeOffer.sort()).toEqual(['offered', 'shortlisted'])
    expect(markSigned.sort()).toEqual(['accepted', 'shortlisted'])
    expect(undo).toEqual(['signed_pending_confirmation'])
    expect(confirm).toEqual(['signed_pending_confirmation'])
    expect(withdrawOffer).toEqual(['offered'])
    // The sentence says "shortlisted applicants only"; the guard also lets the later road statuses through.
    expect(setTrial.sort()).toEqual(['accepted', 'offered', 'shortlisted', 'signed_pending_confirmation'])
  })

  it('for all 12 application statuses, each offered action is allowed by its SQL guard — and each allowed action is offered', () => {
    expect(APPLICATION_STATUSES.length).toBe(12)
    for (const status of APPLICATION_STATUSES) {
      const main = roadMainAction(status)
      const menu = roadMenu(status)
      const offersMakeOffer = main === 'make_offer' || main === 'edit_offer'
      const offersMarkSigned = main === 'mark_signed' || menu.includes('mark_signed')
      expect(offersMakeOffer, `make_offer @ ${status}`).toBe(makeOffer.includes(status))
      expect(offersMarkSigned, `mark_signed @ ${status}`).toBe(markSigned.includes(status))
      expect(menu.includes('withdraw_offer'), `withdraw_offer @ ${status}`).toBe(withdrawOffer.includes(status))
      expect(menu.includes('undo_signing'), `undo_mark_signed @ ${status}`).toBe(undo.includes(status))
    }
  })

  it('the player can withdraw exactly where withdraw_application accepts it, and never a confirmed signing', () => {
    expect([...WITHDRAWABLE_STATUSES].sort()).toEqual([...withdrawApplication].sort())
    for (const status of APPLICATION_STATUSES) {
      expect(canWithdraw(status), status).toBe(withdrawApplication.includes(status))
    }
    expect(canWithdraw('signed')).toBe(false)
    expect(canWithdraw(null)).toBe(false)
  })

  it('the player is only asked to confirm in the one status confirm_signing accepts', () => {
    for (const status of APPLICATION_STATUSES) {
      const asksToConfirm = APPLICATION_STATUS_LABELS[status] === 'Confirm signing'
      expect(asksToConfirm, status).toBe(confirm.includes(status))
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// B · every status renders
// ═════════════════════════════════════════════════════════════════════════════

const NOW = new Date(2026, 9, 5, 12, 0, 0) // 5 Oct 2026, local noon
const RAW_TOKEN = /\b[a-z]+_[a-z_]+\b/

describe('B · application status × every surface', () => {
  it('every enum value has a label, and no label is a raw database token', () => {
    for (const status of APPLICATION_STATUSES) {
      const label = applicationStatusLabel(status)
      expect(label, status).toBeTruthy()
      expect(label as string, status).not.toMatch(RAW_TOKEN)
    }
    expect(applicationStatusLabel('a_status_added_next_month')).toBeNull()
    expect(applicationStatusLabel(null)).toBeNull()
  })

  it('My applications pill: a label and a tone for every status; the player never gets amber', () => {
    for (const status of APPLICATION_STATUSES) {
      for (const roleOpen of [true, false]) {
        const pill = applicationStatusPill(status, '2026-09-01T10:00:00Z', roleOpen, NOW)
        expect(pill.label, status).toBeTruthy()
        expect(pill.label, status).not.toMatch(RAW_TOKEN)
        expect(['positive', 'neutral', 'grey'], `${status} → ${pill.tone}`).toContain(pill.tone)
      }
    }
  })

  it('My applications pill, pending: In review → "No reply · Nd" from day 14 → Role closed when the role closes', () => {
    expect(applicationStatusPill('pending', '2026-09-30T10:00:00Z', true, NOW).label).toBe('In review')
    expect(applicationStatusPill('pending', '2026-09-22T10:00:00Z', true, NOW).label).toBe('In review') // 13 days
    const long = applicationStatusPill('pending', '2026-09-21T10:00:00Z', true, NOW) // 14 days
    expect(long.label).toBe('No reply · 14d')
    expect(long.tone).toBe('grey')
    expect(applicationStatusPill('pending', '2026-09-01T10:00:00Z', false, NOW).label).toBe('Role closed')
    // A status this build does not know yet behaves like pending, not like a crash.
    expect(applicationStatusPill('a_status_added_next_month', null, true, NOW).label).toBe('In review')
  })

  it('role-page badge: a closed outcome is never red, and nothing is undefined', () => {
    for (const status of APPLICATION_STATUSES) {
      const badge = playerApplicationStatusBadge(status)
      if (badge === null) {
        // Only where another element already tells the story.
        expect(['pending', 'withdrawn', 'offer_declined'], status).toContain(status)
        continue
      }
      expect(badge.label, status).toBe(APPLICATION_STATUS_LABELS[status])
      expect(badge.className, status).not.toMatch(/red|rose|amber/)
    }
  })

  it('club applicants list: every status lands under a chip that exists', () => {
    const CHIPS = ['pending', 'shortlisted', 'maybe', 'rejected', 'no_response']
    for (const status of APPLICATION_STATUSES) {
      expect(CHIPS, `${status} → ${applicantChipFor(status)}`).toContain(applicantChipFor(status))
    }
    // Past Shortlist the row says which step it is on.
    for (const status of ['offered', 'accepted', 'signed_pending_confirmation', 'signed']) {
      expect(clubRoadTag(status), status).toBeTruthy()
    }
  })

  it('club review screen: every status has either a decision bar, a road, or a closed note — never a blank', () => {
    for (const status of APPLICATION_STATUSES) {
      const decidable = isDecidableApplicationStatus(status)
      const road = isOnRoad(status)
      const note = closedApplicationNote(status, 'Sam')
      expect(decidable || road || note.length > 0, status).toBe(true)
      expect(note, status).toContain('Sam')
    }
    // The decision bar never shows on a status the club can no longer decide.
    for (const status of ['offered', 'accepted', 'signed_pending_confirmation', 'signed', 'withdrawn', 'filled', 'no_response']) {
      expect(isDecidableApplicationStatus(status), status).toBe(false)
    }
  })

  it('player road: three steps on the road, none off it; Signed ticks only when confirmed', () => {
    for (const status of APPLICATION_STATUSES) {
      const steps = playerRoadSteps(status)
      if (!isOnRoad(status)) {
        expect(steps, status).toBeNull()
        continue
      }
      expect(steps?.map((s) => s.label), status).toEqual(['Shortlisted', 'Offer', 'Signed'])
      expect(steps?.[2].done, status).toBe(status === 'signed')
    }
    // Marked by the club but not confirmed by the player is NOT signed.
    expect(playerRoadSteps('signed_pending_confirmation')?.[2].done).toBe(false)
  })

  it('withdraw confirmation says what is lost for the statuses with something to lose', () => {
    expect(withdrawBody('offered')).toMatch(/offer waiting for you is cancelled/)
    expect(withdrawBody('accepted')).toMatch(/signing won’t go ahead/)
    expect(withdrawBody('signed_pending_confirmation')).toMatch(/signing won’t go ahead/)
    for (const status of WITHDRAWABLE_STATUSES) expect(withdrawBody(status)).toMatch(/can’t be undone/)
  })
})

describe('B · offer status × viewer (the CHECK list of opportunity_offers.status)', () => {
  const OFFER_STATUSES: OfferStatus[] = ['live', 'superseded', 'withdrawn', 'accepted', 'declined', 'expired', 'cancelled']

  it('only a live, unexpired offer shows Accept / Decline, and only to the player', () => {
    for (const status of OFFER_STATUSES) {
      for (const viewer of ['player', 'club'] as const) {
        const state = offerCardState({ viewer, status, openUntil: '2026-10-20', playerFirstName: 'Sam', now: NOW })
        expect(state.actionable, `${status}/${viewer}`).toBe(status === 'live' && viewer === 'player')
        if (!state.actionable) expect(state.line, `${status}/${viewer}`).toBeTruthy()
        expect(`${state.line ?? ''}${state.deadline ?? ''}`, `${status}/${viewer}`).not.toMatch(/undefined|null|NaN/)
      }
    }
  })

  it('the deadline day itself is still open; the day after, a live offer reads expired before the nightly job runs', () => {
    const today = offerCardState({ viewer: 'player', status: 'live', openUntil: '2026-10-05', now: NOW })
    expect(today.actionable).toBe(true)
    expect(today.deadline).toBe('Open until 5 Oct')
    const lapsed = offerCardState({ viewer: 'player', status: 'live', openUntil: '2026-10-04', now: NOW })
    expect(lapsed).toMatchObject({ actionable: false, muted: true, line: 'This offer has expired', deadline: null })
    // Late in the evening of the last day it is still open (local calendar days, not 24 h).
    const lateEvening = offerCardState({ viewer: 'player', status: 'live', openUntil: '2026-10-05', now: new Date(2026, 9, 5, 23, 59, 0) })
    expect(lateEvening.actionable).toBe(true)
  })

  it('amber is the player’s last five days only; the club waiting is always grey', () => {
    const tone = (viewer: 'player' | 'club', openUntil: string) => offerCardState({ viewer, status: 'live', openUntil, now: NOW }).deadlineTone
    expect(tone('player', '2026-10-11')).toBe('grey') // 6 days left
    expect(tone('player', '2026-10-10')).toBe('amber') // 5 days left
    expect(tone('player', '2026-10-05')).toBe('amber') // last day
    for (const day of ['2026-10-05', '2026-10-10', '2026-10-11', '2026-12-31']) expect(tone('club', day), day).toBe('grey')
    for (const status of OFFER_STATUSES.filter((s) => s !== 'live')) {
      expect(offerCardState({ viewer: 'player', status, openUntil: '2026-10-06', now: NOW }).deadlineTone, status).toBe('grey')
    }
  })

  it('a decline reason is shown to the club and never echoed on the player’s own card', () => {
    const club = offerCardState({ viewer: 'club', status: 'declined', openUntil: null, playerFirstName: 'Sam', declineReason: 'Moving abroad', now: NOW })
    const player = offerCardState({ viewer: 'player', status: 'declined', openUntil: null, declineReason: 'Moving abroad', now: NOW })
    expect(club.line).toContain('Moving abroad')
    expect(player.line).toBe('You declined this offer')
  })

  it('a status this build does not know reads as closed, not as an open offer', () => {
    const state = offerCardState({ viewer: 'player', status: 'paused' as OfferStatus, openUntil: '2026-10-20', now: NOW })
    expect(state).toMatchObject({ actionable: false, muted: true, line: 'This offer is closed' })
  })
})

describe('B · invite status × viewer × role state (the CHECK list of opportunity_invites.status)', () => {
  const INVITE_STATUSES: InviteStatus[] = ['sent', 'applied', 'declined', 'expired']
  const FUTURE = '2026-10-19T12:00:00.000Z'
  const PAST = '2026-10-05T11:59:59.000Z'

  it('the three actions show only on a sent, unexpired invite to an open role, and only to the player', () => {
    for (const status of INVITE_STATUSES) {
      for (const viewer of ['player', 'club'] as const) {
        for (const roleOpen of [true, false]) {
          for (const expiresAt of [FUTURE, PAST]) {
            const state = inviteCardState({ viewer, status, expiresAt, roleOpen, playerFirstName: 'Sam', now: new Date('2026-10-05T12:00:00.000Z') })
            const open = status === 'sent' && roleOpen && expiresAt === FUTURE
            expect(state.actionable, `${status}/${viewer}/${roleOpen}/${expiresAt}`).toBe(open && viewer === 'player')
            if (!state.actionable) expect(state.line, `${status}/${viewer}`).toBeTruthy()
            // Founder ruling 2026-09-26: an invitation is never amber, for either side.
            expect(state.tone).toBe('grey')
          }
        }
      }
    }
  })

  it('a sent invite reads expired at the very second it lapses, and closed when the role closed first', () => {
    const at = (expiresAt: string, roleOpen: boolean) =>
      inviteCardState({ viewer: 'player', status: 'sent', expiresAt, roleOpen, now: new Date('2026-10-05T12:00:00.000Z') })
    expect(at('2026-10-05T12:00:00.000Z', true)).toMatchObject({ actionable: false, line: 'This invitation has expired' })
    expect(at('2026-10-05T12:00:00.001Z', true).actionable).toBe(true)
    expect(at(FUTURE, false)).toMatchObject({ actionable: false, line: 'This role is closed' })
  })

  it('an answered invite keeps its answer even after the role closes', () => {
    const applied = inviteCardState({ viewer: 'club', status: 'applied', expiresAt: PAST, roleOpen: false, playerFirstName: 'Sam' })
    expect(applied.line).toBe('Sam applied')
    const declined = inviteCardState({ viewer: 'player', status: 'declined', expiresAt: PAST, roleOpen: false })
    expect(declined.line).toBe('You passed on this role')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// C · the real hooks, with the server answering
// ═════════════════════════════════════════════════════════════════════════════

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const toasts = () => useToastStore.getState().toasts.map((t) => ({ message: t.message, type: t.type }))
const refusal = (message: string, details?: string) => ({ data: null, error: { code: 'P0001', message, details: details ?? null, hint: null } })

beforeEach(() => {
  h.rpc.mockReset()
  h.report.mockReset()
  h.track.mockReset()
  useToastStore.setState({ toasts: [] })
})

describe('C · useSigningActions', () => {
  const draft = { openUntil: '2026-10-20', startDate: '', length: '  1 season ', pay: '', package: [] as string[], note: '  See you soon  ' }

  it('make_offer sends the server exactly what the sheet holds: trimmed text, blanks as NULL, a cleared package as []', async () => {
    h.rpc.mockResolvedValue({ data: { offer_id: 'o1' }, error: null })
    const { result } = renderHook(() => useSigningActions(), { wrapper })
    let out: unknown
    await act(async () => { out = await result.current.makeOffer('app1', draft) })
    expect(h.rpc).toHaveBeenCalledWith('make_offer', {
      p_application_id: 'app1',
      p_open_until: '2026-10-20',
      p_start_date: null,
      p_length: '1 season',
      p_pay: null,
      p_package: [],
      p_note: 'See you soon',
    })
    expect(out).toEqual({ ok: true, data: { offer_id: 'o1' } })
    expect(h.track).toHaveBeenCalledWith('offer_sent', 'application', 'app1', {})
    expect(toasts()).toEqual([])
  })

  it('each action calls its own function with its own arguments', async () => {
    h.rpc.mockResolvedValue({ data: {}, error: null })
    const { result } = renderHook(() => useSigningActions(), { wrapper })
    await act(async () => {
      await result.current.withdrawOffer('offer1', 'app1')
      await result.current.respondOffer('offer1', true, null)
      await result.current.respondOffer('offer1', false, '  Moving abroad ')
      await result.current.markSigned('app1', false)
      await result.current.undoMarkSigned('app1')
      await result.current.confirmSigning('app1', true)
      await result.current.setTrial('app1', true)
      await result.current.withdrawApplication('app1')
    })
    expect(h.rpc.mock.calls).toEqual([
      ['withdraw_offer', { p_offer_id: 'offer1' }],
      ['respond_offer', { p_offer_id: 'offer1', p_accept: true, p_reason: null }],
      ['respond_offer', { p_offer_id: 'offer1', p_accept: false, p_reason: 'Moving abroad' }],
      ['mark_signed', { p_application_id: 'app1', p_close_role: false }],
      ['undo_mark_signed', { p_application_id: 'app1' }],
      ['confirm_signing', { p_application_id: 'app1', p_hide_from_clubs: true }],
      ['set_trial', { p_application_id: 'app1', p_trial: true }],
      ['withdraw_application', { p_application_id: 'app1' }],
    ])
    expect(h.track.mock.calls.map((c) => c[0])).toEqual([
      'offer_withdrawn', 'offer_accepted', 'offer_declined', 'signing_marked', 'signing_undone', 'signing_confirmed', 'application_withdrawn',
    ])
  })

  it('a rule refusal shows the server’s sentence, counts nothing, reports nothing, and unlocks the button', async () => {
    const cases: [string, (a: ReturnType<typeof useSigningActions>) => Promise<unknown>, string, string][] = [
      ['make_offer', (a) => a.makeOffer('app1', draft), 'This role is not open', 'This role is not open.'],
      ['make_offer', (a) => a.makeOffer('app1', draft), "This player can't receive an offer", 'This player can’t receive an offer.'],
      ['respond_offer', (a) => a.respondOffer('o1', true, null), 'This offer has expired', 'This offer has expired.'],
      ['respond_offer', (a) => a.respondOffer('o1', true, null), 'This offer is no longer open', 'This offer is no longer open.'],
      ['withdraw_offer', (a) => a.withdrawOffer('o1', 'app1'), 'Only an offer still waiting for an answer can be withdrawn', 'Only an offer still waiting for an answer can be withdrawn.'],
      ['mark_signed', (a) => a.markSigned('app1', true), 'Add your club to your profile to mark a signing', 'Add your club to your profile to mark a signing.'],
      ['undo_mark_signed', (a) => a.undoMarkSigned('app1'), 'Only a signing still waiting for the player can be undone', 'Only a signing still waiting for the player can be undone.'],
      ['confirm_signing', (a) => a.confirmSigning('app1', true), 'This signing request has expired', 'This signing request has expired.'],
      ['confirm_signing', (a) => a.confirmSigning('app1', true), "This signing can't be confirmed yet", 'This signing can’t be confirmed yet.'],
      ['withdraw_application', (a) => a.withdrawApplication('app1'), "A confirmed signing can't be withdrawn", 'A confirmed signing can’t be withdrawn.'],
    ]
    for (const [fn, run, serverMessage, shown] of cases) {
      h.rpc.mockReset()
      h.report.mockReset()
      h.track.mockReset()
      useToastStore.setState({ toasts: [] })
      h.rpc.mockResolvedValue(refusal(serverMessage))
      const { result, unmount } = renderHook(() => useSigningActions(), { wrapper })
      let out: unknown
      await act(async () => { out = await run(result.current) })
      expect(out, `${fn}: ${serverMessage}`).toEqual({ ok: false, error: shown })
      expect(toasts(), fn).toEqual([{ message: shown, type: 'error' }])
      expect(h.track, `${fn} must not log a success event`).not.toHaveBeenCalled()
      expect(h.report, `${fn}: a rule refusal is not an incident`).not.toHaveBeenCalled()
      expect(result.current.busy, fn).toBe(false)
      unmount()
    }
  })

  it('an unexpected database error shows the neutral line (never the raw text) and IS reported', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for table opportunity_offers' } })
    const { result } = renderHook(() => useSigningActions(), { wrapper })
    let out: unknown
    await act(async () => { out = await result.current.confirmSigning('app1', true) })
    expect(out).toEqual({ ok: false, error: 'Couldn’t confirm the signing. Please try again.' })
    expect(toasts()).toEqual([{ message: 'Couldn’t confirm the signing. Please try again.', type: 'error' }])
    expect(JSON.stringify(toasts())).not.toContain('permission denied')
    expect(h.report).toHaveBeenCalledTimes(1)
    expect(h.report.mock.calls[0][0]).toBe('useSigning.confirm_signing')
    expect(h.track).not.toHaveBeenCalled()
  })

  it('a network failure (the call throws) is handled the same way and the button unlocks', async () => {
    h.rpc.mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useSigningActions(), { wrapper })
    let out: unknown
    await act(async () => { out = await result.current.markSigned('app1', true) })
    expect(out).toEqual({ ok: false, error: 'Couldn’t mark the signing. Please try again.' })
    expect(toasts()).toEqual([{ message: 'Couldn’t mark the signing. Please try again.', type: 'error' }])
    expect(h.report.mock.calls[0][0]).toBe('useSigning.mark_signed.exception')
    expect(h.track).not.toHaveBeenCalled()
    expect(result.current.busy).toBe(false)
  })

  it('busy is true while the server is answering (the double-tap guard)', async () => {
    let answer: (v: unknown) => void = () => {}
    h.rpc.mockReturnValue(new Promise((r) => { answer = r }))
    const { result } = renderHook(() => useSigningActions(), { wrapper })
    let pending: Promise<unknown> = Promise.resolve()
    act(() => { pending = result.current.confirmSigning('app1', true) })
    expect(result.current.busy).toBe(true)
    await act(async () => { answer({ data: {}, error: null }); await pending })
    expect(result.current.busy).toBe(false)
  })
})

describe('C · useSendInvite / useDeclineInvite', () => {
  const invite = { playerId: 'p1', playerName: 'Sam Player', opportunityId: 'role1', note: '  Hello  ' }

  it('success: trimmed note, a toast with the first name, one analytics event', async () => {
    h.rpc.mockResolvedValue({ data: { invite_id: 'inv1' }, error: null })
    const { result } = renderHook(() => useSendInvite(), { wrapper })
    let out: unknown
    await act(async () => { out = await result.current.send(invite) })
    expect(h.rpc).toHaveBeenCalledWith('send_invite', { p_player_id: 'p1', p_opportunity_id: 'role1', p_note: 'Hello' })
    expect(out).toBeNull()
    expect(toasts()).toEqual([{ message: 'Invite sent to Sam', type: 'success' }])
    expect(h.track).toHaveBeenCalledWith('invite_sent', 'opportunity', 'role1', { invite_id: 'inv1', player_id: 'p1' })
  })

  it('a blank note is sent as NULL, not as an empty string', async () => {
    h.rpc.mockResolvedValue({ data: {}, error: null })
    const { result } = renderHook(() => useSendInvite(), { wrapper })
    await act(async () => { await result.current.send({ ...invite, note: '   ' }) })
    expect(h.rpc.mock.calls[0][1]).toMatchObject({ p_note: null })
  })

  /** One refused send: what the sheet gets back, and whether it was reported as an incident. */
  async function refusedSend(message: string) {
    h.rpc.mockReset()
    h.report.mockReset()
    h.track.mockReset()
    useToastStore.setState({ toasts: [] })
    h.rpc.mockResolvedValue(refusal(message))
    const { result, unmount } = renderHook(() => useSendInvite(), { wrapper })
    let out: unknown
    await act(async () => { out = await result.current.send(invite) })
    const seen = { out, toasts: toasts(), tracked: h.track.mock.calls.length, reported: h.report.mock.calls.length, sending: result.current.sending }
    unmount()
    return seen
  }
  const sendInviteRules = () =>
    raisesOf(newestFunction('send_invite')).filter((r) => isRule(r.errcode)).map((r) => r.message.replace('(% per day)', '(20 per day)'))

  it('every send_invite rule comes back as the sheet’s reason: no success toast, no analytics event, button unlocked', async () => {
    for (const message of sendInviteRules()) {
      const seen = await refusedSend(message)
      expect(seen.out, message).toBe(inviteErrorMessage({ message }))
      expect(seen.out, message).not.toBe('Couldn’t send the invite. Please try again.')
      expect(seen.toasts, message).toEqual([])
      expect(seen.tracked, message).toBe(0)
      expect(seen.sending, message).toBe(false)
    }
  })

  // BUG (release audit 2026-10-05, LOW, hooks/useInvites.ts:151): the "is this a
  // rule?" test is a regex (/can.t be invited|already|limit|not open|500 characters/)
  // kept apart from the PASS_THROUGH list in lib/invites.ts. "This player passed
  // on this role" (founder ruling 2026-10-01, added by 20261001210000) matches
  // neither alternative, so every such ordinary refusal is sent to Sentry as an
  // error. The club still reads the right sentence. Fix: report only when
  // inviteErrorMessage returned the generic line.
  it.fails('BUG: no send_invite rule refusal is reported to Sentry as an incident', async () => {
    const reported: string[] = []
    for (const message of sendInviteRules()) {
      if ((await refusedSend(message)).reported > 0) reported.push(message)
    }
    expect(reported).toEqual([])
  })

  it('the rule refusals reported as incidents today are exactly this one (update when fixed)', async () => {
    const reported: string[] = []
    for (const message of sendInviteRules()) {
      if ((await refusedSend(message)).reported > 0) reported.push(message)
    }
    expect(reported).toEqual(['This player passed on this role'])
  })

  it('an unexpected error is reported and returns the neutral line', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'internal error' } })
    const { result } = renderHook(() => useSendInvite(), { wrapper })
    let out: unknown
    await act(async () => { out = await result.current.send(invite) })
    expect(out).toBe('Couldn’t send the invite. Please try again.')
    expect(h.report).toHaveBeenCalledTimes(1)
    expect(h.track).not.toHaveBeenCalled()
  })

  it('declining: sends decline with no note; an expired invite is explained and nothing is counted', async () => {
    h.rpc.mockResolvedValue({ data: {}, error: null })
    const ok = renderHook(() => useDeclineInvite(), { wrapper })
    let out: unknown
    await act(async () => { out = await ok.result.current.decline('inv1') })
    expect(h.rpc).toHaveBeenCalledWith('respond_invite', { p_invite_id: 'inv1', p_response: 'decline', p_note: null })
    expect(out).toBe(true)
    expect(h.track).toHaveBeenCalledWith('invite_declined', 'invite', 'inv1', {})
    ok.unmount()

    h.rpc.mockReset()
    h.track.mockReset()
    h.rpc.mockResolvedValue(refusal('This invite has expired'))
    const refused = renderHook(() => useDeclineInvite(), { wrapper })
    await act(async () => { out = await refused.result.current.decline('inv1') })
    expect(out).toBe(false)
    expect(toasts()).toEqual([{ message: 'This invitation has expired.', type: 'error' }])
    expect(h.track).not.toHaveBeenCalled()
    expect(refused.result.current.busy).toBe(false)
  })
})
