/** The "settings" catalog: import from here to translate settings copy. */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/settings.json'
import i18n, { registerNamespace } from '@/i18n'

registerNamespace('settings', en)

/** For plain functions (lib helpers). Follows the active language. */
export const tSettings = i18n.getFixedT(null, 'settings')

/** For components: re-renders when the language changes. */
export function useSettingsT() {
  return useTranslation('settings').t
}
