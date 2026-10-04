/**
 * Player alignment round 1 — Opportunities (Figma 313:1417 / 313:2177):
 * Card / Role Open | Applied, the package items, the quick chips (incl.
 * "No EU passport needed" = eu_passport_required false), and the detail's
 * Muted 48 message button + Primary / Tonal action.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Vacancy } from '@/lib/supabase'
import { RoleCard } from '@/components/opportunities/RoleCard'
import { PACKAGE_NOT_LISTED, rolePackageItems } from '@/lib/opportunityCopy'
import { EMPTY_ROLE_FILTERS, applyRoleFilters, isQuickChipOn, toggleQuickChip } from '@/lib/opportunityFilters'

const vac = (p: Partial<Vacancy> = {}) => ({
  id: 'v1', club_id: 'c1', title: 'Forward', opportunity_type: 'player', position: 'forward', gender: 'Women',
  location_city: 'Bologna', location_country: 'Italy', start_date: '2026-09-16', duration_text: '3 months',
  created_at: new Date().toISOString(), application_deadline: null, compensation: null, benefits: ['housing', 'flights'],
  eu_passport_required: false, specialist_skills_wanted: [], status: 'open', ...p,
}) as unknown as Vacancy

const card = (applied: boolean, p: Partial<Vacancy> = {}, handlers = { onOpen: vi.fn(), onApply: vi.fn() }) =>
  render(<RoleCard vacancy={vac(p)} clubName="Hockey Team Bologna" clubLogo={null} publisherRole="club" countryFlag="🇮🇹" league="Serie A1" applied={applied} canApply {...handlers} />)

describe('Card / Role', () => {
  it('Open: full-width Primary Apply that starts the apply flow', () => {
    const h = { onOpen: vi.fn(), onApply: vi.fn() }
    card(false, {}, h)
    expect(screen.getByTestId('role-card')).toHaveAttribute('data-status', 'open')
    const apply = screen.getByRole('button', { name: 'Apply' })
    expect(apply.className).toContain('bg-hockia-primary')
    expect(apply.className).toContain('w-full')
    fireEvent.click(apply)
    expect(h.onApply).toHaveBeenCalled()
  })
  it('Applied: Tonal with a check that opens the applied detail', () => {
    const h = { onOpen: vi.fn(), onApply: vi.fn() }
    card(true, {}, h)
    expect(screen.getByTestId('role-card')).toHaveAttribute('data-status', 'applied')
    const applied = screen.getByRole('button', { name: 'Applied' })
    expect(applied.className).toContain('bg-hockia-soft')
    expect(applied.querySelector('svg')?.getAttribute('class')).toContain('lucide-check')
    fireEvent.click(applied)
    expect(h.onOpen).toHaveBeenCalled()
    expect(h.onApply).not.toHaveBeenCalled()
  })
  it('shows "flag city · league", a soft-purple category tag and an optional day-first Apply by', () => {
    card(false, { application_deadline: '2026-10-12' })
    expect(screen.getByText('🇮🇹 Bologna, Italy · Serie A1')).toBeInTheDocument()
    expect(screen.getByTestId('category-tag').className).toContain('bg-brand-soft')
    expect(screen.getByTestId('role-card-apply-by').textContent).toMatch(/Apply by 12 Oct/)
  })
  it('EU passport is a neutral Requirement (ink-1 label, no amber)', () => {
    card(false, { eu_passport_required: true })
    const req = within(screen.getByTestId('role-card-package')).getByText('EU passport').closest('li')!
    expect(req).toHaveAttribute('data-type', 'requirement')
    expect(req.className).toContain('text-ink-1')
    expect(req.innerHTML).not.toMatch(/b45309|amber|warning/)
  })
})

describe('rolePackageItems', () => {
  it('pay first, then benefits, skills, requirement; at most six with the requirement kept', () => {
    const items = rolePackageItems({ compensation: 'paid', benefits: ['housing', 'flights', 'job', 'car', 'visa', 'equipment'], eu_passport_required: true, specialist_skills_wanted: ['drag_flicker'] })
    expect(items).toHaveLength(6)
    expect(items[0]).toMatchObject({ key: 'paid', type: 'benefit' })
    expect(items[5]).toMatchObject({ key: 'eu-passport', type: 'requirement' })
  })
  it('skills use the soft brand tile', () => {
    const [skill] = rolePackageItems({ compensation: null, benefits: [], eu_passport_required: false, specialist_skills_wanted: ['drag_flicker'] })
    expect(skill).toMatchObject({ type: 'skill', label: 'Drag flicker', tileClass: 'bg-hockia-soft text-hockia-primary' })
  })
  it('notes: "Paid or unpaid", and "Package not listed · ask the club" when nothing is listed', () => {
    expect(rolePackageItems({ compensation: 'either', benefits: [], eu_passport_required: false })[0]).toMatchObject({ type: 'note', label: 'Paid or unpaid' })
    expect(rolePackageItems({ compensation: null, benefits: [], eu_passport_required: false })).toEqual([expect.objectContaining({ type: 'note', label: PACKAGE_NOT_LISTED })])
  })
})

describe('quick chips', () => {
  const list = [vac({ id: 'eu', eu_passport_required: true }), vac({ id: 'open', eu_passport_required: false }), vac({ id: 'men', gender: 'Men', eu_passport_required: false })]
  it('"No EU passport needed" keeps only roles with eu_passport_required = false', () => {
    const f = toggleQuickChip(EMPTY_ROLE_FILTERS, 'no-eu-passport')
    expect(isQuickChipOn(f, 'no-eu-passport')).toBe(true)
    expect(applyRoleFilters(list, f, true).map((v) => v.id)).toEqual(['open', 'men'])
  })
  it('All is selected until a chip is on, and clears the chips', () => {
    expect(isQuickChipOn(EMPTY_ROLE_FILTERS, 'all')).toBe(true)
    const f = toggleQuickChip(toggleQuickChip(EMPTY_ROLE_FILTERS, 'women'), 'housing')
    expect(isQuickChipOn(f, 'all')).toBe(false)
    expect(applyRoleFilters(list, f, true).map((v) => v.id)).toEqual(['eu', 'open'])
    const cleared = toggleQuickChip(f, 'all')
    expect(isQuickChipOn(cleared, 'all')).toBe(true)
    expect(cleared.package).toEqual([])
  })
  it("Women's and Men's map onto the sheet's gender filter (one at a time)", () => {
    const f = toggleQuickChip(toggleQuickChip(EMPTY_ROLE_FILTERS, 'women'), 'men')
    expect(f.gender).toBe('Men')
    expect(applyRoleFilters(list, f, true).map((v) => v.id)).toEqual(['men'])
  })
})

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) } }))
vi.mock('@/lib/auth', () => ({ useAuthStore: (sel?: (s: unknown) => unknown) => { const s = { user: { id: 'p1' }, profile: { id: 'p1', role: 'player' } }; return sel ? sel(s) : s } }))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [] }) }))
vi.mock('@/components/safety/useReportAction', () => ({ useReportAction: () => ({ item: { key: 'report' }, sheet: null }) }))

import { OpportunityDetailMobile } from '@/components/opportunities/OpportunityDetailMobile'

describe('Opportunity detail bottom bar', () => {
  const detail = (hasApplied: boolean) => render(
    <MemoryRouter>
      <OpportunityDetailMobile vacancy={vac()} clubName="Bologna" clubLogo={null} clubId="c1" publisherRole="club" countryFlag={null} league={null}
        hasApplied={hasApplied} applicationStatus={hasApplied ? 'pending' : null} canApply isPublisher={false} onApply={() => {}} onMessage={() => {}} />
    </MemoryRouter>,
  )
  it('open: Muted 48 message button + Primary Apply', () => {
    detail(false)
    const msg = screen.getByRole('button', { name: 'Message club' })
    expect(msg).toHaveAttribute('data-variant', 'muted')
    expect(msg).toHaveAttribute('data-size', 'large')
    expect(screen.getByTestId('apply-button').className).toContain('bg-hockia-primary')
    expect(screen.getByText('Compensation not stated')).toBeInTheDocument()
    expect(screen.getByText('Ask the club when you apply')).toBeInTheDocument()
  })
  it('applied: Muted message + Tonal Applied with a check', () => {
    detail(true)
    expect(screen.getByRole('button', { name: 'Message club' })).toBeInTheDocument()
    const applied = screen.getByTestId('applied-state')
    expect(applied.className).toContain('bg-hockia-soft')
    expect(applied).toHaveTextContent('Applied')
  })
})
