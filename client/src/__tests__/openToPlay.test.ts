/**
 * Open to play wrapper — maps public.set_open_to_play() outcomes and never
 * throws. The server rules (18+ by DOB to turn it on; off always allowed;
 * availability_confirmed_at stamped) are covered by the staging probe
 * supabase/tests/security/trackB_d2.probe.sql (cases 4, 5a–5d).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc },
}))

import {
  canToggleOpenToPlay,
  parseSetOpenToPlayResponse,
  setOpenToPlay,
} from '@/lib/openToPlay'

beforeEach(() => {
  rpc.mockReset()
})

describe('parseSetOpenToPlayResponse', () => {
  it('saved → ok with the server timestamp', () => {
    expect(parseSetOpenToPlayResponse({ outcome: 'saved', availability_confirmed_at: '2026-09-26T12:00:00Z' })).toEqual({
      ok: true,
      outcome: 'saved',
      confirmedAt: '2026-09-26T12:00:00Z',
    })
  })

  it.each(['under_18', 'dob_required', 'not_a_player', 'invalid_duration', 'invalid_date', 'unauthenticated'])(
    '%s → not ok, outcome passed through',
    (outcome) => {
      const r = parseSetOpenToPlayResponse({ outcome })
      expect(r.ok).toBe(false)
      expect(r.outcome).toBe(outcome)
      expect(r.confirmedAt).toBeNull()
    },
  )

  it('unknown or malformed replies → error', () => {
    expect(parseSetOpenToPlayResponse({ outcome: 'weird' }).outcome).toBe('error')
    expect(parseSetOpenToPlayResponse(null).outcome).toBe('error')
    expect(parseSetOpenToPlayResponse([]).outcome).toBe('error')
  })
})

describe('setOpenToPlay', () => {
  it('sends all three fields in one call, explicit nulls clear them', async () => {
    rpc.mockResolvedValueOnce({ data: { outcome: 'saved', availability_confirmed_at: 'ts' }, error: null })
    const r = await setOpenToPlay({ open: true })
    expect(rpc).toHaveBeenCalledWith('set_open_to_play', { p_open: true, p_available_from: null, p_duration: null })
    expect(r).toEqual({ ok: true, outcome: 'saved', confirmedAt: 'ts' })
  })

  it('passes the date and length through', async () => {
    rpc.mockResolvedValueOnce({ data: { outcome: 'saved' }, error: null })
    await setOpenToPlay({ open: true, availableFrom: '2027-01-12', duration: 'half_season' })
    expect(rpc).toHaveBeenCalledWith('set_open_to_play', {
      p_open: true,
      p_available_from: '2027-01-12',
      p_duration: 'half_season',
    })
  })

  it('refuses an unknown length without calling the server', async () => {
    const r = await setOpenToPlay({ open: true, duration: 'forever' as never })
    expect(r.outcome).toBe('invalid_duration')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('surfaces the under-18 refusal', async () => {
    rpc.mockResolvedValueOnce({ data: { outcome: 'under_18' }, error: null })
    const r = await setOpenToPlay({ open: true })
    expect(r.ok).toBe(false)
    expect(r.outcome).toBe('under_18')
  })

  it('a transport error resolves to outcome error (never throws)', async () => {
    const err = new Error('network')
    rpc.mockResolvedValueOnce({ data: null, error: err })
    const r = await setOpenToPlay({ open: false })
    expect(r).toMatchObject({ ok: false, outcome: 'error', error: err })
  })
})

describe('canToggleOpenToPlay', () => {
  it('true only when the server says true', async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null })
    expect(await canToggleOpenToPlay('u1')).toBe(true)
    expect(rpc).toHaveBeenCalledWith('can_toggle_open_to_play', { p_uid: 'u1' })

    rpc.mockResolvedValueOnce({ data: false, error: null })
    expect(await canToggleOpenToPlay('u1')).toBe(false)

    rpc.mockResolvedValueOnce({ data: null, error: new Error('x') })
    expect(await canToggleOpenToPlay('u1')).toBe(false)
  })
})
