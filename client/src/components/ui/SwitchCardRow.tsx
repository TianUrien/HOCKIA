import { cn } from '@/lib/utils'

/**
 * List item / Switch (Figma 472:186) on its own muted card — the one toggle
 * at the end of a filter sheet. Title 15 semibold, one sub-line, the iOS
 * switch (51 × 31, positive when on). The whole card is the switch, so the
 * hit area is far above 44 pt.
 */
interface SwitchCardRowProps {
  title: string
  description?: string | null
  checked: boolean
  onChange: () => void
  disabled?: boolean
  testId?: string
}

export function SwitchCardRow({ title, description, checked, onChange, disabled, testId }: SwitchCardRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={title}
      disabled={disabled}
      onClick={onChange}
      data-testid={testId}
      className="flex w-full items-center gap-3 rounded-card bg-surface-grouped px-4 py-3 text-left disabled:opacity-40"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-row font-semibold text-ink-1">{title}</span>
        {description && <span className="block text-secondary text-ink-2">{description}</span>}
      </span>
      <span className={cn('relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors', checked ? 'bg-positive' : 'bg-line')} aria-hidden="true">
        <span className={cn('absolute top-0.5 h-[27px] w-[27px] rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </span>
    </button>
  )
}
