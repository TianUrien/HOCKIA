import { useState, useRef, useEffect, useCallback, useId } from 'react'
import { ChevronDown, Search, X, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCountries, type Country } from '@/hooks/useCountries'
import { searchCountries } from '@/lib/countrySearch'

interface CountrySelectProps {
  label?: string
  value: number | null
  onChange: (countryId: number | null) => void
  placeholder?: string
  required?: boolean
  error?: string
  disabled?: boolean
  /** If true, shows nationality name instead of country name */
  showNationality?: boolean
  className?: string
}

/**
 * A searchable dropdown component for selecting a country.
 * Displays countries with their flag emojis and supports keyboard navigation.
 */
export default function CountrySelect({
  label,
  value,
  onChange,
  placeholder = 'Select a country',
  required = false,
  error,
  disabled = false,
  showNationality = false,
  className,
}: CountrySelectProps) {
  const { countries, loading, getCountryById } = useCountries()
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxRef = useRef<HTMLUListElement>(null)

  const generatedId = useId()
  const listboxId = `${generatedId}-listbox`
  const labelId = `${generatedId}-label`
  const errorId = error ? `${generatedId}-error` : undefined

  const selectedCountry = getCountryById(value)

  // Filter + relevance-rank countries based on search query.
  // Ranking lives in lib/countrySearch.ts so it can be unit-tested.
  const filteredCountries = searchCountries(countries, searchQuery)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setSearchQuery('')
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && listboxRef.current) {
      const highlightedElement = listboxRef.current.children[highlightedIndex] as HTMLElement
      highlightedElement?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex])

  const handleSelect = useCallback(
    (country: Country) => {
      onChange(country.id)
      setIsOpen(false)
      setSearchQuery('')
      setHighlightedIndex(-1)
    },
    [onChange]
  )

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onChange(null)
      setSearchQuery('')
    },
    [onChange]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault()
          setIsOpen(true)
        }
        return
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setHighlightedIndex((prev) =>
            prev < filteredCountries.length - 1 ? prev + 1 : 0
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          setHighlightedIndex((prev) =>
            prev > 0 ? prev - 1 : filteredCountries.length - 1
          )
          break
        case 'Enter':
          e.preventDefault()
          if (highlightedIndex >= 0 && filteredCountries[highlightedIndex]) {
            handleSelect(filteredCountries[highlightedIndex])
          }
          break
        case 'Escape':
          e.preventDefault()
          setIsOpen(false)
          setSearchQuery('')
          setHighlightedIndex(-1)
          break
        case 'Tab':
          setIsOpen(false)
          setSearchQuery('')
          break
      }
    },
    [isOpen, filteredCountries, highlightedIndex, handleSelect]
  )

  const getDisplayText = (country: Country) => {
    const flag = country.flag_emoji ?? ''
    const text = showNationality ? country.nationality_name : country.name
    return `${flag} ${text}`.trim()
  }

  return (
    <div className={cn('space-y-2', className)} ref={containerRef}>
      {label && (
        <label
          id={labelId}
          className="block text-sm font-medium text-gray-700"
        >
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}

      <div className="relative">
        {/* Trigger Button */}
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-labelledby={label ? labelId : undefined}
          aria-describedby={errorId}
          aria-invalid={!!error}
          className={cn(
            'w-full px-4 py-3 bg-gray-50 border rounded-lg text-left',
            'flex items-center justify-between gap-2',
            'focus:outline-none focus:ring-2 focus:ring-[#8026FA] focus:border-transparent',
            'transition-all duration-200',
            disabled && 'opacity-50 cursor-not-allowed',
            error ? 'border-red-500' : 'border-gray-200',
            !disabled && 'hover:border-gray-300'
          )}
        >
          <span className={cn(
            'flex-1 truncate',
            selectedCountry ? 'text-gray-900' : 'text-gray-400'
          )}>
            {selectedCountry ? getDisplayText(selectedCountry) : placeholder}
          </span>

          <div className="flex items-center gap-1">
            {selectedCountry && !disabled && !required && (
              <span
                role="button"
                tabIndex={0}
                onClick={handleClear}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleClear(e as unknown as React.MouseEvent)
                  }
                }}
                className="p-1 hover:bg-gray-200 rounded transition-colors cursor-pointer"
                aria-label="Clear selection"
              >
                <X className="w-4 h-4 text-gray-400" />
              </span>
            )}
            <ChevronDown
              className={cn(
                'w-5 h-5 text-gray-400 transition-transform',
                isOpen && 'rotate-180'
              )}
            />
          </div>
        </button>

        {/* Dropdown */}
        {isOpen && (
          <div
            className={cn(
              'absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg',
              'max-h-80 overflow-hidden flex flex-col'
            )}
          >
            {/* Search Input */}
            <div className="p-2 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  ref={inputRef}
                  type="search"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value)
                    setHighlightedIndex(0)
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Search countries..."
                  className={cn(
                    'w-full pl-9 pr-4 py-2 text-sm',
                    'border border-gray-200 rounded-md',
                    'focus:outline-none focus:ring-2 focus:ring-[#8026FA] focus:border-transparent'
                  )}
                  autoComplete="off"
                  enterKeyHint="search"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-autocomplete="list"
                  aria-controls={listboxId}
                  aria-activedescendant={
                    highlightedIndex >= 0
                      ? `${generatedId}-option-${highlightedIndex}`
                      : undefined
                  }
                />
              </div>
            </div>

            {/* Country List */}
            {loading ? (
              <div className="px-4 py-3 text-sm text-gray-500 text-center">
                Loading countries...
              </div>
            ) : filteredCountries.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-500 text-center">
                No countries found
              </div>
            ) : (
              <ul
                ref={listboxRef}
                id={listboxId}
                role="listbox"
                aria-labelledby={label ? labelId : undefined}
                className="flex-1 overflow-y-auto py-1 max-h-64"
              >
                {filteredCountries.map((country, index) => (
                  <li
                    key={country.id}
                    id={`${generatedId}-option-${index}`}
                    role="option"
                    aria-selected={country.id === value}
                    onClick={() => handleSelect(country)}
                    className={cn(
                      'px-4 py-2 cursor-pointer flex items-center justify-between',
                      'transition-colors duration-100',
                      index === highlightedIndex && 'bg-gray-100',
                      country.id === value && 'bg-indigo-50',
                      index !== highlightedIndex &&
                        country.id !== value &&
                        'hover:bg-gray-50'
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {country.flag_emoji && (
                        <span className="text-lg">{country.flag_emoji}</span>
                      )}
                      <span className="text-sm text-gray-900">
                        {showNationality ? country.nationality_name : country.name}
                      </span>
                      {showNationality && country.name !== country.nationality_name && (
                        <span className="text-xs text-gray-400">
                          ({country.name})
                        </span>
                      )}
                    </span>
                    {country.id === value && (
                      <Check className="w-4 h-4 text-indigo-600" />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {error && (
        <p id={errorId} className="text-sm text-red-500">
          {error}
        </p>
      )}
    </div>
  )
}
