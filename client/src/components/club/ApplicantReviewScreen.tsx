import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, ExternalLink, Lock, MessageCircle, Target } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import ProfileActionMenu from '@/components/ProfileActionMenu'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { ProfileVideoTile } from '@/components/profile/mobile/ProfileVideoTile'
import { CareerRow, ReferenceCard } from '@/components/profile/mobile/ProfileLongScroll'
import { FitCard } from './FitCard'
import { DeclineSheet } from './DeclineSheet'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useCountries } from '@/hooks/useCountries'
import { useProfileScrollData } from '@/hooks/useProfileScrollData'
import { useTrustedReferences } from '@/hooks/useTrustedReferences'
import { markRoleApplicantViewed, patchRoleApplicantStatus } from '@/hooks/useRoleApplicants'
import { holdDecision } from '@/lib/pendingDecisions'
import { WITHDRAWN_APPLICATION_MESSAGE } from '@/lib/applicationStatus'
import { useUndoToast } from '@/lib/undoToast'
import { getImageUrl } from '@/lib/imageUrl'
import { categoryToDisplay } from '@/lib/hockeyCategories'
import { specialistSkillLabel } from '@/lib/specialistSkills'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { daysLeftLabel, daysLeftToReply, decisionToast, DEFAULT_EXPIRY_DAYS, fitRows, fitTarget, isDaysLeftUrgent, personRoleLine, type FitComponents, type FitState } from '@/lib/clubRecruiting'
import { cn } from '@/lib/utils'
import type { Json } from '@/lib/database.types'

/**
 * Applicant review (Figma 04 Club 326:319 / scrolled 327:318; DEV NOTEs
 * 327:563 · 327:570). Club-only: the fit card lists compute_club_fit's four
 * components as plain checks and names the missing side for Level instead
 * of showing 0%. Opening the review records the view (record_application_view).
 * The decision bar writes opportunity_applications.status; every decision is
 * held for the Undo window (lib/pendingDecisions) and the club goes back to
 * Applicants with "<Name> shortlisted · Undo".
 */
interface Props { roleId: string; applicationId: string }

