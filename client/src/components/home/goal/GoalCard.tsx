import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  goalRows,
  goalTitle,
  isGoalRole,
  saveMyGoal,
  trackGoal,
  type GoalRole,
} from '@/lib/memberGoals'

/**
 * "What's your goal?" at the top of today's Home (Figma page 02, YG: G1–G5;
 * founder 2026-10-25). Ask card until the member answers or taps Later twice;
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
  const rows = goalRows(role, goal, actions.data ?? {}, c ? (c.common_name || c.name) : null)
  return <SetCard role={role} title={goalTitle(role, goal)} rows={rows} onChange={() => setEditing(true)} />
}

function SetCard({ role, title, rows, onChange }: { role: GoalRole; title: string; rows: ReturnType<typeof goalRows>; onChange: () => void }) {
  const navigate = useNavigate()
  return (
    <section className="px-4 pb-3 pt-2" aria-label="Your goal" data-testid="home-goal-set">
      <div className="rounded-[24px] bg-brand-soft p-4">
        <div className="flex items-center justify-between">
          <p className="text-caption font-semibold uppercase tracking-[0.06em] text-brand-primary">Your goal</p>
          <button type="button" onClick={onChange} className="-my-2 flex h-11 items-center text-row font-semibold text-brand-primary" data-testid="home-goal-change">Change</button>
        </div>
        <p className="mt-1 truncate text-title text-ink-1">{title}</p>
        {rows.length > 0 ? (
          <div className="mt-3 space-y-2">
            {rows.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => { trackGoal('goal_action', { goal: r.goal, action: r.key, role }); navigate(r.to) }}
                className="flex w-full items-center gap-3 rounded-[16px] bg-white px-4 py-3 text-left"
                data-testid={`home-goal-row-${r.key}`}
              >
                <span className="min-w-0 flex-1 text-row text-ink-2">{r.text}</span>
                <span className="shrink-0 text-row font-semibold text-brand-primary">{r.action}</span>
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
      addToast('Could not save your goal. Please try again.', 'error')
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
    cn('h-11 rounded-full border px-4 text-row', selected ? 'border-brand-primary bg-brand-soft font-semibold text-brand-primary' : 'border-line bg-white text-ink-2')

  return (
    <section className="px-4 pb-3 pt-2" aria-label="What's your goal?" data-testid="home-goal-ask">
      <div className="rounded-[24px] border border-line bg-white p-4 shadow-[0_1px_2px_rgba(15,15,20,0.04)]">
        <p className="text-caption font-semibold uppercase tracking-[0.06em] text-brand-primary">Your goal</p>
        <h2 className="mt-1 text-title text-ink-1">What&rsquo;s your goal?</h2>
        <p className="mt-1 text-row text-ink-2">Pick up to three, or say it in your words. We use it to show you what helps. Only you see it.</p>
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
            {other ?? 'Other…'}
          </button>
        </div>
        <div className="mt-4 flex items-center gap-3">
          {count > 0 ? (
            <Button className="flex-1 rounded-full" loading={saving} onClick={() => void save()} data-testid="goal-save">
              That&rsquo;s my goal · {count} of {GOAL_MAX}
            </Button>
          ) : null}
          {changing ? (
            <button type="button" onClick={onCancel} className={cn('flex h-12 items-center px-2 text-body text-ink-2', count === 0 && 'ml-auto')}>Cancel</button>
          ) : (
            <button type="button" onClick={() => void later()} className={cn('flex h-12 items-center px-2 text-body text-ink-2', count === 0 && 'ml-auto')} data-testid="goal-later">
              Later
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
  const [text, setText] = useState(initial)
  useEffect(() => { if (open) setText(initial) }, [open, initial])
  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Your goal, in your words">
      <div className="px-5 pb-3" data-testid="goal-other-sheet">
        <h2 className="text-title text-ink-1">Your goal, in your words</h2>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, GOAL_TEXT_MAX))}
          rows={3}
          autoFocus
          aria-label="Your goal, in your words"
          placeholder="Play in Germany next season while I finish my degree"
          className={cn(fieldInput, 'mt-3 h-auto resize-none py-3')}
          data-testid="goal-other-text"
        />
        <div className="mt-1.5 flex justify-between text-caption text-ink-3">
          <span>Only you see this.</span>
          <span>{text.length}/{GOAL_TEXT_MAX}</span>
        </div>
        <Button block className="mt-4 rounded-full" onClick={() => onSave(text.trim())} disabled={!text.trim() && !initial} data-testid="goal-other-add">
          {text.trim() ? 'Add to my goal' : 'Remove from my goal'}
        </Button>
      </div>
    </BottomSheet>
  )
}
