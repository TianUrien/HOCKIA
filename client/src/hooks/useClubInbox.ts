import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { humanizeToken } from '@/lib/identity'
import { getSpecializationLabel } from '@/lib/coachSpecializations'
import { clubLeadLeague } from '@/lib/clubProfileCopy'
import { DEFAULT_EXPIRY_DAYS } from '@/lib/clubRecruiting'
import { pickApplication, type ClubApplication } from '@/lib/clubInbox'

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
  /** The club has never sent a message in this conversation (amber dot). */
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
  if (p.role === 'player') return humanizeToken(p.position)
  if (p.role === 'coach') return p.coach_specialization ? getSpecializationLabel(p.coach_specialization, p.coach_specialization_custom) : null
  if (p.role === 'club') return clubLeadLeague(p.mens_league_division, p.womens_league_division)
  if (p.role === 'umpire') return p.umpire_level
  return null
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
      // A conversation whose last message is the club's is answered; only the
      // others need a look at whether the club ever wrote in them.
      const unsure = rows.filter((r) => r.last_message_sender_id !== clubId).map((r) => r.conversation_id)
      const [profiles, apps, mine] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, role, position, coach_specialization, coach_specialization_custom, mens_league_division, womens_league_division, umpire_level')
          .in('id', otherIds),
        supabase
          .from('opportunity_applications')
          .select('applicant_id, opportunity:opportunities!inner(club_id)')
          .eq('opportunity.club_id', clubId as string)
          .in('applicant_id', otherIds)
          .neq('status', 'withdrawn'),
        unsure.length
          ? supabase.from('messages').select('conversation_id').eq('sender_id', clubId as string).in('conversation_id', unsure).is('deleted_at', null).limit(2000)
          : Promise.resolve({ data: [] as { conversation_id: string }[], error: null }),
      ])
      if (profiles.error) throw profiles.error
      if (apps.error) throw apps.error
      if (mine.error) throw mine.error
      const byId = new Map(((profiles.data ?? []) as DetailRow[]).map((p) => [p.id, p]))
      const appliedIds = new Set(((apps.data ?? []) as { applicant_id: string }[]).map((a) => a.applicant_id))
      const wrote = new Set(((mine.data ?? []) as { conversation_id: string }[]).map((m) => m.conversation_id))
      const out = new Map<string, ClubInboxRowMeta>()
      for (const r of rows) {
        out.set(r.conversation_id, {
          detail: roleDetailOf(byId.get(r.other_participant_id)),
          applied: appliedIds.has(r.other_participant_id),
          waiting: r.last_message_sender_id !== clubId && !wrote.has(r.conversation_id),
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
