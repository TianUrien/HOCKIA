/** The "recruiting" catalog: import from here to translate recruiting copy.
 * Nothing runs at import: the catalog is added the first time `tRecruiting` or
 * `useRecruitingT` is used (see ensureNamespace in i18n/index.ts).
 */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/recruiting.json'
import { ensureNamespace, lazyFixedT } from '@/i18n'

/** For plain functions (lib helpers). Follows the active language. */
export const tRecruiting = /* @__PURE__ */ lazyFixedT('recruiting', en)

/** For components: re-renders when the language changes. */
export function useRecruitingT() {
  ensureNamespace('recruiting', en)
  return useTranslation('recruiting').t
}
