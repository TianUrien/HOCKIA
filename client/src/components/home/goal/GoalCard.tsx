import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Lock, Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/logger'
import { hapticLight } from '@/lib/haptics'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useCountries } from '@/hooks/useCountries'
import { useGoalActions, useMyGoal } from '@/hooks/useMemberGoal'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { fieldInput } from '@/components/ui/fieldClasses'
import {
  GOAL_MAX,
  GOAL_OPTIONS,
  GOAL_TEXT_MAX,
  goalLater,
  goalParts,
  goalRows,
  isGoalRole,
  saveMyGoal,
  trackGoal,
  type GoalRole,
} from '@/lib/memberGoals'
import { useHomeT } from '@/i18n/ns/home'
import { countryLabel } from '@/i18n/countryNames'

/**
 * "What's your goal?" (Figma page 02, YG: G1–G5; founder 2026-10-25). Since
 * 2026-11-24 it lives in the owner-only area of the member's own profile. Ask card until the member answers or taps Later twice;
 * then the set card with up to two rows from real data. Only the member ever
 * sees their goal.
 */
export function GoalCard() {
  const profile = useAuthStore((s) => s.profile)
  const role = profile?.role
  const { data: goal, isLoading, refresh } = useMyGoal()
  const [editing, setEditing] = useState(false)
  const [hiddenNow, setHiddenNow] = useState(false)
  const isSet = Boolean(goal?.set_at)
  const actions = useGoalActions(isSet && !editing)
  const { getCountryById } = useCountries()

  if (!isGoalRole(role) || isLoading || !goal || hiddenNow) return null

  if (editing || (!isSet && goal.should_ask)) {
    return (
      <AskCard
        role={role}
        initial={editing ? { options: goal.options, other: goal.other_text } : { options: [], other: null }}
        changing={editing}
        onDone={() => { setEditing(false); void refresh() }}
        onLater={() => setHiddenNow(true)}
        onCancel={() => setEditing(false)}
      />
    )
  }
  if (!isSet) return null

  const c = profile?.base_country_id != null ? getCountryById(profile.base_country_id) : undefined
  const rows = goalRows(role, goal, actions.data ?? {}, c ? countryLabel(c.common_name || c.name) : null)
  return <SetCard role={role} parts={goalParts(role, goal)} rows={rows} onChange={() => setEditing(true)} />
}

/**
 * The goal once set (founder 2026-11-24: "more elegant, more professional;
 * the text is very big and cannot be read in full"). A quiet white card with
 * a hairline: a small header, each picked goal as its own soft chip, the
 * member's own words in full at reading size, then the actions as plain
 * rows. Nothing is truncated.
 */
