import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useToastStore } from '@/lib/toast'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { hasTalked, signingErrorMessage, type OfferDraft, type OfferRow } from '@/lib/signing'

/**
 * Data for D4 · From yes to signed. opportunity_offers and the signing
 * functions (Track C, migrations 20260928110000 / 20260928120000) are newer
 * than the generated types, so they go through an untyped client here. RLS
 * lets only the publisher and the player read an offer; every write is a
 * SECURITY DEFINER function that re-checks who may do what.
 */
const db = supabase as unknown as SupabaseClient

export const SIGNING_KEY = ['signing'] as const

const OFFER_COLUMNS = 'id, application_id, opportunity_id, club_id, player_id, version, start_date, length, pay, package, open_until, note, status, sent_at, responded_at'

// ── Club: the road on one applicant (D4.1) ──

export interface RoadData {
  trial: boolean
  talked: boolean
  signedAt: string | null
  shortlistedAt: string | null
  /** The newest offer of any status (the live one while it waits). */
  offer: OfferRow | null
  /** Others still waiting on this role (pending / shortlisted / maybe / offered / accepted). */
  waiting: number
  /** The role, for the offer defaults and the close-the-role line. */
  role: { id: string; title: string; position: string | null; opportunity_type: string | null; status: string; start_date: string | null; duration_text: string | null; compensation: string | null; benefits: string[] | null; custom_benefits: string[] | null } | null
}

export function roadKey(applicationId: string) {
  return [...SIGNING_KEY, 'road', applicationId] as const
}

export function useApplicationRoad(opts: { applicationId: string; roleId: string; clubId: string | null; playerId: string | null; enabled: boolean }) {
  const { applicationId, roleId, clubId, playerId, enabled } = opts
  const query = useQuery({
    queryKey: roadKey(applicationId),
    enabled: enabled && !!clubId && !!playerId,
    staleTime: 15_000,
    queryFn: async (): Promise<RoadData> => {
      const [app, offers, history, role, waiting, conv] = await Promise.all([
        db.from('opportunity_applications').select('trial, signed_at').eq('id', applicationId).maybeSingle(),
        db.from('opportunity_offers').select(OFFER_COLUMNS).eq('application_id', applicationId).order('version', { ascending: false }).limit(1),
        supabase.from('application_status_history').select('created_at').eq('application_id', applicationId).eq('new_status', 'shortlisted').order('created_at', { ascending: false }).limit(1),
        db.from('opportunities').select('id, title, position, opportunity_type, status, start_date, duration_text, compensation, benefits, custom_benefits').eq('id', roleId).maybeSingle(),
        supabase.from('opportunity_applications').select('id', { count: 'exact', head: true }).eq('opportunity_id', roleId).neq('id', applicationId)
          .in('status', ['pending', 'shortlisted', 'maybe', 'offered', 'accepted'] as never),
        supabase.from('conversations').select('id')
          .or(`and(participant_one_id.eq.${clubId},participant_two_id.eq.${playerId}),and(participant_one_id.eq.${playerId},participant_two_id.eq.${clubId})`)
          .maybeSingle(),
      ])
      if (app.error) reportSupabaseError('useSigning.road.application', app.error)
      if (offers.error) reportSupabaseError('useSigning.road.offers', offers.error)
      let talked = false
      const convId = (conv.data as { id: string } | null)?.id
      if (convId) {
        const { data: msgs } = await supabase.from('messages').select('sender_id, metadata').eq('conversation_id', convId).is('deleted_at', null).order('sent_at', { ascending: false }).limit(200)
        talked = hasTalked((msgs ?? []) as { sender_id: string; metadata: unknown }[], clubId as string, playerId as string)
      }
      const a = (app.data ?? null) as { trial?: boolean; signed_at?: string | null } | null
      return {
        trial: a?.trial === true,
        talked,
        signedAt: a?.signed_at ?? null,
        shortlistedAt: ((history.data ?? []) as { created_at: string }[])[0]?.created_at ?? null,
        offer: ((offers.data ?? []) as OfferRow[])[0] ?? null,
        waiting: waiting.count ?? 0,
        role: (role.data ?? null) as RoadData['role'],
      }
    },
  })
  return { data: query.data ?? null, loading: query.isLoading, refetch: query.refetch }
}

