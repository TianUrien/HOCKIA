import { describe, expect, it } from 'vitest'
import {
  applicantChipFor,
  canWithdraw,
  clubRoadTag,
  offerCardState,
  playerRoadHint,
  playerRoadSteps,
  roadMainAction,
  roadMenu,
  roadSteps,
  roadWaitingLine,
  signingErrorMessage,
  withdrawBody,
} from '@/lib/signing'
import { applicationStatusLabel, playerApplicationStatusBadge } from '@/lib/applicationStatus'
import { METRIC_INFO } from '@/features/admin/lib/metricInfo'

const NOW = new Date('2026-10-02T12:00:00Z')

describe('D4 club road: next action per status', () => {
  it('main button is always the next step', () => {
    expect(roadMainAction('shortlisted')).toBe('make_offer')
    expect(roadMainAction('offered')).toBe('edit_offer')
    expect(roadMainAction('accepted')).toBe('mark_signed')
    expect(roadMainAction('signed_pending_confirmation')).toBeNull()
    expect(roadMainAction('signed')).toBeNull()
    expect(roadMainAction('withdrawn')).toBeNull()
  })

  it('"…" menu offers only what the server allows', () => {
    expect(roadMenu('shortlisted')).toEqual(['mark_signed', 'decline'])
    expect(roadMenu('offered')).toEqual(['withdraw_offer'])
    expect(roadMenu('signed_pending_confirmation')).toEqual(['undo_signing'])
    expect(roadMenu('signed')).toEqual([])
    expect(roadMenu('withdrawn')).toEqual([])
  })

  it('waiting and done states are lines, not buttons', () => {
    expect(roadWaitingLine('signed_pending_confirmation', 'Sam')).toBe('Waiting for Sam to confirm')
    expect(roadWaitingLine('signed', 'Sam')).toBe('Signed through Hockia')
    expect(roadWaitingLine('offered', 'Sam')).toBeNull()
  })

  it('the next step is marked current; trial is optional and never current', () => {
    const steps = roadSteps({ status: 'shortlisted', talked: false, trial: false, firstName: 'Sam', now: NOW })
    expect(steps.find((s) => s.current)?.key).toBe('talked')
    const afterTalk = roadSteps({ status: 'shortlisted', talked: true, trial: false, firstName: 'Sam', now: NOW })
    expect(afterTalk.find((s) => s.current)?.key).toBe('offer')
    const signed = roadSteps({ status: 'signed', talked: true, trial: false, firstName: 'Sam', now: NOW })
    expect(signed.every((s) => s.key === 'trial' || s.done)).toBe(true)
  })

  it('club rows: road applicants stay under Shortlisted with a grey tag', () => {
    expect(applicantChipFor('offered')).toBe('shortlisted')
    expect(applicantChipFor('offer_declined')).toBe('shortlisted')
    // Re-check 2026-10-02: a withdrawn application sits under Closed (read-only).
    expect(applicantChipFor('withdrawn')).toBe('no_response')
    expect(clubRoadTag('offered')).toBe('Offer sent')
    expect(clubRoadTag('signed_pending_confirmation')).toBe('Waiting to confirm')
    expect(clubRoadTag('pending')).toBeNull()
  })
})

describe('D4 offer card: colour depends on the viewer', () => {
  it('player answering a live offer: actionable, amber only in the last 5 days', () => {
    const far = offerCardState({ viewer: 'player', status: 'live', openUntil: '2026-10-20', now: NOW })
    expect(far.actionable).toBe(true)
    expect(far.deadlineTone).toBe('grey')
    const close = offerCardState({ viewer: 'player', status: 'live', openUntil: '2026-10-05', now: NOW })
    expect(close.deadlineTone).toBe('amber')
  })

  it('club waiting on the answer: never amber, never actionable', () => {
    const club = offerCardState({ viewer: 'club', status: 'live', openUntil: '2026-10-05', playerFirstName: 'Sam', now: NOW })
    expect(club.actionable).toBe(false)
    expect(club.deadlineTone).toBe('grey')
    expect(club.line).toBe('Waiting for Sam’s answer')
  })

  it('a live offer past its date reads as expired and greys out', () => {
    const s = offerCardState({ viewer: 'player', status: 'live', openUntil: '2026-09-30', now: NOW })
    expect(s.muted).toBe(true)
    expect(s.actionable).toBe(false)
    expect(s.line).toBe('This offer has expired')
  })

  it('answered or closed offers are grey lines', () => {
    expect(offerCardState({ viewer: 'player', status: 'declined', openUntil: null, now: NOW }).line).toBe('You declined this offer')
    expect(offerCardState({ viewer: 'club', status: 'withdrawn', openUntil: null, now: NOW }).line).toBe('You withdrew this offer')
    expect(offerCardState({ viewer: 'player', status: 'withdrawn', openUntil: null, now: NOW }).line).toBe('The club withdrew this offer')
  })
})

describe('D4 player: own status, withdraw', () => {
  it('player sees Shortlisted → Offer → Signed for road statuses only', () => {
    expect(playerRoadSteps('pending')).toBeNull()
    expect(playerRoadSteps('offered')?.map((s) => s.done)).toEqual([true, false, false])
    expect(playerRoadSteps('offered')?.[1].current).toBe(true)
    expect(playerRoadSteps('accepted')?.map((s) => s.done)).toEqual([true, true, false])
    expect(playerRoadSteps('signed')?.every((s) => s.done)).toBe(true)
    expect(playerRoadHint('signed_pending_confirmation')).toMatch(/Confirm it/)
  })

  it('withdraw is allowed until the signing is confirmed', () => {
    for (const s of ['pending', 'shortlisted', 'maybe', 'offered', 'accepted', 'signed_pending_confirmation']) {
      expect(canWithdraw(s)).toBe(true)
    }
    for (const s of ['signed', 'withdrawn', 'rejected', 'filled', null, undefined]) {
      expect(canWithdraw(s)).toBe(false)
    }
  })

  it('withdraw confirm says it is final and what happens to an offer', () => {
    expect(withdrawBody('pending')).toMatch(/can’t be undone/)
    expect(withdrawBody('offered')).toMatch(/offer waiting for you is cancelled/)
    expect(withdrawBody('accepted')).toMatch(/signing won’t go ahead/)
  })

  it('status labels: players never read "Declined"; signing steps are labelled', () => {
    expect(applicationStatusLabel('offered')).toBe('Offer')
    expect(applicationStatusLabel('signed')).toBe('Signed')
    expect(playerApplicationStatusBadge('rejected')?.label ?? '').not.toMatch(/declined/i)
  })
})

describe('D4 server errors', () => {
  it('passes known server reasons through, falls back otherwise', () => {
    expect(signingErrorMessage({ message: 'This offer has expired' }, 'x')).toBe('This offer has expired.')
    expect(signingErrorMessage({ message: "A confirmed signing can't be withdrawn" }, 'x')).toBe('A confirmed signing can’t be withdrawn.')
    expect(signingErrorMessage({ message: 'permission denied for table x' }, 'Something went wrong')).toBe('Something went wrong')
  })
})

describe('D4 north star in admin', () => {
  it('has an explainer for Signings via HOCKIA', () => {
    expect(METRIC_INFO.signings.title).toBe('Signings via HOCKIA')
    expect(METRIC_INFO.signings.formula).toMatch(/signed/)
  })
})
