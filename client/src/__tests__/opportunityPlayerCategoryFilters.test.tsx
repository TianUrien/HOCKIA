/**
 * Founder ruling 2026-09-25 / Figma update: Boys/Girls are removed from player
 * roles AND from the player-facing Category filters (under-18s are never
 * recruitable; the DB rejects youth player roles). The full enum stays for
 * coach/staff roles and mappings (OPPORTUNITY_GENDERS).
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { OPPORTUNITY_GENDERS, PLAYER_ROLE_GENDERS } from '@/lib/hockeyCategories'
import { OpportunityFiltersSheet } from '@/components/opportunities/OpportunityFiltersSheet'
import OpportunityQuickFilters from '@/components/OpportunityQuickFilters'
import { EMPTY_ROLE_FILTERS } from '@/lib/opportunityFilters'

describe('PLAYER_ROLE_GENDERS', () => {
  it('is the adult teams only; the full enum is untouched', () => {
    expect(PLAYER_ROLE_GENDERS).toEqual(['Men', 'Women', 'Mixed'])
    expect(OPPORTUNITY_GENDERS).toEqual(['Men', 'Women', 'Girls', 'Boys', 'Mixed'])
  })
})

describe('OpportunityFiltersSheet · Category', () => {
  it('offers no Girls / Boys chip', () => {
    render(
      <OpportunityFiltersSheet open onClose={vi.fn()} value={EMPTY_ROLE_FILTERS} onApply={vi.fn()} countFor={() => 0} passportHint={null} />,
    )
    expect(screen.getByRole('button', { name: "Women's" })).toBeTruthy()
    expect(screen.getByRole('button', { name: "Men's" })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mixed' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Girls' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Boys' })).toBeNull()
  })
})

describe('OpportunityQuickFilters · category chip', () => {
  const props = {
    opportunityType: 'all' as const, position: [], onSetType: vi.fn(), onTogglePosition: vi.fn(), onClearAll: vi.fn(),
    hasActiveFilters: false, secondaryFilterCount: 0, onOpenMoreFilters: vi.fn(),
  }

  it('starts the cycle at an adult team', () => {
    const onSetGender = vi.fn()
    render(<OpportunityQuickFilters {...props} gender="all" onSetGender={onSetGender} />)
    fireEvent.click(screen.getByRole('button', { name: /category/i }))
    expect(onSetGender).toHaveBeenCalledWith('Men')
  })
})
