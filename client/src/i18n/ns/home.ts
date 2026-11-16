/** The full "home" catalog: import from here to translate home copy. */
import en from '@/locales/en/home.json'
import { registerNamespace } from '@/i18n'

registerNamespace('home', en)

export { tHome, useHomeT } from './home.core'
