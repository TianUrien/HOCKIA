import { describe, it, expect, vi } from 'vitest'
import { getActiveFilterChips } from '@/lib/communityActiveFilters'
import { defaultFilters } from '@/components/community/communityFilters'

const COUNTRIES = [
  { id: 46, name: 'United Kingdom' },
  { id: 11, name: 'Argentina' },
]
const noop = () => {}

describe('getActiveFilterChips', () => {
  it('returns no chips for the default (unfiltered) state', () => {
    expect(getActiveFilterChips(defaultFilters('all'), COUNTRIES, noop)).toEqual([])
  })

  it('never includes the role/member-type as a chip (the chip row already shows it)', () => {
    const chips = getActiveFilterChips(defaultFilters('coach'), COUNTRIES, noop)
    expect(chips).toEqual([])
  })

  it('emits one removable chip per multi-select value', () => {
    const filters = { ...defaultFilters('player'), position: ['goalkeeper', 'forward'] }
    const chips = getActiveFilterChips(filters, COUNTRIES, noop)
    expect(chips.map((c) => c.label)).toEqual(['Goalkeeper', 'Forward'])
  })

  it('resolves nationality/location country ids to names', () => {
    const filters = { ...defaultFilters('player'), nationalityCountryIds: [11], locationCountryIds: [46] }
    const chips = getActiveFilterChips(filters, COUNTRIES, noop)
    expect(chips.map((c) => c.label).sort()).toEqual(['Argentina', 'United Kingdom'])
  })

  it('emits chips for EU, availability (role-aware), city text, and brand category', () => {
    const filters = { ...defaultFilters('player'), euOnly: true, availability: 'open' as const, location: 'London' }
    const labels = getActiveFilterChips(filters, COUNTRIES, noop).map((c) => c.label)
    expect(labels).toContain('EU-eligible')
    expect(labels).toContain('Open to play') // role-aware availability label for players
    expect(labels).toContain('London')
  })

  it('onRemove removes exactly the targeted value, leaving the rest', () => {
    const update = vi.fn()
    const filters = { ...defaultFilters('player'), position: ['goalkeeper', 'forward'] }
    const chips = getActiveFilterChips(filters, COUNTRIES, update)
    chips.find((c) => c.label === 'Goalkeeper')!.onRemove()
    expect(update).toHaveBeenCalledWith('position', ['forward'])
  })

  it('emits a removable "Has video" chip and clears it on remove', () => {
    const update = vi.fn()
    const filters = { ...defaultFilters('player'), hasVideo: true }
    const chips = getActiveFilterChips(filters, COUNTRIES, update)
    const chip = chips.find((c) => c.id === 'hasVideo')!
    expect(chip.label).toBe('Has video')
    chip.onRemove()
    expect(update).toHaveBeenCalledWith('hasVideo', false)
  })

  it('emits a removable "Enough evidence+" chip and clears it on remove', () => {
    const update = vi.fn()
    const filters = { ...defaultFilters('player'), evidenceEnoughOnly: true }
    const chip = getActiveFilterChips(filters, COUNTRIES, update).find((c) => c.id === 'evidence')!
    expect(chip.label).toBe('Enough evidence+')
    chip.onRemove()
    expect(update).toHaveBeenCalledWith('evidenceEnoughOnly', false)
  })

  it('onRemove resets a scalar facet to its default', () => {
    const update = vi.fn()
    const filters = { ...defaultFilters('player'), euOnly: true }
    getActiveFilterChips(filters, COUNTRIES, update).find((c) => c.id === 'eu')!.onRemove()
    expect(update).toHaveBeenCalledWith('euOnly', false)
  })
})
