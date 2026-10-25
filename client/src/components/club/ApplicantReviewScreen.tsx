import { safeVideoHref, videoLinkSite } from '@/lib/videoUrlValidator'
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Check, ExternalLink, Lock, MessageCircle, MoreHorizontal, Target, UserRound } from 'lucide-react'
import ProfileActionMenu from '@/components/ProfileActionMenu'
import { GlassChip, RoleCover } from '@/components/opportunities/RoleCover'
import { setStatusBarForBackground } from '@/lib/nativeUi'
import { BackGlyph } from '@/components/ui/BackGlyph'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { ProfileVideoTile } from '@/components/profile/mobile/ProfileVideoTile'
import { CareerRow, ReferenceCard } from '@/components/profile/mobile/ProfileLongScroll'
import { FitCard } from './FitCard'
import { DeclineSheet } from './DeclineSheet'
import { RoadToSigningCard } from './RoadToSigningCard'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { useApplicationRoad, useSigningActions } from '@/hooks/useSigning'
import { inviteRoleLabel } from '@/lib/invites'
import { clubRoadTag, closedApplicantTag, isOnRoad, offerDeclinedNote, roadHeaderLine, roadMainAction, roadMenu, roadSteps, roadWaitingLine, shortDayOf, type OfferDraft, type RoadMenuItem } from '@/lib/signing'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useCountries } from '@/hooks/useCountries'
import { useProfileScrollData } from '@/hooks/useProfileScrollData'
import { useTrustedReferences } from '@/hooks/useTrustedReferences'
import { usePublisherOrganisation } from '@/hooks/usePublisherOrganisation'
import { COACH_SIGNING_NEEDS_CLUB_NOTE, coachSigningNeedsClub } from '@/lib/coachRoles'
import { cachedRoleApplicants, markRoleApplicantViewed, patchRoleApplicantStatus } from '@/hooks/useRoleApplicants'
import { UndoToast } from './UndoToast'
import { useReviewRun } from '@/lib/reviewRun'
import { holdDecision } from '@/lib/pendingDecisions'
import { APPLICATION_MOVED_ON_MESSAGE, WITHDRAWN_APPLICATION_MESSAGE, applicationNote, closedApplicationNote, isDecidableApplicationStatus } from '@/lib/applicationStatus'
import { useUndoToast } from '@/lib/undoToast'
import { getImageUrl } from '@/lib/imageUrl'
import { categoryToDisplay } from '@/lib/hockeyCategories'
import { specialistSkillLabel } from '@/lib/specialistSkills'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { canOpenLinkedDecline, DECLINE_DEEP_LINK_PARAM, DECLINE_DEEP_LINK_REASON, wantsDeclineSheet, daysLeftLabel, daysLeftToReply, decisionToast, DEFAULT_EXPIRY_DAYS, fitRows, fitTarget, isClubReplyUrgent, personRoleLine, type FitComponents, type FitState } from '@/lib/clubRecruiting'
import { cn } from '@/lib/utils'
import { flagForCountryName } from '@/lib/careerCopy'
import { profileVideoTotal } from '@/hooks/useProfileVideoTotal'
import { MENU_ICON_CLASS } from '@/lib/report'
import { nationalityCountries } from '@/lib/nationality'
import { fitChipLabel } from '@/lib/clubRecruiting'
import { FitBadge } from '@/components/ui/FitBadge'
import { EuBadge } from '@/components/ui/NationalityBadges'
import type { Json } from '@/lib/database.types'

// D4.2 / D4.4 sheets: their own chunks, loaded when the club opens one.
const OfferSheet = lazy(() => import('./OfferSheet'))
const MarkSignedSheet = lazy(() => import('./MarkSignedSheet'))

const HERO_HEIGHT = 360

const MENU_LABEL: Record<RoadMenuItem, string> = {
  mark_signed: 'Mark as signed',
  decline: 'Not moving forward',
  withdraw_offer: 'Withdraw offer',
  undo_signing: 'Undo signing',
}

/**
 * Applicant review (Figma 04 Club 326:319 / scrolled 327:318; DEV NOTEs
 * 327:563 · 327:570). Club-only: the fit card lists compute_club_fit's four
 * components as plain checks and names the missing side for Level instead
 * of showing 0%. Opening the review records the view (record_application_view).
 * The decision bar writes opportunity_applications.status; every decision is
 * held for the Undo window (lib/pendingDecisions) and the club goes back to
 * Applicants with "<Name> shortlisted · Undo".
 *
 * D4 (Figma 390:3 / 390:249 / 390:647; DEV NOTES 391:23 · 391:28 · 391:36):
 * from Shortlist on, a five-step road to signing replaces the decision bar
 * with "…" · Message · the next step (Make an offer → Edit offer → Mark as
 * signed). "…" holds Not moving forward (the Decline sheet), Mark as signed
 * without an offer, Withdraw offer and Undo signing, as the server allows.
 */
/** Keyboard decisions for the desktop master-detail (S / M / D). */
export interface ReviewActions { shortlist: () => void; maybe: () => void; decline: () => void }

interface Props {
  roleId: string
  applicationId: string
  /** 'pane' = the detail side of the desktop applicants page (Figma D4
   *  195:987): photo 300×380 beside the name, nationalities + EU, fit, inline
   *  Decline / Maybe / Shortlist, then the same sections. Same logic, same
   *  undo toast; after a decision the page moves on instead of going back. */
  layout?: 'screen' | 'pane'
  /** Pane only: a decision was taken (the page selects the next applicant). */
  onDecided?: (status: string) => void
  /** Pane only: S / M / D from the page's keyboard handler. */
  actionsRef?: MutableRefObject<ReviewActions | null>
}

type Person = {
  id: string; full_name: string | null; avatar_url: string | null; role: string | null; position: string | null; secondary_position: string | null
  nationality_country_id: number | null; nationality2_country_id: number | null; base_location: string | null; playing_category: string | null
  gender: string | null; last_active_at: string | null; current_club: string | null; current_world_club_id: string | null; specialist_skills: string[] | null
  highlight_video_url?: string | null
}
type Review = {
  status: string; appliedAt: string | null; metadata: Record<string, unknown>
  person: Person; age: number | null; roleGender: string | null; expiryDays: number
  fit: { state: FitState; components: FitComponents } | null
  playerClub: { name: string; crest: string | null; leagueBanded: boolean } | null
  clubLeagueBanded: boolean
}

// Dates read day first app-wide ("2 Oct"), the one format the signing road uses.
const monthDay = (iso: string | null) => shortDayOf(iso)

