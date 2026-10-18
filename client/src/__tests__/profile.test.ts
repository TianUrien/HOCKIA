import { describe, expect, it } from 'vitest'
import { derivePublicContactEmail, getFirstName } from '@/lib/profileHelpers'

describe('getFirstName', () => {
  it('returns the first whitespace-delimited token of a normal name', () => {
    expect(getFirstName('Alex Rivera')).toBe('Alex')
  })

  it('returns just the name when no surname is present', () => {
    expect(getFirstName('Madonna')).toBe('Madonna')
  })

  it('returns null for null input', () => {
    expect(getFirstName(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(getFirstName(undefined)).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(getFirstName('')).toBeNull()
  })

  it('returns null for whitespace-only input', () => {
    expect(getFirstName('   ')).toBeNull()
    expect(getFirstName('\t\n  ')).toBeNull()
  })

  it('trims surrounding whitespace before splitting', () => {
    expect(getFirstName('   Alex Rivera   ')).toBe('Alex')
  })

  it('collapses repeated internal whitespace via the regex split', () => {
    expect(getFirstName('Alex   Sam   Rivera')).toBe('Alex')
  })

  it('treats tabs and newlines as whitespace separators', () => {
    expect(getFirstName('Alex\tRivera')).toBe('Alex')
    expect(getFirstName('Alex\nRivera')).toBe('Alex')
  })
})

describe('derivePublicContactEmail', () => {
  it('hides the contact when contact_email_public is false', () => {
    expect(
      derivePublicContactEmail({
        contact_email: 'me@example.com',
        contact_email_public: false,
      }),
    ).toEqual({ shouldShow: false, displayEmail: null, source: null })
  })

  it('hides the contact when contact_email_public is null/undefined', () => {
    expect(
      derivePublicContactEmail({
        contact_email: 'me@example.com',
      }),
    ).toEqual({ shouldShow: false, displayEmail: null, source: null })
  })

  it('shows the contact email when set and explicitly public', () => {
    expect(
      derivePublicContactEmail({
        contact_email: 'me@example.com',
        contact_email_public: true,
      }),
    ).toEqual({ shouldShow: true, displayEmail: 'me@example.com', source: 'contact' })
  })

  it('trims whitespace around the contact email', () => {
    expect(
      derivePublicContactEmail({
        contact_email: '  me@example.com  ',
        contact_email_public: true,
      }),
    ).toEqual({ shouldShow: true, displayEmail: 'me@example.com', source: 'contact' })
  })

  it('treats whitespace-only contact_email as missing', () => {
    expect(
      derivePublicContactEmail({
        contact_email: '   ',
        contact_email_public: true,
      }),
    ).toEqual({ shouldShow: true, displayEmail: null, source: null })
  })

  it('never falls back to the account email even when contact_email is missing', () => {
    expect(
      derivePublicContactEmail({
        email: 'login@example.com',
        contact_email: null,
        contact_email_public: true,
      }),
    ).toEqual({ shouldShow: true, displayEmail: null, source: null })
  })

  it('treats undefined contact_email as missing (does not crash)', () => {
    expect(
      derivePublicContactEmail({
        contact_email_public: true,
      }),
    ).toEqual({ shouldShow: true, displayEmail: null, source: null })
  })
})
