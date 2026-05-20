import { useEffect } from 'react'

// A software keyboard is always taller than this. Smaller viewport
// deltas (Safari's collapsing URL bar, safe-area noise) must NOT be
// mistaken for a keyboard, or the composer lifts off the bottom edge.
const KEYBOARD_MIN_PX = 120

// A sane visual-viewport offsetTop is roughly a browser URL-bar height.
// A larger value is the documented iOS "offsetTop fails to reset" bug;
// the cap bounds how far that could misplace the chat header.
const OFFSET_TOP_MAX_PX = 160

/**
 * Tracks the on-screen keyboard and the visual-viewport offset via the
 * VisualViewport API, exposing them to CSS as:
 *   --chat-keyboard-inset      keyboard height at the bottom (px)
 *   --chat-viewport-offset-top visible-area offset from the top (px)
 *
 * iOS Safari never resizes the *layout* viewport when the software
 * keyboard opens, so a keyboard-aware chat layout cannot be expressed
 * in pure CSS — `100vh`, `100dvh`, `svh` and `lvh` all ignore the
 * keyboard on iOS. The chat window therefore pins itself to the stable
 * layout viewport with `position: fixed; inset: 0` and brackets its
 * content with padding:
 *   - padding-top    = max(env(safe-area-inset-top), offset-top)
 *     → header clears the notch (PWA) or the Safari URL bar (browser)
 *   - padding-bottom = --chat-keyboard-inset
 *     → composer rests directly above the keyboard
 * so the content box exactly overlays the visible area. Nothing is
 * repositioned — only padding changes — which is what keeps it stable.
 *
 * Both `resize` and `scroll` are observed on the visual viewport: iOS
 * reports keyboard motion as a mix of the two, and a stale value is
 * exactly what pushes the header or composer off-screen.
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
        root.style.setProperty('--chat-viewport-offset-top', '0px')
        return
      }
      const offsetTop = Math.max(0, viewport.offsetTop)
      // Keyboard height = the slice of the layout viewport the visual
      // viewport no longer covers at the bottom. Raw offsetTop keeps the
      // figure exact so the composer lands flush on the keyboard.
      const rawKeyboard = window.innerHeight - viewport.height - offsetTop
      const keyboardInset = rawKeyboard > KEYBOARD_MIN_PX ? Math.round(rawKeyboard) : 0
      // Safari's layout viewport extends behind the top URL bar, so the
      // visible area sits at a positive offsetTop. The chat pads its top
      // by this so the header lands at the visible-area top rather than
      // behind the URL bar. Capped against the iOS stuck-offsetTop bug.
      const offsetTopCapped = Math.min(Math.round(offsetTop), OFFSET_TOP_MAX_PX)
      root.style.setProperty('--chat-keyboard-inset', `${keyboardInset}px`)
      root.style.setProperty('--chat-viewport-offset-top', `${offsetTopCapped}px`)
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
      root.style.removeProperty('--chat-viewport-offset-top')
    }
  }, [])
}
