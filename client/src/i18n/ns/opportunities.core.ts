/**
 * The part of the "opportunities" catalog that code loaded at start-up needs
 * (locales/en/opportunities.core.json). Start-up files import from here so the rest
 * of the catalog stays in the lazy screens' chunks; everything else imports
 * '@/i18n/ns/opportunities'. A key used by a start-up file must live in the core
 * file: scripts/check-locales.mjs enforces it.
 */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/opportunities.core.json'
import i18n, { registerNamespace } from '@/i18n'

registerNamespace('opportunities', en)

/** For plain functions (lib helpers). Follows the active language. */
export const tOpportunities = i18n.getFixedT(null, 'opportunities')

/** For components: re-renders when the language changes. */
export function useOpportunitiesT() {
  return useTranslation('opportunities').t
}
