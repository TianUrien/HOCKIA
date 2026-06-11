import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import JourneyTab from '@/components/JourneyTab'
import { vi } from 'vitest'

const user = userEvent.setup()

const addToast = vi.fn()
vi.mock('@/lib/toast', () => ({
  useToastStore: () => ({ addToast }),
}))

vi.mock('@/lib/auth', () => ({
  useAuthStore: () => ({ user: { id: 'user-1' } }),
}))

vi.mock('@/lib/storage', () => ({
  deleteStorageObject: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/imageOptimization', () => ({
  optimizeImage: vi.fn(async (file: File) => file),
  validateImage: vi.fn(() => ({ valid: true })),
}))

vi.mock('@/components/Button', () => ({
  default: ({ children, ...props }: { children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/Skeleton', () => ({
  default: () => <div data-testid="skeleton" />,
}))

type JourneyRow = {
  id: string
  user_id: string
  club_name: string
  position_role: string
  division_league: string
  location_city: string | null
  location_country: string | null
  start_date: string | null
  end_date: string | null
  years: string | null
  highlights: string[]
  entry_type: string | null
  description: string | null
  image_url: string | null
  display_order: number | null
  created_at: string
  updated_at: string
}

const journeySupabase = vi.hoisted(() => ({
  rows: [] as JourneyRow[],
  fetchError: null as Error | null,
  insertResult: { error: null as Error | null },
  updateResult: { error: null as Error | null },
  deleteResult: { error: null as Error | null },
  insertSpy: vi.fn(),
  updateSpy: vi.fn(),
  updateEqSpy: vi.fn(),
  deleteEqSpy: vi.fn(),
}))

vi.mock('@/lib/supabase', () => {
  const createSelectBuilder = () => {
    const resultPromise = Promise.resolve({ data: journeySupabase.rows, error: journeySupabase.fetchError })
    const builder = {
      eq: () => builder,
      order: () => builder,
      then: (onFulfilled: (value: { data: unknown; error: Error | null }) => unknown, onRejected?: (reason: unknown) => unknown) =>
        resultPromise.then(onFulfilled, onRejected),
      catch: (onRejected: (reason: unknown) => unknown) => resultPromise.catch(onRejected),
      finally: (onFinally: () => void) => resultPromise.finally(onFinally),
    }
    return builder
  }

  const playingHistoryTable = {
    select: () => createSelectBuilder(),
    insert: (payload: Record<string, unknown>) => {
      journeySupabase.insertSpy(payload)
      return Promise.resolve(journeySupabase.insertResult)
    },
    update: (payload: Record<string, unknown>) => {
      journeySupabase.updateSpy(payload)
      return {
        eq: (column: string, value: unknown) => {
          journeySupabase.updateEqSpy(column, value)
          return Promise.resolve(journeySupabase.updateResult)
        },
      }
    },
    delete: () => ({
      eq: (column: string, value: unknown) => {
        journeySupabase.deleteEqSpy(column, value)
        return Promise.resolve(journeySupabase.deleteResult)
      },
    }),
  }

  return {
    supabase: {
      from: (table: string) => {
        if (table === 'career_history') {
          return playingHistoryTable
        }
        return playingHistoryTable
      },
      storage: {
        from: () => ({
          upload: vi.fn().mockResolvedValue({ error: null }),
          getPublicUrl: () => ({ data: { publicUrl: 'https://example.com/image.jpg' } }),
        }),
      },
    },
  }
})

const renderJourneyTab = () => render(<JourneyTab profileId="user-1" />)

beforeEach(() => {
  vi.clearAllMocks()
  addToast.mockReset()
  journeySupabase.rows = []
  journeySupabase.insertResult = { error: null }
  journeySupabase.updateResult = { error: null }
  journeySupabase.insertSpy.mockReset()
  journeySupabase.updateSpy.mockReset()
  journeySupabase.updateEqSpy.mockReset()
})

describe('JourneyTab', () => {
  it('validates required fields and saves a new entry', async () => {
    renderJourneyTab()

    const addButtons = await screen.findAllByRole('button', { name: /add entry/i })
    await user.click(addButtons[0])

    const saveButton = await screen.findByRole('button', { name: /save entry/i })
    await user.click(saveButton)
    expect(await screen.findByText('Title is required')).toBeInTheDocument()

    await user.type(screen.getByLabelText(/Title/), 'World Cup Squad')
    await user.selectOptions(screen.getByLabelText(/Category/), 'club')
    await user.selectOptions(screen.getByLabelText('Start month'), '0')
    await user.selectOptions(screen.getByLabelText('Start year'), '2024')

    await user.click(saveButton)

    await waitFor(() => {
      expect(journeySupabase.insertSpy).toHaveBeenCalled()
    })

    const payload = journeySupabase.insertSpy.mock.calls[0][0]
    expect(payload).toMatchObject({
      club_name: 'World Cup Squad',
      entry_type: 'club',
      start_date: expect.any(String),
    })
    expect(addToast).toHaveBeenCalledWith('Entry saved.', 'success')
  })

  it('edits an existing entry and updates Supabase', async () => {
    journeySupabase.rows = [
      {
        id: 'entry-1',
        user_id: 'user-1',
        club_name: 'Brussels Wolves',
        position_role: 'Midfielder',
        division_league: 'Premier',
        location_city: 'Brussels',
        location_country: 'Belgium',
        start_date: '2022-01-01',
        end_date: '2023-05-01',
        years: '2022-2023',
        highlights: ['Championship title'],
        entry_type: 'club',
        description: 'Key playmaker',
        image_url: null,
        display_order: 1,
        created_at: '',
        updated_at: '',
      },
    ]

    renderJourneyTab()

    expect(await screen.findByText('Brussels Wolves')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /edit/i }))

    const titleInput = await screen.findByLabelText(/Club Name/)
    await user.clear(titleInput)
    await user.type(titleInput, 'Brussels Wolves Elite')

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(journeySupabase.updateSpy).toHaveBeenCalled()
      expect(journeySupabase.updateEqSpy).toHaveBeenCalledWith('id', 'entry-1')
    })

    expect(journeySupabase.updateSpy.mock.calls[0][0]).toMatchObject({ club_name: 'Brussels Wolves Elite' })
    expect(addToast).toHaveBeenCalledWith('Entry saved.', 'success')
  })
})
