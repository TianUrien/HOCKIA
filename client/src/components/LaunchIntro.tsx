import { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { getAppVersion } from '@/lib/appVersion'

/**
 * Splash intro (rebrand phase 2, assets/app/splash-intro): the mono logo
 * intro, 3 s, played once after the static launch screen.
 *
 * When (founder 2026-10-26): on the first launch after install and after each
 * app update — never on later launches, never on resume, never with Reduce
 * Motion. Native apps only (the web keeps its own landing).
 *
 * Hand-off: the overlay opens looking exactly like the static splash (the
 * splash artwork without its lockup + the clip's last frame as the poster, at
 * the lockup's size and place), so the native splash can go without a seam.
 * It then plays the clip once and fades out, or fades out straight away when
 * the intro was already seen for this version. Any failure just fades out.
 *
 * Geometry: the splash artwork (1170 × 2532) is drawn with cover scaling, so
 * one artwork pixel = --s = max(100vw / 1170, 100dvh / 2532). Its lockup is
 * 373 px wide, centred, centre 179.5 px above the artwork's middle; in the
 * 1080² clip the lockup is 756 px wide with its centre at (540, 475).
 */
const SEEN_KEY = 'hockia-splash-intro-seen'
const LOCKUP_W = 373
const CLIP = { size: 1080, lockupW: 756, cx: 540, cy: 475 }
const k = LOCKUP_W / CLIP.lockupW // clip px → artwork px
const FAILSAFE_MS = 6000

type Phase = 'deciding' | 'playing' | 'leaving' | 'done'

function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

export default function LaunchIntro() {
  const [phase, setPhase] = useState<Phase>(() => (Capacitor.isNativePlatform() && !reducedMotion() ? 'deciding' : 'done'))
  const videoRef = useRef<HTMLVideoElement>(null)

  // Decide: play only if this version hasn't shown the intro yet.
  useEffect(() => {
    if (phase !== 'deciding') return
    let cancelled = false
    void getAppVersion().then((info) => {
      if (cancelled) return
      const version = info ? `${info.version}+${info.build}` : 'unknown'
      let seen: string | null = null
      try { seen = localStorage.getItem(SEEN_KEY) } catch { /* private mode */ }
      if (seen === version) { setPhase('leaving'); return }
      try { localStorage.setItem(SEEN_KEY, version) } catch { /* private mode */ }
      setPhase('playing')
    })
    return () => { cancelled = true }
  }, [phase])

  // Play once; any failure (codec, autoplay) leaves quietly.
  useEffect(() => {
    if (phase !== 'playing') return
    const v = videoRef.current
    if (!v) { setPhase('leaving'); return }
    v.currentTime = 0
    v.play().catch(() => setPhase('leaving'))
    const failsafe = window.setTimeout(() => setPhase('leaving'), FAILSAFE_MS)
    return () => window.clearTimeout(failsafe)
  }, [phase])

  useEffect(() => {
    if (phase !== 'leaving') return
    const t = window.setTimeout(() => setPhase('done'), 260)
    return () => window.clearTimeout(t)
  }, [phase])

  if (phase === 'done') return null

  const clipSize = `calc(var(--s) * ${(CLIP.size * k).toFixed(2)})`
  return (
    <div
      data-testid="launch-intro"
      aria-hidden="true"
      className="fixed inset-0 z-[9996] overflow-hidden bg-surface-subtle transition-opacity duration-[250ms] ease-out"
      style={{ ['--s' as string]: 'max(calc(100vw / 1170), calc(100dvh / 2532))', opacity: phase === 'leaving' ? 0 : 1 }}
    >
      <img src="/native/launch-intro-bg.webp" alt="" className="absolute inset-0 h-full w-full max-w-none object-cover object-center" draggable={false} />
      <video
        ref={videoRef}
        muted
        playsInline
        preload="auto"
        poster="/native/splash-intro-last.png"
        onEnded={() => window.setTimeout(() => setPhase('leaving'), 300)}
        // React also fires this for a <source> the platform can't play (the
        // HEVC .mov on Android) even when the next source plays fine; only a
        // real MediaError on the element means the clip can't play.
        onError={() => { if (videoRef.current?.error) setPhase('leaving') }}
        className="absolute max-w-none"
        style={{
          width: clipSize,
          height: clipSize,
          left: `calc(50vw - var(--s) * ${(CLIP.cx * k).toFixed(2)})`,
          top: `calc(50dvh - var(--s) * ${(179.5 + CLIP.cy * k).toFixed(2)})`,
        }}
      >
        {/* iOS: HEVC with alpha; Android WebView: VP9 with alpha. */}
        <source src="/native/splash-intro.mov" type='video/quicktime; codecs="hvc1"' />
        <source src="/native/splash-intro.webm" type="video/webm" />
      </video>
    </div>
  )
}
