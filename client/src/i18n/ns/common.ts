/** The "common" catalog: import from here to translate common copy.
 * Nothing runs at import: the catalog is added the first time `tCommon` or
 * `useCommonT` is used (see ensureNamespace in i18n/index.ts).
 */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/common.json'
import { ensureNamespace, lazyFixedT } from '@/i18n'

/** For plain functions (lib helpers). Follows the active language. */
export const tCommon = /* @__PURE__ */ lazyFixedT('common', en)

/** For components: re-renders when the language changes. */
export function useCommonT() {
  ensureNamespace('common', en)
  return useTranslation('common').t
}
