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

  it('renders the celebratory "profile complete" state when profile is 100%', () => {
    // Behaviour change 2026-05-08: the card no longer unmounts at 100%.
    // Players need a persistent progress signal so they can tell when
    // something later moves them off 100% (a new bucket, lapsed reference,
    // etc.). The progress bar stays visible and the next-step CTA is
    // replaced with a celebratory "Profile complete" copy block.
    render(<NextStepCard percentage={100} buckets={allCompleteBuckets} />)

    expect(screen.getByText('Profile complete')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 3, name: /your profile is fully built/i }),
    ).toBeInTheDocument()
    // The standalone % label was removed from this card — the Hero arc on
    // the Bento landing now owns the canonical % display. The progress bar
    // here stays, but no duplicate "100%" text is rendered.
    expect(screen.queryByText('100%')).not.toBeInTheDocument()
    // No "Get started" CTA in the complete state.
    expect(screen.queryByRole('button', { name: /get started/i })).not.toBeInTheDocument()
    // Step counter copy reflects completion.
    expect(screen.getByText(/All 2 steps complete/)).toBeInTheDocument()
  })

  it('renders nothing when buckets array is empty', () => {
    const { container } = render(
      <NextStepCard percentage={0} buckets={[]} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the celebratory state when every bucket is completed even if percentage is below 100', () => {
    // Edge case: weights might not sum to 100 but all buckets are marked
    // completed — same celebratory state, since there is no next step.
    render(<NextStepCard percentage={95} buckets={allCompleteBuckets} />)

    expect(screen.getByText('Profile complete')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /get started/i })).not.toBeInTheDocument()
    // % label removed from this card — see note above.
    expect(screen.queryByText('95%')).not.toBeInTheDocument()
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
    // The standalone % label was removed; only the progress bar remains.
    expect(screen.queryByText('40%')).not.toBeInTheDocument()
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

  // The expandable "See all steps" checklist was removed — it duplicated the
  // Profile Snapshot below it on the dashboard and turned the surface from
  // "level up" energy into a homework list. NextStepCard now stays focused
  // on a single primary action; tests for the expander are gone with it.
})
