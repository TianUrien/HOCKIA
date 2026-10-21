import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Calendar, Camera, Check, ChevronDown, Lock, MapPin, Sparkles } from 'lucide-react'
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
  checkStepCopy, draftAsVacancy, draftFromRow, draftToEditPatch, draftToRow, emptyDraft, hardnessFootnote, locationFromClub, recruitingTarget, roleChecklist, rolePostedPath,
  levelHint, offerStepCopy, skillsFor, startLabel, stepProblem, switchRoleType, teamsFor, type PostRoleDraft, type Step,
} from '@/lib/postRole'
import { useRecruitingContextStore } from '@/hooks/useRecruitingContext'
import { Chips, HardnessPill, Muted, Section, Segments, TeamChips } from './roleFormUi'
import { CrestTile, GlassChip, RoleCover } from '@/components/opportunities/RoleCover'
import { useOwnerCrest } from '@/hooks/useOwnerCrest'
import { optimizeImage, validateImage } from '@/lib/imageOptimization'
import { deleteStorageObject } from '@/lib/storage'
import { CATEGORY_DOT_CLASSES, categoryFamily } from '@/lib/opportunityCopy'
import { positionLabel } from '@/lib/identity'
import { cn } from '@/lib/utils'
import { BackGlyph } from '@/components/ui/BackGlyph'
import { ANDROID_CHROME } from '@/lib/platformChrome'
import { MascotAvatar } from '@/components/hockiaAi/mascot'
import { applyAiDraft, checkSummary, type PostRoleStartState } from '@/lib/postRoleAi'
import { postAgainDraft } from '@/lib/postAgain'

/**
 * Post a role (Figma 04 Club 330:318 The role → 330:431 The offer →
 * 330:596 Check and post). A full-screen flow on phones: Save draft at any
 * step (status draft, shown under Opportunities → Open with a "Draft" pill),
 * Cancel with changes asks to keep a draft, Post role opens the role,
 * scopes Find players to it and shows Role posted (D1.26). Every field maps
 * 1:1 onto opportunities.
 */
interface Props {
  /** An existing role: a draft to continue, or a live (open/closed) role to
   *  edit. null = a new role. */
  draftId: string | null
}

const STEP_COPY: Record<Step, { title: string; sub: string; back: string | null }> = {
  1: { title: 'What are you looking for?', sub: 'Step 1 of 3 · The role', back: null },
  2: { title: 'What do you offer?', sub: 'Step 2 of 3 · The offer', back: 'The role' },
  3: { title: 'Check and post', sub: 'Step 3 of 3 · How players will see it', back: 'The offer' },
}

