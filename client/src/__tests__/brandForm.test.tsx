import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BrandForm } from '@/components/brands/BrandForm'

const user = userEvent.setup()

vi.mock('@/lib/auth', () => ({
  useAuthStore: () => ({ user: { id: 'user-1' } }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: vi.fn(),
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
      }),
    },
  },
}))

vi.mock('@/lib/nativeImagePicker', () => ({
  isNativePlatform: () => false,
  pickImageNative: vi.fn(),
}))

vi.mock('@/lib/imageOptimization', () => ({
  optimizeAvatarImage: vi.fn(),
  validateImage: vi.fn().mockReturnValue({ valid: true }),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

// Input/Button come from the barrel; stub them as minimal HTML so tests don't
// depend on their styling implementation. We intentionally omit `required` so
// HTML5 validation doesn't short-circuit our custom `.trim()` checks — the
// whole point of these tests is to verify our client-side gates, not the
// browser's.
vi.mock('@/components', () => ({
  Input: ({ id, value, onChange, placeholder, type, disabled }: {
    id?: string
    value?: string
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
    type?: string
    disabled?: boolean
  }) => (
    <input
      id={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      type={type}
      disabled={disabled}
    />
  ),
  Button: ({ children, type, disabled, onClick }: {
    children: React.ReactNode
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
    onClick?: () => void
  }) => (
    <button type={type} disabled={disabled} onClick={onClick}>{children}</button>
  ),
}))

describe('BrandForm', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('category dropdown', () => {
    it('renders all 10 expanded categories in the dropdown', () => {
      render(<BrandForm onSubmit={vi.fn()} />)
      const select = screen.getByLabelText(/category/i) as HTMLSelectElement
      const labels = Array.from(select.options).map((o) => o.label)
      expect(labels).toEqual([
        'Equipment',
        'Apparel',
        'Accessories',
        'Nutrition',
        'Technology',
        'Coaching & Training',
        'Recruiting',
        'Media',
        'Services',
        'Other',
      ])
    })

    it('includes the three new values introduced by the category expansion', () => {
      render(<BrandForm onSubmit={vi.fn()} />)
      const select = screen.getByLabelText(/category/i) as HTMLSelectElement
      const values = Array.from(select.options).map((o) => o.value)
      expect(values).toContain('coaching')
      expect(values).toContain('recruiting')
      expect(values).toContain('media')
    })
  })

  describe('validation', () => {
    it('blocks submit and shows an error when name is empty', async () => {
      const onSubmit = vi.fn()
      render(<BrandForm onSubmit={onSubmit} submitLabel="Create" />)

      await user.click(screen.getByRole('button', { name: /create/i }))

      expect(await screen.findByText(/brand name is required/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('also rejects whitespace-only name (trim check)', async () => {
      const onSubmit = vi.fn()
      render(<BrandForm onSubmit={onSubmit} submitLabel="Create" />)

      await user.type(screen.getByLabelText(/brand name/i), '   ')
      await user.click(screen.getByRole('button', { name: /create/i }))

      expect(await screen.findByText(/brand name is required/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('blocks submit and shows an error when slug is empty', async () => {
      const onSubmit = vi.fn()
      render(<BrandForm onSubmit={onSubmit} submitLabel="Create" />)

      await user.type(screen.getByLabelText(/brand name/i), 'My Brand')

      const slugInput = screen.getByLabelText(/url slug/i) as HTMLInputElement
      await user.clear(slugInput)

      await user.click(screen.getByRole('button', { name: /create/i }))

      expect(await screen.findByText(/url slug is required/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('rejects a reserved slug with a friendly message before calling onSubmit', async () => {
      const onSubmit = vi.fn()
      render(<BrandForm onSubmit={onSubmit} submitLabel="Create" />)

      await user.type(screen.getByLabelText(/brand name/i), 'Admin')

      // 'admin' is a reserved slug per the server allowlist
      await user.click(screen.getByRole('button', { name: /create/i }))

      expect(await screen.findByText(/reserved/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('rejects a slug containing invalid characters', async () => {
      const onSubmit = vi.fn()
      render(<BrandForm onSubmit={onSubmit} submitLabel="Create" />)

      await user.type(screen.getByLabelText(/brand name/i), 'My Brand')

      // Force an invalid slug (leading hyphen) — the onChange filter strips
      // most bad chars but a leading hyphen can slip through paste or
      // auto-generation edge cases; the regex gate is the last line of
      // defense before the RPC.
      const slugInput = screen.getByLabelText(/url slug/i) as HTMLInputElement
      await user.clear(slugInput)
      await user.type(slugInput, '-bad-slug')

      await user.click(screen.getByRole('button', { name: /create/i }))

      expect(await screen.findByText(/lowercase letters, numbers, and hyphens/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('calls onSubmit with form data on a valid submission', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      render(<BrandForm onSubmit={onSubmit} submitLabel="Create" />)

      await user.type(screen.getByLabelText(/brand name/i), 'Coaching Co')

      const select = screen.getByLabelText(/category/i) as HTMLSelectElement
      await user.selectOptions(select, 'coaching')

      await user.click(screen.getByRole('button', { name: /create/i }))

      expect(onSubmit).toHaveBeenCalledTimes(1)
      const payload = onSubmit.mock.calls[0][0]
      expect(payload.name).toBe('Coaching Co')
      expect(payload.slug).toBe('coaching-co')
      expect(payload.category).toBe('coaching')
    })

    it('skips slug validation when editing an existing brand (slug is locked)', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      render(
        <BrandForm
          brand={{
            id: 'b1',
            profile_id: 'p1',
            slug: 'existing',
            name: 'Existing',
            logo_url: null,
            bio: null,
            category: 'services',
            website_url: null,
            instagram_url: null,
            is_verified: false,
            created_at: '',
            updated_at: '',
            last_activity_at: '',
          }}
          onSubmit={onSubmit}
          submitLabel="Save"
        />
      )

      await user.click(screen.getByRole('button', { name: /save/i }))

      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
  })

  describe('draft persistence', () => {
    it('persists form input to localStorage and restores it on remount', async () => {
      const { unmount } = render(<BrandForm onSubmit={vi.fn()} persistKey="test" />)
      await user.type(screen.getByLabelText(/brand name/i), 'Draft Brand')

      // Draft key format: STORAGE_PREFIX + persistKey
      const saved = localStorage.getItem('hockia_brand_draft_test')
      expect(saved).toBeTruthy()
      expect(JSON.parse(saved!).name).toBe('Draft Brand')

      unmount()
      render(<BrandForm onSubmit={vi.fn()} persistKey="test" />)

      const nameInput = screen.getByLabelText(/brand name/i) as HTMLInputElement
      expect(nameInput.value).toBe('Draft Brand')
    })

    it('clears the draft after a successful submission', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      render(<BrandForm onSubmit={onSubmit} persistKey="test-clear" submitLabel="Create" />)

      await user.type(screen.getByLabelText(/brand name/i), 'Finished')
      await user.click(screen.getByRole('button', { name: /create/i }))

      expect(localStorage.getItem('hockia_brand_draft_test-clear')).toBeNull()
    })

    it('keeps the draft when submission fails so the user can retry', async () => {
      const onSubmit = vi.fn().mockRejectedValue(new Error('Brand slug already taken'))
      render(<BrandForm onSubmit={onSubmit} persistKey="test-keep" submitLabel="Create" />)

      await user.type(screen.getByLabelText(/brand name/i), 'Will Fail')
      await user.click(screen.getByRole('button', { name: /create/i }))

      expect(await screen.findByText(/brand slug already taken/i)).toBeInTheDocument()
      const saved = localStorage.getItem('hockia_brand_draft_test-keep')
      expect(saved).toBeTruthy()
      expect(JSON.parse(saved!).name).toBe('Will Fail')
    })
  })

  describe('category labels', () => {
    it('preserves & and capitalization in the "Coaching & Training" label', () => {
      render(<BrandForm onSubmit={vi.fn()} />)
      const select = screen.getByLabelText(/category/i) as HTMLSelectElement
      const coachingOption = within(select).getByRole('option', { name: 'Coaching & Training' })
      expect(coachingOption).toBeInTheDocument()
      expect((coachingOption as HTMLOptionElement).value).toBe('coaching')
    })
  })
})
