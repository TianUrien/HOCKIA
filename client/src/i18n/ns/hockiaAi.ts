/** The "hockiaAi" catalog: import from here to translate hockiaAi copy.
 * Nothing runs at import: the catalog is added the first time `tHockiaAi` or
 * `useHockiaAiT` is used (see ensureNamespace in i18n/index.ts).
 */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/hockiaAi.json'
import { ensureNamespace, lazyFixedT } from '@/i18n'

/** For plain functions (lib helpers). Follows the active language. */
export const tHockiaAi = /* @__PURE__ */ lazyFixedT('hockiaAi', en)

/** For components: re-renders when the language changes. */
export function useHockiaAiT() {
  ensureNamespace('hockiaAi', en)
  return useTranslation('hockiaAi').t
}
