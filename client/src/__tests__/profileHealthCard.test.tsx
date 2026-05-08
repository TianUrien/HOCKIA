/**
 * ProfileHealthCard — diagnostic counterpart to NextStepCard.
 *
 * Tests pin the contract that:
 *   - The card always renders (no early-return at 100% like NextStepCard had)
 *   - Completed + missing buckets are both shown with the right icons
 *   - Comparative copy is conditional on which high-signal buckets are
 *     missing — and is NEVER an invented multiplier ("X× more contacted")
 */

import { render, screen } from '@testing-library/react'
import ProfileHealthCard from '@/components/ProfileHealthCard'

type TestBucket = {
  id: string
  label: string
  completed: boolean
}

const mixedBuckets: TestBucket[] = [
  { id: 'basic-info', label: 'Basic info', completed: true },
  { id: 'profile-photo', label: 'Profile photo', completed: true },
  { id: 'highlight-video', label: 'Highlight video', completed: false },
  { id: 'full-match-footage', label: 'Full match footage', completed: false },
  { id: 'journey', label: 'Journey', completed: true },
  { id: 'media-gallery', label: 'Gallery', completed: false },
  { id: 'friends', label: 'Connections', completed: true },
  { id: 'references', label: 'References', completed: false },
]

const allCompleteBuckets: TestBucket[] = mixedBuckets.map((b) => ({ ...b, completed: true }))

const onlyOneSignalMissing: TestBucket[] = mixedBuckets.map((b) => ({
  ...b,
  completed: b.id === 'full-match-footage' ? false : true,
}))

describe('ProfileHealthCard', () => {
  it('renders nothing while loading', () => {
    const { container } = render(
      <ProfileHealthCard percentage={40} buckets={mixedBuckets} loading />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when buckets is empty (defensive)', () => {
    const { container } = render(<ProfileHealthCard percentage={0} buckets={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the percentage and tier label', () => {
    render(<ProfileHealthCard percentage={75} buckets={mixedBuckets} />)
    expect(screen.getByText('75%')).toBeInTheDocument()
    // Tier 'rising' (>=70%) maps to "Looking good" via TierBadge
    expect(screen.getByText('Looking good')).toBeInTheDocument()
  })

  it('lists every completed bucket and every missing bucket', () => {
    render(<ProfileHealthCard percentage={50} buckets={mixedBuckets} />)
    // Completed
    expect(screen.getByText('Basic info')).toBeInTheDocument()
    expect(screen.getByText('Profile photo')).toBeInTheDocument()
    expect(screen.getByText('Journey')).toBeInTheDocument()
    expect(screen.getByText('Connections')).toBeInTheDocument()
    // Missing
    expect(screen.getByText('Highlight video')).toBeInTheDocument()
    expect(screen.getByText('Full match footage')).toBeInTheDocument()
    expect(screen.getByText('Gallery')).toBeInTheDocument()
    expect(screen.getByText('References')).toBeInTheDocument()
  })

  // ── Comparative copy variants ──────────────────────────────────────

  it('uses the all-complete copy when every bucket is done', () => {
    render(<ProfileHealthCard percentage={100} buckets={allCompleteBuckets} />)
    expect(
      screen.getByText(/profile has the signals recruiters look for/i),
    ).toBeInTheDocument()
    // Tier 'elite' (>=90%) maps to "Strong profile"
    expect(screen.getByText('Strong profile')).toBeInTheDocument()
  })

  it('names the single missing high-signal bucket in the copy', () => {
    render(<ProfileHealthCard percentage={85} buckets={onlyOneSignalMissing} />)
    // Copy should mention "full match footage" specifically
    expect(
      screen.getByText(/profiles with full match footage tend to get more recruiter contact/i),
    ).toBeInTheDocument()
  })

  it('uses general high-signal copy when multiple high-signal buckets are missing', () => {
    render(<ProfileHealthCard percentage={50} buckets={mixedBuckets} />)
    // mixedBuckets has video, full-match-footage, AND references missing
    expect(
      screen.getByText(/profiles with full match footage, highlight video, and trusted references/i),
    ).toBeInTheDocument()
  })

  it('uses round-out copy when only smaller buckets are missing', () => {
    // All high-signal buckets done, only secondary items missing
    const onlyGalleryMissing: TestBucket[] = mixedBuckets.map((b) => ({
      ...b,
      completed: b.id !== 'media-gallery',
    }))
    render(<ProfileHealthCard percentage={90} buckets={onlyGalleryMissing} />)
    expect(
      screen.getByText(/you have the high-impact signals recruiters look for/i),
    ).toBeInTheDocument()
  })

  // ── Honesty guard: NEVER invent multipliers ────────────────────────

  it('never displays an invented "Nx more contacted" multiplier', () => {
    // Render every state we have — none should leak a fake multiplier.
    const { container: c1 } = render(
      <ProfileHealthCard percentage={50} buckets={mixedBuckets} />,
    )
    const { container: c2 } = render(
      <ProfileHealthCard percentage={85} buckets={onlyOneSignalMissing} />,
    )
    const { container: c3 } = render(
      <ProfileHealthCard percentage={100} buckets={allCompleteBuckets} />,
    )
    for (const c of [c1, c2, c3]) {
      const text = c.textContent ?? ''
      // Catches "2x", "2×", "30%", "100%", etc. (the % is OK if it's the
      // tier-label percentage, but the multiplier patterns must not appear)
      expect(text).not.toMatch(/\d+\s*[x×]\s*more/i)
      expect(text).not.toMatch(/\d+%\s*(more|higher)/i)
    }
  })
})
