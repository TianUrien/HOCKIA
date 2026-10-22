/**
 * Prefetch the role page from role cards (Home and Opportunities, quick wins
 * 2026-10-21): when a card is pressed, hovered, focused or scrolls into view,
 * load the role page's code chunk and warm its data (lib/roleDetail), so the
 * tap opens a filled page instead of a skeleton.
 *
 * Budget: at most 2 reads in flight and a short queue (taps and presses jump
 * the queue, scroll-ins wait); nothing at all when the device asks to save
 * data, and no scroll-in prefetch on 2G.
 */
import { warmRoleDetail, hasWarmRoleDetail } from './roleDetail'

/** The lazy role page import, shared with App.tsx's route so both hit the same chunk. */
export const loadOpportunityDetail = () => import('@/pages/OpportunityDetailPage')

export type PrefetchReason = 'press' | 'hover' | 'focus' | 'viewport'

const MAX_IN_FLIGHT = 2
const MAX_QUEUE = 8

let inFlight = 0
const queue: string[] = []
const pending = new Set<string>()
let chunkRequested = false

type NetworkInformationLike = { saveData?: boolean; effectiveType?: string }

function connection(): NetworkInformationLike | undefined {
  if (typeof navigator === 'undefined') return undefined
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection
}

/** False when prefetching would cost the member data they asked to save, or a slow link. */
export function prefetchAllowed(reason: PrefetchReason): boolean {
  const c = connection()
  if (c?.saveData) return false
  if (reason === 'viewport' && (c?.effectiveType === '2g' || c?.effectiveType === 'slow-2g')) return false
  return true
}

function preloadChunk(): void {
  if (chunkRequested) return
  chunkRequested = true
  loadOpportunityDetail().catch(() => { chunkRequested = false })
}

function drain(): void {
  while (inFlight < MAX_IN_FLIGHT && queue.length > 0) {
    const id = queue.shift()!
    inFlight += 1
    void warmRoleDetail(id).finally(() => {
      inFlight -= 1
      pending.delete(id)
      drain()
    })
  }
}

/** Warm the role page for this role id (deduped; never throws). */
export function prefetchRole(id: string | null | undefined, reason: PrefetchReason = 'press'): void {
  if (!id || !prefetchAllowed(reason)) return
  preloadChunk()
  if (pending.has(id) || hasWarmRoleDetail(id)) return
  if (reason === 'viewport') {
    if (queue.length >= MAX_QUEUE) return
    queue.push(id)
  } else {
    queue.unshift(id)
    if (queue.length > MAX_QUEUE) pending.delete(queue.pop()!)
  }
  pending.add(id)
  drain()
}

// ── Scroll-in: one shared observer for every card ─────────────────────────────
let observer: IntersectionObserver | null = null
const ids = new WeakMap<Element, string>()

function sharedObserver(): IntersectionObserver | null {
  if (observer) return observer
  if (typeof IntersectionObserver === 'undefined') return null
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const id = ids.get(entry.target)
      observer?.unobserve(entry.target)
      if (id) prefetchRole(id, 'viewport')
    }
  }, { rootMargin: '0px', threshold: 0.6 })
  return observer
}

/** Watch a card; returns the cleanup. */
export function observeRoleCard(el: Element, id: string): () => void {
  const obs = sharedObserver()
  if (!obs) return () => {}
  ids.set(el, id)
  obs.observe(el)
  return () => { obs.unobserve(el); ids.delete(el) }
}

/** Tests only. */
export function __resetPrefetchRole(): void {
  inFlight = 0
  queue.length = 0
  pending.clear()
  chunkRequested = false
  observer?.disconnect()
  observer = null
}
