/** The "auth" catalog: import from here to translate auth copy. */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/auth.json'
import i18n, { registerNamespace } from '@/i18n'

registerNamespace('auth', en)

/** For plain functions (lib helpers). Follows the active language. */
export const tAuth = i18n.getFixedT(null, 'auth')

/** For components: re-renders when the language changes. */
export function useAuthT() {
  return useTranslation('auth').t
}
