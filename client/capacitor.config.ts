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
    backgroundColor: '#ffffff',
    preferredContentMode: 'mobile',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      backgroundColor: '#ffffff',
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
}

export default config
