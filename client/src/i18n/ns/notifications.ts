/** The "notifications" catalog: import from here to translate notifications copy.
 * Nothing runs at import: the catalog is added the first time `tNotifications` or
 * `useNotificationsT` is used (see ensureNamespace in i18n/index.ts).
 */
import { useTranslation } from 'react-i18next'
import en from '@/locales/en/notifications.json'
import { ensureNamespace, lazyFixedT } from '@/i18n'

/** For plain functions (lib helpers). Follows the active language. */
export const tNotifications = /* @__PURE__ */ lazyFixedT('notifications', en)

/** For components: re-renders when the language changes. */
export function useNotificationsT() {
  ensureNamespace('notifications', en)
  return useTranslation('notifications').t
}
