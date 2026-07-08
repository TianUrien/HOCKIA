import { useLayoutEffect } from 'react'

/**
 * Locks the document scroll so that only in-app scroll containers can move.
 * Essential for immersive surfaces like chat where the browser viewport
 * should remain visually stable during keyboard animations.
 *
 * REENTRANT: multiple components can hold a lock at once (e.g. an opportunity
 * detail modal with a nested "Apply" modal on top). Only the FIRST lock
 * captures the scroll position and pins the body; nested locks just bump a
 * counter. The body is restored — and the scroll position re-applied — only
 * when the LAST lock releases. Without this, a nested lock mounting while the
 * body is already `position: fixed` would read `window.scrollY` as 0 and,
 * on release, scroll the page to the top (a visible jump).
 */

let lockCount = 0
let savedScrollY = 0
let savedStyles: {
  htmlOverflow: string
  bodyOverflow: string
  bodyPosition: string
  bodyWidth: string
  bodyTop: string
  bodyBottom: string
  bodyHeight: string
} | null = null

export function useBodyScrollLock(enabled: boolean) {
  useLayoutEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof document === 'undefined') {
      return
    }

    const root = document.documentElement
    const body = document.body

    lockCount += 1
    if (lockCount === 1) {
      // First lock — capture state + pin the body.
      savedScrollY = window.scrollY
      savedStyles = {
        htmlOverflow: root.style.overflow,
        bodyOverflow: body.style.overflow,
        bodyPosition: body.style.position,
        bodyWidth: body.style.width,
        bodyTop: body.style.top,
        bodyBottom: body.style.bottom,
        bodyHeight: body.style.height,
      }

      root.setAttribute('data-chat-scroll-lock', 'true')
      body.setAttribute('data-chat-scroll-lock', 'true')

      root.style.overflow = 'hidden'
      body.style.overflow = 'hidden'
      body.style.position = 'fixed'
      body.style.width = '100%'
      body.style.top = `-${savedScrollY}px`
      // Pin the body across the FULL viewport, not just its shifted box.
      // globals.css sets `body { height: 100% }`, which — once the body is
      // position:fixed — resolves against the viewport, collapsing the body
      // to exactly one viewport tall. Shifted up by `top:-scrollY`, that
      // leaves a `scrollY`-px strip at the bottom uncovered: no page content
      // and no body background paint there, so it exposes the canvas and a
      // modal's semi-transparent backdrop over it reads as a hard-edged band
      // (the "black/white bottom half" behind centered modals). `bottom:0`
      // with `height:auto` overrides that: the fixed body now spans from
      // top:-scrollY down to the viewport bottom, its background fills the
      // whole viewport, and every modal backdrop dims uniformly.
      body.style.bottom = '0'
      body.style.height = 'auto'
    }

    return () => {
      lockCount -= 1
      if (lockCount <= 0) {
        lockCount = 0
        if (savedStyles) {
          root.style.overflow = savedStyles.htmlOverflow
          body.style.overflow = savedStyles.bodyOverflow
          body.style.position = savedStyles.bodyPosition
          body.style.width = savedStyles.bodyWidth
          body.style.top = savedStyles.bodyTop
          body.style.bottom = savedStyles.bodyBottom
          body.style.height = savedStyles.bodyHeight
          savedStyles = null
        }
        root.removeAttribute('data-chat-scroll-lock')
        body.removeAttribute('data-chat-scroll-lock')
        if (typeof window.scrollTo === 'function') {
          // behavior: 'instant' overrides the global `scroll-smooth` set on
          // <html> (globals.css). Without it, the cleanup's restore animates
          // over ~300ms and the user sees the page "scroll back" after closing
          // the modal. We want this single paint, invisible.
          window.scrollTo({ top: savedScrollY, left: 0, behavior: 'instant' })
        }
      }
    }
  }, [enabled])
}
