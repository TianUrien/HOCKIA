import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * iOS grouped-list pieces for the phone Settings screens (Figma Settings v2 ·
 * Notifications · Privacy): caps section label, white rounded group with
 * hairline rows, footnote under a group, and the green switch.
 */
export function SettingsGroup({ label, footer, trailingLabels, children }: { label?: string; footer?: ReactNode; trailingLabels?: string[]; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-2">
      {(label || trailingLabels) && (
        <div className="flex items-end justify-between px-4 pb-2">
          <h2 className="text-caption font-semibold uppercase tracking-[0.06em] text-ink-3">{label}</h2>
          {trailingLabels && (
            <div className="flex gap-2 pr-0.5">{trailingLabels.map((t) => <span key={t} className="w-[51px] text-center text-caption font-semibold text-ink-2">{t}</span>)}</div>
          )}
        </div>
      )}
      <div className="divide-y divide-line overflow-hidden rounded-card bg-white">{children}</div>
      {footer && <p className="px-4 pt-2 text-caption leading-[16px] text-ink-3">{footer}</p>}
    </section>
  )
}

export function SettingsSwitch({ checked, onChange, disabled, label }: { checked: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn('relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors disabled:opacity-40', checked ? 'bg-positive' : 'bg-line')}
    >
      <span className={cn('absolute top-0.5 h-[27px] w-[27px] rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
    </button>
  )
}

interface SettingsRowProps {
  title: string
  subtitle?: ReactNode
  value?: ReactNode
  icon?: ReactNode
  iconClassName?: string
  onClick?: () => void
  trailing?: ReactNode
  tone?: 'default' | 'danger'
  /** Value rows that lead nowhere show no chevron. */
  chevron?: boolean
}

export function SettingsRow({ title, subtitle, value, icon, iconClassName, onClick, trailing, tone = 'default', chevron = Boolean(onClick) }: SettingsRowProps) {
  const body = (
    <>
      {icon && <span className={cn('flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-tile', iconClassName ?? 'bg-hockia-soft text-hockia-primary')}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className={cn('block text-body', tone === 'danger' ? 'text-red-600' : 'text-ink-1')}>{title}</span>
        {subtitle && <span className="block text-secondary text-ink-2">{subtitle}</span>}
      </span>
      {value && <span className="max-w-[48%] shrink-0 truncate text-body text-ink-2">{value}</span>}
      {trailing}
      {chevron && <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={2} />}
    </>
  )
  const cls = 'flex w-full items-center gap-3 px-4 py-3 text-left min-h-[50px]'
  return onClick ? <button type="button" onClick={onClick} className={cls}>{body}</button> : <div className={cls}>{body}</div>
}
