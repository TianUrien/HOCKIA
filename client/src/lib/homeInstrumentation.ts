import { useCallback, useRef } from 'react'
import { supabase } from './supabase'
import { trackDbEvent } from './trackDbEvent'
import { useAuthStore } from './auth'
import { logger } from './logger'

/**
 * Home redesign instrumentation (Phase 0, §4 of the brief).
 *
 * Three signals, two write paths:
 *  - MODULE IMPRESSIONS → `home_module_impressions` (bucketed table, NOT
 *    events rows): every Home open × modules is the highest-cardinality
 *    signal in the app. The table dedupes server-side via a
 *    (user, module, hour) unique index; the client upserts with
 *    ignoreDuplicates AND keeps an in-memory seen-set so a scroll session
 *    costs at most one request per module per hour.
 *  - CLICKS + CONTENT VIEWS (`home_module_click`, `post_impression`,
 *    `product_view`) → regular `events` rows via trackDbEvent (low/medium
 *    volume), session-deduped client-side.
 *
 * Home v1 (2026-10-19, research gaps 1–5): the same two paths carry the
 * current Home — module ids `v1_*`, one `home_card_impression` per feed card
 * (position + item_type), `home_feed_scroll` milestones, `destination` on
 * clicks and `surface` on post impressions and interactions.
 *
 * Every reader of these numbers ("every number must be real") lives in the
 * DB, so GA4 is deliberately not involved (it's disabled on native anyway).
 */

// One entry per (module|content) per session — survives re-renders, resets on
// full reload. Impressions also dedupe server-side per hour; this just avoids
// pointless network chatter. Scoped to the signed-in user: if the account
// changes in the same tab (logout→login), the set is cleared so the next
// user's first impressions aren't suppressed as "already seen".
let seenThisSession = new Set<string>()
let seenForUserId: string | null = null

function resetSeenIfUserChanged(userId: string | null): void {
  if (userId !== seenForUserId) {
    seenThisSession = new Set<string>()
    seenForUserId = userId
  }
}

function sessionKey(kind: string, id: string): string {
  return `${kind}:${id}`
}

export function recordModuleImpression(moduleId: string, position: number): void {
  const { user, profile } = useAuthStore.getState()
  if (!user) return
  resetSeenIfUserChanged(user.id)
  const key = sessionKey('module', moduleId)
  if (seenThisSession.has(key)) return
  seenThisSession.add(key)

  void supabase
    .from('home_module_impressions')
    .upsert(
      { user_id: user.id, module_id: moduleId, position, role: profile?.role ?? null },
      { onConflict: 'user_id,module_id,hour_bucket', ignoreDuplicates: true },
    )
    .then(({ error }) => {
      if (error) logger.debug('[home-instrumentation] impression skipped', error.message)
    })
}

/**
 * Home v1 module ids and their slot on the page (Figma H1/H2). The feed is
 * one module; its cards report their own position via `recordCardImpression`.
 */
export const HOME_V1_MODULES = {
  nextStep: { id: 'v1_next_step', position: 0 },
  peopleNew: { id: 'v1_people_new', position: 1 },
  peopleAvailable: { id: 'v1_people_available', position: 1 },
  feed: { id: 'v1_feed', position: 2 },
  rolesRail: { id: 'v1_roles_rail', position: 3 },
  endOfFeed: { id: 'v1_end_of_feed', position: 4 },
  peoplePymk: { id: 'v1_people_pymk', position: 5 },
  endRolesRail: { id: 'v1_roles_rail_end', position: 6 },
  endPeopleAvailable: { id: 'v1_people_available_end', position: 6 },
} as const

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** A click destination without ids: `/opportunities/<uuid>` → `/opportunities/:id`.
 *  Non-route destinations ('member_deck', 'comments', 'compose') pass through. */
export function normalizeDestination(destination: string): string {
  return destination.replace(UUID_RE, ':id').replace(/\?.*$/, '')
}

/** The surface a feed interaction happened on, from the route (no prop threading). */
export function currentSurface(): string {
  if (typeof window === 'undefined') return 'unknown'
  const path = window.location.pathname
  if (path === '/home' || path === '/' ) return 'home_v1'
  if (path.startsWith('/community')) return 'community'
  if (path.startsWith('/dashboard')) return 'profile'
  if (path.startsWith('/pulse')) return 'pulse'
  const first = path.split('/')[1]
  return first ? first.replace(/[^a-z0-9_]/gi, '_').slice(0, 32) : 'unknown'
}

export function trackModuleClick(moduleId: string, position: number, destination?: string): void {
  trackDbEvent('home_module_click', 'home_module', undefined, {
    module_id: moduleId,
    position,
    ...(destination ? { destination: normalizeDestination(destination) } : {}),
  })
}

/** One row per feed card the member actually scrolled to (gap 1): which
 *  card types get seen, and how far down. Session-deduped per feed item. */
export function recordCardImpression(feedItemId: string, position: number, itemType: string): void {
  const userId = useAuthStore.getState().user?.id ?? null
  if (!userId) return
  resetSeenIfUserChanged(userId)
  const key = sessionKey('card', feedItemId)
  if (seenThisSession.has(key)) return
  seenThisSession.add(key)
  trackDbEvent('home_card_impression', 'feed_item', feedItemId, {
    module_id: HOME_V1_MODULES.feed.id,
    position,
    item_type: itemType,
  })
}

