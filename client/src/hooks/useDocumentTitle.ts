import { useEffect } from 'react'

const SUFFIX = ' • HOCKIA'
const DEFAULT_TITLE = 'HOCKIA – The Home of Field Hockey'

/**
 * Sets document.title for the current page and restores the default
 * (matches index.html `<title>`) on unmount.
 *
 * Usage:
 *   useDocumentTitle('Messages')              // → "Messages • HOCKIA"
 *   useDocumentTitle('John Doe', { raw: true }) // → "John Doe" exactly
 *   useDocumentTitle(null)                    // → no change while title resolves
 *
 * The default suffix " • HOCKIA" exists so the brand stays visible in
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
      document.title = previous || DEFAULT_TITLE
    }
  }, [title, options?.raw])
}
