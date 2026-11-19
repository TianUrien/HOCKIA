/**
 * A club's decline note in the reader's language (founder decision 2026-11-19):
 * the translation first, the club's own words always visible below it.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import i18n from '@/i18n'
import { clubNoteFromFeedback, clubNoteOriginalFromFeedback } from '@/lib/opportunityCopy'
import { ClubNoteOriginal } from '@/components/opportunities/ClubNoteOriginal'

const NOTE = { message: 'Hi Ana, we went another way.', status: 'rejected', reason: 'timing', source: 'club' }
const TRANSLATED = { ...NOTE, translations: { es: 'Hola, Ana. Elegimos otra opción.', en: null } }

afterEach(async () => { await i18n.changeLanguage('en') })

describe('club note translation', () => {
  it('shows the note as written when no translation is stored', () => {
    expect(clubNoteFromFeedback(NOTE, 'rejected')).toBe(NOTE.message)
    expect(clubNoteOriginalFromFeedback(NOTE, 'rejected')).toBeNull()
  })

  it('an English reader sees the original; "same language" is not a translation', () => {
    expect(clubNoteFromFeedback(TRANSLATED, 'rejected')).toBe(NOTE.message)
    expect(clubNoteOriginalFromFeedback(TRANSLATED, 'rejected')).toBeNull()
  })

  it('a Spanish reader sees the translation, with the original kept', async () => {
    await i18n.changeLanguage('es')
    expect(clubNoteFromFeedback(TRANSLATED, 'rejected')).toBe('Hola, Ana. Elegimos otra opción.')
    expect(clubNoteOriginalFromFeedback(TRANSLATED, 'rejected')).toBe(NOTE.message)
  })

  it('never treats an AI explanation or another status as a club note', async () => {
    await i18n.changeLanguage('es')
    expect(clubNoteFromFeedback({ ...TRANSLATED, source: 'ai' }, 'rejected')).toBeNull()
    expect(clubNoteFromFeedback(TRANSLATED, 'shortlisted')).toBeNull()
    expect(clubNoteOriginalFromFeedback(TRANSLATED, 'shortlisted')).toBeNull()
  })

  it('renders the original under the note, and nothing when there is none', () => {
    const { container, rerender } = render(<ClubNoteOriginal original={null} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<ClubNoteOriginal original={NOTE.message} />)
    expect(screen.getByTestId('club-note-original')).toHaveTextContent('Translated automatically. Original note: Hi Ana, we went another way.')
  })
})
