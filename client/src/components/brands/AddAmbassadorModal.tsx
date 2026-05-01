import { useState, useCallback, useEffect } from 'react'
import { Search, Award, UserPlus, Loader2 } from 'lucide-react'
import Modal from '@/components/Modal'
import Avatar from '@/components/Avatar'
import RoleBadge from '@/components/RoleBadge'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'

interface PlayerResult {
  id: string
  full_name: string
  avatar_url: string | null
  position: string | null
  base_location: string | null
  current_club: string | null
}

interface AddAmbassadorModalProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (playerId: string) => Promise<{ success: boolean; error?: string }>
  existingPlayerIds: string[]
}

export function AddAmbassadorModal({ isOpen, onClose, onAdd, existingPlayerIds }: AddAmbassadorModalProps) {
  const { user } = useAuthStore()
  const [searchTerm, setSearchTerm] = useState('')
  const [results, setResults] = useState<PlayerResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Search players with debounce
  const searchPlayers = useCallback(async (query: string) => {
    if (!query.trim() || query.length < 2) {
      setResults([])
      return
    }

    setIsSearching(true)
    try {
      const searchPattern = `%${query}%`
      let q = supabase
        .from('profiles')
        .select('id, full_name, avatar_url, position, base_location, current_club')
        .eq('role', 'player')
        .eq('onboarding_completed', true)
        .neq('id', user?.id || '')
        .ilike('full_name', searchPattern)
        .limit(10)

      // Exclude already-added ambassadors
      if (existingPlayerIds.length > 0) {
        q = q.not('id', 'in', `(${existingPlayerIds.join(',')})`)
      }

      const { data, error: queryError } = await q

      if (queryError) throw queryError
      setResults((data || []) as PlayerResult[])
    } catch (err) {
      logger.error('[AddAmbassadorModal] Search error:', err)
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }, [user?.id, existingPlayerIds])

  // Debounced search
  useEffect(() => {
    if (!searchTerm.trim()) {
      setResults([])
      return
    }

    const timer = setTimeout(() => {
      searchPlayers(searchTerm)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchTerm, searchPlayers])

  const handleSelect = async (playerId: string) => {
    setAddingId(playerId)
    setError(null)
    try {
      const result = await onAdd(playerId)
      if (result.success) {
        handleClose()
      } else {
        setError(result.error || 'Failed to add ambassador')
      }
    } catch {
      setError('Failed to add ambassador')
    } finally {
      setAddingId(null)
    }
  }

  const handleClose = () => {
    setSearchTerm('')
    setResults([])
    setError(null)
    setAddingId(null)
    onClose()
  }

  const showEmptyState = searchTerm.trim().length >= 2 && !isSearching && results.length === 0

  return (
    <Modal isOpen={isOpen} onClose={handleClose} className="max-w-md">
      <div className="p-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[#E11D48] to-[#F43F5E] flex items-center justify-center">
              <Award className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Invite Ambassador</h2>
              <p className="text-sm text-gray-500">Search for a player to invite</p>
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Search Input */}
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search players by name..."
            className="w-full rounded-xl border border-gray-200 bg-gray-50 py-3 pl-10 pr-4 text-sm placeholder:text-gray-400 focus:border-[#8026FA] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#8026FA]/20"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoFocus
            autoComplete="off"
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {isSearching && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="w-4 h-4 border-2 border-[#8026FA] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>

        {/* Section Label */}
        {searchTerm.trim().length >= 2 && (
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
            Search Results
          </p>
        )}

        {/* Results List */}
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
          <div className="max-h-72 overflow-y-auto divide-y divide-gray-100">
            {showEmptyState ? (
              <div className="p-6 text-center text-sm text-gray-500">
                No players found matching &ldquo;{searchTerm}&rdquo;
              </div>
            ) : results.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500">
                {searchTerm.trim().length < 2
                  ? 'Type at least 2 characters to search'
                  : 'Searching...'}
              </div>
            ) : (
              results.map((player) => {
                const subtitle = [player.position, player.current_club, player.base_location]
                  .filter(Boolean)
                  .join(' \u00B7 ')
                const isAdding = addingId === player.id

                return (
                  <button
                    type="button"
                    key={player.id}
                    onClick={() => handleSelect(player.id)}
                    disabled={addingId !== null}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                      'hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50'
                    )}
                  >
                    <Avatar
                      src={player.avatar_url}
                      initials={player.full_name?.split(' ').map((n) => n[0]).join('').slice(0, 2) || '?'}
                      alt={player.full_name}
                      size="sm"
                      role="player"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900 truncate">{player.full_name}</p>
                        <RoleBadge role="player" />
                      </div>
                      {subtitle && (
                        <p className="text-xs text-gray-500 truncate mt-0.5">{subtitle}</p>
                      )}
                    </div>
                    {isAdding ? (
                      <Loader2 className="w-4 h-4 text-[#8026FA] animate-spin flex-shrink-0" />
                    ) : (
                      <UserPlus className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Help text */}
        <p className="mt-4 text-xs text-gray-400 text-center">
          The player will receive a notification and must accept your invitation
        </p>
      </div>
    </Modal>
  )
}
