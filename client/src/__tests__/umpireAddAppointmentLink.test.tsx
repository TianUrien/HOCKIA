/**
 * Hockia AI's "Add my latest appointment" lands on the umpire's officiating
 * tab with ?add=appointment: the editor opens once on the owner's own record
 * and the param is dropped. Visitors never get the editor.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

vi.mock('@/hooks/useUmpireAppointments', () => ({
  useUmpireAppointments: () => ({ appointments: [], loading: false, error: null, create: vi.fn(), update: vi.fn(), remove: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/components/UmpireAppointmentEditor', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="appointment-editor" /> : null),
}))
vi.mock('@/lib/storage', () => ({ deleteStorageObject: vi.fn() }))

import UmpireAppointmentsSection from '@/components/UmpireAppointmentsSection'

function Search() { return <div data-testid="search">{useLocation().search}</div> }

const renderAt = (url: string, props: { isOwnProfile: boolean; readOnly?: boolean }) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/dashboard/profile" element={<><UmpireAppointmentsSection userId="m1" {...props} /><Search /></>} />
      </Routes>
    </MemoryRouter>,
  )

describe('umpire ?add=appointment', () => {
  it('opens the editor on the own record and drops the param', () => {
    renderAt('/dashboard/profile?tab=officiating&add=appointment', { isOwnProfile: true })
    expect(screen.getByTestId('appointment-editor')).toBeInTheDocument()
    expect(screen.getByTestId('search').textContent).toBe('?tab=officiating')
  })

  it('does nothing for a visitor', () => {
    renderAt('/dashboard/profile?tab=officiating&add=appointment', { isOwnProfile: false, readOnly: true })
    expect(screen.queryByTestId('appointment-editor')).toBeNull()
  })
})
