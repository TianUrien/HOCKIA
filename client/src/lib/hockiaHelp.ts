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

const answers = new Map<string, Promise<string | null>>()

/**
 * The profile that answers, or null when this member could not open that chat
 * right now (the server decides: no account set, a block, the daily allowance
 * of new conversations). Read once per member per page load. A failed read is
 * not remembered, so the next screen asks again.
 */
export function readHelpProfileId(viewerId: string): Promise<string | null> {
  const cached = answers.get(viewerId)
  if (cached) return cached
  const p = import('@/lib/supabase')
    .then(({ supabase }) => supabase.rpc('hockia_help_profile_id'))
    .then(({ data, error }) => {
      if (error) { answers.delete(viewerId); return null }
      return typeof data === 'string' && data ? data : null
    })
    .catch(() => { answers.delete(viewerId); return null })
  answers.set(viewerId, p)
  return p
}

/** Test seam: forget the cached answers. */
export function resetHelpProfile(): void {
  answers.clear()
}

// The fixed words of the route table (App.tsx). Any other path segment is a
// value: an id, a username, a slug, or a secret token (/invite/club/:token,
// /investors/:token).
const ROUTE_WORDS = new Set((
  'about admin ai-opinions ambassadors app-ratings applicants applications ask attribution audit-log auth brand ' +
  'brand-partnerships brands callback churn club clubs coaches community complete-profile countries dashboard ' +
  'data-issues developers devices directory discover discovery ecosystem edit email email-action engagement faq ' +
  'feature-usage feed feedback find-players forgot-password funnels home id in inbox investors invite ' +
  'juniors-waitlist marketplace member-blocks members messages messaging-health monthly-report need networking new ' +
  'notifications offers offline onboarding opportunities outreach overview player-analytics players post posted ' +
  'preferences privacy privacy-policy product-health profile pulse questions reports requests activity reset-password ' +
  'results saved search search-quality settings shortlist shortlists sign-in-traffic signin signing signup ' +
  'spam-signals suggested template terms umpires users verify-email world'
).split(' '))

/**
 * The screen the member is on as a route pattern: only the fixed words of the
 * route table are kept, every other segment becomes ":id". Nothing a path
 * carries (ids, usernames, slugs, invitation or investor tokens) can reach an
 * event or a message draft.
 */
export function helpScreen(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean).slice(0, 6).map((seg) => (ROUTE_WORDS.has(seg) ? seg : ':id'))
  return `/${parts.join('/')}`
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
