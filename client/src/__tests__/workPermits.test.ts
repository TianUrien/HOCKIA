/**
 * Visas & work permits helpers — must match public.work_permit_status()
 * (supabase/migrations/20260928200000_d2_player_work_permits.sql), which the
 * staging probe checks with the same five cases.
 */
import { describe, expect, it } from 'vitest'
import {
  isWorkPermitValid,
  needsPermitAttention,
  sortWorkPermits,
  validateWorkPermitDraft,
  workPermitStatus,
  workPermitTypeLabel,
} from '@/lib/workPermits'

const TODAY = new Date('2026-09-26T23:30:00Z')

describe('workPermitStatus (mirrors the SQL function)', () => {
  it('matches the probe cases: 60d, 30d, today, yesterday, future start', () => {
    expect(workPermitStatus(null, '2026-11-25', TODAY)).toBe('valid')
    expect(workPermitStatus(null, '2026-10-26', TODAY)).toBe('expiring_soon')
    expect(workPermitStatus(null, '2026-09-26', TODAY)).toBe('expiring_soon')
    expect(workPermitStatus(null, '2026-09-25', TODAY)).toBe('expired')
    expect(workPermitStatus('2026-10-01', '2026-12-25', TODAY)).toBe('not_yet_valid')
  })

  it('31 days out is still plainly valid', () => {
    expect(workPermitStatus(null, '2026-10-27', TODAY)).toBe('valid')
  })

  it('uses the UTC calendar day, not local time', () => {
    // 23:30 UTC on the 26th is still the 26th for the server.
    expect(workPermitStatus(null, '2026-09-26', TODAY)).toBe('expiring_soon')
  })

  it('a missing or junk expiry is treated as expired', () => {
    expect(workPermitStatus(null, null, TODAY)).toBe('expired')
    expect(workPermitStatus(null, 'soon', TODAY)).toBe('expired')
  })

  it('a start date today or earlier does not block validity', () => {
    expect(workPermitStatus('2026-09-26', '2027-09-26', TODAY)).toBe('valid')
    expect(workPermitStatus('2025-01-01', '2027-09-26', TODAY)).toBe('valid')
  })
})

describe('validity and attention', () => {
  it('expiring soon still counts as valid', () => {
    expect(isWorkPermitValid(null, '2026-10-01', TODAY)).toBe(true)
    expect(isWorkPermitValid(null, '2026-09-01', TODAY)).toBe(false)
    expect(isWorkPermitValid('2027-01-01', '2027-06-01', TODAY)).toBe(false)
  })

  it('amber row only for expiring soon or expired', () => {
    expect(needsPermitAttention('expiring_soon')).toBe(true)
    expect(needsPermitAttention('expired')).toBe(true)
    expect(needsPermitAttention('valid')).toBe(false)
    expect(needsPermitAttention('not_yet_valid')).toBe(false)
  })
})

describe('validateWorkPermitDraft', () => {
  const ok = { country_id: 5, type: 'visa', valid_from: null, expires_on: '2027-01-01' }

  it('accepts a complete draft', () => {
    expect(validateWorkPermitDraft(ok)).toBeNull()
  })

  it('flags each missing / invalid field', () => {
    expect(validateWorkPermitDraft({ ...ok, country_id: null })).toBe('country_required')
    expect(validateWorkPermitDraft({ ...ok, type: 'passport' })).toBe('type_invalid')
    expect(validateWorkPermitDraft({ ...ok, expires_on: null })).toBe('expiry_required')
    expect(validateWorkPermitDraft({ ...ok, valid_from: '2027-02-01' })).toBe('dates_out_of_order')
  })
})

describe('sortWorkPermits and labels', () => {
  it('valid first (soonest expiry first), then not yet valid, then expired', () => {
    const rows = [
      { id: 'expired', valid_from: null, expires_on: '2026-01-01' },
      { id: 'later', valid_from: null, expires_on: '2028-01-01' },
      { id: 'future', valid_from: '2027-01-01', expires_on: '2027-06-01' },
      { id: 'soon', valid_from: null, expires_on: '2026-10-01' },
    ]
    expect(sortWorkPermits(rows, TODAY).map((r) => r.id)).toEqual(['soon', 'later', 'future', 'expired'])
  })

  it('type labels with a safe fallback', () => {
    expect(workPermitTypeLabel('work_permit')).toBe('Work permit')
    expect(workPermitTypeLabel('residency')).toBe('Residency')
    expect(workPermitTypeLabel('???')).toBe('Permit')
    expect(workPermitTypeLabel(null)).toBe('Permit')
  })
})
