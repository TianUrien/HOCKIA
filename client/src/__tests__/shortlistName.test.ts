import { describe, expect, it } from 'vitest'
import { DEFAULT_SHORTLIST_NAME, shortlistDisplayName } from '@/lib/shortlistName'
import en from '@/locales/en/recruiting.json'
import es from '@/locales/es/recruiting.json'

describe('shortlistDisplayName', () => {
  it('shows the app-made default list from the catalog, so it follows the language', () => {
    expect(shortlistDisplayName({ name: DEFAULT_SHORTLIST_NAME, is_default: true })).toBe(en.shortlistsIndex.defaultName)
    expect(es.shortlistsIndex.defaultName).not.toBe(en.shortlistsIndex.defaultName)
  })

  it('keeps a name the member chose, default list or not', () => {
    expect(shortlistDisplayName({ name: 'U21 keepers', is_default: true })).toBe('U21 keepers')
    expect(shortlistDisplayName({ name: DEFAULT_SHORTLIST_NAME, is_default: false })).toBe(DEFAULT_SHORTLIST_NAME)
  })
})
