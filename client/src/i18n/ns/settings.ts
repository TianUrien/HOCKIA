/** The "settings" catalog: import from here to translate settings copy.
 * Nothing runs at import: the catalog is added the first time `tSettings` or
 * `useSettingsT` is used (see ensureNamespace in i18n/index.ts).
 */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/settings.json'
import { ensureNamespace, lazyFixedT } from '@/i18n'

/** For plain functions (lib helpers). Follows the active language. */
export const tSettings = /* @__PURE__ */ lazyFixedT('settings', en)

/** For components: re-renders when the language changes. */
export function useSettingsT() {
  ensureNamespace('settings', en)
  return useTranslation('settings').t
}
