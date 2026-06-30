import { create } from 'zustand'
import { logger } from './logger'

/**
 * Official HOCKIA support / contact address — also used in the Footer, Terms,
 * Privacy Policy, and Settings. (Not `support@…`; `team@inhockia.com` is the real one.)
 */
export const SUPPORT_EMAIL = 'team@inhockia.com'

/**
 * Pre-addressed support email. The subject is URL-ENCODED — an unencoded space
 * (`subject=HOCKIA enquiry`) produces a malformed mailto that some browsers /
 * the iOS WKWebView silently ignore, which is why the earlier links "did nothing".
 */
export const CONTACT_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('HOCKIA enquiry')}`

/**
 * Open the OS mail composer to HOCKIA support. Reliable across web, the installed
 * PWA, and the native iOS/Android WebView: navigating to a `mailto:` is handed to
 * the system mail app (Capacitor delegates non-http schemes to the OS). Driving it
 * via JS (not just the <a> default) avoids any attribute-encoding or
 * close-the-menu-on-click race that can swallow the navigation.
 */
export function openSupportEmail(): void {
  try {
    window.location.href = CONTACT_MAILTO
  } catch (err) {
    logger.warn('[CONTACT] Failed to open mail composer', err)
  }
}

/**
 * Copy the support address to the clipboard. Works on every platform (unlike
 * `mailto:`, which on desktop browsers needs a registered mail handler or it
 * silently no-ops). Returns true on success so the UI can show "Copied!".
 */
export async function copySupportEmail(): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(SUPPORT_EMAIL)
      return true
    }
  } catch (err) {
    logger.warn('[CONTACT] Clipboard copy failed', err)
  }
  // Legacy fallback for browsers without the async Clipboard API.
  try {
    const el = document.createElement('textarea')
    el.value = SUPPORT_EMAIL
    el.setAttribute('readonly', '')
    el.style.position = 'absolute'
    el.style.left = '-9999px'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch (err) {
    logger.warn('[CONTACT] Legacy clipboard copy failed', err)
    return false
  }
}

/**
 * Lightweight global state for the Contact modal. The "Contact Us" entries on the
 * logged-out landing (hamburger + hero) just call `open()`; the modal itself is
 * mounted once at the app root so a single instance serves every trigger.
 */
interface ContactModalState {
  isOpen: boolean
  open: () => void
  close: () => void
}

export const useContactModal = create<ContactModalState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}))
