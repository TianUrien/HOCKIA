import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, X } from 'lucide-react'

interface SearchBarProps {
  autoFocus?: boolean
  initialQuery?: string
  onQueryChange?: (query: string) => void
}

export function SearchBar({ autoFocus = false, initialQuery = '', onQueryChange }: SearchBarProps) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState(initialQuery || searchParams.get('q') || '')
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus()
    }
  }, [autoFocus])

  const handleChange = useCallback((value: string) => {
    setQuery(value)

    if (onQueryChange) {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onQueryChange(value)
      }, 300)
    }
  }, [onQueryChange])

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = query.trim()
    if (trimmed.length < 2) return

    // Navigate to search page with query
    navigate(`/search?q=${encodeURIComponent(trimmed)}`)
  }, [query, navigate])

  const handleClear = useCallback(() => {
    setQuery('')
    onQueryChange?.('')
    inputRef.current?.focus()
  }, [onQueryChange])

  return (
    <form onSubmit={handleSubmit} className="relative">
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400 pointer-events-none" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Search posts, people, clubs..."
        className="w-full pl-10 pr-10 py-2.5 text-sm bg-gray-100 border border-gray-200 rounded-full focus:outline-none focus:ring-2 focus:ring-hockia-primary/30 focus:border-hockia-primary focus:bg-white transition-colors"
        autoComplete="off"
        enterKeyHint="search"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      {query && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-3.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Clear search"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </form>
  )
}
