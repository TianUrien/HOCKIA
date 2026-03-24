/**
 * Tests for the 3-tier applicant classification system + delete draft feature.
 *
 * Covers:
 * - ApplicantCard: pill dropdown renders, tier selection calls onStatusChange, Clear resets
 * - ApplicantsList: grouping by tier, section headers with counts
 * - OpportunitiesTab: delete menu visible for drafts + closed, hidden for open
 * - DeleteOpportunityModal: draft vs non-draft messaging
 */
import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { resolve } from 'path'
import { readFileSync } from 'fs'
import ApplicantCard from '@/components/ApplicantCard'
import type { ApplicantReferenceInfo } from '@/components/ApplicantCard'
import type { OpportunityApplicationWithApplicant } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type ApplicationStatus = Database['public']['Enums']['application_status']

// --- Source paths for source-validation tests ---
const COMPONENTS_DIR = resolve(__dirname, '..', 'components')
const PAGES_DIR = resolve(__dirname, '..', 'pages')
const TAB_SOURCE = readFileSync(resolve(COMPONENTS_DIR, 'OpportunitiesTab.tsx'), 'utf-8')
const DELETE_MODAL_SOURCE = readFileSync(resolve(COMPONENTS_DIR, 'DeleteOpportunityModal.tsx'), 'utf-8')
const APPLICANTS_LIST_SOURCE = readFileSync(resolve(PAGES_DIR, 'ApplicantsList.tsx'), 'utf-8')

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

const baseApplication: OpportunityApplicationWithApplicant = {
  id: 'app-1',
  opportunity_id: 'opp-1',
  applicant_id: 'player-1',
  status: 'pending',
  applied_at: '2026-02-10T12:00:00Z',
  updated_at: '2026-02-10T12:00:00Z',
  metadata: {},
  applicant: {
    id: 'player-1',
    full_name: 'Jane Smith',
    avatar_url: null,
    position: 'midfielder',
    secondary_position: 'defender',
    base_location: 'London, UK',
    nationality: 'British',
    username: 'janesmith',
  },
}

const renderCard = (
  overrides?: Partial<OpportunityApplicationWithApplicant>,
  onStatusChange?: (id: string, status: ApplicationStatus) => void,
  isUpdating?: boolean,
  referenceInfo?: ApplicantReferenceInfo | null,
) => {
  const app = { ...baseApplication, ...overrides }
  return render(
    <MemoryRouter>
      <ApplicantCard
        application={app}
        onStatusChange={onStatusChange}
        isUpdating={isUpdating}
        referenceInfo={referenceInfo}
      />
    </MemoryRouter>,
  )
}

describe('ApplicantCard — tier pill dropdown', () => {
  it('shows "Unsorted" pill when status is pending', () => {
    renderCard({ status: 'pending' }, vi.fn())
    expect(screen.getByText('Unsorted')).toBeInTheDocument()
  })

  it('shows "Good fit" pill when status is shortlisted', () => {
    renderCard({ status: 'shortlisted' }, vi.fn())
    expect(screen.getByText('Good fit')).toBeInTheDocument()
  })

  it('shows "Maybe" pill when status is maybe', () => {
    renderCard({ status: 'maybe' }, vi.fn())
    expect(screen.getByText('Maybe')).toBeInTheDocument()
  })

  it('shows "Not a fit" pill when status is rejected', () => {
    renderCard({ status: 'rejected' }, vi.fn())
    expect(screen.getByText('Not a fit')).toBeInTheDocument()
  })

  it('does not render tier pill when onStatusChange is not provided', () => {
    renderCard({ status: 'pending' })
    expect(screen.queryByText('Unsorted')).not.toBeInTheDocument()
  })

  it('opens dropdown with all 3 options when pill is clicked', async () => {
    const user = userEvent.setup()
    renderCard({ status: 'pending' }, vi.fn())

    await user.click(screen.getByText('Unsorted'))

    // All tier labels visible in the dropdown
    expect(screen.getByRole('button', { name: /good fit/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /maybe/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /not a fit/i })).toBeInTheDocument()
  })

  it('calls onStatusChange with "shortlisted" when "Good fit" is selected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderCard({ status: 'pending' }, onChange)

    await user.click(screen.getByText('Unsorted'))
    await user.click(screen.getByRole('button', { name: /good fit/i }))

    expect(onChange).toHaveBeenCalledWith('app-1', 'shortlisted')
  })

  it('calls onStatusChange with "maybe" when "Maybe" is selected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderCard({ status: 'pending' }, onChange)

    await user.click(screen.getByText('Unsorted'))
    await user.click(screen.getByRole('button', { name: /maybe/i }))

    expect(onChange).toHaveBeenCalledWith('app-1', 'maybe')
  })

  it('calls onStatusChange with "rejected" when "Not a fit" is selected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderCard({ status: 'pending' }, onChange)

    await user.click(screen.getByText('Unsorted'))
    await user.click(screen.getByRole('button', { name: /not a fit/i }))

    expect(onChange).toHaveBeenCalledWith('app-1', 'rejected')
  })

  it('shows "Clear" option and resets to pending when tier is already set', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderCard({ status: 'shortlisted' }, onChange)

    await user.click(screen.getByText('Good fit'))

    const clearBtn = screen.getByRole('button', { name: /clear/i })
    expect(clearBtn).toBeInTheDocument()

    await user.click(clearBtn)
    expect(onChange).toHaveBeenCalledWith('app-1', 'pending')
  })

  it('does not show "Clear" option when status is pending', async () => {
    const user = userEvent.setup()
    renderCard({ status: 'pending' }, vi.fn())

    await user.click(screen.getByText('Unsorted'))
    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument()
  })

  it('renders applicant info correctly', () => {
    renderCard({ status: 'pending' }, vi.fn())
    expect(screen.getByText('Jane Smith')).toBeInTheDocument()
    expect(screen.getByText(/Midfielder/i)).toBeInTheDocument()
    expect(screen.getByText('London, UK')).toBeInTheDocument()
    expect(screen.getByText(/Applied Feb 10, 2026/)).toBeInTheDocument()
    expect(screen.getByText('View Profile')).toBeInTheDocument()
  })
})

