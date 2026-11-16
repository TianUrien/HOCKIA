import 'i18next'
import type common from '@/locales/en/common.json'
import type auth from '@/locales/en/auth.json'
import type onboarding from '@/locales/en/onboarding.json'
import type home from '@/locales/en/home.json'
import type opportunities from '@/locales/en/opportunities.json'
import type settings from '@/locales/en/settings.json'
import type enums from '@/locales/en/enums.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    returnNull: false
    resources: {
      common: typeof common
      auth: typeof auth
      onboarding: typeof onboarding
      home: typeof home
      opportunities: typeof opportunities
      settings: typeof settings
      enums: typeof enums
    }
  }
}
