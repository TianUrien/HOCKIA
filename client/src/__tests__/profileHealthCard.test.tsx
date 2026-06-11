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
  noun?: string
  completed: boolean
}

// Mirrors the real useProfileStrength bucket shape — labels are
// imperative CTAs (matching what NextStepCard renders), and the three
// recruiter-grade buckets supply a noun form for ProfileHealthCard's
// comparative copy. Without noun fields the comparative line would
// render "Profiles with get a trusted reference tend to..." (caught in
// staging QA on Batch 4).
const mixedBuckets: TestBucket[] = [
  { id: 'basic-info', label: 'Basic info completed', completed: true },
  { id: 'profile-photo', label: 'Add a profile photo', completed: true },
  { id: 'highlight-video', label: 'Add your highlight video', noun: 'a highlight video', completed: false },
  { id: 'full-match-footage', label: 'Upload full match footage', noun: 'full match footage', completed: false },
  { id: 'journey', label: 'Add to your career history', completed: true },
  { id: 'media-gallery', label: 'Add a photo or video to your Gallery', completed: false },
  { id: 'friends', label: 'Make your first connection', completed: true },
  { id: 'references', label: 'Get a trusted reference', noun: 'trusted references', completed: false },
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
    expect(screen.getByText('Basic info completed')).toBeInTheDocument()
    expect(screen.getByText('Add a profile photo')).toBeInTheDocument()
    expect(screen.getByText('Add to your career history')).toBeInTheDocument()
    expect(screen.getByText('Make your first connection')).toBeInTheDocument()
    // Missing
    expect(screen.getByText('Add your highlight video')).toBeInTheDocument()
    expect(screen.getByText('Upload full match footage')).toBeInTheDocument()
    expect(screen.getByText('Add a photo or video to your Gallery')).toBeInTheDocument()
    expect(screen.getByText('Get a trusted reference')).toBeInTheDocument()
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

  it('names the single missing high-signal bucket in the copy via its noun form', () => {
    render(<ProfileHealthCard percentage={85} buckets={onlyOneSignalMissing} />)
    // The bucket's `noun` field ("full match footage") must be used —
    // NOT the imperative `label` ("Upload full match footage"), which
    // would render as "Profiles with upload full match footage tend to...".
    // Regression guard for the Batch 4 staging QA finding.
    expect(
      screen.getByText(/^profiles with full match footage tend to get more recruiter contact\.$/i),
    ).toBeInTheDocument()
    // Belt-and-suspenders: the broken interpolation must NOT appear.
    expect(screen.queryByText(/profiles with upload/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/profiles with get/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/profiles with add/i)).not.toBeInTheDocument()
  })

  it('falls back to label.toLowerCase() when a high-signal bucket has no noun (defensive)', () => {
    // Hypothetical: someone adds a high-signal bucket without a noun.
    // The fallback path should still render readable copy, even if not ideal.
    const noNounMissing: TestBucket[] = mixedBuckets.map((b) => ({
      ...b,
      noun: undefined,
      completed: b.id === 'highlight-video' ? false : true,
    }))
    render(<ProfileHealthCard percentage={85} buckets={noNounMissing} />)
    // Falls back to the lowercased label
    expect(
      screen.getByText(/^profiles with add your highlight video tend to get more recruiter contact\.$/i),
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
