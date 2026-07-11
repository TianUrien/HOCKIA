import { useState, useRef, useEffect, useId } from 'react'
import { ChevronDown, Search, X, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCountries } from '@/hooks/useCountries'
import { searchCountries } from '@/lib/countrySearch'
import Flag from '@/components/Flag'

interface CountryMultiSelectProps {
  label?: string
  /** Selected country ids. */
  value: number[]
  onChange: (countryIds: number[]) => void
  placeholder?: string
  /** Country ids to hide from the picker (e.g. the opposite open/exclude
   *  list, so a country can't be both). */
  excludeIds?: number[]
  disabled?: boolean
  className?: string
}

/**
 * Searchable multi-select for countries — used by the Recruitment
 * preferences "open to" / "would not consider" lists (Matching Increment
 * #2). Stores/returns country ids (integer[]), mirroring CountrySelect's
 * id-based contract. Selected countries render as removable chips above a
 * searchable checkbox dropdown.
 */
export default function CountryMultiSelect({
  label,
  value,
  onChange,
  placeholder = 'Add countries',
  excludeIds = [],
  disabled = false,
  className,
}: CountryMultiSelectProps) {
  const { countries, getCountryById } = useCountries()
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const generatedId = useId()
  const labelId = `${generatedId}-label`

  const selected = value.map((id) => getCountryById(id)).filter((c): c is NonNullable<typeof c> => Boolean(c))

  const hidden = new Set([...value, ...excludeIds])
  const filtered = searchCountries(countries, searchQuery).filter((c) => !hidden.has(c.id))

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setSearchQuery('')
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const add = (id: number) => {
    if (!value.includes(id)) onChange([...value, id])
    setSearchQuery('')
  }
  const remove = (id: number) => onChange(value.filter((v) => v !== id))

  return (
    <div className={cn('w-full', className)} ref={containerRef}>
      {label && (
        <span id={labelId} className="block text-sm font-medium text-gray-700 mb-1.5">
          {label}
        </span>
      )}

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1 rounded-full bg-hockia-primary/10 text-[#5b16b8] text-xs font-medium pl-1.5 pr-1 py-0.5"
            >
              <Flag code={c.code} countryName={c.name} size="sm" />
              {c.name}
              <button
                type="button"
                onClick={() => remove(c.id)}
                disabled={disabled}
                aria-label={`Remove ${c.name}`}
                className="ml-0.5 rounded-full hover:bg-hockia-primary/20 p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Picker */}
      <div className="relative">
        <button
          type="button"
          onClick={() => !disabled && setIsOpen((v) => !v)}
          disabled={disabled}
          aria-labelledby={label ? labelId : undefined}
          className={cn(
            'flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm',
            'focus:outline-none focus:ring-2 focus:ring-hockia-primary/40',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
        >
          <span className="text-gray-500">{placeholder}</span>
          <ChevronDown className={cn('w-4 h-4 text-gray-400 transition-transform', isOpen && 'rotate-180')} />
        </button>

        {isOpen && !disabled && (
          <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
            <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
              <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search countries…"
                className="w-full text-sm outline-none placeholder:text-gray-400"
              />
            </div>
            <ul className="max-h-56 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <li className="px-3 py-2 text-sm text-gray-400">No countries found</li>
              ) : (
                filtered.slice(0, 60).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => add(c.id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
                    >
                      <Flag code={c.code} countryName={c.name} size="sm" />
                      <span className="flex-1 text-gray-800">{c.name}</span>
                      <Check className="w-4 h-4 text-transparent" />
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