type Person = {
  id: string; full_name: string | null; avatar_url: string | null; role: string | null; position: string | null; secondary_position: string | null
  nationality_country_id: number | null; nationality2_country_id: number | null; base_location: string | null; playing_category: string | null
  gender: string | null; last_active_at: string | null; current_club: string | null; current_world_club_id: string | null; specialist_skills: string[] | null
}
type Review = {
  status: string; appliedAt: string | null; metadata: Record<string, unknown>
  person: Person; age: number | null; roleGender: string | null; expiryDays: number
  fit: { state: FitState; components: FitComponents } | null
  playerClub: { name: string; crest: string | null; leagueBanded: boolean } | null
  clubLeagueBanded: boolean
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthDay = (iso: string | null) => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : `${MONTH[d.getMonth()]} ${d.getDate()}`
}
const pronounsFor = (g: string | null) => (/^(men|male|man|m)$/i.test(g ?? '') ? { obj: 'him' as const, pos: 'his' as const } : /^(women|female|woman|f)$/i.test(g ?? '') ? { obj: 'her' as const, pos: 'her' as const } : { obj: 'them' as const, pos: 'their' as const })

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
          applicant:applicant_id ( id, full_name, avatar_url, role, position, secondary_position, nationality_country_id, nationality2_country_id, base_location, playing_category, gender, last_active_at, current_club, current_world_club_id, specialist_skills )`)
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
      const target = fitTarget(roleGender)
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
  const pron = pronounsFor(p?.gender ?? null)
  const rows = useMemo(() => {
    if (!review) return []
    const lastDays = review.person.last_active_at ? Math.max(0, Math.floor((Date.now() - new Date(review.person.last_active_at).getTime()) / 86_400_000)) : null
    return fitRows(review.fit?.components ?? {}, {
      roleGender: review.roleGender,
      playerCategoryLabel: categoryToDisplay(review.person.playing_category) || null,
      firstName,
      pronoun: pron.pos,
      lastActiveDays: lastDays,
      playerClub: review.playerClub?.name ?? null,
      playerLeagueKnown: Boolean(review.playerClub?.leagueBanded),
      clubLeagueKnown: review.clubLeagueBanded,
    })
  }, [review, firstName, pron.pos])

  const countryRow = (id: number | null) => {
    const c = id ? countries.find((x) => x.id === id) : null
    return c ? [c.flag_emoji, c.common_name || c.name].filter(Boolean).join(' ') : null
  }
  const passports = [countryRow(p?.nationality_country_id ?? null), countryRow(p?.nationality2_country_id ?? null)].filter((x): x is string => Boolean(x))
  const days = review?.status === 'pending' ? daysLeftToReply(review.appliedAt, review.expiryDays) : null
  const replyLine = days === null ? null : days === 0 ? 'closes today' : `${daysLeftLabel(days)} to reply`
  const appliedLine = review ? [`Applied ${monthDay(review.appliedAt)}`, review.status === 'pending' ? replyLine : null].filter(Boolean).join(' · ') : ''
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
    const state = { returnTo: location.pathname, from: location.pathname, messageOrigin: 'Opportunity' }
    if (conv?.id) navigate(`/messages?conversation=${conv.id}`, { state })
    else navigate(`/messages?new=${p.id}`, { state })
  }

  const videos = scroll.fullGameLinks.length + scroll.fullMatches.length + scroll.highlights.length
  const avatar = p?.avatar_url ? getImageUrl(p.avatar_url, 'avatar-lg') ?? p.avatar_url : null
  const statusNote = review && review.status !== 'pending'
    ? { shortlisted: 'You shortlisted this player.', maybe: 'You marked this player maybe.', rejected: 'You declined this application.', no_response: 'Closed without a reply.' }[review.status] ?? null
    : null

  return (
    <div className="flex h-[100dvh] flex-col bg-white pt-[env(safe-area-inset-top)] lg:hidden" data-testid="applicant-review-screen">
      <DetailNavBar
        parent="Applicants"
        title={scrolled && p?.full_name ? p.full_name : undefined}
        showParent
        wideParent
        onBack={backToApplicants}
        trailing={p ? <ProfileActionMenu targetId={p.id} targetName={p.full_name ?? 'this player'} /> : undefined}
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
                <p className={cn('text-caption', isDaysLeftUrgent(days) ? 'font-semibold text-[#b45309]' : 'text-ink-4')}>{appliedLine}</p>
                <button type="button" onClick={() => navigate(`/players/id/${p.id}`, { state: { from: location.pathname } })} className="text-[14px] font-semibold text-hockia-primary">View full profile</button>
              </div>
            </div>

            {statusNote && <p className="mx-5 mb-3 rounded-card bg-surface-grouped px-3.5 py-2.5 text-secondary text-ink-2">{statusNote}</p>}

            {/* Fit — clubs only */}
            <div className="px-5">
              <FitCard state={review.fit?.state} rows={rows} />
            </div>

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
                    <CareerRow key={c.id} entry={c} last={i === arr.length - 1} flag={countryRow(c.representedCountryId)?.split(' ')[0] ?? null} />
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
                ? <p className="text-[14px] leading-5 text-ink-2">No references yet. References come from friends on Hockia — {pron.pos} coaches and teammates can write one.</p>
                : acceptedReferences.slice(0, 2).map((r) => (
                  <ReferenceCard key={r.id} reference={r} onOpen={() => navigate(`/players/id/${p.id}/references`, { state: { from: location.pathname } })} />
                ))}
            </div>
          </>
        )}
      </div>

      {/* Decision bar */}
      {p && review && review.status !== 'no_response' && (
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
      {p && review?.status === 'no_response' && (
        <div className="fixed inset-x-0 bottom-0 flex items-center gap-2 border-t border-line bg-white px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 text-secondary text-ink-2">
          <Lock className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={2} /> This application closed without a reply. You can still message {firstName}.
          <button type="button" onClick={() => void message()} className="ml-auto shrink-0 font-semibold text-hockia-primary">Message</button>
        </div>
      )}

      {p && (
        <DeclineSheet open={declining} applicationId={applicationId} firstName={firstName} pronoun={pron.obj} onCancel={() => setDeclining(false)} onSend={decline} />
      )}
    </div>
  )
}
