import { useState } from 'react'
import { Lock, X } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { useRecruitingContextStore } from '@/hooks/useRecruitingContext'
import { useToastStore } from '@/lib/toast'
import { useClubT } from '@/i18n/ns/club'
import { COACH_POSITIONS, coachTeamHint, LEVELS, PLAYER_POSITIONS, levelHint, skillsFor, teamsFor, type RolePosition } from '@/lib/postRole'
import { LABEL_MAX, emptyContextDraft, newContextPayload, newContextProblem, type ContextKind, type NewContextDraft } from '@/lib/newContext'
import { Chips, HardnessPill, Muted, Section, Segments } from './roleFormUi'

/**
 * New context (Figma D1.23 355:528; DEV NOTE 355:931): "a short form with the
 * Post a role step-1 criteria" — position, team, name, level, skills (with
 * their must-have / nice-to-have switch) plus the region a saved search ranks
 * for. Saving makes it the active context, so Find players and Community
 * re-rank for it. Only the club sees it.
 */
interface Props {
  open: boolean
  kind: ContextKind
  onClose: () => void
  /** Called after the new context is saved and active. */
  onSaved: () => void
}

export default function NewContextSheet({ open, kind, onClose, onSaved }: Props) {
  const t = useClubT()
  const create = useRecruitingContextStore((s) => s.create)
  const update = useRecruitingContextStore((s) => s.update)
  const addToast = useToastStore((s) => s.addToast)
  const [draft, setDraft] = useState<NewContextDraft>(emptyContextDraft)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const isPlayer = kind === 'player'

  const set = <K extends keyof NewContextDraft>(key: K, value: NewContextDraft[K]) => { setProblem(null); setDraft((d) => ({ ...d, [key]: value })) }
  const close = () => { setDraft(emptyContextDraft()); setProblem(null); onClose() }

  const save = async () => {
    const p = newContextProblem(draft, kind)
    if (p) { setProblem(p); return }
    if (saving) return
    setSaving(true)
    try {
      const { create: base, update: criteria } = newContextPayload(draft, kind)
      const row = await create(base)
      if (!row) throw new Error('context not created')
      await update(row.id, criteria)
      addToast(t('newContextSheet.saved'), 'success')
      setDraft(emptyContextDraft())
      onSaved()
    } catch {
      addToast(t('newContextSheet.saveFailed'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={close} ariaLabel={t('newContextSheet.title')}>
      <div className="relative px-5 pb-1 pt-1">
        <h2 className="pr-10 text-[22px] font-bold leading-7 text-ink-1">{t('newContextSheet.title')}</h2>
        <p className="text-[14px] leading-[19px] text-ink-2">{t('newContextSheet.intro')}</p>
        <button type="button" onClick={close} aria-label={t('newContextSheet.close')} className="absolute right-3 top-0 flex h-10 w-10 items-center justify-center text-ink-3">
          <X className="h-5 w-5" strokeWidth={2} />
        </button>
      </div>

      <div className="pb-3" data-testid="new-context-form">
        <Section
          label={isPlayer ? t('newContextSheet.position') : t('newContextSheet.role')}
          trailing={isPlayer ? <HardnessPill label={t('newContextSheet.position')} on={draft.positionRequired} onToggle={() => set('positionRequired', !draft.positionRequired)} /> : undefined}
          hint={isPlayer ? (draft.positionRequired ? t('newContextSheet.positionMust') : t('newContextSheet.positionNice')) : undefined}
        >
          {isPlayer ? (
            <Segments label={t('newContextSheet.position')} value={draft.position} options={PLAYER_POSITIONS} onChange={(v) => setDraft((d) => ({ ...d, position: v, skills: v === 'goalkeeper' ? d.skills : d.skills.filter((x) => x !== 'sweeper_keeper') }))} />
          ) : (
            <Chips label={t('newContextSheet.role')} values={draft.position ? [draft.position] : []} options={COACH_POSITIONS} onToggle={(v) => set('position', v as RolePosition)} />
          )}
        </Section>
        <Section label={t('newContextSheet.team')} trailing={<span className="flex items-center gap-1 text-[13px] text-ink-3"><Lock className="h-3.5 w-3.5" strokeWidth={2} /> {t('newContextSheet.required')}</span>} hint={isPlayer ? t('newContextSheet.teamHint') : coachTeamHint()}>
          <Segments label={t('newContextSheet.team')} value={draft.gender} options={teamsFor(kind)} onChange={(v) => set('gender', v)} />
        </Section>
        <Section label={t('newContextSheet.name')} trailing={<Muted>{t('newContextSheet.optional')}</Muted>} hint={t('newContextSheet.nameHint')}>
          <input
            value={draft.label}
            onChange={(e) => set('label', e.target.value.slice(0, LABEL_MAX))}
            placeholder={isPlayer ? t('newContextSheet.namePlaceholderPlayer') : t('newContextSheet.namePlaceholderCoach')}
            aria-label={t('newContextSheet.name')}
            maxLength={LABEL_MAX}
            className="h-12 w-full rounded-[12px] bg-surface-grouped px-4 text-[17px] text-ink-1 placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/30"
          />
        </Section>
        <Section
          label={t('newContextSheet.level')}
          trailing={isPlayer ? <HardnessPill label={t('newContextSheet.level')} on={draft.levelRequired} onToggle={() => set('levelRequired', !draft.levelRequired)} /> : <Muted>{t('newContextSheet.optional')}</Muted>}
          hint={levelHint(kind)}
        >
          <Segments label={t('newContextSheet.level')} value={draft.level} options={LEVELS} onChange={(v) => set('level', draft.level === v ? null : v)} />
        </Section>
        {isPlayer && (
          <Section label={t('newContextSheet.skills')} trailing={<HardnessPill label={t('newContextSheet.skills')} on={draft.skillsRequired} onToggle={() => set('skillsRequired', !draft.skillsRequired)} />} hint={t('newContextSheet.skillsHint')}>
            <Chips label={t('newContextSheet.skills')} values={draft.skills} options={skillsFor(draft.position)} onToggle={(v) => setDraft((d) => ({ ...d, skills: d.skills.includes(v) ? d.skills.filter((x) => x !== v) : [...d.skills, v] }))} />
          </Section>
        )}
        <Section label={t('newContextSheet.region')} trailing={<Muted>{t('newContextSheet.optional')}</Muted>} hint={t('newContextSheet.regionHint')}>
          <input
            value={draft.region}
            onChange={(e) => set('region', e.target.value.slice(0, 80))}
            placeholder={t('newContextSheet.regionPlaceholder')}
            aria-label={t('newContextSheet.region')}
            className="h-12 w-full rounded-[12px] bg-surface-grouped px-4 text-[17px] text-ink-1 placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/30"
          />
        </Section>
      </div>

      <div className="sticky bottom-0 border-t border-line bg-white px-5 pb-1 pt-3">
        {problem && <p role="alert" className="pb-2 text-[14px] font-medium text-status-danger">{problem}</p>}
        <button type="button" onClick={() => void save()} disabled={saving} className="flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white disabled:opacity-60" data-testid="new-context-save">
          {saving ? t('newContextSheet.saving') : t('newContextSheet.save')}
        </button>
      </div>
    </BottomSheet>
  )
}
