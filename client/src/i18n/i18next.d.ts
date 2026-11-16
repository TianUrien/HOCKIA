import 'i18next'
import type common from '@/locales/en/common.json'
import type auth from '@/locales/en/auth.json'
import type onboarding from '@/locales/en/onboarding.json'
import type onboardingCore from '@/locales/en/onboarding.core.json'
import type home from '@/locales/en/home.json'
import type homeCore from '@/locales/en/home.core.json'
import type opportunities from '@/locales/en/opportunities.json'
import type opportunitiesCore from '@/locales/en/opportunities.core.json'
import type settings from '@/locales/en/settings.json'
import type enums from '@/locales/en/enums.json'
import type profile from '@/locales/en/profile.json'
import type profileEdit from '@/locales/en/profileEdit.json'
import type media from '@/locales/en/media.json'
import type community from '@/locales/en/community.json'
import type inbox from '@/locales/en/inbox.json'
import type notifications from '@/locales/en/notifications.json'
import type world from '@/locales/en/world.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    returnNull: false
    resources: {
      common: typeof common
      auth: typeof auth
      onboarding: typeof onboarding & typeof onboardingCore
      home: typeof home & typeof homeCore
      opportunities: typeof opportunities & typeof opportunitiesCore
      settings: typeof settings
      enums: typeof enums
      profile: typeof profile
      profileEdit: typeof profileEdit
      media: typeof media
      community: typeof community
      inbox: typeof inbox
      notifications: typeof notifications
      world: typeof world
    }
  }
}
