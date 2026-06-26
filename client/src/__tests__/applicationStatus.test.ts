import { describe, it, expect } from 'vitest'
import {
  playerApplicationStatusBadge,
  applicationReasonPlayerCopy,
  applicationStatusFallbackMessage,
  applicationReasonLabel,
  APPLICATION_STATUS_REASONS,
} from '@/lib/applicationStatus'

// Words that would make status copy feel blaming/harsh — the whole feature exists
// to avoid these. Guards every player-facing string the helpers can produce.
const HARSH = ['not good enough', 'failure', 'unqualified', 'incompetent', 'loser', 'worthless', 'rejected', 'bad ', 'reject you']
const assertKind = (s: string | null) => {
  if (s === null) return
  const lower = s.toLowerCase()
  for (const w of HARSH) expect(lower, `"${s}" should not contain "${w}"`).not.toContain(w)
}

describe('playerApplicationStatusBadge', () => {
  it('maps responded statuses to human, non-enum labels', () => {
    expect(playerApplicationStatusBadge('shortlisted')?.label).toBe('Shortlisted')
    expect(playerApplicationStatusBadge('maybe')?.label).toBe('Under consideration')
    expect(playerApplicationStatusBadge('rejected')?.label).toBe('Not selected')
  })
  it('returns null for pending/unknown (no badge, never the raw enum)', () => {
    expect(playerApplicationStatusBadge('pending')).toBeNull()
    expect(playerApplicationStatusBadge(null)).toBeNull()
    expect(playerApplicationStatusBadge('maybe')?.label).not.toContain('maybe')
  })
})

describe('applicationReasonPlayerCopy', () => {
  it('gives kind, non-null copy for every actionable reason code', () => {
    for (const { code } of APPLICATION_STATUS_REASONS) {
      const copy = applicationReasonPlayerCopy(code)
      // 'other' intentionally has no specific copy
      if (code !== 'other') {
        expect(copy, `reason ${code}`).toBeTruthy()
        assertKind(copy)
      }
    }
  })
  it('returns null for other/null/unknown', () => {
    expect(applicationReasonPlayerCopy('other')).toBeNull()
    expect(applicationReasonPlayerCopy(null)).toBeNull()
    expect(applicationReasonPlayerCopy('nope')).toBeNull()
  })
})

describe('applicationStatusFallbackMessage (client last-resort when edge fn is down)', () => {
  it('ALWAYS returns a kind message for responded statuses, even without a reason', () => {
    for (const status of ['shortlisted', 'maybe', 'rejected']) {
      const msg = applicationStatusFallbackMessage(status, null)
      expect(msg, `status ${status} no-reason`).toBeTruthy()
      assertKind(msg)
    }
  })
  it('weaves the reason copy in when present', () => {
    const msg = applicationStatusFallbackMessage('rejected', 'position_filled')
    expect(msg).toContain('covered')
    assertKind(msg)
  })
  it('returns null for pending/unknown (no message node)', () => {
    expect(applicationStatusFallbackMessage('pending', null)).toBeNull()
    expect(applicationStatusFallbackMessage(null, null)).toBeNull()
  })
})

describe('reason taxonomy', () => {
  it('exposes the shared codes + club-facing labels', () => {
    const codes = APPLICATION_STATUS_REASONS.map((r) => r.code)
    expect(codes).toContain('position_filled')
    expect(codes).toContain('video_missing')
    expect(applicationReasonLabel('position_filled')).toBe('Position already filled')
    expect(applicationReasonLabel('nope')).toBeNull()
  })
})
