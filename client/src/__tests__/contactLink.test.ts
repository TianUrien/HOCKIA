/**
 * Contact-link regression: the "Contact Us" links silently did nothing because the
 * mailto had an UNENCODED space (`subject=HOCKIA enquiry`). Lock the encoded form.
 */
import { describe, it, expect } from 'vitest'
import { CONTACT_MAILTO, SUPPORT_EMAIL } from '@/lib/contact'

describe('contact links', () => {
  it('uses the official HOCKIA support email', () => {
    expect(SUPPORT_EMAIL).toBe('team@inhockia.com')
  })

  it('builds a properly URL-encoded mailto (the bug was a raw space)', () => {
    expect(CONTACT_MAILTO).toBe('mailto:team@inhockia.com?subject=HOCKIA%20enquiry')
    // The broken version contained a literal space, which made the link a no-op:
    expect(CONTACT_MAILTO).not.toContain('HOCKIA enquiry')
    expect(CONTACT_MAILTO).not.toMatch(/\s/) // no whitespace anywhere in the URL
  })
})
