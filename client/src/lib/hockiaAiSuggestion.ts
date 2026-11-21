/**
 * What Hockia AI has for this member right now (founder ruling 2026-11-21).
 *
 * The dot on the Hockia AI button lights only for something real and new:
 * applicants waiting on a recruiter, a profile without a photo or a bio, or
 * opportunities published since the member last looked. Opening Hockia AI
 * shows the suggestion and marks it seen, so the same fact never lights the
 * dot twice. Never a timer and never a made-up reason.
 */
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export type AiSuggestion =
  | { kind: 'applicants_waiting'; count: number; signature: string }
  | { kind: 'profile_step'; step: 'photo' | 'bio'; signature: string }
  | { kind: 'new_opportunities'; count: number; signature: string }
  | { kind: 'campaign_ended'; id: string; title: string; signature: string }

export type AiSuggestionKind = AiSuggestion['kind']
export type SeenSignatures = Partial<Record<AiSuggestionKind, string>>

export interface SuggestionViewer {
  id: string
  role: string | null
  coach_recruits_for_team?: boolean | null
  avatar_url?: string | null
  bio?: string | null
  is_test_account?: boolean | null
}

/** Opportunities older than this are not "new" for someone who has never looked. */
export const NEW_OPPORTUNITIES_DAYS = 7
const NEW_OPPORTUNITIES_MAX = 20

const seenKey = (userId: string) => `hockia.aiSuggestionSeen.${userId}`

export function readSeen(userId: string): SeenSignatures {
  try {
    const raw = window.localStorage.getItem(seenKey(userId))
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? (parsed as SeenSignatures) : {}
  } catch {
    return {}
  }
}

export function writeSeen(userId: string, seen: SeenSignatures): void {
  try { window.localStorage.setItem(seenKey(userId), JSON.stringify(seen)) } catch { /* private mode: the dot may show again */ }
}

export function isRecruiter(viewer: Pick<SuggestionViewer, 'role' | 'coach_recruits_for_team'>): boolean {
  return viewer.role === 'club' || (viewer.role === 'coach' && Boolean(viewer.coach_recruits_for_team))
}

/** A profile without a photo, then one without a bio: read from the profile already in memory. */
export function profileStepFor(viewer: SuggestionViewer): AiSuggestion | null {
  if (viewer.role !== 'player' && viewer.role !== 'coach') return null
  if (!viewer.avatar_url) return { kind: 'profile_step', step: 'photo', signature: 'photo' }
  if (!viewer.bio?.trim()) return { kind: 'profile_step', step: 'bio', signature: 'bio' }
  return null
}

/** The first suggestion the member has not seen yet, in the order given. */
export function firstUnseen(candidates: AiSuggestion[], seen: SeenSignatures): AiSuggestion | null {
  return candidates.find((c) => seen[c.kind] !== c.signature) ?? null
}

/** Pending applications on the recruiter's open roles; the newest one is the signature, so a new applicant is news and an answered one is not. */
async function applicantsWaiting(viewer: SuggestionViewer): Promise<AiSuggestion | null> {
  const { data, error, count } = await supabase
    .from('opportunity_applications')
    // The applicant join drops rows the recruiter cannot see (hidden profiles), like the applicants list.
    .select('applied_at, applicant:applicant_id!inner ( id ), opportunity:opportunity_id!inner ( club_id, status )', { count: 'exact' })
    .eq('opportunity.club_id', viewer.id)
    .eq('opportunity.status', 'open' as never)
    .eq('status', 'pending' as never)
    .order('applied_at', { ascending: false })
    .limit(1)
  if (error || !data || data.length === 0 || !count) return null
  const newest = (data[0] as { applied_at: string | null }).applied_at
  return newest ? { kind: 'applicants_waiting', count, signature: newest } : null
}

function showsTestClubs(): boolean {
  return Boolean((import.meta.env.VITE_SUPABASE_URL as string | undefined)?.includes('ivjkdaylalhsteyyclvl'))
}

