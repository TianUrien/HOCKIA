import { useCallback, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { trackNextStepAction } from '@/lib/homeInstrumentation'
import { useWeeklyVisibility } from '@/hooks/useWeeklyVisibility'
import { useOpportunitiesForYou } from '@/hooks/useOpportunitiesForYou'
import { useMyApplications } from '@/hooks/useMyApplications'
import { useRolesHealth } from '@/hooks/useRolesHealth'
import { useScopedMatches } from '@/hooks/useScopedMatches'
import { useMyPulse } from '@/hooks/useMyPulse'
import { useCoachPulseMode } from '@/hooks/useCoachPulseMode'
import { useSearchAppearances } from '@/hooks/useSearchAppearances'
import { positionLabel } from '@/lib/identity'
import { OWN_PROFILE_EDIT_PATH } from '@/lib/profileNavigation'
import { useHomeT } from '@/i18n/ns/home'

/** Who viewed you: Your activity with the viewer list open (players, coaches). */
export const VIEWERS_PATH = '/inbox/activity?viewers=1'
/** A brand's viewers + search appearances: its own profile with the views sheet open. */
export const BRAND_VIEWERS_PATH = '/dashboard/profile?viewers=1'

/**
 * Next step (Figma H5 64:326; spec 65:329): the viewer's Pulse actions in
 * priority order, one card at a time. Agreed order (Home v1 review):
 *   player / open coach : profile photo (new user, H12a) > availability
 *                         check-in > clubs replied > roles match > who viewed >
 *                         clubs from a CV (no career yet, 2026-11-15) > tip
 *   club / recruiting coach : applicants > a role with no applicants > available now > tip
 *   brand  : logo (no logo yet) > profile views + Community search appearances
 *   umpire : umpiring level
 * Nothing pending → "Your week" (CTA Activity → /pulse). Every number comes
 * from a query Pulse already runs — no new data source.
 */
export type NextStepVisual =
  | { kind: 'crests'; urls: Array<string | null> }
  | { kind: 'faces'; people: Array<{ url: string | null; name: string | null; role: string | null }> }
  | { kind: 'icon'; icon: 'camera' | 'check' | 'chart' | 'stick' | 'user' | 'file' }
  /** No photo yet: the owner's Avatar / Placeholder (founder 2026-10-26). */
  | { kind: 'placeholder'; role: string }

export interface NextStep {
  key: string
  title: string
  subtitle: string | null
  cta: string
  visual: NextStepVisual
  /** Navigate here on the CTA… */
  to?: string
  /** …or run this (check-in "Yes", brand "Post", Hockia AI's "Fill my profile"). */
  action?: 'confirm_availability' | 'compose' | 'fill_profile'
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function useNextStep() {
  const t = useHomeT()
  const profile = useAuthStore((s) => s.profile)
  const setProfile = useAuthStore((s) => s.setProfile)
  const role = profile?.role ?? null
  const [coachMode] = useCoachPulseMode()
  const recruitingCoach = role === 'coach' && coachMode === 'recruit'
  const isClubSide = role === 'club' || recruitingCoach
  const isTalent = (role === 'player' || role === 'coach') && !recruitingCoach

  const vis = useWeeklyVisibility(Boolean(role), false)
  const opps = useOpportunitiesForYou(isTalent, role === 'coach' ? 'coach' : 'player')
  const apps = useMyApplications(isTalent)
  const roles = useRolesHealth(isClubSide)
  const scoped = useScopedMatches(isClubSide)
  const pulse = useMyPulse()
  const search = useSearchAppearances({ profileId: role === 'brand' ? profile?.id : null })
  const [done, setDone] = useState<ReadonlySet<string>>(new Set())

  const loading = vis.loading || pulse.isLoading
    || (isTalent && (opps.loading || apps.loading))
    || (isClubSide && (roles.loading || scoped.loading))

  const steps = useMemo<NextStep[]>(() => {
    if (!profile) return []
    const out: NextStep[] = []
    const views = vis.visibility?.views_7d ?? 0
    const hasPhoto = Boolean(profile.avatar_url)

    if (isTalent || role === 'umpire') {
      if (!hasPhoto) out.push({ key: 'photo', title: t('nextStep.photo.title'), subtitle: t('nextStep.photo.subtitle'), cta: t('nextStep.photo.cta'), visual: { kind: 'placeholder', role: role ?? 'player' }, to: OWN_PROFILE_EDIT_PATH })
      const checkIn = pulse.items.find((p) => p.item_type === 'availability_check_in' && !p.action_completed_at && !p.dismissed_at)
      if (checkIn && role !== 'umpire') {
        out.push({
          key: `checkin:${checkIn.id}`,
          title: role === 'coach' ? t('nextStep.checkIn.titleCoach') : t('nextStep.checkIn.titlePlayer'),
          subtitle: t('nextStep.checkIn.subtitle'),
          cta: t('nextStep.checkIn.cta'),
          visual: { kind: 'icon', icon: 'check' },
          action: 'confirm_availability',
        })
      }
    }

    if (isTalent) {
      const replied = apps.applications.filter((a) => a.status !== 'pending' && a.role_open)
      if (replied.length > 0) {
        out.push({
          key: 'replied',
          title: replied.length === 1 ? t('nextStep.replied.titleOne', { club: replied[0].club_name ?? t('nextStep.replied.clubFallback') }) : t('nextStep.replied.titleMany', { total: replied.length }),
          subtitle: replied[0].opportunity_title,
          cta: t('nextStep.replied.cta'),
          visual: { kind: 'icon', icon: 'check' },
          to: '/opportunities/applications',
        })
      }
      const matched = opps.mode === 'matched' ? opps.items : []
      if (matched.length > 0) {
        out.push({
          key: 'roles',
          title: t('nextStep.roles.title', { count: matched.length }),
          subtitle: [positionLabel(profile.position) || null, matched[0].club_name].filter(Boolean).join(', ') || null,
          cta: t('nextStep.roles.cta'),
          visual: { kind: 'crests', urls: matched.slice(0, 3).map((o) => o.club_avatar_url) },
          to: '/opportunities',
        })
      }
      if (views > 0) {
        // A views card opens who viewed you (ruling 2026-10-16): "View", never another action.
        out.push({ key: 'views', title: t('nextStep.views.title', { count: views }), subtitle: t('nextStep.views.subtitle'), cta: t('nextStep.views.cta'), visual: { kind: 'icon', icon: 'chart' }, to: VIEWERS_PATH })
      }
      // No clubs on the profile yet: Hockia AI reads a CV or a few lines (founder 2026-11-15:
      // 22% of players and coaches had a career; the reader had 5 users in three weeks).
      if ((profile.career_entry_count ?? 0) === 0) {
        out.push({ key: 'career', title: t('nextStep.career.title'), subtitle: t('nextStep.career.subtitle'), cta: t('nextStep.career.cta'), visual: { kind: 'icon', icon: 'file' }, action: 'fill_profile' })
      }
      const pct = profile.profile_completeness_pct ?? 100
      if (hasPhoto && pct < 80) {
        out.push({ key: 'complete', title: t('nextStep.complete.title'), subtitle: t('nextStep.complete.subtitle', { percent: pct }), cta: t('nextStep.complete.cta'), visual: { kind: 'icon', icon: 'user' }, to: OWN_PROFILE_EDIT_PATH })
      }
    }

    if (isClubSide) {
      const mine = recruitingCoach ? '/opportunities?view=mine' : '/opportunities'
      const pendingRole = [...roles.roles].filter((r) => r.pending_count > 0).sort((a, b) => b.pending_count - a.pending_count)[0]
      if (roles.totals.pending > 0) {
        out.push({
          key: 'applicants',
          title: t('nextStep.applicants.title', { count: roles.totals.pending }),
          subtitle: pendingRole ? pendingRole.title : null,
          cta: t('nextStep.applicants.cta'),
          visual: { kind: 'icon', icon: 'user' },
          to: pendingRole ? `/dashboard/opportunities/${pendingRole.opportunity_id}/applicants` : mine,
        })
      }
      const quiet = roles.roles.find((r) => r.applicant_count === 0 && Date.now() - new Date(r.created_at).getTime() > WEEK_MS)
      if (quiet) {
        out.push({ key: `quiet:${quiet.opportunity_id}`, title: t('nextStep.quiet.title', { title: quiet.title }), subtitle: t('nextStep.quiet.subtitle'), cta: t('nextStep.quiet.cta'), visual: { kind: 'icon', icon: 'stick' }, to: `/opportunities/${quiet.opportunity_id}` })
      }
      const fits = scoped.matches.filter((m) => m.inScope)
      if (fits.length > 0) {
        out.push({
          key: 'available',
          title: t('nextStep.available.title', { count: fits.length }),
          subtitle: t('nextStep.available.subtitle'),
          cta: t('nextStep.available.cta'),
          visual: { kind: 'faces', people: fits.slice(0, 3).map((m) => ({ url: m.avatar_url, name: m.full_name, role: m.role })) },
          to: '/community',
        })
      }
      if (!hasPhoto && role === 'club') out.push({ key: 'crest', title: t('nextStep.crest.title'), subtitle: t('nextStep.crest.subtitle'), cta: t('nextStep.crest.cta'), visual: { kind: 'placeholder', role: 'club' }, to: OWN_PROFILE_EDIT_PATH })
      // A coach who recruits skips the talent branch: the photo step goes here (founder 2026-10-26).
      if (!hasPhoto && recruitingCoach) out.push({ key: 'photo', title: t('nextStep.photo.title'), subtitle: t('nextStep.photo.subtitle'), cta: t('nextStep.photo.cta'), visual: { kind: 'placeholder', role: 'coach' }, to: OWN_PROFILE_EDIT_PATH })
    }

    if (role === 'brand') {
      // No logo yet: the brand placeholder and "Add your logo" lead (founder 2026-10-26).
      if (!hasPhoto) out.push({ key: 'logo', title: t('nextStep.logo.title'), subtitle: t('nextStep.logo.subtitle'), cta: t('nextStep.logo.cta'), visual: { kind: 'placeholder', role: 'brand' }, to: OWN_PROFILE_EDIT_PATH })
      const searches = search.summary?.total ?? 0
      // Only with something to show: "0 profile views" is not something to act on
      // (production check 2026-11-24).
      if (views > 0 || searches > 0) out.push({
        key: 'brand',
        title: t('nextStep.views.title', { count: views }),
        subtitle: searches > 0 ? t('nextStep.brand.subtitleSearches', { count: searches }) : t('nextStep.views.subtitle'),
        // Opens who viewed the brand + search appearances (ruling 2026-10-16), never the composer.
        cta: t('nextStep.views.cta'),
        visual: { kind: 'icon', icon: 'chart' },
        to: BRAND_VIEWERS_PATH,
      })
    }

    if (role === 'umpire' && !(profile as { umpire_level?: string | null }).umpire_level) {
      out.push({ key: 'umpire', title: t('nextStep.umpire.title'), subtitle: t('nextStep.umpire.subtitle'), cta: t('nextStep.umpire.cta'), visual: { kind: 'icon', icon: 'stick' }, to: OWN_PROFILE_EDIT_PATH })
    }

    const open = out.filter((s) => !done.has(s.key))
    if (open.length === 0) {
      // H5 "Everyone · nothing pending → your week".
      open.push({
        key: 'week',
        title: views > 0 ? t('nextStep.views.title', { count: views }) : t('nextStep.week.title'),
        subtitle: views > 0 ? t('nextStep.views.subtitle') : t('nextStep.week.subtitle'),
        cta: views > 0 ? t('nextStep.views.cta') : t('nextStep.week.cta'),
        visual: { kind: 'icon', icon: 'chart' },
        to: views > 0 ? VIEWERS_PATH : '/inbox/activity',
      })
    }
    return open
  }, [profile, role, isTalent, isClubSide, recruitingCoach, vis.visibility, pulse.items, apps.applications, opps.mode, opps.items, roles.roles, roles.totals.pending, scoped.matches, search.summary, done, t])

  /** Resolving a card shows the next (spec): the check-in "Yes". */
  const run = useCallback(async (step: NextStep): Promise<boolean> => {
    if (step.action !== 'confirm_availability') return false
    try {
      const { error } = await supabase.rpc('confirm_availability')
      if (error) throw error
      const pulseId = step.key.split(':')[1]
      if (pulseId) await pulse.markActionCompleted(pulseId)
      if (profile) {
        const now = new Date().toISOString()
        setProfile({ ...profile, availability_confirmed_at: now, last_meaningful_update_at: now })
      }
      trackNextStepAction(step.key, 'confirm_availability')
      return true
    } catch (err) {
      logger.error('[useNextStep] confirm availability failed', err)
      return false
    }
  }, [pulse, profile, setProfile])

  /** "Not now" on the check-in (Your activity): dismiss the Pulse item. */
  const dismiss = useCallback(async (step: NextStep) => {
    const pulseId = step.key.split(':')[1]
    trackNextStepAction(step.key, 'dismiss')
    if (pulseId) await pulse.markDismissed(pulseId)
    setDone((prev) => new Set(prev).add(step.key))
  }, [pulse])

  /** Take a resolved card out (after its exit animation). */
  const markDone = useCallback((key: string) => setDone((prev) => new Set(prev).add(key)), [])

  return { steps, loading, run, dismiss, markDone }
}
