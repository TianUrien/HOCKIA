import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { coachSpecialtyLabel, positionLabel } from '@/lib/identity'
import { clubLeadLeague } from '@/lib/clubProfileCopy'
import { DEFAULT_EXPIRY_DAYS } from '@/lib/clubRecruiting'
import { pickApplication, type ClubApplication } from '@/lib/clubInbox'
import { WAITING_APPLICATION_STATUSES } from '@/lib/roleLifecycle'

/**
 * Data for the club's Inbox rows and Chat context card (Figma D1.19–D1.21;
 * DEV NOTES 355:914, 355:919, 355:923). Club phones only — callers pass
 * `enabled` so players never run these reads.
 */
export interface InboxConversationLike {
  conversation_id: string
  other_participant_id: string
  last_message_sender_id: string | null
}

export interface ClubInboxRowMeta {
  /** Position / specialisation / league for the role line. */
  detail: string | null
  /** Applied to any of the club's roles (withdrawn ones don't count). */
  applied: boolean
  /** Has an open application and the club hasn't written since it (amber dot). */
  waiting: boolean
}

type DetailRow = {
  id: string
  role: string | null
  position: string | null
  coach_specialization: string | null
  coach_specialization_custom: string | null
  mens_league_division: string | null
  womens_league_division: string | null
  umpire_level: string | null
}

export function roleDetailOf(p: DetailRow | undefined): string | null {
  if (!p) return null
  if (p.role === 'player') return positionLabel(p.position)
  if (p.role === 'coach') return coachSpecialtyLabel(p.coach_specialization, p.coach_specialization_custom)
  if (p.role === 'club') return clubLeadLeague(p.mens_league_division, p.womens_league_division)
  if (p.role === 'umpire') return p.umpire_level
  return null
}

/**
 * Who is "waiting for a first reply" (founder ruling, Club v2 QA round 9):
 * the person has an application to one of the club's roles that is still
 * waiting on the club (WAITING_APPLICATION_STATUSES — not withdrawn /
 * declined / filled / expired), and the club has not sent a (non-deleted)
 * message in the conversation since that application — never, or only
 * before it. A chat with no open application is never waiting, however
 * quiet it is.
 */
export function isWaitingForFirstReply(latestOpenApplicationAt: string | null | undefined, clubLastMessageAt: string | null | undefined): boolean {
  if (!latestOpenApplicationAt) return false
  if (!clubLastMessageAt) return true
  return new Date(clubLastMessageAt).getTime() < new Date(latestOpenApplicationAt).getTime()
}

export function useClubInboxMeta(clubId: string | null, rows: InboxConversationLike[], enabled: boolean) {
  const ids = rows.map((r) => r.conversation_id).sort().join(',')
  return useQuery({
    queryKey: ['club-inbox-meta', clubId, ids],
    enabled: enabled && Boolean(clubId) && rows.length > 0,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<Map<string, ClubInboxRowMeta>> => {
      const otherIds = [...new Set(rows.map((r) => r.other_participant_id))]
      const [profiles, apps] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, role, position, coach_specialization, coach_specialization_custom, mens_league_division, womens_league_division, umpire_level')
          .in('id', otherIds),
        supabase
          .from('opportunity_applications')
          .select('applicant_id, status, applied_at, opportunity:opportunities!inner(club_id)')
          .eq('opportunity.club_id', clubId as string)
          .in('applicant_id', otherIds)
          .neq('status', 'withdrawn'),
      ])
      if (profiles.error) throw profiles.error
      if (apps.error) throw apps.error
      const byId = new Map(((profiles.data ?? []) as DetailRow[]).map((p) => [p.id, p]))
      const appRows = (apps.data ?? []) as { applicant_id: string; status: string; applied_at: string | null }[]
      const appliedIds = new Set(appRows.map((a) => a.applicant_id))
      // Latest still-open application per person.
      const openAt = new Map<string, string>()
      for (const a of appRows) {
        if (!(WAITING_APPLICATION_STATUSES as readonly string[]).includes(a.status)) continue
        const at = a.applied_at ?? '1970-01-01T00:00:00Z'
        const prev = openAt.get(a.applicant_id)
        if (!prev || at > prev) openAt.set(a.applicant_id, at)
      }
      // Only conversations with someone who has an open application need a
      // look at when the club last wrote in them.
      const candidates = rows.filter((r) => openAt.has(r.other_participant_id)).map((r) => r.conversation_id)
      const mine = candidates.length
        ? await supabase
          .from('messages')
          .select('conversation_id, sent_at')
          .eq('sender_id', clubId as string)
          .in('conversation_id', candidates)
          .is('deleted_at', null)
          .order('sent_at', { ascending: false })
          .limit(2000)
        : { data: [] as { conversation_id: string; sent_at: string }[], error: null }
      if (mine.error) throw mine.error
      const clubLast = new Map<string, string>()
      for (const m of (mine.data ?? []) as { conversation_id: string; sent_at: string }[]) {
        if (!clubLast.has(m.conversation_id)) clubLast.set(m.conversation_id, m.sent_at)
      }
      const out = new Map<string, ClubInboxRowMeta>()
      for (const r of rows) {
        out.set(r.conversation_id, {
          detail: roleDetailOf(byId.get(r.other_participant_id)),
          applied: appliedIds.has(r.other_participant_id),
          waiting: isWaitingForFirstReply(openAt.get(r.other_participant_id), clubLast.get(r.conversation_id)),
        })
      }
      return out
    },
  })
}

/** The other person's application to one of the club's roles (chat card). */
export function useClubApplicationWith(clubId: string | null, otherId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['club-chat-application', clubId, otherId],
    enabled: enabled && Boolean(clubId) && Boolean(otherId),
    staleTime: 30_000,
    queryFn: async (): Promise<{ app: ClubApplication; expiryDays: number } | null> => {
      const [{ data, error }, { data: settings }] = await Promise.all([
        supabase
          .from('opportunity_applications')
          .select('id, status, applied_at, updated_at, opportunity:opportunities!inner(id, title, position, club_id)')
          .eq('applicant_id', otherId as string)
          .eq('opportunity.club_id', clubId as string)
          .neq('status', 'withdrawn')
          .order('applied_at', { ascending: false })
          .limit(10),
        supabase.from('application_response_settings').select('expiry_days').limit(1).maybeSingle(),
      ])
      if (error) throw error
      const apps = ((data ?? []) as unknown as { id: string; status: string; applied_at: string | null; updated_at: string | null; opportunity: { id: string; title: string | null; position: string | null } }[]).map((r) => ({
        id: r.id,
        opportunityId: r.opportunity.id,
        status: r.status,
        appliedAt: r.applied_at,
        updatedAt: r.updated_at,
        roleTitle: r.opportunity.title,
        rolePosition: r.opportunity.position,
      }))
      const app = pickApplication(apps)
      return app ? { app, expiryDays: (settings as { expiry_days?: number } | null)?.expiry_days ?? DEFAULT_EXPIRY_DAYS } : null
    },
  })
}
