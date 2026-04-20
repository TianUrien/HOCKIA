import { useState, useEffect, useRef, useCallback, useId, type ReactNode } from 'react'
import { MapPin, Loader2, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useGooglePlaces, type PlacePrediction } from '@/hooks/useGooglePlaces'
import { useCountries } from '@/hooks/useCountries'
import Input from './Input'

export interface LocationSelection {
  displayName: string
  city: string
  countryId: number | null
}

interface LocationAutocompleteProps {
  label?: string
  value: string
  onChange: (value: string) => void
  onLocationSelect: (location: LocationSelection) => void
  onLocationClear: () => void
  isSelected: boolean
  placeholder?: string
  required?: boolean
  error?: string
  disabled?: boolean
  icon?: ReactNode
}

export default function LocationAutocomplete({
  label,
  value,
  onChange,
  onLocationSelect,
  onLocationClear,
  isSelected,
  placeholder = 'Where are you currently based?',
  required,
  error,
  disabled,
  icon,
}: LocationAutocompleteProps) {
  const inputId = useId()
  const { isLoaded, loadError, getAutocompletePredictions, getPlaceDetails } = useGooglePlaces()
  const { countries, getCountryByCode } = useCountries()

  const [predictions, setPredictions] = useState<PlacePrediction[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [isSearching, setIsSearching] = useState(false)
  const [isResolving, setIsResolving] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const searchLocations = useCallback(async (input: string) => {
    if (input.trim().length < 2 || !isLoaded) {
      setPredictions([])
      setShowDropdown(false)
      return
    }

    setIsSearching(true)
    const results = await getAutocompletePredictions(input)
    setPredictions(results)
    setShowDropdown(results.length > 0)
    setHighlightedIndex(-1)
    setIsSearching(false)
  }, [isLoaded, getAutocompletePredictions])

  const handleInputChange = useCallback((newValue: string) => {
    onChange(newValue)

    if (isSelected) {
      onLocationClear()
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => searchLocations(newValue), 300)
  }, [onChange, isSelected, onLocationClear, searchLocations])

  const matchCountryId = useCallback((countryCode: string, adminArea: string): number | null => {
    if (!countryCode || countries.length === 0) return null

    // England edge case: Google returns GB for all UK locations
    if (countryCode === 'GB') {
      const admin = adminArea.toLowerCase()
      if (admin === 'england' || admin.includes('england')) {
        const england = getCountryByCode('GB-ENG')
        if (england) return england.id
      }
      // Scotland, Wales, Northern Ireland → fall through to GB
    }

    const match = getCountryByCode(countryCode)
    return match?.id ?? null
  }, [countries, getCountryByCode])

  const handleSelect = useCallback(async (prediction: PlacePrediction) => {
    setShowDropdown(false)
    setPredictions([])
    setIsResolving(true)

    // Show the prediction text immediately
    onChange(prediction.description)

    const details = await getPlaceDetails(prediction.placeId)
    setIsResolving(false)

    if (!details) {
      // If details fail, keep the text but treat as free text
      return
    }

    const countryId = matchCountryId(details.countryCode, details.adminArea)
    const city = details.city || prediction.mainText

    onLocationSelect({
      displayName: prediction.description,
      city,
      countryId,
    })
  }, [onChange, getPlaceDetails, matchCountryId, onLocationSelect])

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showDropdown || predictions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(i => Math.min(i + 1, predictions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault()
      handleSelect(predictions[highlightedIndex])
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
    }
  }, [showDropdown, predictions, highlightedIndex, handleSelect])

  // Click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Cleanup debounce
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // Fallback to plain Input if Google Places is unavailable
  if (loadError) {
    return (
      <Input
        label={label}
        icon={icon || <MapPin className="w-5 h-5" />}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        error={error}
        disabled={disabled}
      />
    )
  }

  const iconElement = isResolving || isSearching ? (
    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
  ) : isSelected ? (
    <Check className="w-5 h-5 text-emerald-500" />
  ) : (
    icon || <MapPin className="w-5 h-5" />
  )

  return (
    <div ref={containerRef} className="relative space-y-2">
      {label && (
        <label className="block text-sm font-medium text-gray-700" htmlFor={inputId}>
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}

      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
          {iconElement}
        </div>

        <input
          ref={inputRef}
          id={inputId}
          type="text"
          value={value}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => { if (value.trim().length >= 2 && !isSelected) searchLocations(value) }}
          onKeyDown={handleKeyDown}
          disabled={disabled || !isLoaded}
          placeholder={isLoaded ? placeholder : 'Loading...'}
          autoComplete="off"
          className={cn(
            'w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg',
            'focus:outline-none focus:ring-2 focus:ring-[#8026FA] focus:border-transparent',
            'transition-all duration-200 placeholder:text-gray-400 pl-10',
            isSelected && 'border-emerald-300 bg-emerald-50/30',
            error && 'border-red-500 focus:ring-red-500',
          )}
        />

        {isSelected && (
          <button
            type="button"
            onClick={() => {
              onChange('')
              onLocationClear()
              inputRef.current?.focus()
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Clear location"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Dropdown */}
      {showDropdown && predictions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
          <ul className="max-h-60 overflow-y-auto py-1" role="listbox">
            {predictions.map((prediction, index) => (
              <li
                key={prediction.placeId}
                role="option"
                aria-selected={index === highlightedIndex}
                className={cn(
                  'px-3 py-2.5 cursor-pointer transition-colors',
                  index === highlightedIndex ? 'bg-purple-50' : 'hover:bg-gray-50',
                )}
                onClick={() => handleSelect(prediction)}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                <span className="font-medium text-gray-900 text-sm">{prediction.mainText}</span>
                {prediction.secondaryText && (
                  <span className="text-xs text-gray-500 ml-1.5">{prediction.secondaryText}</span>
                )}
              </li>
            ))}
          </ul>
          <div className="border-t border-gray-100 px-3 py-1.5 flex justify-end">
            <img
              src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3_hdpi.png"
              alt="Powered by Google"
              className="h-4"
            />
          </div>
        </div>
      )}
    </div>
  )
}
