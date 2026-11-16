/** The "brands" catalog: import from here to translate brands copy.
 * Nothing runs at import: the catalog is added the first time `tBrands` or
 * `useBrandsT` is used (see ensureNamespace in i18n/index.ts).
 */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/brands.json'
import { ensureNamespace, lazyFixedT } from '@/i18n'

/** For plain functions (lib helpers). Follows the active language. */
export const tBrands = /* @__PURE__ */ lazyFixedT('brands', en)

/** For components: re-renders when the language changes. */
export function useBrandsT() {
  ensureNamespace('brands', en)
  return useTranslation('brands').t
}
