import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, ExternalLink, Lock, MessageCircle, MoreHorizontal, Target, UserRound } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import ProfileActionMenu from '@/components/ProfileActionMenu'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { ProfileVideoTile } from '@/components/profile/mobile/ProfileVideoTile'
import { CareerRow, ReferenceCard } from '@/components/profile/mobile/ProfileLongScroll'
import { FitCard } from './FitCard'
import { DeclineSheet } from './DeclineSheet'
import { RoadToSigningCard } from './RoadToSigningCard'
import { BottomSheet } from '@/components/ui/BottomSheet'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useApplicationRoad, useSigningActions } from '@/hooks/useSigning'
import { inviteRoleLabel } from '@/lib/invites'
import { isOnRoad, offerDeclinedNote, roadHeaderLine, roadMainAction, roadMenu, roadSteps, roadWaitingLine, shortDayOf, type OfferDraft, type RoadMenuItem } from '@/lib/signing'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useCountries } from '@/hooks/useCountries'
import { useProfileScrollData } from '@/hooks/useProfileScrollData'
import { useTrustedReferences } from '@/hooks/useTrustedReferences'
import { markRoleApplicantViewed, patchRoleApplicantStatus } from '@/hooks/useRoleApplicants'
import { holdDecision } from '@/lib/pendingDecisions'
import { WITHDRAWN_APPLICATION_MESSAGE, applicationNote, closedApplicationNote, isDecidableApplicationStatus } from '@/lib/applicationStatus'
import { useUndoToast } from '@/lib/undoToast'
import { getImageUrl } from '@/lib/imageUrl'
import { categoryToDisplay } from '@/lib/hockeyCategories'
import { specialistSkillLabel } from '@/lib/specialistSkills'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { daysLeftLabel, daysLeftToReply, decisionToast, DEFAULT_EXPIRY_DAYS, clubReplyLineClass, fitRows, fitTarget, isClubReplyUrgent, personRoleLine, type FitComponents, type FitState } from '@/lib/clubRecruiting'
import { cn } from '@/lib/utils'
import { flagForCountryName } from '@/lib/careerCopy'
import { profileVideoTotal } from '@/hooks/useProfileVideoTotal'
import { MENU_ICON_CLASS } from '@/lib/report'
import type { Json } from '@/lib/database.types'

// D4.2 / D4.4 sheets: their own chunks, loaded when the club opens one.
const OfferSheet = lazy(() => import('./OfferSheet'))
const MarkSignedSheet = lazy(() => import('./MarkSignedSheet'))

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
interface Props { roleId: string; applicationId: string }

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

