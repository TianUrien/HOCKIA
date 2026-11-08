import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/lib/supabase', () => ({ supabase: {}, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' }))
let viewerRole = 'coach'
vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: { role: viewerRole } }),
}))

import { RoleAiEntry } from '@/components/hockiaAi/RoleAiEntry'
import { useHockiaAiSheet } from '@/components/hockiaAi/hockiaAiSheetStore'
import type { Vacancy } from '@/lib/supabase'

const vacancy = (type: 'player' | 'coach') => ({ id: 'v1', title: 'Midfielder', position: 'midfielder', location_city: 'Madrid', opportunity_type: type } as unknown as Vacancy)

describe('Ask Hockia AI about this opportunity · role match (Sentry JAVASCRIPT-REACT-EC)', () => {
  beforeEach(() => { useHockiaAiSheet.setState({ open: false, roleContext: null }) })

  it('a coach on a player opportunity is not offered "Prepare my application"', () => {
    viewerRole = 'coach'
    render(<RoleAiEntry vacancy={vacancy('player')} clubName="Club" clubLogo={null} />)
    expect(screen.getByTestId('role-ask-ai').textContent).not.toContain('Prepare my application')
    fireEvent.click(screen.getByTestId('role-ask-ai'))
    expect(useHockiaAiSheet.getState().roleContext?.opportunityType).toBe('player')
  })

  it('a player on a player opportunity still is', () => {
    viewerRole = 'player'
    render(<RoleAiEntry vacancy={vacancy('player')} clubName="Club" clubLogo={null} />)
    expect(screen.getByTestId('role-ask-ai').textContent).toContain('Prepare my application')
  })
})
