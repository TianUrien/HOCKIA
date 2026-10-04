import { Workbox } from 'workbox-window'
import { logger } from '@/lib/logger'

/**
 * Service-worker registration and update flow (onboarding QA 2026-10-04).
 *
 * Rule: the page NEVER reloads on its own on the web. A freshly deployed build
 * installs as a WAITING service worker (vite.config.ts: registerType 'prompt',
 * workbox skipWaiting false) and the old one keeps serving the running page
 * and its lazy chunks. When a new version is waiting we show "A new version of
 * HOCKIA is ready" with a Reload button; only that tap applies the update
 * (SKIP_WAITING) and reloads once the new worker controls the page.
 *
 * A waiting worker left from an earlier visit is reported again on the next
 * load (workbox-window's `wasWaitingBeforeRegister`), so a first load after a
 * deploy shows the prompt instead of serving old code indefinitely. Update
 * checks run on load, every 15 minutes while visible, and on return to the tab.
 *
 * Native (Capacitor) keeps its previous behaviour: the bundle only changes
 * with a store build, so a waiting worker is applied straight away (no prompt).
 */

export const SW_URL = '/sw.js'
const UPDATE_INTERVAL_MS = 15 * 60 * 1000

/** The subset of workbox-window's Workbox this module uses (injectable for tests). */
export interface WorkboxLike {
  addEventListener(type: 'waiting' | 'controlling', listener: (event: { isUpdate?: boolean; isExternal?: boolean }) => void): void
  register(options?: { immediate?: boolean }): Promise<ServiceWorkerRegistration | undefined>
  messageSkipWaiting(): void
}

export interface ServiceWorkerUpdateOptions {
  isNative: boolean
  /** Show the update prompt. `apply` is wired to its Reload button. */
  showPrompt: (apply: () => void) => void
  reload?: () => void
  createWorkbox?: () => WorkboxLike
  doc?: Document
}

/**
 * Registers the service worker and wires the prompt-based update flow.
 * Returns the Workbox instance (or null when service workers are unavailable).
 */
export function registerServiceWorker({
  isNative,
  showPrompt,
  reload = () => window.location.reload(),
  createWorkbox = () => new Workbox(SW_URL, { scope: '/' }) as unknown as WorkboxLike,
  doc = typeof document !== 'undefined' ? document : undefined,
}: ServiceWorkerUpdateOptions): WorkboxLike | null {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null

  const wb = createWorkbox()
  // Only a Reload tap in THIS tab (or the native auto-apply) may reload it.
  let applyRequested = false

  const apply = () => {
    applyRequested = true
    wb.messageSkipWaiting()
  }

  wb.addEventListener('waiting', () => {
    if (isNative) {
      logger.info('[PWA] New version waiting — applying (native)')
      apply()
      return
    }
    logger.info('[PWA] New version waiting — prompt shown')
    showPrompt(apply)
  })

  wb.addEventListener('controlling', (event) => {
    if (applyRequested) {
      reload()
      return
    }
    // Another tab applied the update: this page still runs the old build, so
    // offer the reload instead of doing it.
    if (event.isUpdate) showPrompt(() => reload())
  })

  wb.register({ immediate: true })
    .then((registration) => {
      if (!registration) return
      const check = () => registration.update().catch((err) => logger.error('[PWA] Update check failed:', err))
      check()
      let intervalId: ReturnType<typeof setInterval> | null = null
      const start = () => {
        if (!intervalId) intervalId = setInterval(check, UPDATE_INTERVAL_MS)
      }
      const stop = () => {
        if (intervalId) clearInterval(intervalId)
        intervalId = null
      }
      doc?.addEventListener('visibilitychange', () => {
        if (doc.hidden) stop()
        else {
          check()
          start()
        }
      })
      start()
    })
    .catch((err) => logger.error('[PWA] Service Worker registration failed:', err))

  return wb
}