// ── The offer card in the chat (D4.3) ──

export interface OfferCardData {
  offer: OfferRow
  role: { id: string; title: string; position: string | null; opportunity_type: string | null; status: string }
  playerName: string | null
}

export function offerCardKey(offerId: string) {
  return [...SIGNING_KEY, 'offer', offerId] as const
}

export function useOfferCard(offerId: string | null) {
  const query = useQuery({
    queryKey: offerCardKey(offerId ?? 'none'),
    enabled: !!offerId,
    staleTime: 15_000,
    queryFn: async (): Promise<OfferCardData | null> => {
      const { data: offer, error } = await db.from('opportunity_offers').select(OFFER_COLUMNS).eq('id', offerId as string).maybeSingle()
      if (error) reportSupabaseError('useSigning.offerCard', error)
      if (!offer) return null
      const o = offer as OfferRow
      const [{ data: role }, { data: player }] = await Promise.all([
        supabase.from('opportunities').select('id, title, position, opportunity_type, status').eq('id', o.opportunity_id).maybeSingle(),
        supabase.from('profiles').select('full_name').eq('id', o.player_id).maybeSingle(),
      ])
      if (!role) return null
      return { offer: o, role: role as OfferCardData['role'], playerName: (player as { full_name: string | null } | null)?.full_name ?? null }
    },
  })
  return { data: query.data ?? null, loading: query.isLoading }
}

/** The applicant's own status (the "Confirm signing" link under the server's step line). */
export function useOwnApplicationStatus(applicationId: string | null, enabled: boolean) {
  const query = useQuery({
    queryKey: [...SIGNING_KEY, 'status', applicationId ?? 'none'],
    enabled: enabled && !!applicationId,
    staleTime: 15_000,
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase.from('opportunity_applications').select('status').eq('id', applicationId as string).maybeSingle()
      return (data as { status: string } | null)?.status ?? null
    },
  })
  return query.data ?? null
}

// ── The player's confirm / signed screens (D4.5 / D4.6) ──

export interface SigningData {
  application: { id: string; status: string; applicant_id: string; signing_requested_at: string | null; signed_at: string | null }
  role: { id: string; title: string; position: string | null; opportunity_type: string | null; organization_name: string | null; level_sought: string | null; gender: string | null; start_date: string | null; duration_text: string | null }
  club: { id: string; full_name: string | null; avatar_url: string | null; role: string | null; mens_league_division: string | null; womens_league_division: string | null }
  offer: Pick<OfferRow, 'start_date' | 'length'> | null
}

export function signingKey(applicationId: string) {
  return [...SIGNING_KEY, 'confirm', applicationId] as const
}

export function useSigningData(applicationId: string | null) {
  const query = useQuery({
    queryKey: signingKey(applicationId ?? 'none'),
    enabled: !!applicationId,
    staleTime: 10_000,
    queryFn: async (): Promise<SigningData | null> => {
      const { data: app, error } = await db.from('opportunity_applications')
        .select('id, status, applicant_id, opportunity_id, signing_requested_at, signed_at')
        .eq('id', applicationId as string).maybeSingle()
      if (error) reportSupabaseError('useSigning.confirm.application', error)
      if (!app) return null
      const a = app as SigningData['application'] & { opportunity_id: string }
      const { data: role } = await supabase.from('opportunities')
        .select('id, title, position, opportunity_type, organization_name, level_sought, gender, start_date, duration_text, club_id')
        .eq('id', a.opportunity_id).maybeSingle()
      if (!role) return null
      const r = role as SigningData['role'] & { club_id: string }
      const [{ data: club }, { data: offers }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, avatar_url, role, mens_league_division, womens_league_division').eq('id', r.club_id).maybeSingle(),
        db.from('opportunity_offers').select('start_date, length').eq('application_id', a.id).eq('status', 'accepted').order('version', { ascending: false }).limit(1),
      ])
      return {
        application: a,
        role: r,
        club: (club ?? { id: r.club_id, full_name: null, avatar_url: null, role: null, mens_league_division: null, womens_league_division: null }) as SigningData['club'],
        offer: ((offers ?? []) as SigningData['offer'][])[0] ?? null,
      }
    },
  })
  return { data: query.data ?? null, loading: query.isLoading, refetch: query.refetch }
}

