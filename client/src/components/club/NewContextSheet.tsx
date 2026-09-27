import { useState } from 'react'
import { Lock, X } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { useRecruitingContextStore } from '@/hooks/useRecruitingContext'
import { useToastStore } from '@/lib/toast'
import { COACH_POSITIONS, COACH_TEAM_HINT, LEVELS, PLAYER_POSITIONS, levelHint, skillsFor, teamsFor, type RolePosition } from '@/lib/postRole'
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
      addToast('Context saved. Ranking for it now.', 'success')
      setDraft(emptyContextDraft())
      onSaved()
    } catch {
      addToast('Could not save the context. Try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={close} ariaLabel="New context">
      <div className="relative px-5 pb-1 pt-1">
        <h2 className="pr-10 text-[22px] font-bold leading-7 text-ink-1">New context</h2>
        <p className="text-[14px] leading-[19px] text-ink-2">A saved search for scouting without a posting. Only you see this.</p>
        <button type="button" onClick={close} aria-label="Close" className="absolute right-3 top-0 flex h-10 w-10 items-center justify-center text-ink-3">
          <X className="h-5 w-5" strokeWidth={2} />
        </button>
      </div>

      <div className="pb-3" data-testid="new-context-form">
        <Section
          label={isPlayer ? 'Position' : 'Role'}
          trailing={isPlayer ? <HardnessPill label="Position" on={draft.positionRequired} onToggle={() => set('positionRequired', !draft.positionRequired)} /> : undefined}
          hint={isPlayer ? (draft.positionRequired ? 'Must have: players in this position rank first.' : 'Nice to have: used to rank players, never hides them.') : undefined}
        >
          {isPlayer ? (
            <Segments label="Position" value={draft.position} options={PLAYER_POSITIONS} onChange={(v) => setDraft((d) => ({ ...d, position: v, skills: v === 'goalkeeper' ? d.skills : d.skills.filter((x) => x !== 'sweeper_keeper') }))} />
          ) : (
            <Chips label="Role" values={draft.position ? [draft.position] : []} options={COACH_POSITIONS} onToggle={(v) => set('position', v as RolePosition)} />
          )}
        </Section>
        <Section label="Team" trailing={<span className="flex items-center gap-1 text-[13px] text-ink-3"><Lock className="h-3.5 w-3.5" strokeWidth={2} /> Required</span>} hint={isPlayer ? 'Fit is measured against this team.' : COACH_TEAM_HINT}>
          <Segments label="Team" value={draft.gender} options={teamsFor(kind)} onChange={(v) => set('gender', v)} />
        </Section>
        <Section label="Name" trailing={<Muted>Optional</Muted>} hint="Shown in Recruiting for. Without one, the position and team name it.">
          <input
            value={draft.label}
            onChange={(e) => set('label', e.target.value.slice(0, LABEL_MAX))}
            placeholder={isPlayer ? 'Midfielder for next season' : 'Coach for next season'}
            aria-label="Name"
            maxLength={LABEL_MAX}
            className="h-12 w-full rounded-[12px] bg-surface-grouped px-4 text-[17px] text-ink-1 placeholder:text-ink-4 focus:outline-none focus:ring-2 focus:ring-hockia-primary/30"
          />
        </Section>
        <Section
          label="Level"
          trailing={isPlayer ? <HardnessPill label="Level" on={draft.levelRequired} onToggle={() => set('levelRequired', !draft.levelRequired)} /> : <Muted>Optional</Muted>}
          hint={levelHint(kind)}
        >
          <Segments label="Level" value={draft.level} options={LEVELS} onChange={(v) => set('level', draft.level === v ? null : v)} />
        </Section>
        {isPlayer && (
          <Section label="Specialist skills" trailing={<HardnessPill label="Specialist skills" on={draft.skillsRequired} onToggle={() => set('skillsRequired', !draft.skillsRequired)} />} hint="Pick any that matter.">
            <Chips label="Specialist skills" values={draft.skills} options={skillsFor(draft.position)} onToggle={(v) => setDraft((d) => ({ ...d, skills: d.skills.includes(v) ? d.skills.filter((x) => x !== v) : [...d.skills, v] }))} />
          </Section>
        )}
        <Section label="Region" trailing={<Muted>Optional</Muted>} hint="A city or region to rank nearby people first.">
          <input
            value={draft.region}
            onChange={(e) => set('region', e.target.value.slice(0, 80))}
            placeholder="Dublin"
            aria-label="Region"
            className="h-12 w-full rounded-[12px] bg-surface-grouped px-4 text-[17px] text-ink-1 placeholder:text-ink-4 focus:outline-none focus:ring-2 focus:ring-hockia-primary/30"
          />
        </Section>
      </div>

      <div className="sticky bottom-0 border-t border-line bg-white px-5 pb-1 pt-3">
        {problem && <p role="alert" className="pb-2 text-[14px] font-medium text-red-600">{problem}</p>}
        <button type="button" onClick={() => void save()} disabled={saving} className="flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white disabled:opacity-60" data-testid="new-context-save">
          {saving ? 'Saving…' : 'Save and rank'}
        </button>
      </div>
    </BottomSheet>
  )
}