export default function PostRoleScreen({ draftId }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  // Club speed CS1–CS2: a new role started with Hockia AI (or from scratch
  // after it couldn't draft) arrives with router state from the start sheet.
  const start = draftId === null ? ((location.state as PostRoleStartState | null) ?? null) : null
  const seed = (fresh: PostRoleDraft): PostRoleDraft =>
    start?.ai ? applyAiDraft(fresh, start.ai.draft) : start?.scratchText ? { ...fresh, description: start.scratchText } : fresh
  const [aiMode] = useState(Boolean(start?.ai))
  const [againMode] = useState(Boolean(start?.postAgainId))
  // Both open on the summary check screen (Figma CS2 / CS3).
  const checkMode = aiMode || againMode
  const [aboutOpen, setAboutOpen] = useState(false)
  const startedAt = useRef(Date.now())
  const profile = useAuthStore((s) => s.profile)
  const addToast = useToastStore((s) => s.addToast)
  const { countries, getCountryById } = useCountries()
  const cover = useOwnerCrest(profile)
  // Cover photo (Figma O4a/O4b, ruling 4): optional, uploaded to role-covers/<club>/…,
  // written as opportunities.cover_url on save. A replaced or removed photo is
  // deleted only after the draft no longer points at it.
  const coverInput = useRef<HTMLInputElement>(null)
  const [coverBusy, setCoverBusy] = useState(false)
  const uploadCover = async (file: File | undefined) => {
    if (!file || !profile?.id) return
    const check = validateImage(file, { maxFileSizeMB: 10 })
    if (!check.valid) { addToast(check.error ?? 'Please use a JPG, PNG or WebP photo up to 10 MB.', 'error'); return }
    setCoverBusy(true)
    try {
      const optimized = await optimizeImage(file, { maxWidth: 1600, maxHeight: 1200, quality: 0.82 })
      const ext = (optimized.type === 'image/png' ? 'png' : optimized.type === 'image/webp' ? 'webp' : 'jpg')
      const path = `${profile.id}/${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage.from('role-covers').upload(path, optimized, { upsert: false, cacheControl: '31536000' })
      if (error) throw error
      const publicUrl = supabase.storage.from('role-covers').getPublicUrl(path).data.publicUrl
      const previous = draft.coverUrl
      set('coverUrl', publicUrl)
      if (previous) void deleteStorageObject({ bucket: 'role-covers', publicUrl: previous, context: 'post-role:replace-cover' })
    } catch (err) {
      logger.error('[PostRole] cover upload failed', err)
      addToast('We couldn’t upload this photo. Please use a JPG, PNG or WebP up to 10 MB.', 'error')
    } finally {
      setCoverBusy(false)
      if (coverInput.current) coverInput.current.value = ''
    }
  }
  const removeCover = () => {
    const previous = draft.coverUrl
    set('coverUrl', null)
    if (previous) void deleteStorageObject({ bucket: 'role-covers', publicUrl: previous, context: 'post-role:remove-cover' })
  }
  const clubCountry = profile?.nationality_country_id ? getCountryById(profile.nationality_country_id) : null
  const defaults = useMemo(() => ({ baseLocation: profile?.base_location ?? null, countryName: clubCountry?.name ?? null }), [profile?.base_location, clubCountry?.name])

  const [step, setStep] = useState<Step>(checkMode ? 3 : 1)
  const [draft, setDraft] = useState<PostRoleDraft>(() => seed(emptyDraft(defaults)))
  const [loaded, setLoaded] = useState(draftId === null && !start?.postAgainId)
  // Set when editing a role that is already live: its status is kept as is.
  const [liveStatus, setLiveStatus] = useState<'open' | 'closed' | null>(null)
  const editing = liveStatus !== null
  const initial = useRef<string>('')
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState<null | 'draft' | 'post'>(null)
  const [drafting, setDrafting] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [whereOpen, setWhereOpen] = useState(false)
  const [whereText, setWhereText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // A new role: prefill Where from the club profile as it loads (profile,
  // then the countries list), until the club changes anything.
  const touched = useRef(false)
  useEffect(() => {
    if (draftId !== null || touched.current || !profile || againMode) return
    const fresh = emptyDraft(defaults)
    setDraft(seed(fresh))
    // Measured against the empty form, so a drafted role counts as changes (Cancel offers Save draft).
    initial.current = JSON.stringify(fresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed reads the router state once per new role
  }, [draftId, defaults, profile])

  // Post again (CS3): the club's own closed role → a new draft with fresh dates.
  const postAgainId = start?.postAgainId ?? null
  useEffect(() => {
    if (!postAgainId || !profile?.id) return
    let cancelled = false
    void supabase.from('opportunities').select('*').eq('id', postAgainId).eq('club_id', profile.id).maybeSingle().then(({ data }) => {
      if (cancelled) return
      const row = data as Vacancy | null
      if (!row) { navigate('/opportunities', { replace: true }); return }
      setDraft(postAgainDraft(draftFromRow(row)))
      // Measured against the empty form, so Cancel offers Save draft.
      initial.current = JSON.stringify(emptyDraft(defaults))
      setLoaded(true)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per role; defaults only shape the "unchanged" baseline
  }, [postAgainId, profile?.id, navigate])

  // Continue a draft, or edit a live role (the club's own only).
  useEffect(() => {
    if (draftId === null || !profile?.id) return
    let cancelled = false
    void supabase.from('opportunities').select('*').eq('id', draftId).eq('club_id', profile.id).maybeSingle().then(({ data }) => {
      if (cancelled) return
      const row = data as Vacancy | null
      if (!row || (row.status !== 'draft' && row.status !== 'open' && row.status !== 'closed')) {
        navigate('/opportunities', { replace: true })
        return
      }
      if (row.status !== 'draft') setLiveStatus(row.status)
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

  // Scope Find players / Find coaches to this role (DEV NOTE 330:781), then
  // refresh the shared recruiting store so Community reads the NEW scope, not
  // the one it cached before this role existed.
  const scopeToRole = async (id: string) => {
    const { error } = await supabase.rpc('activate_opportunity_recruiting_context', {
      p_opportunity_id: id,
      // A coach role's team is not a player category; the RPC takes null.
      p_target_category: (isPlayer ? recruitingTarget(draft.gender) : null) as string,
      p_region: (draft.city || null) as string,
      p_label: draftToRow(draft, profile!.id, 'open').title,
    })
    if (error) logger.warn('[PostRole] recruiting context not activated', error)
    await useRecruitingContextStore.getState().refresh()
  }

  const saveEdit = async () => {
    const p = stepProblem(draft, 3)
    if (p) { setProblem(p); return }
    if (saving || !draft.id || !profile?.id) return
    setSaving('post')
    try {
      const { error } = await supabase.from('opportunities').update(draftToEditPatch(draft, profile.id) as never).eq('id', draft.id).eq('club_id', profile.id)
      if (error) throw error
      initial.current = JSON.stringify(draft)
      // The role's recruiting scope copies its fields; re-sync it when it's the active one.
      const active = useRecruitingContextStore.getState().rows.find((r) => r.is_active)
      if (liveStatus === 'open' && active?.opportunity_id === draft.id) await scopeToRole(draft.id)
      addToast('Changes saved.', 'success')
      navigate('/opportunities', { replace: true, state: { highlight: draft.id } })
    } catch (err) {
      logger.error('[PostRole] edit failed', err)
      addToast('Could not save the changes. Try again.', 'error')
    } finally {
      setSaving(null)
    }
  }

  const post = async () => {
    if (editing) { await saveEdit(); return }
    const p = stepProblem(draft, 3)
    if (p) {
      // From the AI check screen, take the club to the step that needs it.
      if (checkMode) setStep(stepProblem(draft, 1) ? 1 : stepProblem(draft, 2) ? 2 : 3)
      setProblem(p)
      return
    }
    if (saving) return
    setSaving('post')
    try {
      const id = await save('open')
      if (!id) return
      initial.current = JSON.stringify(draft)
      await scopeToRole(id)
      // Role posted has its own route, so a refresh re-renders it from the
      // saved role; replace keeps Back from reopening the form.
      trackDbEvent('post_role_posted', 'vacancy', id, { method: aiMode ? 'ai' : againMode ? 'post_again' : 'form', seconds: Math.round((Date.now() - startedAt.current) / 1000) })
      navigate(rolePostedPath(id), { replace: true, state: { role: { type: draft.type, position: draft.position } } })
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

  const aiCheck = checkMode && step === 3
  const back = () => {
    setProblem(null)
    if (step > 1 && !aiCheck) { setStep((s) => (s - 1) as Step); return }
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

  const baseCopy = step === 3 ? { ...STEP_COPY[3], title: editing ? 'Check and save' : STEP_COPY[3].title, sub: checkStepCopy(draft.type).sub } : STEP_COPY[step]
  // The AI check screen (Figma CS2) is reached from the start sheet: its way out is Cancel.
  const copy = aiCheck ? { ...baseCopy, back: null } : baseCopy
  const fromClub = (() => { const c = locationFromClub(defaults); return c.city === draft.city && c.country === draft.country && Boolean(c.city) })()
  const flag = countries.find((c) => c.name === draft.country)?.flag_emoji ?? null
  // Live cover preview (Figma O4): the club's colours from its crest, the team chip, the role.
  const previewPill = genderPill(draft.gender)
  const previewFamily = categoryFamily(draft.gender)
  const previewTitle = draft.title.trim() || positionLabel(draft.position) || (isPlayer ? 'Your role' : 'Coaching role')
  const previewClub = cover.clubName ?? profile?.full_name ?? 'Your club'
  const league = draft.gender === 'Women' || draft.gender === 'Girls'
    ? clubLeagueLine(null, profile?.womens_league_division)?.replace(/ · women$/, '')
    : clubLeagueLine(profile?.mens_league_division, null)?.replace(/ · men$/, '')

  return (
    <div className="flex h-app-screen flex-col bg-white pt-[env(safe-area-inset-top)] lg:hidden" data-testid="post-role-screen">
      <header className="shrink-0">
        <div className="relative flex h-11 items-center justify-between px-4">
          <button type="button" onClick={back} className="flex h-11 items-center gap-0.5 text-body text-hockia-primary" aria-label={copy.back ? `Back to ${copy.back}` : 'Cancel'}>
            {copy.back && <BackGlyph className="-ml-1.5 h-6 w-6" strokeWidth={2} />}
            {copy.back && ANDROID_CHROME ? null : (copy.back ?? 'Cancel')}
          </button>
          {aiCheck ? (
            <span className="pointer-events-none absolute inset-x-24 flex flex-col items-center text-center" data-testid="post-role-ai-header">
              <span className="text-body font-semibold leading-[21px] text-ink-1">Check your role</span>
              <span className="text-caption text-ink-3">{aiMode ? 'Drafted by Hockia AI · Beta' : 'Posted again · same details'}</span>
            </span>
          ) : (
            <span className="pointer-events-none absolute inset-x-28 text-center text-body font-semibold text-ink-1">{editing ? 'Edit role' : 'New role'}</span>
          )}
          {editing ? <span aria-hidden="true" /> : (
            <button type="button" onClick={() => void saveDraft()} disabled={!loaded || saving !== null} className="flex h-11 items-center text-body text-hockia-primary disabled:opacity-40">
              {saving === 'draft' ? 'Saving…' : 'Save draft'}
            </button>
          )}
        </div>
        <div className="flex gap-1.5 px-5 pb-1 pt-1" aria-hidden="true">
          {[1, 2, 3].map((n) => <span key={n} className={cn('h-[3px] flex-1 rounded-full', n <= step ? 'bg-hockia-primary' : 'bg-line')} />)}
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto pb-6">
        {aiCheck ? (
          <div className="flex items-center px-5 pt-3 text-ink-3">
            <span className="flex-1 text-micro font-semibold uppercase tracking-[0.44px]">Preview</span>
            <span className="text-caption">Live preview</span>
          </div>
        ) : (
          <div className="px-5 pt-4">
            <h1 className="text-title-xl text-ink-1">{copy.title}</h1>
            <p className="mt-1 text-secondary text-ink-2">{copy.sub}</p>
          </div>
        )}

        {step === 1 && (
          <>
            <section className="px-5 pt-5" data-testid="post-role-cover-preview">
              <div className="flex items-center justify-between">
                <span className="text-micro font-semibold uppercase tracking-[0.02em] text-ink-3">Cover · optional</span>
                <span className="text-secondary text-ink-3">Live preview</span>
              </div>
              <RoleCover coverUrl={draft.coverUrl} crestUrl={cover.crestUrl} palette={cover.palette} scrim="card" className="mt-2 h-[196px] rounded-[20px]">
                {previewPill && previewFamily && <span className="absolute left-3 top-3"><GlassChip dotClass={CATEGORY_DOT_CLASSES[previewFamily]}>{previewPill.label}</GlassChip></span>}
                {/* Add photo / Change (Figma 158:426 / 158:506): a glass pill on the preview. */}
                <button
                  type="button"
                  onClick={() => coverInput.current?.click()}
                  disabled={coverBusy}
                  className="absolute right-3 top-3 inline-flex h-9 items-center gap-1.5 rounded-full border border-white/20 px-3.5 text-secondary font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] backdrop-blur-[10px] disabled:opacity-60"
                  style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
                  data-testid="post-role-cover-add"
                >
                  <Camera className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                  {coverBusy ? 'Uploading…' : draft.coverUrl ? 'Change' : 'Add photo'}
                </button>
                <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void uploadCover(e.target.files?.[0])} data-testid="post-role-cover-input" />
                <div className="absolute bottom-3.5 left-3.5 right-3.5 flex items-center gap-2.5">
                  <CrestTile src={cover.crestUrl} name={previewClub} size={36} radius={10} />
                  <span className="min-w-0">
                    <span className="block truncate text-[16px] font-semibold leading-[21px] text-white">{previewTitle}</span>
                    <span className="block truncate text-caption text-white/80">{[previewClub, draft.country.trim() || null].filter(Boolean).join(' · ')}</span>
                  </span>
                </div>
              </RoleCover>
              {draft.coverUrl ? (
                <>
                  <p className="mt-2 text-secondary text-ink-2">Looks great. We add a soft shade at the bottom so the title always reads.</p>
                  <button type="button" onClick={removeCover} className="mt-1 h-9 text-secondary font-semibold text-status-danger" data-testid="post-role-cover-remove">Remove photo</button>
                </>
              ) : (
                <p className="mt-2 text-secondary text-ink-2">No photo? We build a cover from your crest in your club colours. It already looks finished.</p>
              )}
            </section>
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
              <TeamChips label="Team" value={draft.gender} options={teamsFor(draft.type)} onChange={(v) => set('gender', v)} />
            </Section>
            <Section label="Title" trailing={<Muted>Optional</Muted>} hint={`The role’s headline, shown above the position. Up to ${TITLE_MAX} characters.`}>
              <input
                value={draft.title}
                onChange={(e) => set('title', e.target.value.slice(0, TITLE_MAX))}
                placeholder={isPlayer ? 'Men’s 1st player' : 'Head coach, 1st team'}
                aria-label="Title"
                maxLength={TITLE_MAX}
                className="h-12 w-full rounded-[12px] bg-surface-grouped px-4 text-[17px] text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-hockia-primary/30"
              />
            </Section>
            <Section
              label="Level"
              trailing={isPlayer ? <HardnessPill label="Level" on={draft.levelRequired} onToggle={() => set('levelRequired', !draft.levelRequired)} /> : <Muted>Optional</Muted>}
              hint={levelHint(draft.type)}
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
              hint={offerStepCopy(draft.type).when}
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
            <Section label="Package" trailing={<Muted>Optional</Muted>} hint={offerStepCopy(draft.type).package}>
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
                  <p className="text-[13px] leading-[17px] text-ink-2">{offerStepCopy(draft.type).euPassport}</p>
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
                  onOpen={() => undefined}
                />
              </div>
            </div>
            {aiCheck && (
              <div className="flex flex-col gap-2 px-5 pt-2" data-testid="post-role-ai-summary">
                {aiMode ? (
                  <div className="flex items-center gap-2.5 rounded-[16px] bg-brand-soft px-3.5 py-3">
                    <MascotAvatar size={32} />
                    <p className="min-w-0 flex-1 text-secondary leading-[18px] text-ink-1">I filled this in from what you wrote. Check each part, then post. Nothing is live yet.</p>
                  </div>
                ) : (
                  <p className="rounded-[16px] bg-surface-subtle px-3.5 py-3 text-secondary leading-[18px] text-ink-1" data-testid="post-again-note">Same details as your closed role. Dates and applicants start fresh. Add a start date if you have one, then post. Nothing is live yet.</p>
                )}
                {checkSummary(draft, { fromClub }).map((sec) => (
                  <div key={sec.key} className="flex flex-col gap-1 rounded-[16px] bg-surface-subtle px-4 py-3" data-testid={`ai-summary-${sec.key}`}>
                    <div className="flex items-center">
                      <span className="flex-1 text-caption font-semibold uppercase tracking-[0.48px] text-ink-2">{sec.label}</span>
                      <button
                        type="button"
                        onClick={() => { setProblem(null); if (sec.key === 'role') setStep(1); else if (sec.key === 'offer') setStep(2); else if (sec.key === 'where') { setWhereText(''); setWhereOpen(true) } else setAboutOpen((v) => !v) }}
                        className="-my-2 flex min-h-11 items-center pl-3 text-[14px] font-semibold text-brand-primary"
                        aria-label={`Edit ${sec.label.toLowerCase()}`}
                      >
                        {sec.key === 'about' && aboutOpen ? 'Done' : 'Edit'}
                      </button>
                    </div>
                    {sec.key === 'about' && aboutOpen ? null : sec.lines.map((line, i) => (
                      <p key={i} className={cn('text-body text-ink-1', sec.key === 'about' && 'line-clamp-3')}>{line}</p>
                    ))}
                    {sec.neededMissing.length > 0 && <p className="text-secondary font-semibold text-status-warning">Needed: {sec.neededMissing.join(', ')}</p>}
                    {sec.optionalMissing.length > 0 && !(sec.key === 'about' && aboutOpen) && <p className="text-secondary text-ink-3">Not set · optional: {sec.optionalMissing.join(', ')}</p>}
                  </div>
                ))}
              </div>
            )}
            {(!aiCheck || aboutOpen) && (
            <Section label="About the role" trailing={<Muted>Optional</Muted>}>
              <textarea
                value={draft.description}
                onChange={(e) => set('description', e.target.value.slice(0, DESCRIPTION_MAX))}
                placeholder="Who you are, training days, the city, what the season looks like…"
                aria-label="About the role"
                // Grows with the text (an AI draft is several lines); 4–12 rows.
                rows={Math.min(12, Math.max(4, draft.description.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 36)), 0)))}
                className="w-full resize-none rounded-[12px] bg-surface-grouped px-4 py-3 text-[16px] leading-[22px] text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-hockia-primary/30"
              />
              <button type="button" onClick={() => void draftWithAI()} disabled={drafting} className="mt-2 flex h-9 items-center gap-1.5 text-secondary font-semibold text-hockia-primary disabled:opacity-50">
                <Sparkles className="h-4 w-4" strokeWidth={2} />
                {drafting ? 'Drafting…' : draft.description.trim() ? 'Redraft it with Hockia AI' : 'Draft it with Hockia AI'}
              </button>
            </Section>
            )}
            {!aiCheck && (
            <section className="px-5 pt-3">
              <div className="rounded-[16px] border border-line p-4" data-testid="post-role-checklist">
                <h2 className="text-body font-semibold text-ink-1">{checkStepCopy(draft.type).checklistTitle}</h2>
                <ul className="mt-2 space-y-2">
                  {roleChecklist(draft).map((c) => (
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
            )}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-white px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2.5">
        {problem && <p role="alert" className="pb-2 text-center text-secondary text-status-danger">{problem}</p>}
        <button type="button" onClick={next} disabled={!loaded || saving !== null} className="flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white active:opacity-90 disabled:opacity-60">
          {step === 3
            ? (editing ? (saving === 'post' ? 'Saving…' : 'Save changes') : (saving === 'post' ? 'Posting…' : 'Post role'))
            : 'Continue'}
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

      <BottomSheet open={confirmCancel && editing} onClose={() => setConfirmCancel(false)} ariaLabel="Discard changes?">
        <div className="px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2">
          <h2 className="text-[20px] font-bold text-ink-1">Discard changes?</h2>
          <p className="mt-1 text-row text-ink-2">The role stays as it was.</p>
          <div className="mt-4 flex flex-col gap-2.5">
            <button type="button" onClick={() => { setConfirmCancel(false); navigate('/opportunities') }} className="flex h-[50px] items-center justify-center rounded-full bg-surface-grouped text-body font-semibold text-status-danger">Discard</button>
            <button type="button" onClick={() => setConfirmCancel(false)} className="flex h-11 items-center justify-center text-body text-ink-2">Keep editing</button>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet open={confirmCancel && !editing} onClose={() => setConfirmCancel(false)} ariaLabel="Save as draft?">
        <div className="px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2">
          <h2 className="text-[20px] font-bold text-ink-1">Save as draft?</h2>
          <p className="mt-1 text-row text-ink-2">Keep what you’ve written and finish the role later from Opportunities.</p>
          <div className="mt-4 flex flex-col gap-2.5">
            <button type="button" onClick={() => { setConfirmCancel(false); void saveDraft() }} className="flex h-[50px] items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white">Save draft</button>
            <button type="button" onClick={() => { setConfirmCancel(false); navigate('/opportunities') }} className="flex h-[50px] items-center justify-center rounded-full bg-surface-grouped text-body font-semibold text-status-danger">Discard</button>
            <button type="button" onClick={() => setConfirmCancel(false)} className="flex h-11 items-center justify-center text-body text-ink-2">Keep editing</button>
          </div>
        </div>
      </BottomSheet>
    </div>
  )
}
