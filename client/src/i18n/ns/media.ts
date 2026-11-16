/** The "media" catalog: import from here to translate media copy.
 * Nothing runs at import: the catalog is added the first time `tMedia` or
 * `useMediaT` is used (see ensureNamespace in i18n/index.ts).
 */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/media.json'
import { ensureNamespace, lazyFixedT } from '@/i18n'

/** For plain functions (lib helpers). Follows the active language. */
export const tMedia = /* @__PURE__ */ lazyFixedT('media', en)

/** For components: re-renders when the language changes. */
export function useMediaT() {
  ensureNamespace('media', en)
  return useTranslation('media').t
}
