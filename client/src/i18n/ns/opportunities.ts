/** The "opportunities" catalog: import from here to translate opportunities copy. */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/opportunities.json'
import i18n, { registerNamespace } from '@/i18n'

registerNamespace('opportunities', en)

/** For plain functions (lib helpers). Follows the active language. */
export const tOpportunities = i18n.getFixedT(null, 'opportunities')

/** For components: re-renders when the language changes. */
export function useOpportunitiesT() {
  return useTranslation('opportunities').t
}