export default function ApplicantReviewScreen({ roleId, applicationId }: Props) {
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
  const [scrolled, setScrolled] = useState(false)
  const [sheet, setSheet] = useState<'offer' | 'sign' | 'menu' | null>(null)
  const [confirm, setConfirm] = useState<'withdraw_offer' | 'undo_signing' | null>(null)
  const signing = useSigningActions()

  const playerId = review?.person.id ?? null
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
        (() => {
          const ids = [club.mens_league_id, club.womens_league_id].filter((x): x is number => typeof x === 'number')
          return ids.length ? supabase.from('world_leagues').select('id, level_band_global').in('id', ids) : Promise.resolve({ data: [] })
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
  }, [club?.id, club?.mens_league_id, club?.womens_league_id, roleId, applicationId])

  const p = review?.person
  const firstName = p?.full_name?.trim().split(/\s+/)[0] || 'this player'
  const onRoad = review ? isOnRoad(review.status) : false
  const road = useApplicationRoad({ applicationId, roleId, clubId: club?.id ?? null, playerId, enabled: onRoad })
  const roadData = road.data
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
  const roleLabel = roadData?.role ? inviteRoleLabel(roadData.role) : 'this role'
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
    showUndo({ applicationId, text: decisionToast(firstName, status), onUndo: () => patchRoleApplicantStatus(roleId, applicationId, prev) })
    backToApplicants()
  }

  const decline = (reason: string, message: string) => {
    if (!review) return
    const prev = review.status
    setDeclining(false)
    holdDecision({ kind: 'decline', applicationId, reason, message }, (ok, withdrawn) => {
      if (ok) trackDbEvent('applicant_status_change', 'application', applicationId, { new_status: 'rejected', reason })
      else if (withdrawn) { patchRoleApplicantStatus(roleId, applicationId, 'withdrawn'); addToast(WITHDRAWN_APPLICATION_MESSAGE, 'info') }
      else { patchRoleApplicantStatus(roleId, applicationId, prev); addToast('Couldn’t send the decline. Please try again.', 'error') }
    })
    patchRoleApplicantStatus(roleId, applicationId, 'rejected')
    showUndo({ applicationId, text: decisionToast(firstName, 'rejected'), onUndo: () => patchRoleApplicantStatus(roleId, applicationId, prev) })
    backToApplicants()
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
  const statusNote = review && review.status !== 'pending' && !onRoad
    ? { shortlisted: 'You shortlisted this player.', maybe: 'You marked this player maybe.', rejected: 'You declined this application.', no_response: 'Closed without a reply.', filled: 'This role was filled.', withdrawn: 'Withdrawn by the applicant.' }[review.status] ?? null
    : null
  // Closed applications (no reply, filled, withdrawn, signing statuses) can't
  // be re-decided: no decision bar, just the grey note with Message.
  const decidable = review ? isDecidableApplicationStatus(review.status) && !onRoad : false
  const mainAction = review && onRoad ? roadMainAction(review.status) : null
  const menu = review && onRoad ? roadMenu(review.status) : []
  const waitingLine = review && onRoad ? roadWaitingLine(review.status, firstName) : null

  return (
    <div className="flex h-[100dvh] flex-col bg-white pt-[env(safe-area-inset-top)] lg:hidden" data-testid="applicant-review-screen">
      <DetailNavBar
        parent="Applicants"
        title={scrolled && p?.full_name ? p.full_name : undefined}
        showParent
        wideParent
        onBack={backToApplicants}
        trailing={p ? (
          // Founder ruling: the applicant "…" = Message · View full profile · Report.
          <ProfileActionMenu
            targetId={p.id}
            targetName={p.full_name ?? 'this player'}
            showBlock={false}
            leadingItems={[
              { key: 'message', label: 'Message', icon: <MessageCircle className={MENU_ICON_CLASS} strokeWidth={1.8} />, onSelect: () => void message() },
              { key: 'profile', label: 'View full profile', icon: <UserRound className={MENU_ICON_CLASS} strokeWidth={1.8} />, onSelect: () => navigate(`/players/id/${p.id}`, { state: { from: location.pathname } }) },
            ]}
          />
        ) : undefined}
      />
      <div className="flex-1 overflow-y-auto pb-40" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 120)}>
        {error && <p className="px-5 py-6 text-row text-ink-2">{error}</p>}
        {p && review && (
          <>
            <div className="flex items-center gap-3.5 px-5 pb-4 pt-1.5">
              <EntityAvatar src={avatar} name={p.full_name} role={p.role} size={76} />
              <div className="min-w-0 flex-1">
                <h1 className="text-[24px] font-bold leading-[30px] tracking-[-0.144px] text-ink-1">{p.full_name}</h1>
                <p className="truncate text-[14px] leading-[19px] text-ink-2">{personRoleLine({ role: p.role, position: p.position, secondaryPosition: p.secondary_position })}</p>
                <p className={cn('text-caption', clubReplyLineClass(review.status === 'pending' && isClubReplyUrgent(review.appliedAt, days)))}>{appliedLine}</p>
                <button type="button" onClick={() => navigate(`/players/id/${p.id}`, { state: { from: location.pathname } })} className="text-[14px] font-semibold text-hockia-primary">View full profile</button>
              </div>
            </div>

            {statusNote && <p className="mx-5 mb-3 rounded-card bg-surface-grouped px-3.5 py-2.5 text-secondary text-ink-2">{statusNote}</p>}

            {onRoad && (
              <div className="px-5 pb-4">
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
              <section className="px-5 pb-4" data-testid="applicant-note">
                <div className="rounded-2xl border border-line bg-white px-3.5 py-3">
                  <h2 className="text-secondary font-semibold text-ink-2">In their words</h2>
                  <p className="mt-1 whitespace-pre-wrap break-words text-row leading-[21px] text-ink-1">{note}</p>
                </div>
              </section>
            )}

            {/* Fit — clubs only; not for an application the player withdrew (read-only record). */}
            {review.status !== 'withdrawn' && (
              <div className="px-5">
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
                    <a key={l.id} href={l.video_url} target="_blank" rel="noopener noreferrer" className="relative flex h-[124px] w-[220px] shrink-0 flex-col justify-end overflow-hidden rounded-xl bg-gradient-to-br from-ink-1 to-ink-2 p-2.5 text-left">
                      <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-[3px] text-[11px] font-semibold text-white">Full match</span>
                      <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-white"><ExternalLink className="h-3 w-3" /></span>
                      <span className="truncate text-secondary font-semibold text-white">{l.match_title?.trim() || (l.opponent_team ? `vs ${l.opponent_team}` : 'Full match')}</span>
                      <span className="truncate text-[11px] text-white/85">{[l.competition, l.minutes_played ? `${l.minutes_played} min` : null, l.shirt_number ? `#${l.shirt_number}` : null].filter(Boolean).join(' · ')}</span>
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
                ? <p className="text-[14px] leading-5 text-ink-2">No references yet. References come from friends on Hockia — coaches and teammates can write one.</p>
                : acceptedReferences.slice(0, 2).map((r) => (
                  <ReferenceCard key={r.id} reference={r} onOpen={() => navigate(`/players/id/${p.id}/references`, { state: { from: location.pathname } })} />
                ))}
            </div>
          </>
        )}
      </div>

      {/* Decision bar */}
      {p && review && decidable && (
        <div className="fixed inset-x-0 bottom-0 border-t border-line bg-white px-4 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-3" data-testid="decision-bar">
          <div className="flex gap-2">
            <button type="button" onClick={() => setDeclining(true)} disabled={review.status === 'rejected'} className="flex h-[46px] flex-1 items-center justify-center rounded-full bg-surface-grouped text-[16px] font-semibold text-[#e5484d] disabled:opacity-40">Decline</button>
            <button type="button" onClick={() => decide('maybe')} disabled={review.status === 'maybe'} className="flex h-[46px] flex-1 items-center justify-center rounded-full bg-surface-grouped text-[16px] font-semibold text-ink-1 disabled:opacity-40">Maybe</button>
            <button type="button" onClick={() => decide('shortlisted')} disabled={review.status === 'shortlisted'} className="flex h-[46px] flex-1 items-center justify-center gap-1.5 rounded-full bg-hockia-primary text-[16px] font-semibold text-white disabled:opacity-40">
              <Check className="h-[18px] w-[18px]" strokeWidth={2.4} /> Shortlist
            </button>
          </div>
          <button type="button" onClick={() => void message()} className="mt-2 flex w-full items-center justify-center gap-1.5 py-1.5 text-row font-semibold text-hockia-primary">
            <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.8} /> Message {firstName}
          </button>
        </div>
      )}
      {/* Road to signing bar (D4.1): "…" · Message · the next step. */}
      {p && review && onRoad && (
        <div className="fixed inset-x-0 bottom-0 flex items-center gap-2.5 border-t border-line bg-white px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3" data-testid="road-bar">
          {menu.length > 0 && (
            <button type="button" onClick={() => setSheet('menu')} aria-label="More actions" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-grouped text-ink-1" data-testid="road-more">
              <MoreHorizontal className="h-5 w-5" strokeWidth={2} />
            </button>
          )}
          <button type="button" onClick={() => void message()} className="flex h-12 shrink-0 items-center justify-center rounded-full border border-line bg-white px-5 text-[16px] font-semibold text-ink-1">Message</button>
          {mainAction ? (
            <button
              type="button"
              onClick={() => setSheet(mainAction === 'mark_signed' ? 'sign' : 'offer')}
              disabled={mainAction === 'edit_offer' && !liveOffer}
              className="flex h-12 min-w-0 flex-1 items-center justify-center rounded-full bg-hockia-primary px-3 text-[16px] font-semibold text-white disabled:opacity-60"
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
        <div className="fixed inset-x-0 bottom-0 flex items-center gap-2 border-t border-line bg-white px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 text-secondary text-ink-2" data-testid="closed-application-note">
          <Lock className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={2} /> {closedApplicationNote(review.status, firstName)}
          <button type="button" onClick={() => void message()} className="ml-auto shrink-0 font-semibold text-hockia-primary">Message</button>
        </div>
      )}

      {/* "…" on the road: what the server allows at this step. */}
      <BottomSheet open={sheet === 'menu'} onClose={() => setSheet(null)} ariaLabel="More actions">
        <div className="px-3 pb-2 pt-1" data-testid="road-menu">
          {menu.map((item) => (
            <button key={item} type="button" onClick={() => pickMenu(item)} className={cn('flex h-12 w-full items-center rounded-xl px-3 text-left text-[16px] font-medium', item === 'decline' || item === 'withdraw_offer' || item === 'undo_signing' ? 'text-[#e5484d]' : 'text-ink-1')} data-testid={`road-menu-${item}`}>
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
            clubAvatar={club?.avatar_url ?? null}
            clubName={club?.full_name ?? null}
            publisherIsClub={club?.role === 'club'}
            roleLabel={roleLabel}
            waiting={roadData?.waiting ?? 0}
            busy={signing.busy}
            onClose={() => setSheet(null)}
            onConfirm={(closeRole) => void markSigned(closeRole)}
          />
        </Suspense>
      )}
      <ConfirmDialog
        isOpen={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        title={confirm === 'withdraw_offer' ? 'Withdraw this offer?' : 'Undo the signing?'}
        message={confirm === 'withdraw_offer'
          ? `${firstName} is told the offer was withdrawn and goes back to Shortlisted.`
          : `${firstName} won’t be asked to confirm any more. You can mark the signing again later.`}
        confirmLabel={confirm === 'withdraw_offer' ? 'Withdraw offer' : 'Undo signing'}
        variant="danger"
        testId="road-confirm"
      />

      {p && (
        <DeclineSheet open={declining} applicationId={applicationId} firstName={firstName} hasName={Boolean(p.full_name?.trim())} onCancel={() => setDeclining(false)} onSend={decline} />
      )}
    </div>
  )
}
