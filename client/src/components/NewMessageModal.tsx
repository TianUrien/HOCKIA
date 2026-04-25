/**
 * NewMessageModal
 *
 * Modal for starting a new conversation by searching for users.
 * Searches profiles and navigates to messages with the selected user.
 */

import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, MessageCircle } from 'lucide-react'
import Modal from './Modal'
import Avatar from './Avatar'
import RoleBadge from './RoleBadge'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'

interface SearchResult {
  id: string
  full_name: string
  avatar_url: string | null
  role: 'player' | 'coach' | 'club' | 'umpire'
  base_location: string | null
  current_club: string | null
}

interface NewMessageModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function NewMessageModal({ isOpen, onClose }: NewMessageModalProps) {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [searchTerm, setSearchTerm] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [recentContacts, setRecentContacts] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isLoadingRecent, setIsLoadingRecent] = useState(true)

  // Fetch recent contacts on mount
  useEffect(() => {
    if (!isOpen || !user?.id) return

    const fetchRecentContacts = async () => {
      setIsLoadingRecent(true)
      try {
        // Get the most recent conversations to show as suggestions
        const { data, error } = await supabase.rpc('get_user_conversations', {
          p_user_id: user.id
        })

        if (error) throw error

        // Extract the other users from conversations
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC return type not generated
        const contacts: SearchResult[] = ((data || []) as any[])
          .slice(0, 5)
          .map((conv: { other_participant_id: string; other_participant_name: string; other_participant_avatar: string | null; other_participant_role: string }) => ({
            id: conv.other_participant_id,
            full_name: conv.other_participant_name,
            avatar_url: conv.other_participant_avatar,
            role: conv.other_participant_role as 'player' | 'coach' | 'club' | 'umpire',
            base_location: null,
            current_club: null
          }))

        setRecentContacts(contacts)
      } catch (err) {
        logger.error('[NewMessageModal] Error fetching recent contacts:', err)
      } finally {
        setIsLoadingRecent(false)
      }
    }

    fetchRecentContacts()
  }, [isOpen, user?.id])

  // Search users with debounce
  const searchUsers = useCallback(async (query: string) => {
    if (!query.trim() || query.length < 2) {
      setResults([])
      return
    }

    setIsSearching(true)
    try {
      const searchPattern = `%${query}%`
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url, role, base_location, current_club')
        .eq('onboarding_completed', true)
        .neq('id', user?.id ?? '') // Exclude current user
        .or(`full_name.ilike.${searchPattern},current_club.ilike.${searchPattern}`)
        .limit(10)

      if (error) throw error
      setResults((data || []) as SearchResult[])
    } catch (err) {
      logger.error('[NewMessageModal] Search error:', err)
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }, [user?.id])

  // Debounced search
  useEffect(() => {
    if (!searchTerm.trim()) {
      setResults([])
      return
    }

    const timer = setTimeout(() => {
      searchUsers(searchTerm)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchTerm, searchUsers])

  const handleSelectUser = (userId: string) => {
    // Navigate to messages with the new conversation parameter
    navigate(`/messages?new=${userId}`)
    handleClose()
  }

  const handleClose = () => {
    setSearchTerm('')
    setResults([])
    onClose()
  }

  const displayedUsers = searchTerm.trim() ? results : recentContacts
  const showEmptyState = searchTerm.trim() && !isSearching && results.length === 0

  return (
    <Modal isOpen={isOpen} onClose={handleClose} className="max-w-md">
      <div className="p-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[#8026FA] to-[#924CEC] flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">New Message</h2>
              <p className="text-sm text-gray-500">Start a conversation</p>
            </div>
          </div>
        </div>

        {/* Search Input */}
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search by name or club..."
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
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
          {searchTerm.trim() ? 'Search Results' : 'Recent Conversations'}
        </p>

        {/* Results List */}
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
          <div className="max-h-72 overflow-y-auto divide-y divide-gray-100">
            {isLoadingRecent && !searchTerm.trim() ? (
              // Loading state
              <div className="p-8 text-center">
                <div className="w-6 h-6 border-2 border-[#8026FA] border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : showEmptyState ? (
              // Empty search results
              <div className="p-6 text-center text-sm text-gray-500">
                No users found matching "{searchTerm}"
              </div>
            ) : displayedUsers.length === 0 ? (
              // No recent contacts
              <div className="p-6 text-center text-sm text-gray-500">
                Start typing to search for users
              </div>
            ) : (
              displayedUsers.map((profile) => (
                <button
                  type="button"
                  key={profile.id}
                  onClick={() => handleSelectUser(profile.id)}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                    'hover:bg-gray-50 active:bg-gray-100'
                  )}
                >
                  <Avatar
                    src={profile.avatar_url}
                    initials={profile.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2) || '?'}
                    alt={profile.full_name}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{profile.full_name}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <RoleBadge role={profile.role} />
                      {profile.current_club && <span className="truncate">{profile.current_club}</span>}
                      {!profile.current_club && profile.base_location && <span className="truncate">{profile.base_location}</span>}
                    </div>
                  </div>
                  <MessageCircle className="w-4 h-4 text-gray-400 flex-shrink-0" />
                </button>
              ))
            )}
          </div>
        </div>

        {/* Help text */}
        <p className="mt-4 text-xs text-gray-400 text-center">
          Select a person to start a conversation
        </p>
      </div>
    </Modal>
  )
}
