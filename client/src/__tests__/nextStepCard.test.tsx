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
    expect(screen.getByText('Add your highlight video')).toBeInTheDocument()
    expect(screen.getByText('Clubs see how you play.')).toBeInTheDocument()
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

    expect(screen.getByText('Add a profile photo')).toBeInTheDocument()
    // No unlockCopy provided, so no second paragraph should render for it.
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
})
