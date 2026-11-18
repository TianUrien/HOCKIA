/** The "profileEdit" catalog: import from here to translate profileEdit copy.
 * Nothing runs at import: the catalog is added the first time `tProfileEdit` or
 * `useProfileEditT` is used (see ensureNamespace in i18n/index.ts).
 */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/profileEdit.json'
import { ensureNamespace, lazyFixedT } from '@/i18n'

/** For plain functions (lib helpers). Follows the active language. */
export const tProfileEdit = /* @__PURE__ */ lazyFixedT('profileEdit', en)

/** For components: re-renders when the language changes. */
export function useProfileEditT() {
  ensureNamespace('profileEdit', en)
  return useTranslation('profileEdit').t
}
