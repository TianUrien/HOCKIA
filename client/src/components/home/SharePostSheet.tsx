/**
 * SharePostSheet
 *
 * Bottom-sheet modal for sharing a post via PLAYR Messages or copying a link.
 * Reuses the contact search pattern from NewMessageModal.
 */

import { useState, useCallback, useEffect } from 'react'
import { Search, Send, Link2, Check } from 'lucide-react'
import Modal from '../Modal'
import Avatar from '../Avatar'
import RoleBadge from '../RoleBadge'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { extractErrorMessage } from '@/lib/utils'
import { sendSharedPostMessage } from '@/lib/sharePost'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import type { SharedPostMetadata } from '@/types/chat'

interface ContactResult {
  id: string
  full_name: string
  avatar_url: string | null
  role: 'player' | 'coach' | 'club' | 'brand'
}

interface SharePostSheetProps {
  isOpen: boolean
  onClose: () => void
  postId: string
  authorId: string
  authorName: string | null
  authorAvatar: string | null
  authorRole: 'player' | 'coach' | 'club' | 'brand'
  content: string
  thumbnailUrl: string | null
}

export function SharePostSheet({
  isOpen,
  onClose,
  postId,
  authorId,
  authorName,
  authorAvatar,
  authorRole,
  content,
  thumbnailUrl,
}: SharePostSheetProps) {
  const { user, profile } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)

  const [searchTerm, setSearchTerm] = useState('')
  const [results, setResults] = useState<ContactResult[]>([])
  const [recentContacts, setRecentContacts] = useState<ContactResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isLoadingRecent, setIsLoadingRecent] = useState(true)
  const [sendingTo, setSendingTo] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<Set<string>>(new Set())

  const isBrand = profile?.role === 'brand'

  // Fetch recent contacts on mount
  useEffect(() => {
    if (!isOpen || !user?.id || isBrand) return

    const fetchRecentContacts = async () => {
      setIsLoadingRecent(true)
      try {
        const { data, error } = await supabase.rpc('get_conversations_for_user', {
          user_uuid: user.id,
        })

        if (error) throw error

        const contacts: ContactResult[] = (data || [])
          .slice(0, 8)
          .map(
            (conv: {
              other_user_id: string
              other_user_name: string
              other_user_avatar: string | null
              other_user_role: string
            }) => ({
              id: conv.other_user_id,
              full_name: conv.other_user_name,
              avatar_url: conv.other_user_avatar,
              role: conv.other_user_role as ContactResult['role'],
            }),
          )

        setRecentContacts(contacts)
      } catch (err) {
        logger.error('[SharePostSheet] Error fetching recent contacts:', err)
      } finally {
        setIsLoadingRecent(false)
      }
    }

    fetchRecentContacts()
  }, [isOpen, user?.id, isBrand])

  // Search users with debounce
  const searchUsers = useCallback(
    async (query: string) => {
      if (!query.trim() || query.length < 2) {
        setResults([])
        return
      }

      setIsSearching(true)
      try {
        const searchPattern = `%${query}%`
        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url, role')
          .eq('onboarding_completed', true)
          .neq('id', user?.id)
          .or(`full_name.ilike.${searchPattern},current_club.ilike.${searchPattern}`)
          .limit(10)

        if (error) throw error
        setResults((data || []) as ContactResult[])
      } catch (err) {
        logger.error('[SharePostSheet] Search error:', err)
        setResults([])
      } finally {
        setIsSearching(false)
      }
    },
    [user?.id],
  )

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

  const handleSendTo = useCallback(
    async (contact: ContactResult) => {
      if (!user?.id || sendingTo) return

      setSendingTo(contact.id)
      try {
        const postData: SharedPostMetadata = {
          type: 'shared_post',
          post_id: postId,
          author_id: authorId,
          author_name: authorName,
          author_avatar: authorAvatar,
          author_role: authorRole,
          content_preview: content.slice(0, 150),
          thumbnail_url: thumbnailUrl,
        }

        const result = await sendSharedPostMessage(user.id, contact.id, postData)

        if (result.success) {
          setSentTo((prev) => new Set(prev).add(contact.id))
          addToast(`Post sent to ${contact.full_name}`, 'success')
        } else {
          addToast(result.error || 'Failed to send post', 'error')
        }
      } catch (error) {
        addToast(extractErrorMessage(error, 'Failed to share post. Please try again.'), 'error')
      } finally {
        setSendingTo(null)
      }
    },
    [user?.id, sendingTo, postId, authorId, authorName, authorAvatar, authorRole, content, thumbnailUrl, addToast],
  )

  const handleCopyLink = useCallback(async () => {
    const url = `${window.location.origin}/post/${postId}`
    try {
      await navigator.clipboard.writeText(url)
      addToast('Link copied to clipboard', 'success')
    } catch {
      // Fallback for older browsers
      const input = document.createElement('input')
      input.value = url
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      addToast('Link copied to clipboard', 'success')
    }
  }, [postId, addToast])

  const handleClose = () => {
    setSearchTerm('')
    setResults([])
    setSentTo(new Set())
    onClose()
  }

  const displayedContacts = searchTerm.trim() ? results : recentContacts
  const showEmptyState = searchTerm.trim() && !isSearching && results.length === 0

  return (
    <Modal isOpen={isOpen} onClose={handleClose} className="sm:max-w-md">
      <div className="p-5">
        {/* Header */}
        <h2 className="text-lg font-bold text-gray-900 mb-4">Share post</h2>

        {/* Send to contacts — hidden for brand users */}
        {!isBrand && (
          <>
            {/* Search Input */}
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                placeholder="Search by name or club..."
                className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-10 pr-4 text-sm placeholder:text-gray-400 focus:border-[#8026FA] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#8026FA]/20"
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
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              {searchTerm.trim() ? 'Search Results' : 'Recent'}
            </p>

            {/* Contact List */}
            <div className="rounded-xl border border-gray-100 bg-white overflow-hidden mb-4">
              <div className="max-h-56 overflow-y-auto divide-y divide-gray-100">
                {isLoadingRecent && !searchTerm.trim() ? (
                  <div className="p-6 text-center">
                    <div className="w-5 h-5 border-2 border-[#8026FA] border-t-transparent rounded-full animate-spin mx-auto" />
                  </div>
                ) : showEmptyState ? (
                  <div className="p-5 text-center text-sm text-gray-500">
                    No users found matching &ldquo;{searchTerm}&rdquo;
                  </div>
                ) : displayedContacts.length === 0 ? (
                  <div className="p-5 text-center text-sm text-gray-500">
                    Start typing to search for users
                  </div>
                ) : (
                  displayedContacts.map((contact) => {
                    const alreadySent = sentTo.has(contact.id)
                    const isSending = sendingTo === contact.id

                    return (
                      <div
                        key={contact.id}
                        className="flex items-center gap-3 px-4 py-2.5"
                      >
                        <Avatar
                          src={contact.avatar_url}
                          initials={
                            contact.full_name
                              .split(' ')
                              .map((n) => n[0])
                              .join('')
                              .slice(0, 2) || '?'
                          }
                          alt={contact.full_name}
                          size="sm"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {contact.full_name}
                          </p>
                          <RoleBadge role={contact.role} />
                        </div>

                        {alreadySent ? (
                          <span className="flex items-center gap-1 text-xs font-medium text-green-600">
                            <Check className="w-3.5 h-3.5" />
                            Sent
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSendTo(contact)}
                            disabled={isSending}
                            className={cn(
                              'flex items-center justify-center w-8 h-8 rounded-full transition-colors',
                              'bg-[#8026FA] text-white hover:bg-[#6b1fd4] active:bg-[#5a18b5]',
                              'disabled:opacity-50',
                            )}
                          >
                            {isSending ? (
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <Send className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </>
        )}

        {/* Copy Link */}
        <button
          type="button"
          onClick={handleCopyLink}
          className="flex w-full items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100">
            <Link2 className="h-4 w-4 text-gray-600" />
          </div>
          <span className="text-sm font-medium text-gray-900">Copy link</span>
        </button>
      </div>
    </Modal>
  )
}
