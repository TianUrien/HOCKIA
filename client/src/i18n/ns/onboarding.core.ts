/** The start-up part of the "onboarding" catalog (locales/en/onboarding.core.json).
 * Start-up files import from here so the rest of the catalog stays in the
 * lazy screens' chunks; everything else imports '@/i18n/ns/onboarding'. A key used
 * by a start-up file must live in the core file: scripts/check-locales.mjs
 * enforces it.
 * Nothing runs at import: the catalog is added the first time `tOnboarding` or
 * `useOnboardingT` is used (see ensureNamespace in i18n/index.ts).
 */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/onboarding.core.json'
import { ensureNamespace, lazyFixedT } from '@/i18n'

/** For plain functions (lib helpers). Follows the active language. */
export const tOnboarding = /* @__PURE__ */ lazyFixedT('onboarding', en)

/** For components: re-renders when the language changes. */
export function useOnboardingT() {
  ensureNamespace('onboarding', en)
  return useTranslation('onboarding').t
}