export default function ApplicantReviewScreen({ roleId, applicationId, layout = 'screen', onDecided, actionsRef }: Props) {
  const pane = layout === 'pane'
  const navigate = useNavigate()
  const location = useLocation()
  const club = useAuthStore((s) => s.profile)
  const user = useAuthStore((s) => s.user)
  const addToast = useToastStore((s) => s.addToast)
  const showUndo = useUndoToast((s) => s.show)
  const { countries } = useCountries()
  const [review, setReview] = useState<Review | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [declining, setDeclining] = useState(false)
  // B2: "Decline with a kind note" in the Last call email (?decline=1).
  const [searchParams, setSearchParams] = useSearchParams()
  const [linkedDeclineReason, setLinkedDeclineReason] = useState<string | null>(null)
  const declineLinkHandled = useRef(false)
  const [scrolled, setScrolled] = useState(false)
  const [sheet, setSheet] = useState<'offer' | 'sign' | 'menu' | null>(null)
  const [confirm, setConfirm] = useState<'withdraw_offer' | 'undo_signing' | null>(null)
  const signing = useSigningActions()

  const playerId = review?.person.id ?? null
  useEffect(() => { if (pane) return; void setStatusBarForBackground('dark-bg'); return () => { void setStatusBarForBackground('light-bg') } }, [pane])
  const scroll = useProfileScrollData(playerId, Boolean(playerId))
  const { acceptedReferences } = useTrustedReferences(playerId ?? '')

  useEffect(() => {
    if (!club?.id) return
    let cancelled = false
    void (async () => {
      const { data: app, error: appErr } = await supabase
        .from('opportunity_applications')
        .select(`status, applied_at, metadata, opportunity_id,
          applicant:applicant_id ( id, full_name, avatar_url, role, position, secondary_position, nationality_country_id, nationality2_country_id, base_location, playing_category, gender, last_active_at, current_club, current_world_club_id, specialist_skills, highlight_video_url )`)
        .eq('id', applicationId)
        .maybeSingle()
      if (cancelled) return
      const row = app as unknown as { status: string; applied_at: string | null; metadata: unknown; opportunity_id: string; applicant: Person | null } | null
      if (appErr || !row?.applicant || row.opportunity_id !== roleId) { setError('This application isn’t available.'); return }
      // Opening the review records the view (drops "New" on Applicants).
      void supabase.rpc('record_application_view', { p_application_id: applicationId }).then(({ error: e }) => { if (e) logger.warn('record_application_view failed', e) })
      markRoleApplicantViewed(roleId, applicationId)

      const person = row.applicant
      const [{ data: role }, { data: ages }, { data: settings }, { data: wc }, clubLeagues] = await Promise.all([
        supabase.from('opportunities').select('gender, club_id').eq('id', roleId).maybeSingle(),
        supabase.rpc('get_profile_ages', { p_ids: [person.id] }),
        supabase.from('application_response_settings').select('expiry_days').limit(1).maybeSingle(),
        person.current_world_club_id
          ? supabase.from('world_clubs').select('club_name, avatar_url, men_league_id, women_league_id').eq('id', person.current_world_club_id).maybeSingle()
          : Promise.resolve({ data: null }),
        (async () => {
          // The publisher's level = the league of their current club (what
          // compute_club_fit bands by) plus a club account's own league ids;
          // a coach who recruits has only the former.
          const own = club.current_world_club_id
            ? ((await supabase.from('world_clubs').select('men_league_id, women_league_id').eq('id', club.current_world_club_id).maybeSingle()).data as { men_league_id: number | null; women_league_id: number | null } | null)
            : null
          const ids = [own?.men_league_id, own?.women_league_id, club.mens_league_id, club.womens_league_id].filter((x, i, a): x is number => typeof x === 'number' && a.indexOf(x) === i)
          return ids.length ? supabase.from('world_leagues').select('id, level_band_global').in('id', ids) : { data: [] }
        })(),
      ])
      if (cancelled) return
      const roleGender = (role as { gender: string | null } | null)?.gender ?? null
      // A withdrawn application is read-only for the record: no fit for it.
      const target = row.status === 'withdrawn' ? null : fitTarget(roleGender)
      const { data: fitData } = target
        ? await supabase.rpc('compute_club_fit', { p_owner_id: club.id, p_player_id: person.id, p_target: target, p_region: null as unknown as string, p_opportunity_id: roleId })
        : { data: null }
      const w = wc as { club_name: string; avatar_url: string | null; men_league_id: number | null; women_league_id: number | null } | null
      let playerBanded = false
      if (w) {
        const ids = [w.men_league_id, w.women_league_id].filter((x): x is number => typeof x === 'number')
        if (ids.length) {
          const { data: lg } = await supabase.from('world_leagues').select('level_band_global').in('id', ids)
          playerBanded = ((lg ?? []) as { level_band_global: number | null }[]).some((l) => l.level_band_global !== null)
        }
      }
      if (cancelled) return
      const fitRow = (fitData as { state: FitState; components: FitComponents }[] | null)?.[0] ?? null
      setReview({
        status: row.status,
        appliedAt: row.applied_at,
        metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {},
        person,
        age: ((ages ?? []) as { age: number }[])[0]?.age ?? null,
        roleGender,
        expiryDays: (settings as { expiry_days?: number } | null)?.expiry_days ?? DEFAULT_EXPIRY_DAYS,
        fit: fitRow ? { state: fitRow.state, components: fitRow.components } : null,
        playerClub: w ? { name: w.club_name, crest: w.avatar_url, leagueBanded: playerBanded } : person.current_club ? { name: person.current_club, crest: null, leagueBanded: false } : null,
        clubLeagueBanded: ((clubLeagues.data ?? []) as { level_band_global: number | null }[]).some((l) => l.level_band_global !== null),
      })
    })().catch((err) => {
      logger.error('[ApplicantReviewScreen] load failed', err)
      if (!cancelled) setError('Couldn’t load this application.')
    })
    return () => { cancelled = true }
  }, [club?.id, club?.mens_league_id, club?.womens_league_id, club?.current_world_club_id, roleId, applicationId])

  const p = review?.person
  const firstName = p?.full_name?.trim().split(/\s+/)[0] || 'this player'
  const onRoad = review ? isOnRoad(review.status) : false
  const road = useApplicationRoad({ applicationId, roleId, clubId: club?.id ?? null, playerId, enabled: onRoad })
  const roadData = road.data
  // Who the offer and the signing are with: the club, or — for a coach who
  // recruits — the organisation the role is for, never the coach.
  const organisation = usePublisherOrganisation(roadData?.role)
  const signingNeedsClub = onRoad && coachSigningNeedsClub(club, roadData?.role)
  // The D4 sheets are lazy chunks: fetch them as soon as the road shows so
  // the first tap on "Make an offer" opens the sheet instead of waiting on a
  // download with a null fallback (QA 2 Oct: the first tap did nothing).
  useEffect(() => {
    if (!onRoad) return
    void import('./OfferSheet')
    void import('./MarkSignedSheet')
  }, [onRoad])
  const steps = review && onRoad
    ? roadSteps({ status: review.status, talked: roadData?.talked ?? false, trial: roadData?.trial ?? false, firstName, shortlistedAt: roadData?.shortlistedAt, offer: roadData?.offer, signedAt: roadData?.signedAt })
    : []
  const roleLabel = roadData?.role ? inviteRoleLabel(roadData.role) : 'this opportunity'
  const liveOffer = roadData?.offer?.status === 'live' ? roadData.offer : null
  // The player declined the newest offer: their reason, grey, under the road.
  const declinedNote = onRoad ? offerDeclinedNote(firstName, roadData?.offer) : null
  // A road step moved: the review, the Applicants list and the road all follow.
  const moved = (status: string | null) => {
    if (status) {
      setReview((r) => (r ? { ...r, status } : r))
      patchRoleApplicantStatus(roleId, applicationId, status)
    }
    void road.refetch()
  }
  const sendOffer = async (d: OfferDraft) => {
    const res = await signing.makeOffer(applicationId, d)
    if (res.ok) { setSheet(null); addToast(liveOffer ? `Updated offer sent to ${firstName}` : `Offer sent to ${firstName}`, 'success'); moved('offered') }
  }
  const markSigned = async (closeRole: boolean) => {
    const res = await signing.markSigned(applicationId, closeRole)
    if (res.ok) { setSheet(null); addToast(`${firstName} will be asked to confirm`, 'success'); moved('signed_pending_confirmation') }
  }
  const toggleTrial = async () => {
    const res = await signing.setTrial(applicationId, !(roadData?.trial ?? false))
    if (res.ok) void road.refetch()
  }
  const runConfirm = async () => {
    if (confirm === 'withdraw_offer' && liveOffer) {
      const res = await signing.withdrawOffer(liveOffer.id, applicationId)
      if (!res.ok) throw new Error(res.error)
      moved('shortlisted')
    } else if (confirm === 'undo_signing') {
      const res = await signing.undoMarkSigned(applicationId)
      if (!res.ok) throw new Error(res.error)
      moved(typeof res.data.status === 'string' ? res.data.status : null)
    }
  }
  const pickMenu = (item: RoadMenuItem) => {
    setSheet(null)
    if (item === 'decline') setDeclining(true)
    else if (item === 'mark_signed') setSheet('sign')
    else setConfirm(item)
  }
  const rows = useMemo(() => {
    if (!review) return []
    const lastDays = review.person.last_active_at ? Math.max(0, Math.floor((Date.now() - new Date(review.person.last_active_at).getTime()) / 86_400_000)) : null
    return fitRows(review.fit?.components ?? {}, {
      roleGender: review.roleGender,
      playerCategoryLabel: categoryToDisplay(review.person.playing_category) || null,
      firstName,
      lastActiveDays: lastDays,
      playerClub: review.playerClub?.name ?? null,
      playerLeagueKnown: Boolean(review.playerClub?.leagueBanded),
      clubLeagueKnown: review.clubLeagueBanded,
    })
  }, [review, firstName])

  const countryRow = (id: number | null) => {
    const c = id ? countries.find((x) => x.id === id) : null
    return c ? [c.flag_emoji, c.common_name || c.name].filter(Boolean).join(' ') : null
  }
  const passports = [countryRow(p?.nationality_country_id ?? null), countryRow(p?.nationality2_country_id ?? null)].filter((x): x is string => Boolean(x))
  const days = review?.status === 'pending' ? daysLeftToReply(review.appliedAt, review.expiryDays) : null
  const replyLine = days === null ? null : days === 0 ? 'closes today' : `${daysLeftLabel(days)} to reply`
  const appliedLine = review
    ? onRoad ? roadHeaderLine(roadData?.shortlistedAt, review.appliedAt) : [`Applied ${monthDay(review.appliedAt)}`, review.status === 'pending' ? replyLine : null].filter(Boolean).join(' · ')
    : ''
  const backToApplicants = () => {
    const from = (location.state as { from?: string } | null)?.from
    if (from) navigate(from)
    else navigate(`/dashboard/opportunities/${roleId}/applicants`)
  }

  // Club speed CS7 (Figma 05 204:1358): on the phone, after a decision on an
  // applicant To review, the next one To review comes up (oldest first, like
  // desktop S/M/D), with "N of M to review"; the Undo toast stays on screen.
  // Back still returns to the list. Nothing left → back to the list.
  const run = useReviewRun((st) => st.runs[roleId] ?? 0)
  const stepRun = useReviewRun((st) => st.step)
  const resetRun = useReviewRun((st) => st.reset)
  // Opened from the list (not by moving on): a new run starts at 0.
  const advancedHere = Boolean((location.state as { advanced?: boolean } | null)?.advanced)
  useEffect(() => { if (!pane && !advancedHere) resetRun(roleId) }, [pane, advancedHere, resetRun, roleId])
  const waitingNow = (cachedRoleApplicants(roleId) ?? []).filter((a) => a.status === 'pending')
  const reviewTotal = run + waitingNow.length
  const showCounter = review?.status === 'pending' && reviewTotal > 1 && waitingNow.some((a) => a.applicationId === applicationId)
  const advance = (prevStatus: string) => {
    if (prevStatus !== 'pending') { backToApplicants(); return }
    const next = (cachedRoleApplicants(roleId) ?? [])
      .filter((a) => a.status === 'pending' && a.applicationId !== applicationId)
      .sort((a, b) => (a.appliedAt ?? '').localeCompare(b.appliedAt ?? ''))[0]
    if (!next) { backToApplicants(); return }
    const from = (location.state as { from?: string } | null)?.from
    stepRun(roleId, 1)
    navigate(`/dashboard/opportunities/${roleId}/applicants/${next.applicationId}`, { replace: true, state: { from, advanced: true } })
  }

  const decide = (status: 'shortlisted' | 'maybe') => {
    if (!review) return
    const prev = review.status
    const metadata = { ...review.metadata, status_reason: null } as unknown as Json
    holdDecision({ kind: 'status', applicationId, status, metadata }, (ok, withdrawn) => {
      if (ok) trackDbEvent('applicant_status_change', 'application', applicationId, { new_status: status, reason: null })
      else if (withdrawn) { patchRoleApplicantStatus(roleId, applicationId, 'withdrawn'); addToast(WITHDRAWN_APPLICATION_MESSAGE, 'info') }
      else { patchRoleApplicantStatus(roleId, applicationId, prev); addToast('Couldn’t save that decision. Please try again.', 'error') }
    })
    patchRoleApplicantStatus(roleId, applicationId, status)
    showUndo({ applicationId, text: decisionToast(firstName, status), onUndo: () => { patchRoleApplicantStatus(roleId, applicationId, prev); if (!pane && prev === 'pending') stepRun(roleId, -1) } })
    if (pane) onDecided?.(status)
    else advance(prev)
  }

  const decline = (reason: string, message: string) => {
    if (!review) return
    const prev = review.status
    setDeclining(false)
    holdDecision({ kind: 'decline', applicationId, reason, message }, (ok, withdrawn, movedOn) => {
      if (ok) trackDbEvent('applicant_status_change', 'application', applicationId, { new_status: 'rejected', reason })
      else if (withdrawn) { patchRoleApplicantStatus(roleId, applicationId, 'withdrawn'); addToast(WITHDRAWN_APPLICATION_MESSAGE, 'info') }
      else if (movedOn) { patchRoleApplicantStatus(roleId, applicationId, prev); addToast(APPLICATION_MOVED_ON_MESSAGE, 'info') }
      else { patchRoleApplicantStatus(roleId, applicationId, prev); addToast('Couldn’t send the decline. Please try again.', 'error') }
    })
    patchRoleApplicantStatus(roleId, applicationId, 'rejected')
    showUndo({ applicationId, text: decisionToast(firstName, 'rejected'), onUndo: () => { patchRoleApplicantStatus(roleId, applicationId, prev); if (!pane && prev === 'pending') stepRun(roleId, -1) } })
    if (pane) onDecided?.('rejected')
    else advance(prev)
  }

  const message = async () => {
    if (!user || !p) return
    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .or(`and(participant_one_id.eq.${user.id},participant_two_id.eq.${p.id}),and(participant_one_id.eq.${p.id},participant_two_id.eq.${user.id})`)
      .maybeSingle()
    // Back label names where Chat returns (DEV NOTE 355:923: "Leandro"); a
    // chat started here is an Application conversation.
    const state = { returnTo: location.pathname, from: location.pathname, messageOrigin: 'Application', backLabel: p.full_name?.trim().split(/\s+/)[0] || undefined }
    if (conv?.id) navigate(`/messages?conversation=${conv.id}`, { state })
    else navigate(`/messages?new=${p.id}`, { state })
  }

  const note = review ? applicationNote(review.metadata) : null
  // Same number as the profile's Videos (profileVideoTotal): every tile, reels
  // and the legacy highlight link included. Clubs see recruiters-only rows, so
  // nothing is locked here.
  const videos = profileVideoTotal({
    videoRows: scroll.highlights.length + scroll.fullMatches.length + scroll.reels.length,
    fullGameLinks: scroll.fullGameLinks.length,
    hasLegacyHighlight: Boolean(p?.highlight_video_url?.trim()),
    lockedFullMatches: 0,
    lockedHighlights: 0,
  })
  const avatar = p?.avatar_url ? getImageUrl(p.avatar_url, 'avatar-lg') ?? p.avatar_url : null
  // Hero chips (Figma O9): the stage in brand while new, glass otherwise; applied + days left beside it.
  const heroStatus = (() => {
    if (!review) return { label: '', brand: false }
    const road = clubRoadTag(review.status) ?? closedApplicantTag(review.status)
    if (road) return { label: road, brand: false }
    if (review.status === 'pending') return { label: 'New', brand: true }
    if (review.status === 'shortlisted') return { label: 'Shortlisted', brand: false }
    if (review.status === 'maybe') return { label: 'Maybe', brand: false }
    if (review.status === 'rejected') return { label: 'Not a fit', brand: false }
    return { label: review.status, brand: false }
  })()
  const heroLine = p ? [personRoleLine({ role: p.role, position: p.position, secondaryPosition: p.secondary_position }), review?.age ? String(review.age) : null, ...passports].filter(Boolean).join(' · ') : ''
  const statusNote = review && review.status !== 'pending' && !onRoad
    ? { shortlisted: 'You shortlisted this player.', maybe: 'You marked this player maybe.', rejected: 'You marked this application not a fit.', no_response: 'Closed without a reply.', filled: 'This opportunity was filled.', withdrawn: 'Withdrawn by the applicant.' }[review.status] ?? null
    : null
  // Closed applications (no reply, filled, withdrawn, signing statuses) can't
  // be re-decided: no decision bar, just the grey note with Message.
  const decidable = review ? isDecidableApplicationStatus(review.status) && !onRoad : false
  // A coach with no club on the role or the profile can't mark a signing yet:
  // the career entry would be named after the coach (coachSigningNeedsClub).
  // The email deep link opens the Decline sheet once, when the review has
  // loaded and the application can still be declined; the param is dropped
  // so Back or a refresh never re-opens it.
  useEffect(() => {
    if (!review || declineLinkHandled.current || !wantsDeclineSheet(searchParams)) return
    declineLinkHandled.current = true
    const next = new URLSearchParams(searchParams)
    next.delete(DECLINE_DEEP_LINK_PARAM)
    setSearchParams(next, { replace: true })
    if (canOpenLinkedDecline(review.status, decidable)) {
      setLinkedDeclineReason(DECLINE_DEEP_LINK_REASON)
      setDeclining(true)
    }
  }, [review, decidable, searchParams, setSearchParams])
  useEffect(() => {
    if (!actionsRef) return
    actionsRef.current = {
      shortlist: () => { if (decidable && review?.status !== 'shortlisted') decide('shortlisted') },
      maybe: () => { if (decidable && review?.status !== 'maybe') decide('maybe') },
      decline: () => { if (decidable && review?.status !== 'rejected') setDeclining(true) },
    }
    return () => { actionsRef.current = null }
  })
  const roadAction = review && onRoad ? roadMainAction(review.status) : null
  const mainAction = signingNeedsClub && roadAction === 'mark_signed' ? null : roadAction
  const menu = (review && onRoad ? roadMenu(review.status) : []).filter((item) => !(signingNeedsClub && item === 'mark_signed'))
  const waitingLine = review && onRoad
    ? signingNeedsClub && roadAction === 'mark_signed' ? COACH_SIGNING_NEEDS_CLUB_NOTE : roadWaitingLine(review.status, firstName)
    : null

  function renderPane() {
    const nats = p ? nationalityCountries([p.nationality_country_id, p.nationality2_country_id], countries) : []
    const fitLine = review?.fit?.state ? fitChipLabel(review.fit.state) : null
    const H2 = 'text-[22px] font-bold leading-7 tracking-[-0.01em] text-ink-1'
    return (
      <div className="min-w-0 pb-16" data-testid="applicant-review-pane">
        {error && <p className="py-6 text-row text-ink-2">{error}</p>}
        {!error && !review && <div className="h-[380px] animate-pulse rounded-[24px] bg-surface-subtle" />}
        {p && review && (
          <>
            <div className="flex gap-6">
              <div className="relative h-[380px] w-[300px] shrink-0 overflow-hidden rounded-[24px] bg-surface-subtle" data-testid="review-photo">
                {avatar
                  ? <img src={getImageUrl(p.avatar_url, 'feed-full') ?? avatar} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  : <span className="absolute inset-0 flex items-center justify-center"><EntityAvatar src={null} name={p.full_name} role={p.role} size={120} /></span>}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex items-start gap-2">
                  <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                    <span className={cn('rounded-full px-2.5 py-[3px] text-caption font-semibold', heroStatus.brand ? 'bg-brand-soft text-brand-primary' : 'bg-surface-muted text-ink-2')} data-testid="review-status-chip">{heroStatus.label}</span>
                    {appliedLine && <span className={cn('rounded-full bg-surface-subtle px-2.5 py-[3px] text-caption font-semibold', review.status === 'pending' && isClubReplyUrgent(review.appliedAt, days) ? 'text-status-warning' : 'text-ink-2')}>{appliedLine}</span>}
                  </div>
                  <ProfileActionMenu
                    targetId={p.id}
                    targetName={p.full_name ?? 'this player'}
                    showBlock={false}
                    triggerClassName="flex h-9 w-9 items-center justify-center rounded-full text-ink-2 hover:bg-surface-subtle"
                    iconClassName="h-[18px] w-[18px]"
                    leadingItems={[
                      { key: 'message', label: 'Message', icon: <MessageCircle className={MENU_ICON_CLASS} strokeWidth={1.8} />, onSelect: () => void message() },
                      { key: 'profile', label: 'View full profile', icon: <UserRound className={MENU_ICON_CLASS} strokeWidth={1.8} />, onSelect: () => navigate(`/players/id/${p.id}`, { state: { from: location.pathname } }) },
                    ]}
                  />
                </div>
                <h1 className="text-[34px] font-bold leading-[41px] tracking-[-0.015em] text-ink-1" data-testid="review-name">{p.full_name}</h1>
                <p className="-mt-1 text-[17px] leading-[22px] text-ink-2">{[personRoleLine({ role: p.role, position: p.position, secondaryPosition: p.secondary_position }), review.age ? String(review.age) : null].filter(Boolean).join(' · ')}</p>
                {nats.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2" data-testid="review-nationalities">
                    {nats.map((c) => (
                      <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full bg-surface-subtle px-2.5 py-1 text-secondary font-semibold text-ink-1">
                        {c.flag && <span aria-hidden="true">{c.flag}</span>}{c.name}
                      </span>
                    ))}
                    {nats.some((c) => c.isEu) && <EuBadge surface="light" />}
                  </div>
                )}
                {fitLine && review.fit?.state && review.status !== 'withdrawn' && (
                  <p className="flex" data-testid="review-fit-line">
                    <FitBadge state={review.fit.state} />
                  </p>
                )}
                {statusNote && <p className="rounded-[12px] bg-surface-subtle px-3.5 py-2.5 text-secondary text-ink-2">{statusNote}</p>}
                {decidable && (
                  <div data-testid="decision-bar">
                    <div className="flex gap-2.5">
                      <button type="button" onClick={() => setDeclining(true)} disabled={review.status === 'rejected'} className="flex h-[52px] w-[120px] items-center justify-center rounded-full bg-surface-subtle text-[16px] font-semibold text-status-danger transition-colors hover:bg-surface-muted disabled:opacity-40">Not a fit</button>
                      <button type="button" onClick={() => decide('maybe')} disabled={review.status === 'maybe'} className="flex h-[52px] w-[110px] items-center justify-center rounded-full bg-surface-subtle text-[16px] font-semibold text-ink-1 transition-colors hover:bg-surface-muted disabled:opacity-40">Maybe</button>
                      <button type="button" onClick={() => decide('shortlisted')} disabled={review.status === 'shortlisted'} className="flex h-[52px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full bg-hockia-primary text-[16px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40">
                        <Check className="h-[18px] w-[18px]" strokeWidth={2.4} /> Shortlist
                      </button>
                    </div>
                    <button type="button" onClick={() => void message()} className="mt-2 text-secondary font-semibold text-hockia-primary hover:underline">Message {firstName}</button>
                  </div>
                )}
                {onRoad && (
                  <div className="flex items-center gap-2.5" data-testid="road-bar">
                    {menu.length > 0 && (
                      <button type="button" onClick={() => setSheet('menu')} aria-label="More actions" className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-surface-subtle text-ink-1 hover:bg-surface-muted" data-testid="road-more">
                        <MoreHorizontal className="h-5 w-5" strokeWidth={2} />
                      </button>
                    )}
                    <button type="button" onClick={() => void message()} className="flex h-[52px] shrink-0 items-center justify-center rounded-full bg-surface-subtle px-5 text-[16px] font-semibold text-ink-1 hover:bg-surface-muted">Message</button>
                    {mainAction ? (
                      <button type="button" onClick={() => setSheet(mainAction === 'mark_signed' ? 'sign' : 'offer')} disabled={mainAction === 'edit_offer' && !liveOffer} className="flex h-[52px] min-w-0 flex-1 items-center justify-center rounded-full bg-hockia-primary px-3 text-[16px] font-semibold text-white disabled:opacity-60" data-testid="road-main">
                        <span className="truncate">{mainAction === 'make_offer' ? 'Make an offer' : mainAction === 'edit_offer' ? 'Edit offer' : 'Mark as signed'}</span>
                      </button>
                    ) : waitingLine ? (
                      <span className="flex min-h-12 min-w-0 flex-1 items-center justify-center rounded-[20px] bg-surface-grouped px-3 py-1.5 text-center text-secondary font-semibold leading-[17px] text-ink-2" data-testid="road-waiting">{waitingLine}</span>
                    ) : null}
                  </div>
                )}
                {!decidable && !onRoad && (
                  <div className="flex items-center gap-2 text-secondary text-ink-2" data-testid="closed-application-note">
                    <Lock className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={2} /> {closedApplicationNote(review.status, firstName)}
                    <button type="button" onClick={() => void message()} className="ml-auto shrink-0 font-semibold text-hockia-primary hover:underline">Message</button>
                  </div>
                )}
              </div>
            </div>

            {onRoad && (
              <div className="pt-6">
                <RoadToSigningCard steps={steps} onMessage={() => void message()} onToggleTrial={review.status !== 'signed' ? () => void toggleTrial() : undefined} trialBusy={signing.busy} />
                {declinedNote && <p className="mt-2 rounded-card bg-surface-grouped px-3.5 py-2.5 text-secondary leading-[18px] text-ink-2" data-testid="road-decline-note">{declinedNote}</p>}
              </div>
            )}

            {note && (
              <section className="pt-8" data-testid="applicant-note">
                <h2 className={H2}>In their words</h2>
                <p className="mt-2 max-w-[72ch] whitespace-pre-wrap break-words text-[17px] leading-[26px] text-ink-1">“{note}”</p>
              </section>
            )}

            <div className="grid grid-cols-2 gap-4 pt-8">
              {review.status !== 'withdrawn' ? <FitCard state={review.fit?.state} rows={rows} /> : <span />}
              <div className="overflow-hidden self-start rounded-2xl border border-line bg-white">
                {[
                  ...(review.age ? [{ k: 'Age', v: String(review.age) }] : []),
                  ...(p.base_location ? [{ k: 'Based in', v: p.base_location }] : []),
                  ...(review.playerClub ? [{ k: 'Club', v: review.playerClub.name }] : []),
                ].map((row, i) => (
                  <div key={row.k}>
                    {i > 0 && <div className="ml-3.5 h-[0.5px] bg-line" />}
                    <div className="flex h-[46px] items-center justify-between gap-3 px-3.5">
                      <span className="text-row text-ink-2">{row.k}</span>
                      <span className="min-w-0 truncate text-row font-medium text-ink-1">{row.v}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {videos > 0 && (
              <section className="pt-8">
                <div className="flex items-center justify-between pb-3">
                  <h2 className={H2}>Videos</h2>
                  <button type="button" onClick={() => navigate(`/players/id/${p.id}/videos`, { state: { from: location.pathname } })} className="text-row font-semibold text-hockia-primary hover:underline">See all {videos}</button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {scroll.fullGameLinks.slice(0, 2).map((l) => (
                    <a key={l.id} href={safeVideoHref(l.video_url) ?? undefined} target="_blank" rel="noopener noreferrer" className="relative flex aspect-video flex-col justify-end overflow-hidden rounded-[16px] bg-gradient-to-br from-ink-1 to-ink-2 p-3 text-left">
                      <span className="absolute left-2.5 top-2.5 rounded-full bg-black/70 px-2 py-[3px] text-[11px] font-semibold text-white">Full match</span>
                      <span className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-white"><ExternalLink className="h-3 w-3" /></span>
                      <span className="truncate text-secondary font-semibold text-white">{l.match_title?.trim() || (l.opponent_team ? `vs ${l.opponent_team}` : 'Full match')}</span>
                    </a>
                  ))}
                  {[...scroll.fullMatches, ...scroll.highlights].slice(0, Math.max(0, 4 - scroll.fullGameLinks.slice(0, 2).length)).map((v, i) => (
                    <ProfileVideoTile key={v.id} video={v} locked={false} canWatch eager={i < 2} onOpen={() => navigate(`/players/id/${p.id}/videos`, { state: { from: location.pathname } })} className="aspect-video w-full" />
                  ))}
                </div>
              </section>
            )}

            {scroll.career.length > 0 && (
              <section className="pt-8">
                <div className="flex items-center justify-between pb-2">
                  <h2 className={H2}>Career</h2>
                  <button type="button" onClick={() => navigate(`/players/id/${p.id}/journey`, { state: { from: location.pathname } })} className="text-row font-semibold text-hockia-primary hover:underline">See all</button>
                </div>
                {scroll.career.slice(0, 3).map((c, i, arr) => (
                  <CareerRow key={c.id} entry={c} last={i === arr.length - 1} flag={countryRow(c.representedCountryId)?.split(' ')[0] ?? null} locationFlag={flagForCountryName(countries, c.locationCountry)} />
                ))}
              </section>
            )}

            {(p.specialist_skills ?? []).length > 0 && (
              <section className="pt-8">
                <h2 className={`${H2} pb-2`}>Specialist skills</h2>
                <div className="flex flex-wrap gap-x-3.5 gap-y-2">
                  {(p.specialist_skills ?? []).map((sk) => (
                    <span key={sk} className="flex items-center gap-[7px] text-[14px] font-medium text-ink-1">
                      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-hockia-soft text-hockia-primary"><Target className="h-3.5 w-3.5" strokeWidth={2} /></span>
                      {specialistSkillLabel(sk)}
                    </span>
                  ))}
                </div>
              </section>
            )}

            <section className="pt-8">
              <h2 className={`${H2} pb-2`}>References</h2>
              <div className="grid grid-cols-2 gap-3">
                {acceptedReferences.length === 0
                  ? <p className="col-span-2 text-[14px] leading-5 text-ink-2">No references yet. References come from friends on Hockia. Coaches and teammates can write one.</p>
                  : acceptedReferences.slice(0, 2).map((r) => (
                    <ReferenceCard key={r.id} reference={r} onOpen={() => navigate(`/players/id/${p.id}/references`, { state: { from: location.pathname } })} />
                  ))}
              </div>
            </section>
          </>
        )}
        {overlays}
      </div>
    )
  }

  const overlays = (
    <>
      {/* "…" on the road: what the server allows at this step. */}
      <BottomSheet open={sheet === 'menu'} onClose={() => setSheet(null)} ariaLabel="More actions">
        <div className="px-3 pb-2 pt-1" data-testid="road-menu">
          {menu.map((item) => (
            <button key={item} type="button" onClick={() => pickMenu(item)} className={cn('flex h-12 w-full items-center rounded-xl px-3 text-left text-[16px] font-medium', item === 'decline' || item === 'withdraw_offer' || item === 'undo_signing' ? 'text-status-danger' : 'text-ink-1')} data-testid={`road-menu-${item}`}>
              {MENU_LABEL[item]}
            </button>
          ))}
          <button type="button" onClick={() => setSheet(null)} className="flex h-12 w-full items-center justify-center text-[16px] font-semibold text-ink-1">Cancel</button>
        </div>
      </BottomSheet>
      {sheet === 'offer' && (
        <Suspense fallback={null}>
          <OfferSheet
            open
            firstName={firstName}
            roleLabel={roleLabel}
            role={roadData?.role ?? null}
            current={liveOffer}
            publisherIsClub={organisation.isClub}
            organisation={organisation.name}
            busy={signing.busy}
            onClose={() => setSheet(null)}
            onSend={(d) => void sendOffer(d)}
          />
        </Suspense>
      )}
      {sheet === 'sign' && p && (
        <Suspense fallback={null}>
          <MarkSignedSheet
            open
            firstName={firstName}
            playerAvatar={avatar}
            playerName={p.full_name}
            clubAvatar={organisation.avatarUrl}
            clubName={organisation.name}
            publisherIsClub={organisation.isClub}
            roleLabel={roleLabel}
            waiting={roadData?.waiting ?? 0}
            busy={signing.busy}
            onClose={() => setSheet(null)}
            onConfirm={(closeRole) => void markSigned(closeRole)}
          />
        </Suspense>
      )}
      {/* Danger confirmations are sheets, like Decline (one surface per screen). */}
      <ConfirmSheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        title={confirm === 'withdraw_offer' ? 'Withdraw this offer?' : 'Undo the signing?'}
        message={confirm === 'withdraw_offer'
          ? `${firstName} is told the offer was withdrawn and goes back to Shortlisted.`
          : `${firstName} won’t be asked to confirm any more. You can mark the signing again later.`}
        confirmLabel={confirm === 'withdraw_offer' ? 'Withdraw offer' : 'Undo signing'}
        busyLabel={confirm === 'withdraw_offer' ? 'Withdrawing…' : 'Undoing…'}
        testId="road-confirm"
      />

      {p && (
        <DeclineSheet open={declining} applicationId={applicationId} firstName={firstName} hasName={Boolean(p.full_name?.trim())} onCancel={() => { setDeclining(false); setLinkedDeclineReason(null) }} onSend={decline} initialReason={linkedDeclineReason} />
      )}
    </>
  )

  if (pane) return renderPane()

  return (
    <div className="flex h-app-screen flex-col bg-white lg:hidden" data-testid="applicant-review-screen">
      <div className="flex-1 overflow-y-auto pb-40" onScroll={(e) => { const past = e.currentTarget.scrollTop > HERO_HEIGHT - 80; if (past !== scrolled) { setScrolled(past); void setStatusBarForBackground(past ? 'light-bg' : 'dark-bg') } }}>
        {error && <p className="px-5 py-6 text-row text-ink-2">{error}</p>}
        {p && review && (
          <>
            {/* Figma O9 169:642: the applicant's photo as a hero under the status bar; glass back + "…". */}
            <RoleCover coverUrl={p.avatar_url} palette={null} scrim="portrait" className="w-full" style={{ height: HERO_HEIGHT }}>
              {!p.avatar_url && (
                <span className="absolute inset-0 flex items-center justify-center"><EntityAvatar src={null} name={p.full_name} role={p.role} size={120} /></span>
              )}
              <div className="absolute inset-x-4 flex items-center justify-between" style={{ top: 'calc(env(safe-area-inset-top) + 8px)' }}>
                <button type="button" onClick={backToApplicants} aria-label="Back to applicants" className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] backdrop-blur-[10px]" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} data-testid="review-back">
                  <BackGlyph className="h-5 w-5" strokeWidth={2.2} />
                </button>
                {showCounter && (
                  <span className="flex h-9 items-center rounded-full px-3 text-secondary font-semibold text-white" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} data-testid="review-counter">
                    {run + 1} of {reviewTotal} to review
                  </span>
                )}
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] backdrop-blur-[10px]" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
                  {/* Founder ruling: the applicant "…" = Message · View full profile · Report. */}
                  <ProfileActionMenu
                    targetId={p.id}
                    targetName={p.full_name ?? 'this player'}
                    showBlock={false}
                    triggerClassName="flex h-9 w-9 items-center justify-center rounded-full text-white"
                    iconClassName="h-[18px] w-[18px]"
                    leadingItems={[
                      { key: 'message', label: 'Message', icon: <MessageCircle className={MENU_ICON_CLASS} strokeWidth={1.8} />, onSelect: () => void message() },
                      { key: 'profile', label: 'View full profile', icon: <UserRound className={MENU_ICON_CLASS} strokeWidth={1.8} />, onSelect: () => navigate(`/players/id/${p.id}`, { state: { from: location.pathname } }) },
                    ]}
                  />
                </span>
              </div>
              <div className="absolute inset-x-4 bottom-4 flex flex-col gap-1.5">
                <div className="flex flex-wrap gap-1.5">
                  <GlassChip className={heroStatus.brand ? '!border-transparent' : ''} testId="review-status-chip">
                    {heroStatus.brand && <span aria-hidden="true" className="absolute inset-0 -z-10 rounded-full" style={{ backgroundColor: 'rgba(107,43,217,0.9)' }} />}
                    {heroStatus.label}
                  </GlassChip>
                  {appliedLine && <GlassChip className={review.status === 'pending' && isClubReplyUrgent(review.appliedAt, days) ? '!text-status-warning' : ''}>{appliedLine}</GlassChip>}
                </div>
                <h1 className="text-title-xl text-white" data-testid="review-name">{p.full_name}</h1>
                <p className="truncate text-secondary text-white/85">{heroLine}</p>
              </div>
            </RoleCover>

            {statusNote && <p className="mx-4 mb-3 mt-4 rounded-[12px] bg-surface-subtle px-3.5 py-2.5 text-secondary text-ink-2">{statusNote}</p>}

            {onRoad && (
              <div className="px-4 pb-4 pt-4">
                <RoadToSigningCard
                  steps={steps}
                  onMessage={() => void message()}
                  onToggleTrial={review.status !== 'signed' ? () => void toggleTrial() : undefined}
                  trialBusy={signing.busy}
                />
                {declinedNote && (
                  <p className="mt-2 rounded-card bg-surface-grouped px-3.5 py-2.5 text-secondary leading-[18px] text-ink-2" data-testid="road-decline-note">{declinedNote}</p>
                )}
              </div>
            )}

            {/* The applicant's note from the Apply sheet — their words, first. */}
            {note && (
              <section className="px-4 pb-5" data-testid="applicant-note">
                <h2 className="text-[20px] font-semibold leading-6 tracking-[-0.02em] text-ink-1">In their words</h2>
                <p className="mt-2 whitespace-pre-wrap break-words text-[16px] leading-[22px] text-ink-1">“{note}”</p>
              </section>
            )}

            {/* Fit — clubs only; not for an application the player withdrew (read-only record). */}
            {review.status !== 'withdrawn' && (
              <div className="px-4 pt-4">
                <FitCard state={review.fit?.state} rows={rows} />
              </div>
            )}

            {/* Facts */}
            <div className="px-5 pt-4">
              <div className="overflow-hidden rounded-2xl border border-line bg-white">
                {[
                  ...passports.map((v, i) => ({ k: i === 0 ? (passports.length > 1 ? 'Passports' : 'Passport') : '', v })),
                  ...(review.age ? [{ k: 'Age', v: String(review.age) }] : []),
                  ...(p.base_location ? [{ k: 'Based in', v: p.base_location }] : []),
                ].map((row, i) => (
                  <div key={`${row.k}-${i}`}>
                    {i > 0 && <div className="ml-3.5 h-[0.5px] bg-line" />}
                    <div className="flex h-[46px] items-center justify-between gap-3 px-3.5">
                      <span className="text-row text-ink-2">{row.k}</span>
                      <span className="min-w-0 truncate text-row font-medium text-ink-1">{row.v}</span>
                    </div>
                  </div>
                ))}
                {review.playerClub && (
                  <>
                    <div className="ml-3.5 h-[0.5px] bg-line" />
                    <div className="flex h-[46px] items-center justify-between gap-3 px-3.5">
                      <span className="text-row text-ink-2">Club</span>
                      <span className="flex min-w-0 items-center gap-1.5">
                        {review.playerClub.crest && (
                          <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center overflow-hidden rounded-[5px] border-[0.5px] border-line bg-white">
                            <img src={getImageUrl(review.playerClub.crest, 'avatar-sm') ?? review.playerClub.crest} alt="" className="h-[18px] w-[18px] object-contain" />
                          </span>
                        )}
                        <span className="truncate text-row font-medium text-ink-1">{review.playerClub.name}</span>
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Videos — full matches first (clubs always see them), then highlights */}
            {videos > 0 && (
              <>
                <div className="flex items-center justify-between px-5 pb-2 pt-[22px]">
                  <h2 className="text-[22px] font-bold leading-7 tracking-[-0.176px] text-ink-1">Videos</h2>
                  <button type="button" onClick={() => navigate(`/players/id/${p.id}/videos`, { state: { from: location.pathname } })} className="text-row font-semibold text-hockia-primary">See all {videos}</button>
                </div>
                <div className="flex gap-2.5 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {scroll.fullGameLinks.map((l) => (
                    <a key={l.id} href={safeVideoHref(l.video_url) ?? undefined} target="_blank" rel="noopener noreferrer" className="relative flex h-[124px] w-[220px] shrink-0 flex-col justify-end overflow-hidden rounded-xl bg-gradient-to-br from-ink-1 to-ink-2 p-2.5 text-left">
                      <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-[3px] text-[11px] font-semibold text-white">Full match</span>
                      <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-white"><ExternalLink className="h-3 w-3" /></span>
                      <span className="truncate text-secondary font-semibold text-white">{l.match_title?.trim() || (l.opponent_team ? `vs ${l.opponent_team}` : 'Full match')}</span>
                      <span className="truncate text-[11px] text-white/85">{[l.competition, l.minutes_played ? `${l.minutes_played} min` : null, l.shirt_number ? `#${l.shirt_number}` : null, videoLinkSite(l.video_url)].filter(Boolean).join(' · ')}</span>
                    </a>
                  ))}
                  {[...scroll.fullMatches, ...scroll.highlights].map((v, i) => (
                    <ProfileVideoTile
                      key={v.id}
                      video={v}
                      locked={false}
                      canWatch
                      eager={i < 2}
                      onOpen={() => navigate(`/players/id/${p.id}/videos`, { state: { from: location.pathname } })}
                      className={cn('h-[124px] shrink-0', v.kind === 'full_match' ? 'w-[220px]' : 'w-[150px]')}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Career — latest 2, See all */}
            {scroll.career.length > 0 && (
              <>
                <div className="flex items-center justify-between px-5 pb-2 pt-[22px]">
                  <h2 className="text-[22px] font-bold leading-7 tracking-[-0.176px] text-ink-1">Career</h2>
                  <button type="button" onClick={() => navigate(`/players/id/${p.id}/journey`, { state: { from: location.pathname } })} className="text-row font-semibold text-hockia-primary">See all</button>
                </div>
                <div className="px-5">
                  {scroll.career.slice(0, 2).map((c, i, arr) => (
                    <CareerRow key={c.id} entry={c} last={i === arr.length - 1} flag={countryRow(c.representedCountryId)?.split(' ')[0] ?? null} locationFlag={flagForCountryName(countries, c.locationCountry)} />
                  ))}
                </div>
              </>
            )}

            {(p.specialist_skills ?? []).length > 0 && (
              <>
                <h2 className="px-5 pb-2 pt-[22px] text-[22px] font-bold leading-7 tracking-[-0.176px] text-ink-1">Specialist skills</h2>
                <div className="flex flex-wrap gap-x-3.5 gap-y-2 px-5">
                  {(p.specialist_skills ?? []).map((s) => (
                    <span key={s} className="flex items-center gap-[7px] text-[14px] font-medium text-ink-1">
                      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-hockia-soft text-hockia-primary"><Target className="h-3.5 w-3.5" strokeWidth={2} /></span>
                      {specialistSkillLabel(s)}
                    </span>
                  ))}
                </div>
              </>
            )}

            <h2 className="px-5 pb-2 pt-[22px] text-[22px] font-bold leading-7 tracking-[-0.176px] text-ink-1">References</h2>
            <div className="flex flex-col gap-3 px-5 pb-7">
              {acceptedReferences.length === 0
                ? <p className="text-[14px] leading-5 text-ink-2">No references yet. References come from friends on Hockia. Coaches and teammates can write one.</p>
                : acceptedReferences.slice(0, 2).map((r) => (
                  <ReferenceCard key={r.id} reference={r} onOpen={() => navigate(`/players/id/${p.id}/references`, { state: { from: location.pathname } })} />
                ))}
            </div>
          </>
        )}
      </div>

      {/* Decision bar */}
      {p && review && decidable && (
        <div className="fixed inset-x-0 bottom-0 border-t-[0.5px] border-line bg-white/94 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 backdrop-blur-[12px]" data-testid="decision-bar">
          {/* Figma O9 169:687: glass bar — Not a fit · Maybe quiet, Shortlist Primary, Message as a link. */}
          <div className="flex gap-2">
            <button type="button" onClick={() => setDeclining(true)} disabled={review.status === 'rejected'} className="flex h-[52px] w-[100px] items-center justify-center rounded-full bg-surface-subtle text-[16px] font-semibold text-status-danger disabled:opacity-40">Not a fit</button>
            <button type="button" onClick={() => decide('maybe')} disabled={review.status === 'maybe'} className="flex h-[52px] w-[92px] items-center justify-center rounded-full bg-surface-subtle text-[16px] font-semibold text-ink-1 disabled:opacity-40">Maybe</button>
            <button type="button" onClick={() => decide('shortlisted')} disabled={review.status === 'shortlisted'} className="flex h-[52px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full bg-hockia-primary text-[16px] font-semibold text-white disabled:opacity-40">
              <Check className="h-[18px] w-[18px]" strokeWidth={2.4} /> Shortlist
            </button>
          </div>
          <button type="button" onClick={() => void message()} className="mt-1 flex min-h-10 w-full items-center justify-center text-secondary font-semibold text-hockia-primary">
            Message {firstName}
          </button>
        </div>
      )}
      {/* Road to signing bar (D4.1): "…" · Message · the next step. */}
      {p && review && onRoad && (
        <div className="fixed inset-x-0 bottom-0 border-t-[0.5px] border-line bg-white/94 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 backdrop-blur-[12px] flex items-center gap-2.5" data-testid="road-bar">
          {menu.length > 0 && (
            <button type="button" onClick={() => setSheet('menu')} aria-label="More actions" className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-surface-subtle text-ink-1" data-testid="road-more">
              <MoreHorizontal className="h-5 w-5" strokeWidth={2} />
            </button>
          )}
          <button type="button" onClick={() => void message()} className="flex h-[52px] shrink-0 items-center justify-center rounded-full bg-surface-subtle px-5 text-[16px] font-semibold text-ink-1">Message</button>
          {mainAction ? (
            <button
              type="button"
              onClick={() => setSheet(mainAction === 'mark_signed' ? 'sign' : 'offer')}
              disabled={mainAction === 'edit_offer' && !liveOffer}
              className="flex h-[52px] min-w-0 flex-1 items-center justify-center rounded-full bg-hockia-primary px-3 text-[16px] font-semibold text-white disabled:opacity-60"
              data-testid="road-main"
            >
              <span className="truncate">{mainAction === 'make_offer' ? 'Make an offer' : mainAction === 'edit_offer' ? 'Edit offer' : 'Mark as signed'}</span>
            </button>
          ) : waitingLine ? (
            <span className="flex min-h-12 min-w-0 flex-1 items-center justify-center rounded-[20px] bg-surface-grouped px-3 py-1.5 text-center text-secondary font-semibold leading-[17px] text-ink-2" data-testid="road-waiting">
              <span className="break-words">{waitingLine}</span>
            </span>
          ) : null}
        </div>
      )}
      {p && review && !decidable && !onRoad && (
        <div className="fixed inset-x-0 bottom-0 border-t-[0.5px] border-line bg-white/94 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 backdrop-blur-[12px] flex items-center gap-2 text-secondary text-ink-2" data-testid="closed-application-note">
          <Lock className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={2} /> {closedApplicationNote(review.status, firstName)}
          <button type="button" onClick={() => void message()} className="ml-auto shrink-0 font-semibold text-hockia-primary">Message</button>
        </div>
      )}

      {overlays}
      <UndoToast aboveBar />
    </div>
  )
}
