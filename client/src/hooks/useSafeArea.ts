import { useEffect } from 'react'

// A software keyboard is always taller than this. Smaller viewport
// deltas (Safari's collapsing URL bar, safe-area noise) must NOT be
// mistaken for a keyboard, or the composer lifts off the bottom edge.
const KEYBOARD_MIN_PX = 120

/**
 * Tracks the on-screen keyboard via the VisualViewport API and exposes
 * its height to CSS as `--chat-keyboard-inset` (px).
 *
 * iOS Safari never resizes the *layout* viewport when the software
 * keyboard opens, so a keyboard-aware chat layout cannot be expressed
 * in pure CSS — `100vh`, `100dvh`, `svh` and `lvh` all ignore the
 * keyboard on iOS. The chat window therefore pins itself to the stable
 * layout viewport with `position: fixed; inset: 0` and simply pads its
 * bottom by `--chat-keyboard-inset`, lifting the composer above the
 * keyboard while the message list absorbs the change.
 *
 * Both `resize` and `scroll` are observed on the visual viewport: iOS
 * reports keyboard motion as a mix of the two, and a stale value is
 * exactly what pushes the composer off-screen.
 */
export function useSafeArea() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return
    }

    const root = document.documentElement
    const viewport = window.visualViewport

    const update = () => {
      if (!viewport) {
        root.style.setProperty('--chat-keyboard-inset', '0px')
        return
      }
      // The keyboard occupies the slice of the layout viewport that the
      // visual viewport no longer covers at the bottom. offsetTop is
      // subtracted so a transient iOS focus auto-scroll can't inflate it.
      const raw = window.innerHeight - viewport.height - viewport.offsetTop
      const inset = raw > KEYBOARD_MIN_PX ? Math.round(raw) : 0
      root.style.setProperty('--chat-keyboard-inset', `${inset}px`)
    }

    update()

    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)

    return () => {
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      root.style.removeProperty('--chat-keyboard-inset')
    }
  }, [])
}
