import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Pieces shared by the D2 owner screens (Figma D2.3 Passports & permits,
 * D2.4 Open to play): the Cancel · title · Save bar, grey grouped cards with
 * hairline dividers, and the small uppercase section labels.
 */
export function CancelSaveBar({ title, onCancel, onSave, saving, saveDisabled }: {
  title: string
  onCancel: () => void
  onSave: () => void
  saving?: boolean
  saveDisabled?: boolean
}) {
  return (
    <div className="sticky top-0 z-20 bg-white pt-[env(safe-area-inset-top)]">
      <div className="flex h-11 items-center px-4">
        <div className="flex w-[90px] items-center">
          <button type="button" onClick={onCancel} className="h-11 text-body text-hockia-primary">Cancel</button>
        </div>
        <h1 className="min-w-0 flex-1 truncate text-center text-body font-semibold text-ink-1">{title}</h1>
        <div className="flex w-[90px] items-center justify-end">
          <button type="button" onClick={onSave} disabled={saving || saveDisabled} className="h-11 text-body font-semibold text-hockia-primary disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-caption font-semibold uppercase tracking-[0.04em] text-ink-2">{children}</p>
}

export function GroupCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col divide-y divide-line overflow-hidden rounded-card bg-surface-grouped px-4', className)}>{children}</div>
}
