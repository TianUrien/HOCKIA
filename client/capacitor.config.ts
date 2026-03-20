import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.inhockia.app',
  appName: 'HOCKIA',
  webDir: 'dist',
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
