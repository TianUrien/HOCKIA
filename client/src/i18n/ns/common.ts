/** The "common" catalog (shell, navigation, shared buttons and errors). */
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'

/** For plain functions (lib helpers). Follows the active language. */
export const tCommon = i18n.getFixedT(null, 'common')

/** For components: re-renders when the language changes. */
export function useCommonT() {
  return useTranslation('common').t
}
