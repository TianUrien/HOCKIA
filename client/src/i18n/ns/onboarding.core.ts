/**
 * The part of the "onboarding" catalog that code loaded at start-up needs
 * (locales/en/onboarding.core.json). Start-up files import from here so the rest
 * of the catalog stays in the lazy screens' chunks; everything else imports
 * '@/i18n/ns/onboarding'. A key used by a start-up file must live in the core
 * file: scripts/check-locales.mjs enforces it.
 */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/onboarding.core.json'
import i18n, { registerNamespace } from '@/i18n'

registerNamespace('onboarding', en)

/** For plain functions (lib helpers). Follows the active language. */
export const tOnboarding = i18n.getFixedT(null, 'onboarding')

/** For components: re-renders when the language changes. */
export function useOnboardingT() {
  return useTranslation('onboarding').t
}
