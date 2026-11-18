/** The full "onboarding" catalog (core and rest): import from here to translate onboarding copy.
 * Nothing runs at import: the catalog is added the first time `tOnboarding` or
 * `useOnboardingT` is used (see ensureNamespace in i18n/index.ts).
 */
import { useTranslation } from 'react-i18next'
import core from '@/locales/en/onboarding.core.json'
import en from '@/locales/en/onboarding.json'
import { ensureNamespace, lazyFixedT } from '@/i18n'

/** For plain functions (lib helpers). Follows the active language. */
export const tOnboarding = /* @__PURE__ */ lazyFixedT('onboarding', core, en)

/** For components: re-renders when the language changes. */
export function useOnboardingT() {
  ensureNamespace('onboarding', core, en)
  return useTranslation('onboarding').t
}
