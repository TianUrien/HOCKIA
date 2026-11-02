import { lazy } from 'react'
import type { ComponentType } from 'react'
import { isStaleChunkMessage, STALE_EXPORT_MESSAGE } from '@/lib/sentryFilters'
import { claimStaleChunkRecovery, isStaleChunkRecoveryRunning, recoverFromStaleChunk } from '@/lib/swUpdate'

// Auto-reload on stale chunk errors (after deploy, old hashed filenames 404).
// Uses sessionStorage guard to prevent infinite reload loops.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    importFn().then((mod) => {
      // The chunk loaded but carries no component: an old deploy's file
      // answering a new shell's import (JAVASCRIPT-REACT-DP / -DM). Treat
      // it like a failed chunk load so the recovery below runs.
      if (!mod || typeof mod.default === 'undefined') throw new Error(STALE_EXPORT_MESSAGE)
      return mod
    }).catch((error: Error) => {
      // main.tsx's vite:preloadError handler already started a recovery: the
      // import then resolves to undefined and a route's `m.X` mapping throws
      // a TypeError (prod 2026-10-30, "reading 'AdminGuard'"). Keep waiting
      // for the reload instead of showing the error screen.
      if (isStaleChunkRecoveryRunning()) return new Promise<never>(() => {})

      // Chrome, Firefox and Safari word the stale-chunk failure differently
      // (incl. the HTML-served-as-JS MIME error, JAVASCRIPT-REACT-3) — the
      // signature list lives in lib/sentryFilters.
      const isStale = isStaleChunkMessage(error?.message)

      if (isStale && claimStaleChunkRecovery()) {
        // Activate the new service worker first: a plain reload came back to
        // the same stale shell (prod 2026-10-18).
        void recoverFromStaleChunk()
        return new Promise<never>(() => {}) // hang until reload completes
      }

      throw error // not stale or already retried — let ErrorBoundary handle
    }),
  )
}
