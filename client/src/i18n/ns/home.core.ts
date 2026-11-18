/** The start-up part of the "home" catalog (locales/en/home.core.json).
 * Start-up files import from here so the rest of the catalog stays in the
 * lazy screens' chunks; everything else imports '@/i18n/ns/home'. A key used
 * by a start-up file must live in the core file: scripts/check-locales.mjs
 * enforces it.
 * Nothing runs at import: the catalog is added the first time `tHome` or
 * `useHomeT` is used (see ensureNamespace in i18n/index.ts).
 */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/home.core.json'
import { ensureNamespace, lazyFixedT } from '@/i18n'

/** For plain functions (lib helpers). Follows the active language. */
export const tHome = /* @__PURE__ */ lazyFixedT('home', en)

/** For components: re-renders when the language changes. */
export function useHomeT() {
  ensureNamespace('home', en)
  return useTranslation('home').t
}
