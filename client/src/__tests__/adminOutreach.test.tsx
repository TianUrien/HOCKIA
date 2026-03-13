import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

// Mock the outreach API
const mockAddOutreachContact = vi.fn()

vi.mock('@/features/admin/api/outreachApi', () => ({
  addOutreachContact: (...args: unknown[]) => mockAddOutreachContact(...args),
  getOutreachContacts: vi.fn(),
  getOutreachStats: vi.fn(),
  bulkImportOutreachContacts: vi.fn(),
  previewOutreachAudience: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { AddContactModal } from '@/features/admin/components/AddContactModal'

describe('AddContactModal', () => {
  const onClose = vi.fn()
  const onAdded = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockAddOutreachContact.mockResolvedValue({ id: 'new-id' })
  })

  const getEmailInput = () => screen.getByPlaceholderText('contact@club.com')
  const getClubInput = () => screen.getByPlaceholderText('Club name')
  const getNameInput = () => screen.getByPlaceholderText('Contact person')
  const getCountryInput = () => screen.getByPlaceholderText('e.g. Argentina')
  const getInstagramInput = () => screen.getByPlaceholderText('@handle')
  const getNotesInput = () => screen.getByPlaceholderText(/any context/i)
  const getSubmitButton = () => {
    const buttons = screen.getAllByRole('button')
    return buttons.find((btn) => btn.textContent?.trim() === 'Add Contact' && !btn.closest('div.flex.items-center.gap-2'))!
  }

  it('renders all form fields', () => {
    render(<AddContactModal onClose={onClose} onAdded={onAdded} />)

    expect(getEmailInput()).toBeInTheDocument()
    expect(getClubInput()).toBeInTheDocument()
    expect(getNameInput()).toBeInTheDocument()
    expect(getCountryInput()).toBeInTheDocument()
    expect(getInstagramInput()).toBeInTheDocument()
    expect(getNotesInput()).toBeInTheDocument()
  })

  it('disables submit when required fields are empty', () => {
    render(<AddContactModal onClose={onClose} onAdded={onAdded} />)

    // Find the footer Add Contact button (not the header)
    const buttons = screen.getAllByRole('button')
    const addBtn = buttons.find((btn) => {
      const text = btn.textContent?.trim()
      return text === 'Add Contact' && btn.hasAttribute('disabled')
    })
    expect(addBtn).toBeTruthy()
  })

  it('enables submit when email and club are filled', async () => {
    const user = userEvent.setup()
    render(<AddContactModal onClose={onClose} onAdded={onAdded} />)

    await user.type(getEmailInput(), 'test@club.com')
    await user.type(getClubInput(), 'Test Club')

    const buttons = screen.getAllByRole('button')
    const addBtn = buttons.find((btn) => btn.textContent?.includes('Add Contact') && !btn.hasAttribute('disabled'))
    expect(addBtn).toBeTruthy()
  })

  it('calls addOutreachContact with correct params on submit', async () => {
    const user = userEvent.setup()
    render(<AddContactModal onClose={onClose} onAdded={onAdded} />)

    await user.type(getEmailInput(), 'john@example.com')
    await user.type(getClubInput(), 'Hockey Club')
    await user.type(getNameInput(), 'John Doe')
    await user.type(getCountryInput(), 'Argentina')
    await user.type(getInstagramInput(), '@hockeyclub')
    await user.type(getNotesInput(), 'Met at tournament')

    await user.click(getSubmitButton())

    await waitFor(() => {
      expect(mockAddOutreachContact).toHaveBeenCalledWith({
        email: 'john@example.com',
        club_name: 'Hockey Club',
        contact_name: 'John Doe',
        country: 'Argentina',
        role_at_club: undefined,
        instagram: 'hockeyclub',
        notes: 'Met at tournament',
      })
    })
  })

  it('strips @ from instagram handle', async () => {
    const user = userEvent.setup()
    render(<AddContactModal onClose={onClose} onAdded={onAdded} />)

    await user.type(getEmailInput(), 'test@club.com')
    await user.type(getClubInput(), 'Test Club')
    await user.type(getInstagramInput(), '@myhandle')
    await user.click(getSubmitButton())

    await waitFor(() => {
      expect(mockAddOutreachContact).toHaveBeenCalledWith(
        expect.objectContaining({ instagram: 'myhandle' })
      )
    })
  })

  it('calls onAdded on successful submission', async () => {
    const user = userEvent.setup()
    render(<AddContactModal onClose={onClose} onAdded={onAdded} />)

    await user.type(getEmailInput(), 'test@club.com')
    await user.type(getClubInput(), 'Test Club')
    await user.click(getSubmitButton())

    await waitFor(() => {
      expect(onAdded).toHaveBeenCalled()
    })
  })

  it('shows error on API failure', async () => {
    mockAddOutreachContact.mockRejectedValue(new Error('A contact with this email already exists'))

    const user = userEvent.setup()
    render(<AddContactModal onClose={onClose} onAdded={onAdded} />)

    await user.type(getEmailInput(), 'dupe@club.com')
    await user.type(getClubInput(), 'Test Club')
    await user.click(getSubmitButton())

    await waitFor(() => {
      expect(screen.getByText(/already exists/i)).toBeInTheDocument()
    })
    expect(onAdded).not.toHaveBeenCalled()
  })

  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup()
    render(<AddContactModal onClose={onClose} onAdded={onAdded} />)

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
