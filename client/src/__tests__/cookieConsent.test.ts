import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getConsentStatus, hasAnalyticsConsent, enableGA4 } from '@/lib/cookieConsent'

describe('cookieConsent utilities', () => {
  beforeEach(() => {
    localStorage.clear()
    // Clean up any injected gtag scripts
    document.querySelectorAll('script[src*="googletagmanager"]').forEach(s => s.remove())
    // Reset window.gtag
    delete (window as Record<string, unknown>).gtag
    window.dataLayer = undefined
  })

  describe('getConsentStatus', () => {
    it('returns null when no consent stored', () => {
      expect(getConsentStatus()).toBeNull()
    })

    it('returns "accepted" when accepted', () => {
      localStorage.setItem('hockia-cookie-consent', 'accepted')
      expect(getConsentStatus()).toBe('accepted')
    })

    it('returns "declined" when declined', () => {
      localStorage.setItem('hockia-cookie-consent', 'declined')
      expect(getConsentStatus()).toBe('declined')
    })

    it('returns null for invalid stored value', () => {
      localStorage.setItem('hockia-cookie-consent', 'maybe')
      expect(getConsentStatus()).toBeNull()
    })

    it('returns null when localStorage throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      expect(getConsentStatus()).toBeNull()
      vi.restoreAllMocks()
    })
  })

  describe('hasAnalyticsConsent', () => {
    it('returns true when accepted', () => {
      localStorage.setItem('hockia-cookie-consent', 'accepted')
      expect(hasAnalyticsConsent()).toBe(true)
    })

    it('returns false when declined', () => {
      localStorage.setItem('hockia-cookie-consent', 'declined')
      expect(hasAnalyticsConsent()).toBe(false)
    })

    it('returns false when no consent stored', () => {
      expect(hasAnalyticsConsent()).toBe(false)
    })
  })

  describe('enableGA4', () => {
    it('injects gtag script and initializes dataLayer', () => {
      enableGA4()

      const scripts = document.querySelectorAll('script[src*="googletagmanager"]')
      expect(scripts.length).toBe(1)
      expect(scripts[0].getAttribute('src')).toContain('G-')
      expect(window.dataLayer).toBeDefined()
      expect(typeof window.gtag).toBe('function')
    })

    it('does not inject script twice', () => {
      enableGA4()
      enableGA4()

      const scripts = document.querySelectorAll('script[src*="googletagmanager"]')
      expect(scripts.length).toBe(1)
    })
  })
})
