/** The full "onboarding" catalog: import from here to translate onboarding copy. */
import en from '@/locales/en/onboarding.json'
import { registerNamespace } from '@/i18n'

registerNamespace('onboarding', en)

export { tOnboarding, useOnboardingT } from './onboarding.core'
