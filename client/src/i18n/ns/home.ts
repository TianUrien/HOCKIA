/** The "home" catalog: import from here to translate home copy. */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/home.json'
import i18n, { registerNamespace } from '@/i18n'

registerNamespace('home', en)

/** For plain functions (lib helpers). Follows the active language. */
export const tHome = i18n.getFixedT(null, 'home')

/** For components: re-renders when the language changes. */
export function useHomeT() {
  return useTranslation('home').t
}
