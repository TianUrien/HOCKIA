/**
 * Fire-and-forget database event tracking.
 *
 * Calls the `track_event()` RPC which handles auth.uid(), role denormalization,
 * server-side geo/IP enrichment, and insertion into the `events` table.
 *
 * Every event is stamped with the analytics context (session id, durable
 * anonymous id, device, browser, source) so the funnel is measurable per
 * visitor/session. Context is authoritative — it overrides any same-named key a
 * caller passes. Never blocks UI, never throws — failures are silently ignored.
 */

import { supabase } from '@/lib/supabase'
import { analyticsContext, getFirstTouch } from '@/lib/analyticsIdentity'

export function trackDbEvent(
  eventName: string,
  entityType?: string,
  entityId?: string,
  properties?: Record<string, unknown>,
): void {
  let merged: Record<string, unknown> = properties ?? {}
  if (typeof window !== 'undefined') {
    try {
      merged = { ...(properties ?? {}), ...analyticsContext() }
    } catch {
      merged = properties ?? {}
    }
  }
  void Promise.resolve(
    supabase
      .rpc('track_event', {
        p_event_name: eventName,
        p_entity_type: (entityType ?? null) as string | undefined,
        p_entity_id: (entityId ?? null) as string | undefined,
        p_properties: merged as unknown as undefined,
      })
  ).then(() => {}).catch(() => {})
}

/**
 * Called once right after registration completes. Writes first-touch signup
 * attribution and stitches every prior anonymous event from this browser to
 * the new user (resolved_user_id), so pre-signup exploration is joinable to
 * the account. Fire-and-forget; no-op if there's no captured first-touch.
 */
export function linkSignupAttribution(): void {
  if (typeof window === 'undefined') return
  const ft = getFirstTouch()
  if (!ft?.anonymous_id) return
  void Promise.resolve(
    supabase.rpc('link_signup_attribution', {
      p_anonymous_id: ft.anonymous_id,
      p_first_referrer: ft.first_referrer ?? undefined,
      p_first_source: ft.first_source ?? undefined,
      p_utm: (ft.utm ?? undefined) as unknown as undefined,
      p_landing_path: ft.landing_path ?? undefined,
      p_first_seen_at: ft.first_seen_at ?? undefined,
    })
  ).then(() => {}).catch(() => {})
}
