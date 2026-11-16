/** The full "home" catalog (core and rest): import from here to translate home copy.
 * Nothing runs at import: the catalog is added the first time `tHome` or
 * `useHomeT` is used (see ensureNamespace in i18n/index.ts).
 */
import { useTranslation } from 'react-i18next'
import core from '@/locales/en/home.core.json'
import en from '@/locales/en/home.json'
import { ensureNamespace, lazyFixedT } from '@/i18n'

/** For plain functions (lib helpers). Follows the active language. */
export const tHome = /* @__PURE__ */ lazyFixedT('home', core, en)

/** For components: re-renders when the language changes. */
export function useHomeT() {
  ensureNamespace('home', core, en)
  return useTranslation('home').t
}
