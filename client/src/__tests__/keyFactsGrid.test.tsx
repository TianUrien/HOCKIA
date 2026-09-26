/**
 * Key facts tiles (Figma D2.1 / D2.2): owner Add links fire the matching
 * action; an expiring / expired permit line is drawn amber; viewers get no
 * links; the amber row copy names the permit.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { KeyFactsGrid, PermitAttentionRow } from '@/components/profile/KeyFactsGrid'
import { buildCoachKeyFacts, buildPlayerKeyFacts } from '@/lib/keyFacts'

const today = new Date(Date.UTC(2026, 8, 26))
const input = {
  position: 'Midfielder', secondaryPosition: 'Defender', currentClubName: 'Old Lions Rugby Club', league: null,
  availableFrom: null, availabilityDuration: 'full_season', passports: [{ name: 'Argentina', flag: '🇦🇷', isEu: false }],
  permits: [{ countryName: 'United Kingdom', flag: null, type: 'visa', validFrom: null, expiresOn: '2026-10-10' }],
  fullMatchCount: 1, highlightCount: 4, age: 25,
}

describe('KeyFactsGrid', () => {
  it('owner: six tiles, Add links call onAction, expiring permit is amber', () => {
    const onAction = vi.fn()
    render(<KeyFactsGrid facts={buildPlayerKeyFacts(input, { viewer: 'owner', today })} onAction={onAction} />)
    expect(screen.getAllByTestId(/^key-fact-/)).toHaveLength(6)
    fireEvent.click(screen.getByText('Add league'))
    fireEvent.click(screen.getByText('Add date'))
    fireEvent.click(screen.getByText('Add another'))
    expect(onAction.mock.calls.map((c) => c[0])).toEqual(['add_league', 'add_date', 'add_passport'])
    expect(screen.getByText(/United Kingdom · Visa/).className).toContain('text-amber-600')
  })

  it('viewer: "not given" copy, no links', () => {
    render(<KeyFactsGrid facts={buildPlayerKeyFacts(input, { viewer: 'public', today })} />)
    expect(screen.getByText('League not given')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(/United Kingdom/)).toBeNull()
  })
})

describe('PermitAttentionRow', () => {
  it('says when it expires / expired', () => {
    const { rerender } = render(<PermitAttentionRow permit={{ id: '1', type: 'visa', expires_on: '2026-10-16', status: 'expiring_soon', countryName: 'United Kingdom', flag: null }} />)
    expect(screen.getByTestId('permit-attention').textContent).toContain('Your United Kingdom visa expires on 16 Oct 2026')
    rerender(<PermitAttentionRow permit={{ id: '1', type: 'work_permit', expires_on: '2026-08-01', status: 'expired', countryName: 'Netherlands', flag: null }} />)
    expect(screen.getByTestId('permit-attention').textContent).toContain('Your Netherlands work permit expired on 1 Aug 2026')
  })
})

describe('KeyFactsGrid · coach', () => {
  const coach = { specialization: 'head_coach', categories: ['adult_women'], currentClubName: 'Old Lions', openToCoach: true, availableFrom: null, passports: [], age: 41 }
  it('Current role shows the role with the club under it', () => {
    render(<KeyFactsGrid facts={buildCoachKeyFacts({ ...coach, currentRole: 'Head coach, U21 women' }, { viewer: 'public', today })} />)
    const tile = screen.getByTestId('key-fact-current_role')
    expect(tile.textContent).toContain('Head coach, U21 women')
    expect(tile.textContent).toContain('Old Lions')
  })
  it('no role → the club; nothing → "Not set" with Add for the owner', () => {
    const { unmount } = render(<KeyFactsGrid facts={buildCoachKeyFacts({ ...coach, currentRole: null }, { viewer: 'public', today })} />)
    expect(screen.getByTestId('key-fact-current_role').textContent).toContain('Old Lions')
    unmount()
    render(<KeyFactsGrid facts={buildCoachKeyFacts({ ...coach, currentRole: null, currentClubName: null }, { viewer: 'owner', today })} onAction={vi.fn()} />)
    expect(screen.getByTestId('key-fact-current_role').textContent).toContain('Not set')
    expect(screen.getByText('Add current role')).toBeTruthy()
  })
})
