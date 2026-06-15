import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import CompletionArc from '@/components/dashboard/bento/CompletionArc'

describe('CompletionArc', () => {
  it('renders the rounded percentage label and caption', () => {
    render(<CompletionArc percentage={73.4} />)
    expect(screen.getByText('73%')).toBeInTheDocument()
    expect(screen.getByText('Profile complete')).toBeInTheDocument()
  })

  it('clamps values above 100', () => {
    render(<CompletionArc percentage={150} caption="Done" />)
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('clamps values below 0', () => {
    render(<CompletionArc percentage={-25} />)
    expect(screen.getByText('0%')).toBeInTheDocument()
  })

  it('sets an aria-label that screen readers can announce', () => {
    render(<CompletionArc percentage={42} caption="Profile complete" />)
    expect(screen.getByTestId('completion-arc')).toHaveAttribute(
      'aria-label',
      'Profile complete: 42%',
    )
  })

  it('reserves its footprint with a skeleton while loading (no flashed percentage)', () => {
    render(<CompletionArc percentage={75} loading caption="Profile complete" />)
    // The (still-understated) percentage is withheld behind a skeleton so it
    // never flashes a wrong number that "catches up" once data lands.
    expect(screen.queryByText('75%')).not.toBeInTheDocument()
    // Caption + testid stay mounted so the footprint and a11y hook persist.
    expect(screen.getByText('Profile complete')).toBeInTheDocument()
    expect(screen.getByTestId('completion-arc')).toHaveAttribute('aria-label', 'Profile complete')
  })
})
