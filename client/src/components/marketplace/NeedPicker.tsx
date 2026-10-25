import { cn } from '@/lib/utils'
import { chipTone } from '@/components/ui/chipClasses'
import { fieldLabel } from '@/components/ui/fieldClasses'
import { NEEDS, type Need } from '@/lib/marketplace'

/** "Which need does it help with?" (Figma 08 · Brands P6): one need per offer or product. */
export function NeedPicker({ value, onChange, idPrefix = 'need' }: { value: Need | null; onChange: (n: Need) => void; idPrefix?: string }) {
  return (
    <fieldset data-testid={`${idPrefix}-picker`}>
      <legend className={fieldLabel}>Which need does it help with?</legend>
      <div className="flex flex-wrap gap-2">
        {NEEDS.map((n) => (
          <button key={n.key} type="button" aria-pressed={value === n.key} onClick={() => onChange(n.key)} className={cn('h-9 rounded-full px-4 text-row font-semibold', chipTone(value === n.key))} data-testid={`${idPrefix}-${n.key}`}>
            {n.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-caption text-ink-3">Members find it under this need in Community › Brands.</p>
    </fieldset>
  )
}
