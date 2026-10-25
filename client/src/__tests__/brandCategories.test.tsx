import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrandCategoryFilter } from '@/components/brands/BrandCategoryFilter'

// Regression guard for the category taxonomy expansion
// (202604210100_expand_brand_categories), moved from the Marketplace smoke
// test when the Marketplace Directory tab went away (2026-10-25). If a
// category goes missing, a label map is out of sync with the DB constraint.
describe('brand category filter', () => {
  it('shows All and the 10 categories the database allows', () => {
    render(<BrandCategoryFilter value={null} onChange={vi.fn()} />)
    for (const label of ['All', 'Equipment', 'Apparel', 'Accessories', 'Nutrition', 'Technology', 'Coaching & Training', 'Recruiting', 'Media', 'Services', 'Other']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })
})
