import { trackDbEvent } from '@/lib/trackDbEvent'
import { loadMessageDraft, saveMessageDraft } from '@/lib/messageDrafts'

/**
 * "Ask Hockia" at failure and help moments (founder 2026-11-21, proposal
 * docs/product/proposals/brand-promotion.md, phase 2). One line opens a chat
 * with the Hockia account. These moments are for Hockia only: no other brand
 * appears next to a problem.
 *
 * Which account answers is a runtime setting (app_settings
 * 'hockia_help_profile_id' through the hockia_help_profile_id() RPC). No
 * account, or any failure reading it, means the line is not shown.
 */

/** Where the line appears; recorded with every event. */
export type HelpMoment = 'error_screen' | 'route_error' | 'search_empty' | 'ai_no_result' | 'settings_help' | 'feedback_form'

let remote: Promise<string | null> | null = null

/** The profile that answers, read once per page load and shared. */
export function readHelpProfileId(): Promise<string | null> {
  remote ??= import('@/lib/supabase')
    .then(({ supabase }) => supabase.rpc('hockia_help_profile_id'))
    .then(({ data, error }) => (!error && typeof data === 'string' && data ? data : null))
    .catch(() => null)
  return remote
}

/** Test seam: forget the cached answer. */
export function resetHelpProfile(): void {
  remote = null
}

/** The screen the member is on, without ids, so it can travel in an event or a draft. */
export function helpScreen(pathname: string): string {
  return pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .slice(0, 120)
}

const shown = new Set<string>()
/** Once per moment and screen per page load. */
export function trackHelpShown(moment: HelpMoment, screen: string): void {
  const key = `${moment}|${screen}`
  if (shown.has(key)) return
  shown.add(key)
  trackDbEvent('help_moment_shown', undefined, undefined, { moment, screen })
}

/**
 * The route of the chat with Hockia. The draft names the screen, in the
 * member's own composer where they can see and change it; something they
 * already started typing is never replaced.
 */
export async function hockiaHelpRoute(viewerId: string, helpProfileId: string, moment: HelpMoment, screen: string, draft: string): Promise<string> {
  trackDbEvent('help_moment_open', undefined, undefined, { moment, screen })
  const { resolveConversationRoute } = await import('@/lib/startConversation')
  const route = await resolveConversationRoute(viewerId, helpProfileId)
  const key = new URLSearchParams(route.split('?')[1] ?? '').get('conversation') ?? `pending-${helpProfileId}`
  if (!loadMessageDraft(viewerId, key).trim()) saveMessageDraft(viewerId, key, draft)
  return route
}
