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

import { Capacitor } from '@capacitor/core'
import { REDIRECT_INTENT_KEY } from './redirectIntent'
import { isSafeRedirectPath } from './safeRedirect'

export interface InAppBrowserInfo {
  isInAppBrowser: boolean
  browserName: string | null
  canOpenInExternalBrowser: boolean
  suggestedAction: 'open-in-safari' | 'open-in-chrome' | 'copy-link' | null
}

const IN_APP_BROWSER_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /FBAN|FBAV|FB_IAB/i, name: 'Facebook' },
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

  // The Capacitor native shell (iOS/Android) hosts the app inside a WebView
  // whose UA matches our generic "; wv)" / WKWebView signatures — telling the
  // user to "open in a real browser" inside our own app would be nonsense and
  // makes us look unprofessional. Treat native as trusted, same as a PWA.
  if (Capacitor.isNativePlatform()) {
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
 * Whether a given OAuth provider can finish inside the current browser.
 *
 * Google refuses every embedded webview (403 `disallowed_useragent`, policy
 * "Use secure browsers", enforced since Sep 2021), so inside Instagram,
 * Facebook, WhatsApp… the Google round-trip has to happen in the system
 * browser. Apple publishes no such rule: its web redirect flow (the one
 * Supabase uses — full page, no popup) loads in WKWebView and Android WebView;
 * the member just types the Apple Account password because Face ID / the
 * keychain are not available there. Email works everywhere: the client uses
 * the implicit flow, so confirmation links open in any browser.
 *
 * Facebook Login is Meta's own: inside Meta's in-app browsers (Instagram,
 * Facebook, Messenger, WhatsApp) the member is usually already signed in to
 * Facebook, so it finishes in place. Meta stopped supporting Facebook Login
 * in other apps' embedded webviews (Oct 2021), so TikTok, LinkedIn… hand off.
 */
const META_IN_APP = /^(Instagram|Facebook|WhatsApp)$/

export function supportsOAuthProvider(provider: 'apple' | 'google' | 'facebook'): boolean {
  if (provider === 'apple') return true
  if (provider === 'facebook') {
    const info = detectInAppBrowser()
    return !info.isInAppBrowser || META_IN_APP.test(info.browserName ?? '')
  }
  return supportsReliableOAuth()
}

/** Facebook Login switch — on only once the Meta app and the Supabase
 *  provider are configured for this environment. */
export function facebookLoginEnabled(): boolean {
  return (import.meta.env.VITE_ENABLE_FACEBOOK_LOGIN ?? '').toString().toLowerCase() === 'true'
}

export type InAppPlatform = 'ios' | 'android' | 'other'

export function inAppPlatform(): InAppPlatform {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'other'
}

/**
 * Step-by-step for the in-app browser's own "open in browser" menu — the one
 * route that works on every platform. Wording follows what the apps show
 * today (Oct 2026): Instagram and Facebook both call it "Open in external
 * browser" behind the ⋯ / ⋮ menu.
 */
export function getExternalBrowserInstructions(browserName: string | null): string {
  const platform = browserName?.toLowerCase() ?? ''
  const menu = inAppPlatform() === 'android' ? '⋮' : '⋯'

  if (platform.includes('instagram') || platform.includes('facebook')) {
    return `Tap ${menu} at the top right, then “Open in external browser”.`
  }
  if (platform.includes('whatsapp')) {
    return `Tap ${menu} at the top right, then “Open in browser”.`
  }
  if (platform.includes('tiktok')) {
    return 'Tap ⋯ at the top right, then “Open in browser”.'
  }
  if (platform.includes('linkedin')) {
    return `Tap ${menu}, then “Open in browser”.`
  }

  return 'Use the app’s menu to open this page in your browser, or copy the link and paste it into Safari or Chrome.'
}

/**
 * The URL to hand to the system browser: this page, plus the pending
 * destination when it only lives in this webview's sessionStorage (club
 * invites and protected-route bounces stash it there and open /signup with no
 * `?next=`). The new browser has empty storage, so without this the member
 * would sign up and land on the default screen instead of the invite.
 */
export function handoffHref(location: Pick<Location, 'href'> = window.location): string {
  let url: URL
  try {
    url = new URL(location.href)
  } catch {
    return location.href
  }
  if (!url.searchParams.has('next')) {
    let saved: string | null = null
    try {
      saved = sessionStorage.getItem(REDIRECT_INTENT_KEY)
    } catch {
      /* storage blocked */
    }
    if (saved && isSafeRedirectPath(saved) && saved !== url.pathname) url.searchParams.set('next', saved)
  }
  url.hash = ''
  return url.toString()
}

/**
 * Best-effort hand-off of `href` to the system browser. Neither route is
 * documented by Meta, so the caller must keep the menu steps and Copy link
 * on screen whatever happens:
 * - Android: an `intent://` URL (Chrome's documented syntax) asks the OS for
 *   the default browser. Recent Instagram / Facebook builds honour it; some
 *   versions ignore it.
 * - iOS 17+: the `x-safari-https://` scheme opens Safari; community-reported
 *   to work from the Meta apps, not documented by Apple.
 * The fragment is dropped (it would collide with the intent's own `#Intent`).
 */
export function externalBrowserUrl(href: string, platform: InAppPlatform = inAppPlatform()): string | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const rest = `${url.host}${url.pathname}${url.search}`
  if (platform === 'android') return `intent://${rest}#Intent;scheme=https;action=android.intent.action.VIEW;end`
  if (platform === 'ios') return `x-safari-https://${rest}`
  return null
}

/**
 * Attempts to open `href` (default: this page) in the system browser.
 * Returns whether a hand-off was attempted — never proof that it worked.
 */
export function openInExternalBrowser(href?: string): boolean {
  if (typeof window === 'undefined') return false
  href ??= handoffHref()
  const target = externalBrowserUrl(href)
  if (!target) return false
  try {
    window.location.href = target
    return true
  } catch {
    return false
  }
}
