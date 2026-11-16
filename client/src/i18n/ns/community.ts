/** The "community" catalog: import from here to translate community copy.
 * Nothing runs at import: the catalog is added the first time `tCommunity` or
 * `useCommunityT` is used (see ensureNamespace in i18n/index.ts).
 */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/community.json'
import { ensureNamespace, lazyFixedT } from '@/i18n'

/** For plain functions (lib helpers). Follows the active language. */
export const tCommunity = /* @__PURE__ */ lazyFixedT('community', en)

/** For components: re-renders when the language changes. */
export function useCommunityT() {
  ensureNamespace('community', en)
  return useTranslation('community').t
}
