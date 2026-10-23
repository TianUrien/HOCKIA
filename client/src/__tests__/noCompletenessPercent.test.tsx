/**
 * Design audit 2026-10-21, A2/A3: no completeness percentage anywhere a
 * member sees it, the owner gets the next missing item with its icon, and
 * recruiter views get a plain "Missing: …" list with no activity row.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PrimaryCard } from '@/components/profile/v2/OwnerArea'
import { missingLine } from '@/lib/evidence'

describe('PrimaryCard (own profile next step)', () => {
  it('shows the next item’s icon and never a percentage', () => {
    const { container } = render(<PrimaryCard stepKey="bio" title="Write a short bio" subtitle="Three lines about you" cta="Write" onAction={vi.fn()} />)
    expect(screen.getByTestId('next-step-icon')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/%/)
  })

  it('falls back to a generic icon for an unknown part', () => {
    render(<PrimaryCard stepKey="something_new" title="Do it" subtitle="Why" cta="Go" onAction={vi.fn()} />)
    expect(screen.getByTestId('next-step-icon')).toBeInTheDocument()
  })
})

describe('missingLine (recruiter views)', () => {
  it('lists what is missing in plain words', () => {
    expect(missingLine([
      { label: 'Highlight video', present: false },
      { label: 'Current club', present: true },
      { label: 'Career history', present: false },
    ])).toBe('Missing: Highlight video, career history')
  })
  it('is null when nothing is missing', () => {
    expect(missingLine([{ label: 'Current club', present: true }])).toBeNull()
  })
})

describe('no completeness % or activity evidence in source', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')
  it.each([
    'components/profile/v2/OwnerArea.tsx',
    'components/NextStepCard.tsx',
    'components/dashboard/bento/ClubHeroCard.tsx',
  ])('%s renders no completeness percentage', (p) => {
    const src = read(p)
    expect(src).not.toMatch(/\{(completeness|pct|percentage|profileStrength\.percentage)\}%/)
    expect(src).not.toMatch(/CompletionArc|<Ring /)
  })
})
