/**
 * Detect the user's platform from the browser user agent.
 */
export function detectPlatform(): 'ios' | 'android' | 'desktop' {
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}
