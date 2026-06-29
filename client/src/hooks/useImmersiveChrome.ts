import { useEffect } from 'react'
import { setStatusBarForBackground } from '@/lib/nativeUi'

/**
 * For logged-out DARK splash screens (Landing): make it feel like a native,
 * fixed full-screen onboarding screen, not a scrollable webpage.
 *
 *  - Paints `body` (and the iOS safe-area / status-bar region) to match the dark
 *    background, so there's no white strip behind the status bar.
 *  - Switches the status bar to light/white icons.
 *  - LOCKS document scroll + overscroll (no iOS rubber-band, no white space when
 *    you drag). The screen itself is positioned `fixed inset-0` so it fills the
 *    viewport exactly with nothing to scroll.
 *
 * Everything is reverted on unmount, so logged-in / light / scrollable screens are
 * completely unaffected (white body, dark icons, normal scrolling).
 */
export function useImmersiveChrome(backgroundColor: string): void {
  useEffect(() => {
    const { body } = document
    const html = document.documentElement
    const prev = {
      bodyBg: body.style.backgroundColor,
      bodyOverflow: body.style.overflow,
      htmlOverflow: html.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
      htmlOverscroll: html.style.overscrollBehavior,
    }

    body.style.backgroundColor = backgroundColor
    body.style.overflow = 'hidden'
    html.style.overflow = 'hidden'
    body.style.overscrollBehavior = 'none'
    html.style.overscrollBehavior = 'none'
    void setStatusBarForBackground('dark-bg')

    return () => {
      body.style.backgroundColor = prev.bodyBg
      body.style.overflow = prev.bodyOverflow
      html.style.overflow = prev.htmlOverflow
      body.style.overscrollBehavior = prev.bodyOverscroll
      html.style.overscrollBehavior = prev.htmlOverscroll
      void setStatusBarForBackground('light-bg')
    }
  }, [backgroundColor])
}