/** Open opportunities for the member's role published since they last looked (or in the last week). */
async function newOpportunities(viewer: SuggestionViewer, seen: SeenSignatures, now: Date): Promise<AiSuggestion | null> {
  if (viewer.role !== 'player' && viewer.role !== 'coach') return null
  const weekAgo = new Date(now.getTime() - NEW_OPPORTUNITIES_DAYS * 86_400_000).toISOString()
  const lastSeen = seen.new_opportunities
  const since = lastSeen && lastSeen > weekAgo ? lastSeen : weekAgo
  const { data, error } = await supabase
    .from('opportunities')
    .select('published_at, club:profiles!opportunities_club_id_fkey ( is_test_account )')
    .eq('status', 'open' as never)
    .eq('opportunity_type', viewer.role as never)
    .neq('club_id', viewer.id)
    .gt('published_at', since)
    .order('published_at', { ascending: false })
    .limit(NEW_OPPORTUNITIES_MAX)
  if (error || !data) return null
  const rows = (data as unknown as { published_at: string | null; club: { is_test_account: boolean | null } | null }[])
    // The same rule as the opportunities list (hooks/useOpportunitiesForYou): test clubs only for test viewers, and on staging.
    .filter((r) => r.published_at && (showsTestClubs() || viewer.is_test_account || !r.club?.is_test_account))
  if (rows.length === 0) return null
  return { kind: 'new_opportunities', count: rows.length, signature: rows[0].published_at as string }
}

/** A campaign is news for this long after it ended. */
export const CAMPAIGN_ENDED_DAYS = 14

/**
 * The ids of ended campaigns already announced, from the stored signature.
 * It is a comma-separated list of ids; the first release stored one
 * "id:ended_at", which reads as that one id.
 */
export function announcedCampaigns(signature: string | undefined): string[] {
  return (signature ?? '').split(',').map((part) => part.split(':')[0].trim()).filter(Boolean)
}

interface EndedRow { id: string; status: string; title: string | null; live_at: string | null; ended_at: string | null; review_note?: string | null }

/**
 * The next ended campaign to announce, or null. Every campaign that ended in
 * the last two weeks is news once: the newest one not announced yet is
 * chosen (ties on the end time broken by id, so the choice never flips), and
 * the signature lists everything announced so far plus this one, so opening
 * Hockia AI marks it seen without forgetting the others. It makes no
 * difference whether it reached its end date or the brand ended it by hand
 * (founder 2026-11-21: "Sí, siempre"). One that Hockia had taken down is not
 * news: "see how it went" would read as if it had run its course.
 */
export function nextEndedCampaign(rows: EndedRow[], seenSignature: string | undefined, now: Date): AiSuggestion | null {
  const since = now.getTime() - CAMPAIGN_ENDED_DAYS * 86_400_000
  const recent = rows
    .filter((o) => o.status === 'ended' && o.live_at && o.ended_at && !(o.review_note ?? '').trim() && new Date(o.ended_at).getTime() >= since)
    .sort((a, b) => (b.ended_at as string).localeCompare(a.ended_at as string) || a.id.localeCompare(b.id))
  const announced = new Set(announcedCampaigns(seenSignature))
  const next = recent.find((o) => !announced.has(o.id))
  if (!next) return null
  // Only ids still inside the window are kept, so the stored list stays short.
  const kept = recent.filter((o) => announced.has(o.id)).map((o) => o.id)
  return { kind: 'campaign_ended', id: next.id, title: next.title?.trim() ?? '', signature: [...kept, next.id].sort().join(',') }
}

/** A brand's campaign that ended in the last two weeks and has not been announced: its closing summary is waiting in Hockia AI. */
async function campaignEnded(viewer: SuggestionViewer, seen: SeenSignatures, now: Date): Promise<AiSuggestion | null> {
  if (viewer.role !== 'brand') return null
  const { data, error } = await supabase.rpc('get_my_brand_offers')
  if (error || !data) return null
  return nextEndedCampaign(data as unknown as EndedRow[], seen.campaign_ended, now)
}

/**
 * Everything Hockia AI could suggest to this member, most useful first.
 * Recruiters: applicants waiting. Players and coaches: a missing photo or
 * bio, then new opportunities. Brands: a campaign that just ended. A failed
 * read means no suggestion, never a guess.
 */
export async function loadSuggestions(viewer: SuggestionViewer, seen: SeenSignatures, now = new Date()): Promise<AiSuggestion[]> {
  const out: AiSuggestion[] = []
  try {
    if (isRecruiter(viewer)) {
      const waiting = await applicantsWaiting(viewer)
      if (waiting) out.push(waiting)
    }
    const step = profileStepFor(viewer)
    if (step) out.push(step)
    const fresh = await newOpportunities(viewer, seen, now)
    if (fresh) out.push(fresh)
    const closed = await campaignEnded(viewer, seen, now)
    if (closed) out.push(closed)
  } catch (err) {
    logger.debug('[hockiaAiSuggestion] load failed', err)
  }
  return out
}
