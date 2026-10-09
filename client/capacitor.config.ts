import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.inhockia.app',
  appName: 'HOCKIA',
  webDir: 'dist',
  // Capacitor's default WebView origin on Android is https://localhost.
  // Google Places (and any other HTTP-referrer-restricted API key) rejects
  // that origin because it isn't in our *.inhockia.com allowlist. Setting a
  // custom hostname makes the WebView serve from https://app.inhockia.com
  // (intercepted locally by Capacitor — never actually resolved by DNS), so
  // the Referer header matches the existing allowlist. Cloud Console must
  // also include https://app.inhockia.com/* in the Places key's allowed
  // referrers — without that, this change does nothing.
  android: {
    hostname: 'app.inhockia.com',
    // WebView canvas before the first web paint = the launch artwork's bottom
    // colour, so the hand-off from the native splash can never flash white.
    // Once the page paints, html/body (white in the app) cover it.
    backgroundColor: '#7b39ec',
  },
  ios: {
    scheme: 'HOCKIA',
    // Mirror the android.hostname above so the iOS WKWebView serves from
    // https://app.inhockia.com instead of the default https://localhost.
    // Without this, the Places API key (HTTP-referrer restricted to
    // *.inhockia.com) would reject every autocomplete request from iOS
    // — same Vincent-style symptom we hit on Android. iOS isn't live yet,
    // so there are no installed users to silently sign out.
    hostname: 'app.inhockia.com',
    contentInset: 'automatic',
    // WKWebView + scroll-view colour before the first web paint. Was #ffffff,
    // which is what showed in the home-indicator band under the launch
    // artwork. Now the artwork's bottom colour (#7b39ec, its last pixel row).
    // After the page paints, WebKit repaints the scroll view with the
    // document's own background (white in the app; violet while the in-app
    // splash holds the launch canvas — src/lib/launchSplash.ts).
    backgroundColor: '#7b39ec',
    preferredContentMode: 'mobile',
  },
  plugins: {
    SplashScreen: {
      // The native launch artwork (01-E · Violet editorial) stays up until the
      // web app reports its first frame is painted (src/lib/launchSplash.ts) —
      // no fixed duration, no artificial delay, and the in-app splash is the
      // same artwork so the hand-off is invisible.
      launchAutoHide: false,
      launchFadeOutDuration: 0,
      backgroundColor: '#5929a8',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
}

export default config
