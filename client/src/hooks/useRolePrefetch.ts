import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { observeRoleCard, prefetchRole } from '@/lib/prefetchRole'

/**
 * Warms the role page from a role card (lib/prefetchRole): on press, hover
 * or focus (`handlers`), and when the card scrolls into view. Pass the
 * card's existing ref as `target` when it already has one (press springs);
 * otherwise attach the returned `ref`. Pass no id to opt out.
 */
export function useRolePrefetch(id: string | null | undefined, target?: RefObject<HTMLElement | null>) {
  const cleanup = useRef<(() => void) | null>(null)
  const ref = useCallback((el: HTMLElement | null) => {
    cleanup.current?.()
    cleanup.current = el && id ? observeRoleCard(el, id) : null
  }, [id])
  useEffect(() => () => { cleanup.current?.() }, [])
  useEffect(() => {
    const el = target?.current
    if (!el || !id) return
    return observeRoleCard(el, id)
  }, [id, target])
  return {
    ref,
    handlers: {
      onPointerEnter: () => prefetchRole(id, 'hover'),
      onFocus: () => prefetchRole(id, 'focus'),
      onTouchStart: () => prefetchRole(id, 'press'),
    },
  }
}
