/** The "enums" catalog: import from here to translate enums copy. */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/enums.json'
import i18n, { registerNamespace } from '@/i18n'

registerNamespace('enums', en)

/** For plain functions (lib helpers). Follows the active language. */
export const tEnums = i18n.getFixedT(null, 'enums')

/** For components: re-renders when the language changes. */
export function useEnumsT() {
  return useTranslation('enums').t
}
