/** The "world" catalog: import from here to translate world copy.
 * Nothing runs at import: the catalog is added the first time `tWorld` or
 * `useWorldT` is used (see ensureNamespace in i18n/index.ts).
 */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/world.json'
import { ensureNamespace, lazyFixedT } from '@/i18n'

/** For plain functions (lib helpers). Follows the active language. */
export const tWorld = /* @__PURE__ */ lazyFixedT('world', en)

/** For components: re-renders when the language changes. */
export function useWorldT() {
  ensureNamespace('world', en)
  return useTranslation('world').t
}
