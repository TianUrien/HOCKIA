/** The "inbox" catalog: import from here to translate inbox copy.
 * Nothing runs at import: the catalog is added the first time `tInbox` or
 * `useInboxT` is used (see ensureNamespace in i18n/index.ts).
 */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/inbox.json'
import { ensureNamespace, lazyFixedT } from '@/i18n'

/** For plain functions (lib helpers). Follows the active language. */
export const tInbox = /* @__PURE__ */ lazyFixedT('inbox', en)

/** For components: re-renders when the language changes. */
export function useInboxT() {
  ensureNamespace('inbox', en)
  return useTranslation('inbox').t
}
