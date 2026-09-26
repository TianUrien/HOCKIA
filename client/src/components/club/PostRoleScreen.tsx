import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Calendar, Check, ChevronDown, ChevronLeft, Lock, MapPin, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Vacancy } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { useCountries } from '@/hooks/useCountries'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { trackVacancyCreate } from '@/lib/analytics'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { RoleCard } from '@/components/opportunities/RoleCard'
import LocationAutocomplete, { type LocationSelection } from '@/components/LocationAutocomplete'
import { SettingsSwitch } from '@/components/settings/settingsUi'
import { BENEFIT_TILES, genderPill } from '@/lib/opportunityCopy'
import { clubLeagueLine } from '@/lib/clubProfileCopy'
import {
  COACH_POSITIONS, COACH_TEAM_HINT, DESCRIPTION_MAX, DURATION_OPTIONS, LEVELS, PACKAGE_KEYS, PAY_OPTIONS, PLAYER_POSITIONS, TITLE_MAX,
  draftAsVacancy, draftFromRow, draftToRow, emptyDraft, hardnessFootnote, locationFromClub, playerChecklist, recruitingTarget,
  skillsFor, startLabel, stepProblem, switchRoleType, teamsFor, type PostRoleDraft, type Step,
} from '@/lib/postRole'
import RolePostedScreen from '@/components/club/RolePostedScreen'
import { cn } from '@/lib/utils'

/**
 * Post a role (Figma 04 Club 330:318 The role → 330:431 The offer →
 * 330:596 Check and post). A full-screen flow on phones: Save draft at any
 * step (status draft, shown under Opportunities → Open with a "Draft" pill),
 * Cancel with changes asks to keep a draft, Post role opens the role,
 * scopes Find players to it and shows Role posted (D1.26). Every field maps
 * 1:1 onto opportunities.
 */
interface Props {
  /** An existing draft to continue; null = a new role. */
  draftId: string | null
}

const STEP_COPY: Record<Step, { title: string; sub: string; back: string | null }> = {
  1: { title: 'What are you looking for?', sub: 'Step 1 of 3 · The role', back: null },
  2: { title: 'What do you offer?', sub: 'Step 2 of 3 · The offer', back: 'The role' },
  3: { title: 'Check and post', sub: 'Step 3 of 3 · How players will see it', back: 'The offer' },
}