function SetCard({ role, parts, rows, onChange }: { role: GoalRole; parts: ReturnType<typeof goalParts>; rows: ReturnType<typeof goalRows>; onChange: () => void }) {
  const t = useHomeT()
  const navigate = useNavigate()
  return (
    <section className="px-4 pb-3 pt-2" aria-label={t('goal.set.ariaLabel')} data-testid="home-goal-set">
      <div className="rounded-[20px] border border-line bg-white shadow-[0_1px_2px_rgba(15,15,20,0.04)]">
        <div className="flex items-center gap-2.5 pl-4 pr-2 pt-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-primary">
            <Target className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <h2 className="text-row font-semibold text-ink-1">{t('goal.set.eyebrow')}</h2>
          </span>
          <button type="button" onClick={onChange} className="flex h-11 shrink-0 items-center px-2 text-secondary font-semibold text-brand-primary" data-testid="home-goal-change">{t('goal.set.change')}</button>
        </div>

        <div className="flex flex-col gap-3 px-4 pb-4">
          {parts.labels.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" data-testid="home-goal-picks">
              {parts.labels.map((label) => (
                <li key={label} className="rounded-full bg-brand-soft px-3 py-1.5 text-secondary font-medium text-brand-primary">{label}</li>
              ))}
            </ul>
          )}
          {parts.other && (
            <p className="whitespace-pre-line break-words border-l-2 border-brand-soft pl-3 text-row text-ink-1" data-testid="home-goal-own-words">{parts.other}</p>
          )}
          <p className="flex items-center gap-1 text-caption text-ink-3">
            <Lock className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden="true" /> {t('goal.other.privacy')}
          </p>
        </div>

        {rows.length > 0 ? (
          <div className="divide-y divide-line border-t border-line">
            {rows.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => { trackGoal('goal_action', { goal: r.goal, action: r.key, role }); navigate(r.to) }}
                className="flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-subtle"
                data-testid={`home-goal-row-${r.key}`}
              >
                <span className="min-w-0 flex-1 text-row text-ink-2">{r.text}</span>
                <span className="flex shrink-0 items-center gap-0.5 text-secondary font-semibold text-brand-primary">
                  {r.action}
                  <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}

interface AskCardProps {
  role: GoalRole
  initial: { options: string[]; other: string | null }
  changing: boolean
  onDone: () => void
  onLater: () => void
  onCancel: () => void
}

function AskCard({ role, initial, changing, onDone, onLater, onCancel }: AskCardProps) {
  const t = useHomeT()
  const addToast = useToastStore((s) => s.addToast)
  const [picked, setPicked] = useState<string[]>(initial.options)
  const [other, setOther] = useState<string | null>(initial.other)
  const [otherOpen, setOtherOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const viewed = useRef(false)
  const count = picked.length + (other ? 1 : 0)

  useEffect(() => {
    if (viewed.current || changing) return
    viewed.current = true
    trackGoal('goal_prompt_view', { role })
  }, [changing, role])

  const toggle = (key: string) => {
    if (picked.includes(key)) { setPicked(picked.filter((k) => k !== key)); return }
    if (count >= GOAL_MAX) { void hapticLight(); return }
    setPicked([...picked, key])
  }

  const save = async () => {
    setSaving(true)
    try {
      await saveMyGoal(picked, other)
      trackGoal(changing ? 'goal_change' : 'goal_set', { options: picked, has_text: Boolean(other), count, role })
      onDone()
    } catch (err) {
      logger.error('[GoalCard] save failed', err)
      addToast(t('goal.ask.saveFailed'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const later = async () => {
    onLater()
    try {
      const times = await goalLater()
      trackGoal('goal_later', { times, role })
    } catch (err) {
      logger.error('[GoalCard] later failed', err)
    }
  }

  const chip = (selected: boolean) =>
    cn('h-11 rounded-full border px-4 text-row', selected ? 'border-transparent bg-brand-soft font-semibold text-brand-primary' : 'border-line bg-white text-ink-1')

  return (
    <section className="px-4 pb-3 pt-2" aria-label={t('goal.ask.ariaLabel')} data-testid="home-goal-ask">
      <div className="rounded-[20px] border border-line bg-white p-4 shadow-[0_1px_2px_rgba(15,15,20,0.04)]">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-primary">
            <Target className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </span>
          <h2 className="text-body font-semibold text-ink-1">{t('goal.ask.title')}</h2>
        </div>
        <p className="mt-2 text-secondary text-ink-2">{t('goal.ask.body')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {GOAL_OPTIONS[role].map((o) => (
            <button key={o.key} type="button" aria-pressed={picked.includes(o.key)} onClick={() => toggle(o.key)} className={chip(picked.includes(o.key))} data-testid={`goal-option-${o.key}`}>
              {o.label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={Boolean(other)}
            onClick={() => { if (!other && count >= GOAL_MAX) { void hapticLight(); return } setOtherOpen(true) }}
            className={cn(chip(Boolean(other)), 'max-w-full truncate')}
            data-testid="goal-option-other"
          >
            {other ?? t('goal.ask.other')}
          </button>
        </div>
        <div className={cn('flex items-center gap-3', count > 0 ? 'mt-4' : '-mb-2 mt-1')}>
          {count > 0 ? (
            <Button className="flex-1 rounded-full" loading={saving} onClick={() => void save()} data-testid="goal-save">
              <span>{t('goal.ask.save')}</span>{' '}
              <span className="ml-2 font-normal tabular-nums opacity-80">{t('goal.ask.saveCount', { picked: count, max: GOAL_MAX })}</span>
            </Button>
          ) : null}
          {changing ? (
            <button type="button" onClick={onCancel} className={cn('flex h-12 items-center px-2 text-body text-ink-2', count === 0 && 'ml-auto')}>{t('goal.ask.cancel')}</button>
          ) : (
            <button type="button" onClick={() => void later()} className={cn('flex h-12 items-center px-2 text-body text-ink-2', count === 0 && 'ml-auto')} data-testid="goal-later">
              {t('goal.ask.later')}
            </button>
          )}
        </div>
      </div>
      <OtherSheet
        open={otherOpen}
        initial={other ?? ''}
        onClose={() => setOtherOpen(false)}
        onSave={(text) => { setOther(text || null); setOtherOpen(false) }}
      />
    </section>
  )
}

/** G2: the member's own words; counts as one of the three picks. */
function OtherSheet({ open, initial, onClose, onSave }: { open: boolean; initial: string; onClose: () => void; onSave: (text: string) => void }) {
  const t = useHomeT()
  const [text, setText] = useState(initial)
  useEffect(() => { if (open) setText(initial) }, [open, initial])
  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('goal.other.title')}>
      <div className="px-5 pb-3" data-testid="goal-other-sheet">
        <h2 className="text-title text-ink-1">{t('goal.other.title')}</h2>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, GOAL_TEXT_MAX))}
          rows={3}
          autoFocus
          aria-label={t('goal.other.title')}
          placeholder={t('goal.other.placeholder')}
          className={cn(fieldInput, 'mt-3 h-auto resize-none py-3')}
          data-testid="goal-other-text"
        />
        <div className="mt-1.5 flex justify-between text-caption text-ink-3">
          <span>{t('goal.other.privacy')}</span>
          <span>{text.length}/{GOAL_TEXT_MAX}</span>
        </div>
        <Button block className="mt-4 rounded-full" onClick={() => onSave(text.trim())} disabled={!text.trim() && !initial} data-testid="goal-other-add">
          {text.trim() || !initial ? t('goal.other.add') : t('goal.other.remove')}
        </Button>
      </div>
    </BottomSheet>
  )
}