describe('Opportunities source — delete draft menu', () => {
  it('delete menu item is available for draft AND closed statuses', () => {
    expect(TAB_SOURCE).toContain("vacancy.status === 'closed' || vacancy.status === 'draft'")
    expect(TAB_SOURCE).toContain("'Delete draft'")
    expect(TAB_SOURCE).toContain("'Delete permanently'")
  })

  it('DeleteOpportunityModal has isDraft prop with draft-specific messaging', () => {
    expect(DELETE_MODAL_SOURCE).toContain('isDraft')
    expect(DELETE_MODAL_SOURCE).toContain('Delete Draft')
    expect(DELETE_MODAL_SOURCE).toContain('Delete Opportunity Permanently')
    expect(DELETE_MODAL_SOURCE).toContain('has not been published and has no applicants')
  })
})

describe('ApplicantCard — reference trust signal', () => {
  it('shows reference count when referenceInfo is provided', () => {
    renderCard({ status: 'pending' }, vi.fn(), false, {
      count: 3,
      topEndorsement: null,
    })
    expect(screen.getByText('3 references')).toBeInTheDocument()
  })

  it('shows singular "reference" for count of 1', () => {
    renderCard({ status: 'pending' }, vi.fn(), false, {
      count: 1,
      topEndorsement: null,
    })
    expect(screen.getByText('1 reference')).toBeInTheDocument()
  })

  it('shows top endorsement text and endorser name when available', () => {
    renderCard({ status: 'pending' }, vi.fn(), false, {
      count: 2,
      topEndorsement: {
        text: 'Excellent midfielder with great vision',
        endorserName: 'Coach Williams',
        endorserRole: 'coach',
        relationshipType: 'Head Coach',
      },
    })
    expect(screen.getByText(/Excellent midfielder/)).toBeInTheDocument()
    expect(screen.getByText(/Coach Williams/)).toBeInTheDocument()
  })

  it('does not show reference section when count is 0', () => {
    renderCard({ status: 'pending' }, vi.fn(), false, {
      count: 0,
      topEndorsement: null,
    })
    expect(screen.queryByText(/reference/i)).not.toBeInTheDocument()
  })

  it('does not show reference section when referenceInfo is null', () => {
    renderCard({ status: 'pending' }, vi.fn(), false, null)
    expect(screen.queryByText(/reference/i)).not.toBeInTheDocument()
  })

  it('does not show reference section when referenceInfo is undefined', () => {
    renderCard({ status: 'pending' }, vi.fn(), false)
    expect(screen.queryByText(/reference/i)).not.toBeInTheDocument()
  })
})

describe('ApplicantsList source — tier grouping', () => {
  it('defines all 4 tier groups in correct order', () => {
    const unsortedIdx = APPLICANTS_LIST_SOURCE.indexOf("label: 'Unsorted'")
    const shortlistedIdx = APPLICANTS_LIST_SOURCE.indexOf("label: 'Good fit'")
    const maybeIdx = APPLICANTS_LIST_SOURCE.indexOf("label: 'Maybe'")
    const notAFitIdx = APPLICANTS_LIST_SOURCE.indexOf("label: 'Not a fit'")

    expect(unsortedIdx).toBeGreaterThan(-1)
    expect(shortlistedIdx).toBeGreaterThan(unsortedIdx)
    expect(maybeIdx).toBeGreaterThan(shortlistedIdx)
    expect(notAFitIdx).toBeGreaterThan(maybeIdx)
  })

  it('filters out empty groups', () => {
    expect(APPLICANTS_LIST_SOURCE).toContain('.filter((group) => group.applications.length > 0)')
  })

  it('uses optimistic status update with error rollback', () => {
    expect(APPLICANTS_LIST_SOURCE).toContain('Optimistic update')
    expect(APPLICANTS_LIST_SOURCE).toContain("update({ status: newStatus })")
    expect(APPLICANTS_LIST_SOURCE).toContain("Failed to update status")
  })
})