/** A tap on a feed card that leaves Home or opens a sheet (gap 5 for the feed). */
export function trackCardClick(feedItemId: string, itemType: string, destination: string): void {
  trackDbEvent('home_card_click', 'feed_item', feedItemId, {
    module_id: HOME_V1_MODULES.feed.id,
    item_type: itemType,
    destination: normalizeDestination(destination),
  })
}

/** `quiet:<uuid>` / `checkin:<pulse id>` → the step family only; never an id. */
export function nextStepKind(key: string): string {
  return key.split(':')[0]
}

/** The Next step card that was on screen (gap 8): once per step per session. */
export function recordNextStepImpression(key: string): void {
  const userId = useAuthStore.getState().user?.id ?? null
  if (!userId) return
  resetSeenIfUserChanged(userId)
  const k = sessionKey('step', key)
  if (seenThisSession.has(k)) return
  seenThisSession.add(k)
  trackDbEvent('next_step_impression', 'next_step', undefined, { key: nextStepKind(key), surface: 'home_v1' })
}

/** What the member did with a Next step: open its destination, compose, confirm, dismiss. */
export function trackNextStepAction(key: string, action: 'open' | 'compose' | 'confirm_availability' | 'dismiss', surface: string = currentSurface()): void {
  trackDbEvent('next_step_action', 'next_step', undefined, { key: nextStepKind(key), action, surface })
}

export const FEED_SCROLL_MILESTONES = [25, 50, 75, 100] as const
export type FeedScrollMilestone = (typeof FEED_SCROLL_MILESTONES)[number]

/**
 * Which milestones a visible card index crosses, given how many cards are
 * loaded (gap 3). Pure: the caller remembers what already fired. Depth is
 * measured against the cards loaded so far, so `loaded` rides along in the
 * event and 100 % means "saw the last loaded card", not the end of the feed.
 */
export function scrollMilestonesCrossed(lastIndex: number, loaded: number, fired: ReadonlySet<number>): FeedScrollMilestone[] {
  if (loaded <= 0 || lastIndex < 0) return []
  const depth = ((Math.min(lastIndex, loaded - 1) + 1) / loaded) * 100
  return FEED_SCROLL_MILESTONES.filter((m) => depth >= m && !fired.has(m))
}

export function trackFeedScroll(milestone: FeedScrollMilestone, lastIndex: number, loaded: number, hasMore: boolean): void {
  trackDbEvent('home_feed_scroll', 'home_module', undefined, {
    module_id: HOME_V1_MODULES.feed.id,
    milestone,
    last_index: lastIndex,
    loaded,
    has_more: hasMore,
  })
}

/** Viewer country rides in properties as the profile's nationality country id
 *  (joins cleanly server-side; events has no country column). */
function viewerCountryId(): number | null {
  const { profile } = useAuthStore.getState()
  return (profile as { nationality_country_id?: number | null } | null)?.nationality_country_id ?? null
}

export function recordPostImpression(postId: string, surface: string = currentSurface()): void {
  resetSeenIfUserChanged(useAuthStore.getState().user?.id ?? null)
  const key = sessionKey('post', postId)
  if (seenThisSession.has(key)) return
  seenThisSession.add(key)
  const country = viewerCountryId()
  trackDbEvent('post_impression', 'post', postId, { surface, ...(country != null ? { country_id: country } : {}) })
}

export function recordProductView(productId: string, brandId: string): void {
  resetSeenIfUserChanged(useAuthStore.getState().user?.id ?? null)
  const key = sessionKey('product', productId)
  if (seenThisSession.has(key)) return
  seenThisSession.add(key)
  const country = viewerCountryId()
  trackDbEvent('product_view', 'brand_product', productId, {
    brand_id: brandId,
    ...(country != null ? { country_id: country } : {}),
  })
}

/**
 * Fire `onVisible` exactly once when the element first approaches the
 * viewport (200px margin, house pattern). A card that renders but is never
 * scrolled to is NOT an impression.
 *
 * Returns a CALLBACK ref, not an object ref: the observer is wired the moment
 * the node actually mounts, in whatever render state. A mount-only effect
 * reading ref.current would miss modules that render a loading/empty branch
 * WITHOUT the ref on first paint and only attach it once data arrives (the
 * hero + applications do exactly that) — the effect would run once against a
 * null ref and never re-fire.
 */
export function useImpressionOnce(onVisible: () => void) {
  const firedRef = useRef(false)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const onVisibleRef = useRef(onVisible)
  onVisibleRef.current = onVisible

  return useCallback((node: HTMLElement | null) => {
    // Node detached (unmount or state swap) — tear down.
    if (!node) {
      observerRef.current?.disconnect()
      observerRef.current = null
      return
    }
    if (firedRef.current || observerRef.current) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !firedRef.current) {
          firedRef.current = true
          observer.disconnect()
          observerRef.current = null
          onVisibleRef.current()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(node)
    observerRef.current = observer
  }, [])
}
