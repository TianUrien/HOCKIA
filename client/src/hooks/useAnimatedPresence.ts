import { useEffect, useState } from 'react'

/**
 * Keep a node mounted through its EXIT animation.
 *
 * HOCKIA's modals/sheets animate IN (slide-up / scale-in) but historically
 * unmounted instantly, so closing felt abrupt ("the UI just disappears"). This
 * hook keeps the node rendered for `exitMs` after `open` flips false and
 * exposes a `status` the caller swaps enter ↔ exit animation classes on.
 * prefers-reduced-motion users skip the delay (instant unmount), and the
 * paired CSS classes collapse to ~0ms — so nothing ever feels slower.
 *
 * Usage:
 *   const { mounted, status } = useAnimatedPresence(isOpen)
 *   if (!mounted) return null
 *   <div className={status === 'closing' ? 'animate-scale-out' : 'animate-scale-in'} />
 *
 * Note: this is for surfaces whose OPEN state is a boolean and whose content
 * doesn't depend on a value that's cleared on close (e.g. Modal). For previews
 * that compute from a `member` prop, defer the parent's onClose instead so the
 * content stays rendered through the exit.
 */
export type PresenceStatus = 'open' | 'closing'

export function useAnimatedPresence(
  open: boolean,
  exitMs = 200,
): { mounted: boolean; status: PresenceStatus } {
  const [mounted, setMounted] = useState(open)
  const [status, setStatus] = useState<PresenceStatus>(open ? 'open' : 'closing')

  useEffect(() => {
    if (open) {
      setMounted(true)
      setStatus('open')
      return
    }
    setStatus('closing')
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = window.setTimeout(() => setMounted(false), reduce ? 0 : exitMs)
    return () => window.clearTimeout(timer)
  }, [open, exitMs])

  return { mounted, status }
}
