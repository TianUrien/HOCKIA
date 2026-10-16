import { cn } from '@/lib/utils'
import { hasEuPassport, nationalityFlags, type NationalityCountry } from '@/lib/nationality'

/** The EU badge (Figma 189:14): EU blue at 85 %, radius 6, 11 semibold white. */
export function EuBadge({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-[6px] px-1.5 py-[2px] text-micro font-semibold leading-[14px] text-white', className)} style={{ backgroundColor: 'rgba(0,51,153,0.85)' }} data-testid="eu-badge" aria-label="EU passport">
      EU
    </span>
  )
}

/**
 * Card line (Figma 189:12): the nationality flags, larger than the text, the
 * EU badge when either passport is EU, then the age · city tail (no flag).
 */
export function NationalityLine({ nationalities, tail, className, dark = true }: { nationalities: NationalityCountry[]; tail?: string | null; className?: string; dark?: boolean }) {
  const flags = nationalityFlags(nationalities)
  if (!flags && !tail) return null
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', className)} data-testid="nationality-line">
      {/* Flags never wrap (two columns on a phone leave ~170 pt): larger than the text, on one line. */}
      {flags && <span className="shrink-0 whitespace-nowrap text-[17px] leading-5" aria-label={nationalities.map((c) => c.name).join(', ')}>{flags}</span>}
      {hasEuPassport(nationalities) && <EuBadge className="shrink-0" />}
      {tail && <span className={cn('min-w-0 flex-1 truncate text-[12px] leading-4', dark ? 'text-white/[0.8]' : 'text-ink-2')}>{tail}</span>}
    </span>
  )
}

/**
 * Hero pills (Figma 189:50): one glass pill per nationality (flag + country
 * name) and the EU badge; always visible, over the photo.
 */
export function NationalityPills({ nationalities, className }: { nationalities: NationalityCountry[]; className?: string }) {
  if (nationalities.length === 0) return null
  return (
    <span className={cn('flex flex-wrap items-center gap-2', className)} data-testid="nationality-pills">
      {nationalities.map((c) => (
        <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-2.5 py-[5px] text-secondary font-semibold text-white backdrop-blur-[8px]" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} data-testid="nationality-pill">
          {c.flag && <span className="text-[14px] leading-[19px] font-normal" aria-hidden="true">{c.flag}</span>}
          {c.name}
        </span>
      ))}
      {hasEuPassport(nationalities) && <EuBadge />}
    </span>
  )
}

/**
 * Profile tile (Figma 189:61): "NATIONALITIES, PASSPORTS & PERMITS", one
 * line per nationality with an "EU passport" tag on EU ones, then the
 * permit rows the viewer may see (owner / recruiters), never truncated.
 */
export interface PermitLine { text: string; detail?: string | null; flag?: string | null; amber?: boolean }

export function NationalitiesTile({ nationalities, permits = [], missingLabel = 'Not given', onAdd }: { nationalities: NationalityCountry[]; permits?: PermitLine[]; missingLabel?: string; onAdd?: (() => void) | null }) {
  return (
    <div className="flex w-full flex-col gap-2 rounded-[16px] bg-surface-subtle px-3.5 py-3" data-testid="nationalities-tile">
      <span className="text-micro font-semibold uppercase text-ink-3">Nationalities, passports &amp; permits</span>
      {nationalities.length === 0 && <span className="text-[16px] font-semibold leading-[21px] text-ink-3">{missingLabel}</span>}
      {nationalities.map((c) => (
        <span key={c.id} className="flex items-center gap-2" data-testid="nationality-row">
          {c.flag && <span className="text-[16px] leading-[21px]" aria-hidden="true">{c.flag}</span>}
          <span className="min-w-0 flex-1 text-[16px] font-semibold leading-[21px] text-ink-1">{c.name}</span>
          {c.isEu && <span className="shrink-0 rounded-full px-2 py-[3px] text-caption font-semibold" style={{ backgroundColor: '#e5edff', color: '#003399' }} data-testid="eu-passport-tag">EU passport</span>}
        </span>
      ))}
      {permits.length > 0 && <span className="h-[0.5px] w-full bg-line" aria-hidden="true" />}
      {permits.map((p) => (
        <span key={p.text} className="flex items-center gap-2" data-testid="permit-row">
          {p.flag && <span className="text-[14px] leading-[19px]" aria-hidden="true">{p.flag}</span>}
          <span className="min-w-0 flex-1">
            <span className={cn('block text-[14px] font-semibold leading-[19px]', p.amber ? 'text-status-warning' : 'text-ink-1')}>{p.text}</span>
            {p.detail && <span className={cn('block text-caption', p.amber ? 'text-status-warning' : 'text-ink-2')}>{p.detail}</span>}
          </span>
        </span>
      ))}
      {onAdd && (
        <button type="button" onClick={onAdd} className="self-start text-secondary font-semibold text-brand-primary">{nationalities.length === 0 ? 'Add passport' : 'Add another'}</button>
      )}
    </div>
  )
}
