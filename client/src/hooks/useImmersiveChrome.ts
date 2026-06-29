import { useEffect } from 'react'
import { setStatusBarForBackground } from '@/lib/nativeUi'

/**
 * For logged-out DARK screens (Landing, SignUp): paint the `body` — and therefore
 * the iOS safe-area / status-bar region — to match the screen's dark background
 * (so there's no white strip behind the status bar), and switch the status bar to
 * light/white icons so they stay visible.
 *
 * Reverts to the light app chrome (default white body, dark icons) on unmount, so
 * logged-in white screens are untouched — no regression there.
 *
 * The body background covers its padding box, so it fills the
 * `padding-top: env(safe-area-inset-top)` region that was showing white.
 */
export function useImmersiveChrome(backgroundColor: string): void {
  useEffect(() => {
    const previous = document.body.style.backgroundColor
    document.body.style.backgroundColor = backgroundColor
    void setStatusBarForBackground('dark-bg')
    return () => {
      document.body.style.backgroundColor = previous
      void setStatusBarForBackground('light-bg')
    }
  }, [backgroundColor])
}
