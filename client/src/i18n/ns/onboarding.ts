/** The "onboarding" catalog: import from here to translate onboarding copy. */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/onboarding.json'
import i18n, { registerNamespace } from '@/i18n'

registerNamespace('onboarding', en)

/** For plain functions (lib helpers). Follows the active language. */
export const tOnboarding = i18n.getFixedT(null, 'onboarding')

/** For components: re-renders when the language changes. */
export function useOnboardingT() {
  return useTranslation('onboarding').t
}
