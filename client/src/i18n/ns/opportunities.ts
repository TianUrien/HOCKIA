/** The full "opportunities" catalog (core and rest): import from here to translate opportunities copy.
 * Nothing runs at import: the catalog is added the first time `tOpportunities` or
 * `useOpportunitiesT` is used (see ensureNamespace in i18n/index.ts).
 */
import { useTranslation } from 'react-i18next'
import core from '@/locales/en/opportunities.core.json'
import en from '@/locales/en/opportunities.json'
import { ensureNamespace, lazyFixedT } from '@/i18n'

/** For plain functions (lib helpers). Follows the active language. */
export const tOpportunities = /* @__PURE__ */ lazyFixedT('opportunities', core, en)

/** For components: re-renders when the language changes. */
export function useOpportunitiesT() {
  ensureNamespace('opportunities', core, en)
  return useTranslation('opportunities').t
}
