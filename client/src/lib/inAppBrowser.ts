/**
 * In-App Browser Detection
 * 
 * Detects when users are viewing HOCKIA in restricted browser environments
 * like Instagram, Facebook, WhatsApp, TikTok, Snapchat, Line, etc.
 * 
 * These browsers have limitations:
 * - OAuth popups may be blocked
 * - localStorage/sessionStorage may not persist
 * - Verification email links may open in a different browser
 * - Cookies may be restricted
 */

export interface InAppBrowserInfo {
  isInAppBrowser: boolean
  browserName: string | null
  canOpenInExternalBrowser: boolean
  suggestedAction: 'open-in-safari' | 'open-in-chrome' | 'copy-link' | null
}

const IN_APP_BROWSER_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /FBAN|FBAV/i, name: 'Facebook' },
  { pattern: /Instagram/i, name: 'Instagram' },
  { pattern: /\bLine\b/i, name: 'LINE' },
  { pattern: /\bSnapchat\b/i, name: 'Snapchat' },
  { pattern: /\bTwitter\b/i, name: 'Twitter/X' },
  { pattern: /\bLinkedIn\b/i, name: 'LinkedIn' },
  { pattern: /\bPinterest\b/i, name: 'Pinterest' },
  { pattern: /\bTikTok\b/i, name: 'TikTok' },
  { pattern: /\bWeChat\b|MicroMessenger/i, name: 'WeChat' },
  { pattern: /\bWhatsApp\b/i, name: 'WhatsApp' },
  { pattern: /\bTelegram\b/i, name: 'Telegram' },
  { pattern: /\bDiscord\b/i, name: 'Discord' },
  { pattern: /\bSlack\b/i, name: 'Slack' },
  // Generic WebView detection (Android)
  { pattern: /; wv\)/i, name: 'WebView' },
  // iOS WebView detection (WKWebView often has no Safari in UA).
  // The parens around (iPhone|iPad|iPod) are load-bearing: without them the
  // `|` alternation has lower precedence than the following `.*AppleWebKit`,
  // so the negative-lookahead for Safari would only guard the `iPod` branch
  // and EVERY iOS browser (Safari included) would falsely register as a
  // WebView. Verified against 17 UAs before this fix.
  { pattern: /(iPhone|iPad|iPod).*AppleWebKit(?!.*Safari)/i, name: 'iOS WebView' },
]

/**
 * Detects if the current browser is an in-app browser (WebView)
 */
export function detectInAppBrowser(): InAppBrowserInfo {
  if (typeof window === 'undefined' || !navigator?.userAgent) {
    return {
      isInAppBrowser: false,
      browserName: null,
      canOpenInExternalBrowser: false,
      suggestedAction: null,
    }
  }

  // PWA standalone mode is NOT an in-app browser - it's a trusted environment
  const isStandalonePWA = 
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true

  if (isStandalonePWA) {
    return {
      isInAppBrowser: false,
      browserName: null,
      canOpenInExternalBrowser: false,
      suggestedAction: null,
    }
  }

  const ua = navigator.userAgent

  for (const { pattern, name } of IN_APP_BROWSER_PATTERNS) {
    if (pattern.test(ua)) {
      const isIOS = /iPad|iPhone|iPod/.test(ua)
      const isAndroid = /Android/i.test(ua)

      return {
        isInAppBrowser: true,
        browserName: name,
        canOpenInExternalBrowser: true,
        suggestedAction: isIOS ? 'open-in-safari' : isAndroid ? 'open-in-chrome' : 'copy-link',
      }
    }
  }

  return {
    isInAppBrowser: false,
    browserName: null,
    canOpenInExternalBrowser: false,
    suggestedAction: null,
  }
}

/**
 * Checks if the browser supports reliable OAuth (popups, redirects)
 */
export function supportsReliableOAuth(): boolean {
  // Native apps use SFSafariViewController/Chrome Custom Tabs — always reliable
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cap = (window as any)?.Capacitor
    if (cap?.isNativePlatform?.()) return true
  } catch { /* fall through */ }
  const info = detectInAppBrowser()
  return !info.isInAppBrowser
}

/**
 * Generates instructions for opening in external browser based on platform
 */
export function getExternalBrowserInstructions(browserName: string | null): string {
  const platform = browserName?.toLowerCase() ?? ''

  if (platform.includes('instagram')) {
    return 'Tap the ⋯ menu in the top right corner, then select "Open in Safari" or "Open in Browser".'
  }
  if (platform.includes('facebook')) {
    return 'Tap the ⋯ menu, then select "Open in Safari" or "Open in external browser".'
  }
  if (platform.includes('whatsapp')) {
    return 'Tap the ⋯ menu in the top right, then select "Open in Safari" or copy the link to your browser.'
  }
  if (platform.includes('tiktok')) {
    return 'Tap the Share icon, then select "Copy link" and paste it in Safari or Chrome.'
  }
  if (platform.includes('twitter') || platform.includes('x')) {
    return 'Tap the Share icon, then select "Open in Safari" or copy the link.'
  }
  if (platform.includes('linkedin')) {
    return 'Tap the ⋯ menu, then select "Open in browser".'
  }

  // Generic fallback
  return 'Look for a menu option to "Open in Safari", "Open in browser", or copy the link and paste it in your browser.'
}

/**
 * Attempts to open the current URL in the system browser
 * Returns true if successful (or attempted), false if not possible
 */
export function openInExternalBrowser(): boolean {
  if (typeof window === 'undefined') return false

  const url = window.location.href

  // Try intent URL for Android (opens in default browser)
  const isAndroid = /Android/i.test(navigator.userAgent)
  if (isAndroid) {
    try {
      // Android intent to open in browser
      window.location.href = `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=https;action=android.intent.action.VIEW;end`
      return true
    } catch {
      // Fallback: just try to copy URL
      return false
    }
  }

  // For iOS, there's no reliable programmatic way to escape the WebView
  // Best we can do is guide the user
  return false
}
