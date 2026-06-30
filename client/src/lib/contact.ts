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
