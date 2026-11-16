/** The "profile" catalog: import from here to translate profile copy.
 * Nothing runs at import: the catalog is added the first time `tProfile` or
 * `useProfileT` is used (see ensureNamespace in i18n/index.ts).
 */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/profile.json'
import { ensureNamespace, lazyFixedT } from '@/i18n'

/** For plain functions (lib helpers). Follows the active language. */
export const tProfile = /* @__PURE__ */ lazyFixedT('profile', en)

/** For components: re-renders when the language changes. */
export function useProfileT() {
  ensureNamespace('profile', en)
  return useTranslation('profile').t
}
