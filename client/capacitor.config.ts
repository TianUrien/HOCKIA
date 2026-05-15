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
