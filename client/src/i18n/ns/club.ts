/** The "club" catalog: import from here to translate club copy.
 * Nothing runs at import: the catalog is added the first time `tClub` or
 * `useClubT` is used (see ensureNamespace in i18n/index.ts).
 */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/club.json'
import { ensureNamespace, lazyFixedT } from '@/i18n'

/** For plain functions (lib helpers). Follows the active language. */
export const tClub = /* @__PURE__ */ lazyFixedT('club', en)

/** For components: re-renders when the language changes. */
export function useClubT() {
  ensureNamespace('club', en)
  return useTranslation('club').t
}
