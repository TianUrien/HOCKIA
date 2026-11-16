/** The "enums" catalog: import from here to translate enums copy.
 * Nothing runs at import: the catalog is added the first time `tEnums` or
 * `useEnumsT` is used (see ensureNamespace in i18n/index.ts).
 */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/enums.json'
import i18n, { ensureNamespace, lazyFixedT } from '@/i18n'

/** For plain functions (lib helpers). Follows the active language. */
export const tEnums = /* @__PURE__ */ lazyFixedT('enums', en)

/** For components: re-renders when the language changes. */
export function useEnumsT() {
  ensureNamespace('enums', en)
  return useTranslation('enums').t
}

/** Whether the catalog has a label for this key (adds the catalog first). */
export function hasEnumsKey(key: string): boolean {
  ensureNamespace('enums', en)
  return i18n.exists(key, { ns: 'enums' })
}
