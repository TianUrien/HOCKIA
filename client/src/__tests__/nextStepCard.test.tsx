import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import NextStepCard from '@/components/NextStepCard'

type TestBucket = {
  id: string
  label: string
  completed: boolean
  unlockCopy?: string
}

const mixedBuckets: TestBucket[] = [
  { id: 'photo', label: 'Add a profile photo', completed: true },
  {
    id: 'video',
    label: 'Add your highlight video',
    completed: false,
    unlockCopy: 'Clubs see how you play.',
  },
  { id: 'references', label: 'Get a reference', completed: false },
]

const allCompleteBuckets: TestBucket[] = [
  { id: 'photo', label: 'Add a profile photo', completed: true },
  { id: 'video', label: 'Add your highlight video', completed: true },
]

describe('NextStepCard', () => {
  it('renders nothing while loading', () => {
    const { container } = render(
      <NextStepCard percentage={40} buckets={mixedBuckets} loading />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when profile is 100% complete', () => {
    const { container } = render(
      <NextStepCard percentage={100} buckets={allCompleteBuckets} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when buckets array is empty', () => {
    const { container } = render(
      <NextStepCard percentage={0} buckets={[]} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when every bucket is already completed even if percentage is below 100', () => {
    // Edge case: weights might not sum to 100 but all buckets could be marked completed.
    const { container } = render(
      <NextStepCard percentage={95} buckets={allCompleteBuckets} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('surfaces the first incomplete bucket with its label, unlock copy, and CTA', () => {
    render(<NextStepCard percentage={40} buckets={mixedBuckets} />)

    expect(screen.getByText('Next step')).toBeInTheDocument()
    // CTA body heading is an <h3>; the same label also appears as a span in the
    // (hidden) checklist, so scope the assertion to the heading role.
    expect(
      screen.getByRole('heading', { level: 3, name: 'Add your highlight video' })
    ).toBeInTheDocument()
    // Unlock copy appears once in the CTA body, and once in the hidden
    // checklist row — confirm at least one exists, no duplicates are broken.
    expect(screen.getAllByText('Clubs see how you play.').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /get started/i })).toBeInTheDocument()
    // Progress summary
    expect(screen.getByText('40%')).toBeInTheDocument()
    // 2 of 3 buckets incomplete in this fixture → "2 steps left"
    expect(screen.getByText(/2 steps left/)).toBeInTheDocument()
  })

  it('omits the unlock copy line when the next bucket has none', () => {
    const bucketsWithoutCopy: TestBucket[] = [
      { id: 'photo', label: 'Add a profile photo', completed: false },
    ]
    render(<NextStepCard percentage={0} buckets={bucketsWithoutCopy} />)

    // Label shows in both the CTA heading and the (hidden) checklist row.
    expect(
      screen.getByRole('heading', { level: 3, name: 'Add a profile photo' })
    ).toBeInTheDocument()
    // No unlockCopy provided, so no description paragraph should render for it.
    expect(screen.queryByText(/clubs see how you play/i)).not.toBeInTheDocument()
  })

  it('handles a single remaining step with correct "1 step left" copy', () => {
    const oneLeftBuckets: TestBucket[] = [
      { id: 'photo', label: 'Add a profile photo', completed: true },
      { id: 'video', label: 'Add your highlight video', completed: false },
    ]
    render(<NextStepCard percentage={50} buckets={oneLeftBuckets} />)

    expect(screen.getByText(/1 step left/)).toBeInTheDocument()
  })

  it('fires onBucketAction with the top incomplete bucket when the CTA is clicked', () => {
    const handler = vi.fn()
    render(
      <NextStepCard percentage={40} buckets={mixedBuckets} onBucketAction={handler} />
    )

    fireEvent.click(screen.getByRole('button', { name: /get started/i }))

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'video', completed: false })
    )
  })

  it('does not throw when the CTA is clicked without an onBucketAction handler', () => {
    render(<NextStepCard percentage={40} buckets={mixedBuckets} />)
    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: /get started/i }))
    ).not.toThrow()
  })

  describe('expandable checklist', () => {
    it('renders a "See all X steps" toggle labelled with the total bucket count', () => {
      render(<NextStepCard percentage={40} buckets={mixedBuckets} />)
      expect(
        screen.getByRole('button', { name: /see all 3 steps/i })
      ).toBeInTheDocument()
    })

    it('is collapsed by default — the toggle reports aria-expanded=false', () => {
      render(<NextStepCard percentage={40} buckets={mixedBuckets} />)
      const toggle = screen.getByRole('button', { name: /see all 3 steps/i })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    })

    it('expands and swaps the toggle label when clicked', () => {
      render(<NextStepCard percentage={40} buckets={mixedBuckets} />)
      const toggle = screen.getByRole('button', { name: /see all 3 steps/i })
      fireEvent.click(toggle)

      // Label swaps
      expect(
        screen.getByRole('button', { name: /hide all steps/i })
      ).toBeInTheDocument()
      // aria-expanded flips
      expect(
        screen.getByRole('button', { name: /hide all steps/i })
      ).toHaveAttribute('aria-expanded', 'true')
    })

    it('renders every bucket in the expanded list (complete + incomplete)', () => {
      render(<NextStepCard percentage={40} buckets={mixedBuckets} />)
      fireEvent.click(screen.getByRole('button', { name: /see all 3 steps/i }))

      // Completed bucket label appears
      expect(screen.getByText('Add a profile photo')).toBeInTheDocument()
      // Next-step bucket label already appears in the CTA body above, so it
      // shows twice in the expanded layout — verify at least one occurrence.
      expect(screen.getAllByText('Add your highlight video').length).toBeGreaterThan(0)
      // Last incomplete bucket
      expect(screen.getByText('Get a reference')).toBeInTheDocument()
    })

    it('clicking an incomplete bucket in the checklist fires onBucketAction with that bucket', () => {
      const handler = vi.fn()
      render(
        <NextStepCard
          percentage={40}
          buckets={mixedBuckets}
          onBucketAction={handler}
        />
      )
      fireEvent.click(screen.getByRole('button', { name: /see all 3 steps/i }))

      // Click the "Get a reference" row in the expanded list
      fireEvent.click(screen.getByRole('button', { name: /get a reference/i }))

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'references', completed: false })
      )
    })

    it('does not render clickable buttons for completed buckets in the checklist', () => {
      render(<NextStepCard percentage={40} buckets={mixedBuckets} />)
      fireEvent.click(screen.getByRole('button', { name: /see all 3 steps/i }))

      // Completed buckets render as non-interactive rows, so no button with that name.
      expect(
        screen.queryByRole('button', { name: /add a profile photo/i })
      ).not.toBeInTheDocument()
    })
  })
})
