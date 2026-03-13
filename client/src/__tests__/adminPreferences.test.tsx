import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

// Mock the preferences API
const mockGetPreferenceSummary = vi.fn()
const mockGetPreferenceUsers = vi.fn()

vi.mock('@/features/admin/api/preferencesApi', () => ({
  getPreferenceSummary: (...args: unknown[]) => mockGetPreferenceSummary(...args),
  getPreferenceUsers: (...args: unknown[]) => mockGetPreferenceUsers(...args),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { AdminPreferences } from '@/features/admin/pages/AdminPreferences'

const mockSummary = {
  total_users: 100,
  preferences: {
    notify_applications: { enabled: 90, disabled: 10, by_role: { player: { enabled: 40, disabled: 5 }, coach: { enabled: 20, disabled: 2 }, club: { enabled: 25, disabled: 3 }, brand: { enabled: 5, disabled: 0 } } },
    notify_friends: { enabled: 95, disabled: 5, by_role: { player: { enabled: 45, disabled: 2 }, coach: { enabled: 22, disabled: 1 }, club: { enabled: 23, disabled: 2 }, brand: { enabled: 5, disabled: 0 } } },
    notify_references: { enabled: 92, disabled: 8, by_role: { player: { enabled: 42, disabled: 3 }, coach: { enabled: 21, disabled: 2 }, club: { enabled: 24, disabled: 3 }, brand: { enabled: 5, disabled: 0 } } },
    notify_messages: { enabled: 88, disabled: 12, by_role: { player: { enabled: 38, disabled: 7 }, coach: { enabled: 20, disabled: 2 }, club: { enabled: 25, disabled: 3 }, brand: { enabled: 5, disabled: 0 } } },
    notify_opportunities: { enabled: 85, disabled: 15, by_role: { player: { enabled: 35, disabled: 10 }, coach: { enabled: 20, disabled: 2 }, club: { enabled: 25, disabled: 3 }, brand: { enabled: 5, disabled: 0 } } },
    notify_push: { enabled: 30, disabled: 70, by_role: { player: { enabled: 15, disabled: 30 }, coach: { enabled: 5, disabled: 17 }, club: { enabled: 8, disabled: 20 }, brand: { enabled: 2, disabled: 3 } } },
    notify_profile_views: { enabled: 93, disabled: 7, by_role: { player: { enabled: 43, disabled: 2 }, coach: { enabled: 22, disabled: 1 }, club: { enabled: 23, disabled: 4 }, brand: { enabled: 5, disabled: 0 } } },
    browse_anonymously: { enabled: 8, disabled: 92, by_role: { player: { enabled: 5, disabled: 40 }, coach: { enabled: 2, disabled: 20 }, club: { enabled: 1, disabled: 27 }, brand: { enabled: 0, disabled: 5 } } },
  },
  generated_at: '2026-03-13T00:00:00Z',
}

const mockUsers = {
  users: [
    { id: 'u1', email: 'player1@test.com', full_name: 'Player One', role: 'player', avatar_url: null, created_at: '2026-01-01', total_count: 2 },
    { id: 'u2', email: 'coach1@test.com', full_name: 'Coach One', role: 'coach', avatar_url: null, created_at: '2026-02-01', total_count: 2 },
  ],
  totalCount: 2,
}

describe('AdminPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPreferenceSummary.mockResolvedValue(mockSummary)
    mockGetPreferenceUsers.mockResolvedValue(mockUsers)
  })

  it('renders the page title and user count', async () => {
    render(<AdminPreferences />)

    await waitFor(() => {
      expect(screen.getByText('User Preferences')).toBeInTheDocument()
    })

    expect(screen.getByText(/100/)).toBeInTheDocument()
  })

  it('shows all notification preference rows', async () => {
    render(<AdminPreferences />)

    await waitFor(() => {
      expect(screen.getByText('Application Notifications')).toBeInTheDocument()
    })

    expect(screen.getByText('Friend Request Emails')).toBeInTheDocument()
    expect(screen.getByText('Reference Request Emails')).toBeInTheDocument()
    expect(screen.getByText('Message Email Digests')).toBeInTheDocument()
    expect(screen.getByText('Opportunity Notifications')).toBeInTheDocument()
    expect(screen.getByText('Push Notifications')).toBeInTheDocument()
    expect(screen.getByText('Profile View Emails')).toBeInTheDocument()
  })

  it('shows anonymous browsing in privacy section', async () => {
    render(<AdminPreferences />)

    await waitFor(() => {
      expect(screen.getByText('Anonymous Browsing')).toBeInTheDocument()
    })

    expect(screen.getByText('Privacy Settings')).toBeInTheDocument()
  })

  it('displays enabled and disabled counts', async () => {
    render(<AdminPreferences />)

    await waitFor(() => {
      // Application Notifications: 90 enabled, 10 disabled
      expect(screen.getByText('90')).toBeInTheDocument()
    })
  })

  it('expands a row to show role breakdown on click', async () => {
    const user = userEvent.setup()
    render(<AdminPreferences />)

    await waitFor(() => {
      expect(screen.getByText('Application Notifications')).toBeInTheDocument()
    })

    // Click to expand
    await user.click(screen.getByText('Application Notifications'))

    await waitFor(() => {
      expect(screen.getByText('Breakdown by role')).toBeInTheDocument()
    })
  })

  it('loads user drill-down when a row is expanded', async () => {
    const user = userEvent.setup()
    render(<AdminPreferences />)

    await waitFor(() => {
      expect(screen.getByText('Application Notifications')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Application Notifications'))

    await waitFor(() => {
      expect(mockGetPreferenceUsers).toHaveBeenCalledWith(
        expect.objectContaining({
          preference: 'notify_applications',
          enabled: false, // defaults to "Disabled" tab
        })
      )
    })
  })

  it('shows user list in drill-down', async () => {
    const user = userEvent.setup()
    render(<AdminPreferences />)

    await waitFor(() => {
      expect(screen.getByText('Application Notifications')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Application Notifications'))

    await waitFor(() => {
      expect(screen.getByText('Player One')).toBeInTheDocument()
      expect(screen.getByText('Coach One')).toBeInTheDocument()
    })
  })

  it('shows loading state initially', () => {
    mockGetPreferenceSummary.mockReturnValue(new Promise(() => {})) // never resolves
    render(<AdminPreferences />)

    expect(screen.getByText('User Preferences')).toBeInTheDocument()
  })

  it('handles API error gracefully', async () => {
    mockGetPreferenceSummary.mockRejectedValue(new Error('Network error'))
    render(<AdminPreferences />)

    await waitFor(() => {
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument()
    })
  })
})