function HardnessPill({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${label}: ${on ? 'must have' : 'nice to have'}`}
      onClick={onToggle}
      className={cn('flex h-6 items-center gap-1 rounded-full px-2.5 text-[13px] font-medium', on ? 'bg-hockia-soft text-hockia-primary' : 'bg-surface-grouped text-ink-2')}
    >
      {on && <Check className="h-3.5 w-3.5" strokeWidth={2.4} />}
      {on ? 'Must have' : 'Nice to have'}
    </button>
  )
}

function Section({ label, trailing, hint, children }: { label: string; trailing?: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="px-5 pt-5">
      <div className="mb-2 flex min-h-6 items-center justify-between gap-3">
        <h2 className="text-body font-semibold text-ink-1">{label}</h2>
        {trailing}
      </div>
      {children}
      {hint && <p className="mt-2 text-[13px] leading-[17px] text-ink-3">{hint}</p>}
    </section>
  )
}

const Muted = ({ children }: { children: ReactNode }) => <span className="text-[13px] text-ink-3">{children}</span>

function Segments<T extends string>({ value, options, onChange, label }: { value: T | null; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-0.5 rounded-[10px] bg-surface-grouped p-[3px]">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn('flex h-[30px] min-w-0 flex-1 items-center justify-center rounded-[8px] px-1 text-[14px]', on ? 'bg-white font-semibold text-ink-1 shadow-[0_1px_3px_rgba(0,0,0,0.10)]' : 'text-ink-2')}
          >
            <span className="truncate">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function Chips({ values, options, onToggle, label }: { values: string[]; options: { value: string; label: string }[]; onToggle: (v: string) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = values.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(o.value)}
            className={cn('flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[15px]', on ? 'bg-hockia-soft font-medium text-hockia-primary' : 'bg-surface-grouped text-ink-1')}
          >
            {on && <Check className="h-4 w-4" strokeWidth={2.2} />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export default function PostRoleScreen({ draftId }: Props) {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const addToast = useToastStore((s) => s.addToast)
  const { countries, getCountryById } = useCountries()
  const clubCountry = profile?.nationality_country_id ? getCountryById(profile.nationality_country_id) : null
  const defaults = useMemo(() => ({ baseLocation: profile?.base_location ?? null, countryName: clubCountry?.name ?? null }), [profile?.base_location, clubCountry?.name])

  const [step, setStep] = useState<Step>(1)
  const [draft, setDraft] = useState<PostRoleDraft>(() => emptyDraft(defaults))
  const [loaded, setLoaded] = useState(draftId === null)
  const initial = useRef<string>('')
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState<null | 'draft' | 'post'>(null)
  const [drafting, setDrafting] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [whereOpen, setWhereOpen] = useState(false)
  const [whereText, setWhereText] = useState('')
  const [posted, setPosted] = useState<{ id: string; draft: Pick<PostRoleDraft, 'type' | 'position'> } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // A new role: prefill Where from the club profile as it loads (profile,
  // then the countries list), until the club changes anything.
  const touched = useRef(false)
  useEffect(() => {
    if (draftId !== null || touched.current || !profile) return
    const fresh = emptyDraft(defaults)
    setDraft(fresh)
    initial.current = JSON.stringify(fresh)
  }, [draftId, defaults, profile])

  // Continue a draft.
  useEffect(() => {
    if (draftId === null || !profile?.id) return
    let cancelled = false
    void supabase.from('opportunities').select('*').eq('id', draftId).eq('club_id', profile.id).maybeSingle().then(({ data }) => {
      if (cancelled) return
      const row = data as Vacancy | null
      if (!row || row.status !== 'draft') {
        navigate('/opportunities', { replace: true })
        return
      }
      const d = draftFromRow(row)
      setDraft(d)
      initial.current = JSON.stringify(d)
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [draftId, profile?.id, navigate])

  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }) }, [step])

  const set = <K extends keyof PostRoleDraft>(key: K, value: PostRoleDraft[K]) => { touched.current = true; setProblem(null); setDraft((d) => ({ ...d, [key]: value })) }
  const toggleIn = (key: 'skills' | 'benefits', v: string) => { touched.current = true; setDraft((d) => ({ ...d, [key]: d[key].includes(v) ? d[key].filter((x) => x !== v) : [...d[key], v] })) }
  const dirty = loaded && JSON.stringify(draft) !== initial.current
  const isPlayer = draft.type === 'player'

  const save = async (status: 'draft' | 'open'): Promise<string | null> => {
    if (!profile?.id) return null
    const row = draftToRow(draft, profile.id, status)
    if (status === 'open') row.published_at = new Date().toISOString()
    if (draft.id) {
      const { error } = await supabase.from('opportunities').update(row as never).eq('id', draft.id).eq('club_id', profile.id)
      if (error) throw error
      return draft.id
    }
    const { data, error } = await supabase.from('opportunities').insert(row as never).select('id').single()
    if (error) throw error
    const id = (data as { id: string }).id
    trackDbEvent('opportunity_create', 'vacancy', id, { type: row.opportunity_type, source: 'post_role_v2' })
    trackVacancyCreate(row.position || row.opportunity_type || 'unknown')
    return id
  }

  const saveDraft = async () => {
    if (saving) return
    setSaving('draft')
    try {
      const id = await save('draft')
      if (!id) return
      initial.current = JSON.stringify(draft)
      addToast('Draft saved', 'success')
      navigate('/opportunities', { replace: true, state: { highlight: id } })
    } catch (err) {
      logger.error('[PostRole] save draft failed', err)
      addToast('Could not save the draft. Try again.', 'error')
    } finally {
      setSaving(null)
    }
  }

  const post = async () => {
    const p = stepProblem(draft, 3)
    if (p) { setProblem(p); return }
    if (saving) return
    setSaving('post')
    try {
      const id = await save('open')
      if (!id) return
      initial.current = JSON.stringify(draft)
      // Find players ranks for this role from now on (DEV NOTE 330:781).
      const target = recruitingTarget(draft.gender)
      if (target && isPlayer) {
        const { error } = await supabase.rpc('activate_opportunity_recruiting_context', {
          p_opportunity_id: id,
          p_target_category: target,
          p_region: (draft.city || null) as string,
          p_label: draftToRow(draft, profile!.id, 'open').title,
        })
        if (error) logger.warn('[PostRole] recruiting context not activated', error)
      }
      setPosted({ id, draft: { type: draft.type, position: draft.position } })
    } catch (err) {
      logger.error('[PostRole] post failed', err)
      addToast('Could not post the role. Try again.', 'error')
    } finally {
      setSaving(null)
    }
  }

  const next = () => {
    const p = stepProblem(draft, step)
    if (p) { setProblem(p); return }
    setProblem(null)
    if (step < 3) setStep((s) => (s + 1) as Step)
    else void post()
  }

  const back = () => {
    setProblem(null)
    if (step > 1) { setStep((s) => (s - 1) as Step); return }
    if (dirty) setConfirmCancel(true)
    else navigate('/opportunities')
  }

  const draftWithAI = async () => {
    if (drafting) return
    setDrafting(true)
    try {
      const { data, error } = await supabase.functions.invoke('role-description-draft', {
        body: {
          answers: {
            type: draft.type,
            position: draft.position,
            team: genderPill(draft.gender)?.label ?? draft.gender,
            title: draft.title,
            level: draft.level,
            skills: draft.skills,
            start: startLabel(draft.startDate),
            duration: draft.duration,
            city: draft.city,
            country: draft.country,
            pay: draft.pay,
            package: draft.benefits,
            euPassport: draft.euPassport,
          },
        },
      })
      const text = (data as { description?: string } | null)?.description
      if (error || !text) throw error ?? new Error('empty')
      set('description', text.slice(0, DESCRIPTION_MAX))
    } catch (err) {
      logger.error('[PostRole] AI draft failed', err)
      addToast('Could not draft it right now. Write a few lines instead.', 'error')
    } finally {
      setDrafting(false)
    }
  }

  const copy = STEP_COPY[step]
  const fromClub = (() => { const c = locationFromClub(defaults); return c.city === draft.city && c.country === draft.country && Boolean(c.city) })()
  const flag = countries.find((c) => c.name === draft.country)?.flag_emoji ?? null
  const league = draft.gender === 'Women' || draft.gender === 'Girls'
    ? clubLeagueLine(null, profile?.womens_league_division)?.replace(/ · women$/, '')
    : clubLeagueLine(profile?.mens_league_division, null)?.replace(/ · men$/, '')

  if (posted) return <RolePostedScreen roleId={posted.id} draft={posted.draft} />

  return (
    <div className="flex h-[100dvh] flex-col bg-white pt-[env(safe-area-inset-top)] lg:hidden" data-testid="post-role-screen">
      <header className="shrink-0">
        <div className="relative flex h-11 items-center justify-between px-4">
          <button type="button" onClick={back} className="flex h-11 items-center gap-0.5 text-body text-hockia-primary" aria-label={copy.back ? `Back to ${copy.back}` : 'Cancel'}>
            {copy.back && <ChevronLeft className="-ml-1.5 h-6 w-6" strokeWidth={2} />}
            {copy.back ?? 'Cancel'}
          </button>
          <span className="pointer-events-none absolute inset-x-28 text-center text-body font-semibold text-ink-1">New role</span>
          <button type="button" onClick={() => void saveDraft()} disabled={!loaded || saving !== null} className="flex h-11 items-center text-body text-hockia-primary disabled:opacity-40">
            {saving === 'draft' ? 'Saving…' : 'Save draft'}
          </button>
        </div>
        <div className="flex gap-1.5 px-5 pb-1 pt-1" aria-hidden="true">
          {[1, 2, 3].map((n) => <span key={n} className={cn('h-[3px] flex-1 rounded-full', n <= step ? 'bg-hockia-primary' : 'bg-line')} />)}
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto pb-6">
        <div className="px-5 pt-4">
          <h1 className="text-[28px] font-bold leading-[34px] tracking-[-0.3px] text-ink-1">{copy.title}</h1>
          <p className="mt-1 text-secondary text-ink-2">{copy.sub}</p>
        </div>

        {step === 1 && (
          <>
            <div className="px-5 pt-5">
              <Segments label="Role type" value={draft.type} options={[{ value: 'player', label: 'Player' }, { value: 'coach', label: 'Coach' }]} onChange={(v) => { touched.current = true; setProblem(null); setDraft((d) => switchRoleType(d, v)) }} />
            </div>
            <Section
              label={isPlayer ? 'Position' : 'Role'}
              trailing={isPlayer ? <HardnessPill label="Position" on={draft.positionRequired} onToggle={() => set('positionRequired', !draft.positionRequired)} /> : undefined}
              hint={isPlayer ? (draft.positionRequired ? 'Must have: players in this position rank first.' : 'Nice to have: used to rank players, never blocks them.') : undefined}
            >
              {isPlayer ? (
                <Segments label="Position" value={draft.position} options={PLAYER_POSITIONS} onChange={(v) => { touched.current = true; setDraft((d) => ({ ...d, position: v, skills: v === 'goalkeeper' ? d.skills : d.skills.filter((x) => x !== 'sweeper_keeper') })) }} />
              ) : (
                <Chips label="Role" values={draft.position ? [draft.position] : []} options={COACH_POSITIONS} onToggle={(v) => set('position', v as PostRoleDraft['position'])} />
              )}
            </Section>
            <Section label="Team" trailing={<span className="flex items-center gap-1 text-[13px] text-ink-3"><Lock className="h-3.5 w-3.5" strokeWidth={2} /> Always required</span>} hint={isPlayer ? 'Players outside this team can’t apply.' : COACH_TEAM_HINT}>
              <Segments label="Team" value={draft.gender} options={teamsFor(draft.type)} onChange={(v) => set('gender', v)} />
            </Section>
            <Section label="Title" trailing={<Muted>Optional</Muted>} hint={`Shown above the position. Up to ${TITLE_MAX} characters.`}>
              <input
                value={draft.title}
                onChange={(e) => set('title', e.target.value.slice(0, TITLE_MAX))}
                placeholder={isPlayer ? 'Men’s 1st player' : 'Head coach, 1st team'}
                aria-label="Title"
                maxLength={TITLE_MAX}
                className="h-12 w-full rounded-[12px] bg-surface-grouped px-4 text-[17px] text-ink-1 placeholder:text-ink-4 focus:outline-none focus:ring-2 focus:ring-hockia-primary/30"
              />
            </Section>
            <Section
              label="Level"
              trailing={isPlayer ? <HardnessPill label="Level" on={draft.levelRequired} onToggle={() => set('levelRequired', !draft.levelRequired)} /> : <Muted>Optional</Muted>}
              hint="Shown to players and used to rank them."
            >
              <Segments label="Level" value={draft.level} options={LEVELS} onChange={(v) => set('level', draft.level === v ? null : v)} />
            </Section>
            {isPlayer && (
              <Section label="Specialist skills" trailing={<HardnessPill label="Specialist skills" on={draft.skillsRequired} onToggle={() => set('skillsRequired', !draft.skillsRequired)} />} hint="Pick any that matter for this role.">
                <Chips label="Specialist skills" values={draft.skills} options={skillsFor(draft.position)} onToggle={(v) => toggleIn('skills', v)} />
              </Section>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <Section
              label="When"
              trailing={isPlayer ? <HardnessPill label="When" on={draft.availabilityRequired} onToggle={() => set('availabilityRequired', !draft.availabilityRequired)} /> : <Muted>Optional</Muted>}
              hint="Players mark when they’re free; we match it to your start."
            >
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-secondary text-ink-2">Start</span>
                  <span className="relative flex h-12 items-center gap-2 rounded-[12px] bg-surface-grouped px-3.5">
                    <Calendar className="h-[18px] w-[18px] shrink-0 text-ink-2" strokeWidth={1.8} />
                    <span className={cn('flex-1 truncate text-[17px]', draft.startDate ? 'text-ink-1' : 'text-ink-4')}>{startLabel(draft.startDate) ?? 'Immediately'}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={2} />
                    <input type="date" aria-label="Start date" value={draft.startDate ?? ''} onChange={(e) => set('startDate', e.target.value || null)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                  </span>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-secondary text-ink-2">Length</span>
                  <span className="relative flex h-12 items-center gap-2 rounded-[12px] bg-surface-grouped px-3.5">
                    <span className={cn('flex-1 truncate text-[17px]', draft.duration ? 'text-ink-1' : 'text-ink-4')}>{draft.duration ?? 'Choose'}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={2} />
                    <select aria-label="Length" value={draft.duration ?? ''} onChange={(e) => set('duration', e.target.value || null)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
                      <option value="">Not set</option>
                      {(draft.duration && !DURATION_OPTIONS.includes(draft.duration) ? [draft.duration, ...DURATION_OPTIONS] : DURATION_OPTIONS).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </span>
                </label>
              </div>
            </Section>
            <Section
              label="Where"
              trailing={isPlayer ? <HardnessPill label="Where" on={draft.locationRequired} onToggle={() => set('locationRequired', !draft.locationRequired)} /> : undefined}
              hint={fromClub ? 'From your club profile.' : undefined}
            >
              <button type="button" onClick={() => { setWhereText([draft.city, draft.country].filter(Boolean).join(', ')); setWhereOpen(true) }} className="flex h-12 w-full items-center gap-2.5 rounded-[12px] bg-surface-grouped px-3.5 text-left">
                <MapPin className="h-[18px] w-[18px] shrink-0 text-ink-2" strokeWidth={1.8} />
                <span className={cn('flex-1 truncate text-[17px]', draft.city ? 'text-ink-1' : 'text-ink-4')}>{[draft.city, draft.country].filter(Boolean).join(', ') || 'Add a city'}</span>
              </button>
            </Section>
            <Section label="Pay" trailing={isPlayer ? <HardnessPill label="Pay" on={draft.payRequired} onToggle={() => set('payRequired', !draft.payRequired)} /> : <Muted>Optional</Muted>}>
              <Segments label="Pay" value={draft.pay} options={PAY_OPTIONS} onChange={(v) => set('pay', draft.pay === v ? null : v)} />
            </Section>
            <Section label="Package" trailing={<Muted>Optional</Muted>} hint="Housing and flights are what relocating players ask about first.">
              <div className="grid grid-cols-2 gap-2.5" role="group" aria-label="Package">
                {PACKAGE_KEYS.map((k) => {
                  const tile = BENEFIT_TILES[k]
                  const on = draft.benefits.includes(k)
                  const Icon = tile.icon
                  return (
                    <button key={k} type="button" aria-pressed={on} onClick={() => toggleIn('benefits', k)} className={cn('flex h-[52px] items-center gap-2 rounded-[12px] border px-2.5 text-left', on ? 'border-[1.5px] border-hockia-primary bg-hockia-soft/40' : 'border-line bg-white')}>
                      <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px]', tile.tileClass)}><Icon className="h-[15px] w-[15px]" strokeWidth={2} /></span>
                      <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink-1">{tile.label}</span>
                      <span className={cn('flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full', on ? 'bg-hockia-primary text-white' : 'border-[1.5px] border-ink-4')}>
                        {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                      </span>
                    </button>
                  )
                })}
              </div>
            </Section>
            <section className="px-5 pt-5">
              <div className="flex items-center gap-3 rounded-[12px] bg-surface-grouped px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-body font-semibold text-ink-1">EU passport required</p>
                  <p className="text-[13px] leading-[17px] text-ink-2">Only players with an EU passport can apply.</p>
                </div>
                <SettingsSwitch label="EU passport required" checked={draft.euPassport} onChange={() => set('euPassport', !draft.euPassport)} />
              </div>
            </section>
          </>
        )}

        {step === 3 && profile && (
          <>
            <div className="px-5 pt-5" aria-label="Preview" data-testid="post-role-preview">
              <div className="pointer-events-none">
                <RoleCard
                  vacancy={draftAsVacancy(draft, profile.id)}
                  clubName={profile.full_name ?? 'Your club'}
                  clubLogo={profile.avatar_url ?? null}
                  publisherRole={profile.role}
                  countryFlag={flag}
                  league={league ?? null}
                  applied={false}
                  canApply
                  onOpen={() => undefined}
                  onApply={() => undefined}
                />
              </div>
            </div>
            <Section label="About the role" trailing={<Muted>Optional</Muted>}>
              <textarea
                value={draft.description}
                onChange={(e) => set('description', e.target.value.slice(0, DESCRIPTION_MAX))}
                placeholder="Who you are, training days, the city, what the season looks like…"
                aria-label="About the role"
                // Grows with the text (an AI draft is several lines); 4–12 rows.
                rows={Math.min(12, Math.max(4, draft.description.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 36)), 0)))}
                className="w-full resize-none rounded-[12px] bg-surface-grouped px-4 py-3 text-[16px] leading-[22px] text-ink-1 placeholder:text-ink-4 focus:outline-none focus:ring-2 focus:ring-hockia-primary/30"
              />
              <button type="button" onClick={() => void draftWithAI()} disabled={drafting} className="mt-2 flex h-9 items-center gap-1.5 text-secondary font-semibold text-hockia-primary disabled:opacity-50">
                <Sparkles className="h-4 w-4" strokeWidth={2} />
                {drafting ? 'Drafting…' : draft.description.trim() ? 'Redraft it with Hockia AI' : 'Draft it with Hockia AI'}
              </button>
            </Section>
            <section className="px-5 pt-3">
              <div className="rounded-[16px] border border-line p-4" data-testid="post-role-checklist">
                <h2 className="text-body font-semibold text-ink-1">What players ask first</h2>
                <ul className="mt-2 space-y-2">
                  {playerChecklist(draft).map((c) => (
                    <li key={c.key} className="flex items-center gap-2.5 text-[15px] text-ink-1">
                      <span className={cn('flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full', c.ok ? 'bg-positive-soft text-positive' : 'border-[1.5px] border-line')}>
                        {c.ok && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                      </span>
                      <span className={c.ok ? 'text-ink-1' : 'text-ink-2'}>{c.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="mt-3 text-[13px] leading-[17px] text-ink-3" data-testid="post-role-footnote">{hardnessFootnote(draft)}</p>
            </section>
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-white px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2.5">
        {problem && <p role="alert" className="pb-2 text-center text-secondary text-[#dc2626]">{problem}</p>}
        <button type="button" onClick={next} disabled={!loaded || saving !== null} className="flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white active:opacity-90 disabled:opacity-60">
          {step === 3 ? (saving === 'post' ? 'Posting…' : 'Post role') : 'Continue'}
        </button>
      </div>

      <BottomSheet open={whereOpen} onClose={() => setWhereOpen(false)} ariaLabel="Where">
        <div className="px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2">
          <h2 className="pb-3 text-body font-semibold text-ink-1">Where is the role?</h2>
          <LocationAutocomplete
            value={whereText}
            onChange={setWhereText}
            isSelected={false}
            placeholder="Search for a city…"
            onLocationSelect={(loc: LocationSelection) => {
              const country = loc.countryId ? getCountryById(loc.countryId) : null
              touched.current = true
              setDraft((d) => ({ ...d, city: loc.city, country: country?.name ?? d.country }))
              setWhereOpen(false)
            }}
            onLocationClear={() => undefined}
          />
        </div>
      </BottomSheet>

      <BottomSheet open={confirmCancel} onClose={() => setConfirmCancel(false)} ariaLabel="Save as draft?">
        <div className="px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2">
          <h2 className="text-[20px] font-bold text-ink-1">Save as draft?</h2>
          <p className="mt-1 text-row text-ink-2">Keep what you’ve written and finish the role later from Opportunities.</p>
          <div className="mt-4 flex flex-col gap-2.5">
            <button type="button" onClick={() => { setConfirmCancel(false); void saveDraft() }} className="flex h-[50px] items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white">Save draft</button>
            <button type="button" onClick={() => { setConfirmCancel(false); navigate('/opportunities') }} className="flex h-[50px] items-center justify-center rounded-full bg-surface-grouped text-body font-semibold text-[#dc2626]">Discard</button>
            <button type="button" onClick={() => setConfirmCancel(false)} className="flex h-11 items-center justify-center text-body text-ink-2">Keep editing</button>
          </div>
        </div>
      </BottomSheet>
    </div>
  )
}
