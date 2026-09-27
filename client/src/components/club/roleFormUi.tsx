import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Form pieces shared by Post a role step 1 (Figma D1.6 330:318) and the
 * "New context" form of the Recruiting for sheet (D1.23, DEV NOTE 355:931:
 * "a short form with the Post a role step-1 criteria").
 */
export function HardnessPill({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
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

export function Section({ label, trailing, hint, children }: { label: string; trailing?: ReactNode; hint?: ReactNode; children: ReactNode }) {
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

export const Muted = ({ children }: { children: ReactNode }) => <span className="text-[13px] text-ink-3">{children}</span>

export function Segments<T extends string>({ value, options, onChange, label }: { value: T | null; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
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

export function Chips({ values, options, onToggle, label }: { values: string[]; options: { value: string; label: string }[]; onToggle: (v: string) => void; label: string }) {
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
