import { useId, useState } from 'react'
import { ArrowUp, Check, PenLine } from 'lucide-react'
import { hapticSelection } from '@/lib/haptics'
import { cn } from '@/lib/utils'

export interface Choice<T = string> {
  value: T
  label: string
  description?: string
  recommended?: boolean
}

interface Props<T> {
  question: string
  choices: Choice<T>[]
  onPick: (choice: Choice<T>) => void
  /** "Other": the member writes their own answer. Omit to hide it. */
  onOther?: (text: string) => void
  otherPlaceholder?: string
  onSkip?: () => void
  /** Set once answered: the card shows what was picked and stops taking taps. */
  picked?: T | 'other' | null
  busy?: boolean
  testId?: string
}

/**
 * Hockia AI asks with ready-made answers (founder, 2026-10-18 — "like Claude
 * Code"): 2–4 options, the recommended one first and badged, a one-line
 * trade-off under each, and "Other" to write your own. One tap answers.
 */
export function ChoiceCard<T>({ question, choices, onPick, onOther, otherPlaceholder = 'Write your own answer…', onSkip, picked = null, busy = false, testId = 'ai-choice' }: Props<T>) {
  const [writing, setWriting] = useState(false)
  const [text, setText] = useState('')
  const id = useId()
  const done = picked !== null
  const ordered = [...choices].sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)))

  const pick = (c: Choice<T>) => { if (done || busy) return; void hapticSelection(); onPick(c) }
  const sendOther = () => { const t = text.trim(); if (!t || done || busy || !onOther) return; void hapticSelection(); onOther(t) }

  return (
    <div className="overflow-hidden rounded-[18px] border border-line bg-white" role="group" aria-labelledby={id} data-testid={testId}>
      <p id={id} className="border-b border-line bg-surface-subtle px-4 py-3 text-[15px] font-semibold leading-5 text-ink-1">{question}</p>
      <ul>
        {ordered.map((c, i) => {
          const isPicked = picked === c.value
          return (
            <li key={`${c.label}-${i}`} className={cn(i > 0 && 'border-t border-line')}>
              <button
                type="button"
                onClick={() => pick(c)}
                disabled={done && !isPicked}
                aria-pressed={isPicked}
                className={cn(
                  'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                  !done && 'hover:bg-surface-subtle active:bg-surface-muted',
                  c.recommended && !done && 'bg-brand-soft',
                  done && !isPicked && 'opacity-45',
                )}
                data-testid={`${testId}-option`}
                data-recommended={c.recommended ? 'true' : undefined}
              >
                <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', isPicked ? 'border-brand-primary bg-brand-primary text-white' : c.recommended ? 'border-brand-primary' : 'border-ink-4')}>
                  {isPicked ? <Check className="h-3 w-3" strokeWidth={3.5} /> : c.recommended ? <span className="h-2 w-2 rounded-full bg-brand-primary" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[15px] font-semibold leading-5 text-ink-1">{c.label}</span>
                    {c.recommended && <span className="rounded-full bg-brand-primary px-2 py-[1px] text-[11px] font-semibold leading-4 text-white">Recommended</span>}
                  </span>
                  {c.description && <span className="mt-0.5 block text-[13px] leading-[18px] text-ink-2">{c.description}</span>}
                </span>
              </button>
            </li>
          )
        })}
        {onOther && (
          <li className="border-t border-line">
            {writing && !done ? (
              <div className="flex items-end gap-2 px-3 py-2.5">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Your own answer</span>
                  <textarea
                    autoFocus
                    rows={1}
                    value={text}
                    maxLength={300}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendOther() } }}
                    placeholder={otherPlaceholder}
                    className="block max-h-[96px] min-h-[40px] w-full resize-none rounded-[12px] bg-surface-subtle px-3 py-[9px] text-[15px] leading-5 text-ink-1 placeholder:text-ink-3 focus:outline-none"
                    data-testid={`${testId}-other-input`}
                  />
                </label>
                <button type="button" onClick={sendOther} disabled={!text.trim() || busy} aria-label="Send your answer" className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-hockia-primary text-white', (!text.trim() || busy) && 'opacity-40')} data-testid={`${testId}-other-send`}>
                  <ArrowUp className="h-5 w-5" strokeWidth={2.25} />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => { if (!done) setWriting(true) }} disabled={done && picked !== 'other'} className={cn('flex w-full items-center gap-3 px-4 py-3 text-left', done && picked !== 'other' && 'opacity-45')} data-testid={`${testId}-other`}>
                <PenLine className="h-5 w-5 shrink-0 text-ink-3" strokeWidth={1.9} />
                <span className="text-[15px] leading-5 text-ink-2">{picked === 'other' ? 'Your own answer' : 'Other'}</span>
              </button>
            )}
          </li>
        )}
      </ul>
      {onSkip && !done && (
        <div className="flex justify-end border-t border-line px-3 py-2">
          <button type="button" onClick={onSkip} className="min-h-[36px] rounded-full px-3 text-[14px] font-semibold text-ink-2" data-testid={`${testId}-skip`}>Not now</button>
        </div>
      )}
    </div>
  )
}
