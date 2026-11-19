import { useEffect } from 'react'
import { tCommon } from '@/i18n/ns/common'

const SUFFIX = ' | Hockia'

/**
 * Sets document.title for the current page and restores the default
 * (matches index.html `<title>`) on unmount.
 *
 * Usage:
 *   useDocumentTitle('Messages')              // → "Messages | Hockia"
 *   useDocumentTitle('John Doe', { raw: true }) // → "John Doe" exactly
 *   useDocumentTitle(null)                    // → no change while title resolves
 *
 * The default suffix " | Hockia" (the format the server-rendered page titles use) exists so the brand stays visible in
 * tab strips and browser-history search results without crowding the
 * page label. Pass `{ raw: true }` for already-formatted titles.
 */
export function useDocumentTitle(
  title: string | null | undefined,
  options?: { raw?: boolean },
): void {
  useEffect(() => {
    if (!title) return
    const previous = document.title
    document.title = options?.raw ? title : `${title}${SUFFIX}`
    return () => {
      // Restore on unmount so a no-title page after this one doesn't
      // inherit a stale title. Falls back to the static index.html title.
      document.title = previous || tCommon('documentTitle.default')
    }
  }, [title, options?.raw])
}
