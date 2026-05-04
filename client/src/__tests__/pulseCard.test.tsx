import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { PulseCard } from '@/components/home/PulseCard'
import type { PulseItem } from '@/hooks/useMyPulse'

// ── Sentry mock — captures every captureMessage call so we can assert
//    "reported once per session per unknown type."
const sentryCaptureMessage = vi.fn()
vi.mock('@sentry/react', () => ({
  captureMessage: (...args: unknown[]) => sentryCaptureMessage(...args),
}))

beforeEach(() => {
  sentryCaptureMessage.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const buildPulse = (overrides: Partial<PulseItem> = {}): PulseItem => ({
  id: 'p-1',
  user_id: 'user-1',
  item_type: 'unknown_test_type',
  priority: 3,
  metadata: {},
  created_at: '2026-05-04T10:00:00.000Z',
  seen_at: null,
  clicked_at: null,
  action_completed_at: null,
  dismissed_at: null,
  ...overrides,
})

describe('PulseCard dispatcher', () => {
  it('renders nothing for an unknown item_type (Phase 1B.2 default — no card types yet)', () => {
    const { container } = render(
      <PulseCard item={buildPulse()} onClick={() => {}} onDismiss={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('reports an unknown item_type to Sentry with feature + item_type tags', () => {
    render(<PulseCard item={buildPulse({ id: 'p-x', item_type: 'brand_new_type' })} onClick={() => {}} onDismiss={() => {}} />)
    expect(sentryCaptureMessage).toHaveBeenCalledTimes(1)
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      'pulse.unknown_item_type',
      expect.objectContaining({
        level: 'warning',
        tags: { feature: 'pulse', item_type: 'brand_new_type' },
        extra: { pulse_id: 'p-x' },
      }),
    )
  })

  it('only reports each unknown item_type once per session even on multiple renders', () => {
    // First render: should report
    const { rerender } = render(
      <PulseCard item={buildPulse({ item_type: 'one_off_type' })} onClick={() => {}} onDismiss={() => {}} />,
    )
    expect(sentryCaptureMessage).toHaveBeenCalledTimes(1)

    // Re-render with the same unknown type: should NOT report again
    rerender(
      <PulseCard item={buildPulse({ id: 'p-2', item_type: 'one_off_type' })} onClick={() => {}} onDismiss={() => {}} />,
    )
    expect(sentryCaptureMessage).toHaveBeenCalledTimes(1)

    // Re-render with a DIFFERENT unknown type: should report
    rerender(
      <PulseCard item={buildPulse({ id: 'p-3', item_type: 'other_unknown_type' })} onClick={() => {}} onDismiss={() => {}} />,
    )
    expect(sentryCaptureMessage).toHaveBeenCalledTimes(2)
  })
})