// ── Writes ──

type RpcResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string }

/**
 * Every D4 write in one place: the server function, the analytics event,
 * the toast on failure (with the server's reason when it is one people can
 * act on) and the cache refresh. Each returns ok or the reason.
 */
export function useSigningActions() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const [busy, setBusy] = useState(false)

  const call = useCallback(async (fn: string, args: Record<string, unknown>, fallback: string, event?: [string, string, string, Record<string, unknown>?]): Promise<RpcResult> => {
    setBusy(true)
    try {
      const { data, error } = await db.rpc(fn, args)
      if (error) {
        const message = signingErrorMessage(error, fallback)
        if (message === fallback) reportSupabaseError(`useSigning.${fn}`, error)
        addToast(message, 'error')
        void queryClient.invalidateQueries({ queryKey: SIGNING_KEY })
        return { ok: false, error: message }
      }
      if (event) trackDbEvent(event[0], event[1], event[2], event[3] ?? {})
      void queryClient.invalidateQueries({ queryKey: SIGNING_KEY })
      return { ok: true, data: (data ?? {}) as Record<string, unknown> }
    } catch (err) {
      reportSupabaseError(`useSigning.${fn}.exception`, err)
      addToast(fallback, 'error')
      return { ok: false, error: fallback }
    } finally {
      setBusy(false)
    }
  }, [queryClient, addToast])

  const makeOffer = useCallback((applicationId: string, d: OfferDraft) => call('make_offer', {
    p_application_id: applicationId,
    p_open_until: d.openUntil,
    p_start_date: d.startDate || null,
    p_length: d.length?.trim() || null,
    p_pay: d.pay || null,
    // An explicit list (possibly empty) so a package the club cleared stays cleared.
    p_package: d.package,
    p_note: d.note.trim() || null,
  }, 'Couldn’t send the offer. Please try again.', ['offer_sent', 'application', applicationId]), [call])

  const withdrawOffer = useCallback((offerId: string, applicationId: string) =>
    call('withdraw_offer', { p_offer_id: offerId }, 'Couldn’t withdraw the offer. Please try again.', ['offer_withdrawn', 'application', applicationId]), [call])

  const respondOffer = useCallback((offerId: string, accept: boolean, reason: string | null) =>
    call('respond_offer', { p_offer_id: offerId, p_accept: accept, p_reason: reason?.trim() || null }, 'Couldn’t send your answer. Please try again.',
      [accept ? 'offer_accepted' : 'offer_declined', 'offer', offerId]), [call])

  const markSigned = useCallback((applicationId: string, closeRole: boolean) =>
    call('mark_signed', { p_application_id: applicationId, p_close_role: closeRole }, 'Couldn’t mark the signing. Please try again.',
      ['signing_marked', 'application', applicationId, { close_role: closeRole }]), [call])

  const undoMarkSigned = useCallback((applicationId: string) =>
    call('undo_mark_signed', { p_application_id: applicationId }, 'Couldn’t undo the signing. Please try again.', ['signing_undone', 'application', applicationId]), [call])

  const confirmSigning = useCallback((applicationId: string, hideFromClubs: boolean) =>
    call('confirm_signing', { p_application_id: applicationId, p_hide_from_clubs: hideFromClubs }, 'Couldn’t confirm the signing. Please try again.',
      ['signing_confirmed', 'application', applicationId, { hide_from_clubs: hideFromClubs }]), [call])

  const setTrial = useCallback((applicationId: string, trial: boolean) =>
    call('set_trial', { p_application_id: applicationId, p_trial: trial }, 'Couldn’t save the trial. Please try again.'), [call])

  const withdrawApplication = useCallback((applicationId: string) =>
    call('withdraw_application', { p_application_id: applicationId }, 'Couldn’t withdraw the application. Please try again.', ['application_withdrawn', 'application', applicationId]), [call])

  return { busy, makeOffer, withdrawOffer, respondOffer, markSigned, undoMarkSigned, confirmSigning, setTrial, withdrawApplication }
}
