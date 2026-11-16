/** The "auth" catalog: import from here to translate auth copy.
 * Nothing runs at import: the catalog is added the first time `tAuth` or
 * `useAuthT` is used (see ensureNamespace in i18n/index.ts).
 */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/auth.json'
import { ensureNamespace, lazyFixedT } from '@/i18n'

/** For plain functions (lib helpers). Follows the active language. */
export const tAuth = /* @__PURE__ */ lazyFixedT('auth', en)

/** For components: re-renders when the language changes. */
export function useAuthT() {
  ensureNamespace('auth', en)
  return useTranslation('auth').t
}
