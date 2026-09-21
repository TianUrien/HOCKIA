/**
 * Lets the header's search icon open the SearchOverlay mounted elsewhere on
 * the page (Home, Pulse) without threading state through the tree.
 */
const OPEN_EVENT = 'hockia:open-search'

export function openSearchOverlay(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OPEN_EVENT))
}

export function onOpenSearchOverlay(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(OPEN_EVENT, handler)
  return () => window.removeEventListener(OPEN_EVENT, handler)
}
