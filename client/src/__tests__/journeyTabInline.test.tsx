import { render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

// JourneyTab does a Supabase fetch on mount. We pin the empty-list case
// here so the inline-mode suppression doesn't regress silently — when
// a public viewer hits a profile with no Journey entries, the inline
// section must render NOTHING (not an empty placeholder).

vi.mock('@/lib/auth', () => ({
  useAuthStore: () => ({ user: { id: 'visitor-1' }, profile: null }),
}))

vi.mock('@/lib/toast', () => ({
  useToastStore: () => ({ addToast: vi.fn() }),
}))

vi.mock('@/lib/storage', () => ({
  deleteStorageObject: vi.fn(),
  extractStoragePath: vi.fn(),
}))

vi.mock('@/lib/imageOptimization', () => ({
  optimizeImage: vi.fn(),
  generateThumbnail: vi.fn(),
  validateImage: vi.fn(),
}))

vi.mock('@/components/StorageImage', () => ({
  default: () => null,
}))

vi.mock('@/components/WorldClubSearch', () => ({
  default: () => null,
}))

const supabaseMocks = vi.hoisted(() => {
  // Each chained call returns `this`; the terminal `order()` (the second
  // one) resolves the promise. JourneyTab also subscribes to a realtime
  // channel — return a minimal stub for that path too.
  const builder: Record<string, ReturnType<typeof vi.fn>> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.order = vi.fn(() => builder)
  builder.then = vi.fn((resolve: (v: { data: unknown[]; error: null }) => void) => {
    resolve({ data: [], error: null })
    return Promise.resolve({ data: [], error: null })
  })

  return {
    supabase: {
      from: vi.fn(() => builder),
      channel: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
      })),
      removeChannel: vi.fn(),
      auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
    },
  }
})

vi.mock('@/lib/supabase', () => supabaseMocks)

import JourneyTab from '@/components/JourneyTab'

describe('JourneyTab — inline + readOnly empty-state suppression', () => {
  it('renders nothing when there are no entries (inline + readOnly)', async () => {
    const { container } = render(
      <JourneyTab profileId="profile-1" readOnly variant="inline" title="Journey" />
    )

    // After the supabase fetch resolves with an empty list, the
    // inline+readOnly branch returns null. There should be no "Journey"
    // heading anywhere in the rendered output.
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /^journey$/i })).toBeNull()
    })

    // Container should be empty (or render only the wrapper React adds).
    expect(container.textContent ?? '').not.toMatch(/journey/i)
  })

  it('still renders the heading in tab variant (default)', async () => {
    render(
      <JourneyTab profileId="profile-1" readOnly variant="tab" />
    )

    // In tab mode, the heading shows even when empty (existing behavior —
    // empty-state placeholder lives below the heading).
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /^journey$/i })).not.toBeNull()
    })
  })
})
