import { useMemo, useState } from 'react'
import { Plus, Search, X } from 'lucide-react'
import Flag from '@/components/Flag'
import { useCountries } from '@/hooks/useCountries'
import { searchCountries } from '@/lib/countrySearch'
import { chipTone } from '@/components/ui/chipClasses'
import { fieldInput } from '@/components/ui/fieldClasses'
import { cn } from '@/lib/utils'

/**
 * A country filter inside the Community Filters sheet (founder 2026-11-09):
 * "Based in" (where members live) and "Nationality" (their passport). Picked
 * countries are removable chips; "Add country" opens an inline search list,
 * not a second sheet on top of the Filters sheet. Flags only on Nationality:
 * on a person a flag always means nationality, location stays text.
 */
export function CountryFilterField({ label, caption, value, onChange, withFlags = false, testId }: {
  label: string
  caption: string
  value: number[]
  onChange: (ids: number[]) => void
  withFlags?: boolean
  testId: string
}) {
  const { countries, getCountryById } = useCountries()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const results = useMemo(() => searchCountries(countries, q).filter((c) => !value.includes(c.id)).slice(0, 60), [countries, q, value])
  const close = () => { setOpen(false); setQ('') }
  const name = (id: number) => { const c = getCountryById(id); return c ? c.common_name || c.name : 'Country' }

  return (
    <section className="flex flex-col gap-2.5" data-testid={testId}>
      <h3 className="text-[12px] font-semibold uppercase leading-4 tracking-[0.04em] text-ink-3">{label}</h3>
      <div className="flex flex-wrap gap-2">
        {value.map((id) => {
          const c = getCountryById(id)
          return (
            <span key={id} className="inline-flex h-9 items-center gap-1.5 rounded-full border-[1.5px] border-brand-primary bg-brand-soft pl-3.5 pr-1 text-row font-semibold text-brand-text">
              {withFlags && c ? <Flag code={c.code} fallbackEmoji={c.flag_emoji} /> : null}
              {name(id)}
              <button type="button" aria-label={`Remove ${name(id)}`} onClick={() => onChange(value.filter((v) => v !== id))} className="flex h-8 w-8 items-center justify-center rounded-full">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </span>
          )
        })}
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className={cn('inline-flex h-9 items-center gap-1 rounded-full px-4 text-row font-semibold', chipTone(false))} data-testid={`${testId}-add`}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add country
          </button>
        )}
      </div>
      {open && (
        <div className="rounded-[16px] border border-line bg-white p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search countries"
              aria-label={`Search countries for ${label}`}
              className={cn(fieldInput, 'pl-10')}
              data-testid={`${testId}-search`}
            />
          </div>
          <ul className="mt-1 max-h-[220px] overflow-y-auto overscroll-contain">
            {results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => { onChange([...value, c.id]); close() }}
                  className="flex h-11 w-full items-center gap-2 rounded-[10px] px-3 text-left text-body text-ink-1 active:bg-surface-muted"
                >
                  {withFlags ? <Flag code={c.code} fallbackEmoji={c.flag_emoji} /> : null}
                  {c.common_name || c.name}
                </button>
              </li>
            ))}
            {results.length === 0 && <li className="px-3 py-3 text-secondary text-ink-2">No country matches “{q}”.</li>}
          </ul>
          <button type="button" onClick={close} className="mt-1 flex h-10 w-full items-center justify-center rounded-full text-row font-semibold text-ink-2">
            Cancel
          </button>
        </div>
      )}
      <p className="text-caption text-ink-3">{caption}</p>
    </section>
  )
}
