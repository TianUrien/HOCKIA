import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Eye, Lock, Pencil } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { SquircleBox } from '@/components/home/v1/primitives'
import { cn } from '@/lib/utils'

/**
 * Own profile, under the hero (Figma PR2 101:46): Edit profile + Preview as…
 * (secondary 44) → ONE primary card (the next step) → private stats marked
 * "only you".
 */
export function OwnerButtons({ onEdit, previews }: {
  onEdit: () => void
  /** "Preview as…" options (PR3): e.g. "Someone on Hockia", "A club". */
  previews: Array<{ key: string; label: string; detail: string; onSelect: () => void }>
}) {
  const [open, setOpen] = useState(false)
  const btn = 'flex h-11 flex-1 items-center justify-center gap-2 rounded-full border border-line bg-white text-[15px] font-semibold text-ink-1 transition-transform duration-300 active:scale-[0.97]'
  return (
    <div className="flex gap-2.5 px-4 pt-4">
      <button type="button" onClick={onEdit} className={btn} data-testid="profile-edit"><Pencil className="h-4 w-4" strokeWidth={1.8} /> Edit profile</button>
      <button type="button" onClick={() => setOpen(true)} className={btn} data-testid="profile-preview-as"><Eye className="h-4 w-4" strokeWidth={1.8} /> Preview as…</button>
      <BottomSheet open={open} onClose={() => setOpen(false)} ariaLabel="Preview as">
        <div className="px-5 pb-4 pt-1">
          <h2 className="pb-3 text-body font-semibold text-ink-1">Preview your profile as…</h2>
          <div className="divide-y divide-line overflow-hidden rounded-card bg-surface-grouped">
            {previews.map((p) => (
              <button key={p.key} type="button" onClick={() => { setOpen(false); p.onSelect() }} className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block text-body text-ink-1">{p.label}</span>
                  <span className="block text-secondary text-ink-2">{p.detail}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={2} />
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setOpen(false)} className="mt-2.5 flex h-11 w-full items-center justify-center text-body font-semibold text-ink-1">Cancel</button>
        </div>
      </BottomSheet>
    </div>
  )
}

/** Progress ring for the strength card (the completeness %). */
function Ring({ pct }: { pct: number }) {
  const r = 22
  const c = 2 * Math.PI * r
  return (
    <span className="relative flex h-14 w-14 shrink-0 items-center justify-center" aria-hidden="true">
      <svg width="56" height="56" viewBox="0 0 56 56" className="-rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(108,43,217,0.15)" strokeWidth="5" />
        <circle cx="28" cy="28" r={r} fill="none" stroke="#6c2bd9" strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, Math.max(0, pct)) / 100)} />
      </svg>
      <span className="absolute text-caption font-semibold tabular-nums text-hockia-primary">{pct}%</span>
    </span>
  )
}

/** The ONE primary card: the next step (ring + copy + CTA), or a role-specific card (applicants …). */
export function PrimaryCard({ pct, title, subtitle, cta, onAction, visual }: {
  pct?: number | null
  title: string
  subtitle: string
  cta: string
  onAction: () => void
  /** Replaces the ring (e.g. applicant faces). */
  visual?: ReactNode
}) {
  return (
    <div className="px-4 pt-3">
      <SquircleBox className="flex items-center gap-3 bg-hockia-soft px-4 py-3.5" >
        {visual ?? (typeof pct === 'number' ? <Ring pct={pct} /> : null)}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-semibold text-ink-1">{title}</span>
          <span className="block line-clamp-2 text-secondary text-ink-2">{subtitle}</span>
        </span>
        <button
          type="button"
          onClick={onAction}
          className="flex h-11 min-w-[58px] shrink-0 items-center justify-center rounded-full bg-hockia-primary px-4 text-[14px] font-semibold text-white transition-transform duration-300 active:scale-[0.97]"
          data-testid="profile-primary-cta"
        >
          {cta}
        </button>
      </SquircleBox>
    </div>
  )
}

/** Private stats (🔒 only you). Hidden until there is data (spec: stats hidden until there's data). */
export function PrivateStats({ stats }: { stats: Array<{ value: number; label: string }> }) {
  if (stats.every((s) => s.value === 0)) return null
  return (
    <div className="px-4 pt-3" data-testid="profile-private-stats">
      <div className="flex divide-x divide-line rounded-[20px] border border-line bg-white">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-1 flex-col items-center py-3">
            <span className="text-title tabular-nums text-ink-1">{s.value}</span>
            <span className="text-caption text-ink-2">{s.label}</span>
          </div>
        ))}
      </div>
      <Link to="/pulse" className={cn('mt-2 flex min-h-[32px] items-center gap-1 text-caption text-ink-3')}>
        <Lock className="h-3 w-3" strokeWidth={2} aria-hidden="true" /> Only you see this · Your activity <ChevronRight className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
      </Link>
    </div>
  )
}
