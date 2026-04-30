import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Search, UserPlus, X, CheckCircle, ChevronDown } from 'lucide-react'
import Modal from './Modal'
import Avatar from './Avatar'
import RoleBadge from './RoleBadge'
import { cn } from '@/lib/utils'

export type ReferenceFriendOption = {
  id: string
  fullName: string
  username: string | null
  avatarUrl: string | null
  role: string | null
  baseLocation: string | null
  currentClub: string | null
}

/** Relationship options keyed by [requester role][reference role] */
const RELATIONSHIP_MAP: Record<string, Record<string, string[]>> = {
  player: {
    player: ['Teammate', 'Team Captain', 'Former Teammate', 'Former Captain'],
    coach:  ['Head Coach', 'Assistant Coach', 'Former Coach', 'Academy Coach'],
    club:   ['Club', 'Former Club'],
    umpire: ['Match Umpire', 'Tournament Official'],
  },
  coach: {
    player: ['Player', 'Former Player', 'Team Captain', 'Mentor'],
    coach:  ['Colleague', 'Fellow Coach', 'Former Colleague'],
    club:   ['Club', 'Former Club'],
    umpire: ['Match Umpire', 'Tournament Official'],
  },
  club: {
    player: ['Club Member', 'Former Member', 'Club Captain'],
    coach:  ['Club Coach', 'Former Coach', 'Head Coach'],
    umpire: ['Club Umpire', 'Tournament Umpire'],
  },
  umpire: {
    // Primary trust pair — peer umpires are the strongest voice for an
    // umpire's credibility. Rich list: partnership, seniority, mentorship,
    // formal assessment, and panel colleagueship all carry distinct weight.
    umpire: [
      'Umpiring Partner',
      'Fellow Umpire',
      'Senior Umpire',
      'Umpire Mentor',
      'Umpire Assessor',
      'Panel Colleague',
    ],
    // Describe the CONNECTION, not the coach's title. "Head Coach" by
    // itself doesn't tell the reader how they know the umpire.
    coach: [
      'Coach at Matches I Officiated',
      'Tournament Coach',
      'Development Panel Coach',
      'Opposing Coach',
    ],
    // Same principle — what was the umpire's relationship to the club?
    club: [
      'Home Club',
      'Club I Regularly Officiated For',
      'Tournament Host Club',
      'Former Club',
    ],
    // Narrow to the honest cases: career pivot, senior player voice from
    // officiated matches, or a high-level player whose observation carries
    // weight. A UI advisory below the dropdown nudges umpires toward
    // stronger reference sources (peer/assessor/coach) for this pair.
    player: [
      'Former Teammate',
      'Team Captain I Officiated',
      'Senior National Player',
    ],
    // Rare pair but missing entirely before — falling through to the
    // generic Teammate/Colleague/Mentor fallback was incoherent. The
    // three most plausible umpire↔brand connections.
    brand: [
      'Sponsor',
      'Equipment Partner',
      'Clinic / Academy Host',
    ],
  },
}

/** Flat fallback if role pair is unknown */
const FALLBACK_OPTIONS = ['Teammate', 'Colleague', 'Mentor']

const MAX_NOTE_LENGTH = 300

interface AddReferenceModalProps {
  isOpen: boolean
  onClose: () => void
  friends: ReferenceFriendOption[]
  onSubmit: (payload: { referenceId: string; relationshipType: string; requestNote?: string | null }) => Promise<boolean>
  isSubmitting: boolean
  remainingSlots: number
  /** Role of the logged-in user requesting the reference */
  requesterRole?: string | null
  /** Phase 4 References UX Plan #1.2 — when set, the modal opens with this
   *  friend already selected (skips the search dropdown step). Drives the
   *  "Ask to vouch" CTA on individual friend rows in FriendsTab. The id
   *  must match a friend in the `friends` prop; if not present, the modal
   *  silently falls back to the dropdown flow. */
  preselectedFriendId?: string | null
}

export default function AddReferenceModal({ isOpen, onClose, friends, onSubmit, isSubmitting, remainingSlots, requesterRole, preselectedFriendId }: AddReferenceModalProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedFriendId, setSelectedFriendId] = useState<string>('')
  const [relationshipType, setRelationshipType] = useState('')
  const [requestNote, setRequestNote] = useState('')
  const [showSuccess, setShowSuccess] = useState(false)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const relationshipSelectId = useId()

  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const filteredFriends = useMemo(() => {
    if (!searchTerm) return friends
    const term = searchTerm.toLowerCase()
    return friends.filter((friend) => {
      const haystacks = [friend.fullName, friend.username, friend.baseLocation, friend.currentClub]
      return haystacks.some((value) => value?.toLowerCase().includes(term))
    })
  }, [friends, searchTerm])

  const selectedFriend = friends.find((friend) => friend.id === selectedFriendId) ?? null

  const relationshipOptions = useMemo(() => {
    const rRole = requesterRole?.toLowerCase()
    const refRole = selectedFriend?.role?.toLowerCase()
    if (!rRole || !refRole) return FALLBACK_OPTIONS
    return RELATIONSHIP_MAP[rRole]?.[refRole] ?? FALLBACK_OPTIONS
  }, [requesterRole, selectedFriend?.role])

  const resetState = () => {
    setSearchTerm('')
    setSelectedFriendId('')
    setRelationshipType('')
    setRequestNote('')
    setShowSuccess(false)
    setIsDropdownOpen(false)
  }

  const handleClose = () => {
    if (isSubmitting) return
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current)
      successTimerRef.current = null
    }
    resetState()
    onClose()
  }

  const handleSubmit = async () => {
    if (!selectedFriendId || !relationshipType) return
    const success = await onSubmit({
      referenceId: selectedFriendId,
      relationshipType,
      requestNote: requestNote.trim() ? requestNote.trim() : null,
    })

    if (success) {
      setShowSuccess(true)
      successTimerRef.current = setTimeout(() => {
        successTimerRef.current = null
        resetState()
        onClose()
      }, 1000)
    }
  }

  const handleSelectFriend = (friendId: string) => {
    setSelectedFriendId(friendId)
    setRelationshipType('')
    setIsDropdownOpen(false)
    setSearchTerm('')
  }

  const handleClearSelection = () => {
    setSelectedFriendId('')
    setRelationshipType('')
    setSearchTerm('')
  }

  // Cleanup success timer on unmount
  useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current)
      }
    }
  }, [])

  // Click-outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Auto-focus search input when dropdown opens
  useEffect(() => {
    if (isDropdownOpen && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [isDropdownOpen])

  // Phase 4 References UX Plan #1.2 — when a parent component (e.g. the
  // "Ask to vouch" CTA on a friend row) signals a preselected friend,
  // mirror that into local state on every open. Only honored if the friend
  // is actually present in the friends list (defensive fallback to the
  // dropdown flow when the id doesn't match).
  useEffect(() => {
    if (!isOpen) return
    if (!preselectedFriendId) return
    const exists = friends.some((f) => f.id === preselectedFriendId)
    if (exists) {
      setSelectedFriendId(preselectedFriendId)
      setRelationshipType('')
      setSearchTerm('')
      setIsDropdownOpen(false)
    }
  }, [isOpen, preselectedFriendId, friends])

  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
      <div className="p-6">
        {showSuccess ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle className="h-6 w-6 text-emerald-600" />
            </div>
            <p className="mt-3 text-lg font-semibold text-gray-900">Request sent</p>
            <p className="mt-1 text-sm text-gray-500">
              {selectedFriend?.fullName} will be notified
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Header */}
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-hockia-primary">Add Reference</p>
              <h2 className="text-xl font-bold text-gray-900">Request a trusted reference</h2>
              <p className="mt-1 text-sm text-gray-500">{5 - remainingSlots} of 5 references used</p>
            </div>

            {/* Person selector */}
            <div>
              <label className="text-sm font-medium text-gray-700">Connection</label>

              {selectedFriend ? (
                <div className="mt-2 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 px-3 py-2.5">
                  <Avatar
                    src={selectedFriend.avatarUrl}
                    initials={selectedFriend.fullName.split(' ').map((n) => n[0]).join('').slice(0, 2) || '?'}
                    alt={selectedFriend.fullName}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">{selectedFriend.fullName}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <RoleBadge role={selectedFriend.role ?? undefined} />
                      {selectedFriend.currentClub && <span className="truncate">{selectedFriend.currentClub}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearSelection}
                    className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                    aria-label="Change selection"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="relative mt-2" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-xl border bg-gray-50 px-3 py-2.5 text-left text-sm transition-colors',
                      isDropdownOpen ? 'border-hockia-primary bg-white' : 'border-gray-200 hover:border-gray-300'
                    )}
                  >
                    <span className="text-gray-400">Search connections...</span>
                    <ChevronDown className={cn('h-4 w-4 text-gray-400 transition-transform', isDropdownOpen && 'rotate-180')} />
                  </button>

                  {isDropdownOpen && (
                    <div className="absolute z-10 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg">
                      <div className="border-b border-gray-100 p-2">
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                          <input
                            ref={searchInputRef}
                            type="search"
                            placeholder="Search by name, club, or location"
                            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-gray-400 focus:border-hockia-primary focus:outline-none"
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                            aria-label="Search connections"
                            autoComplete="off"
                            enterKeyHint="search"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                          />
                        </div>
                      </div>

                      <div className="max-h-48 overflow-y-auto">
                        {filteredFriends.length === 0 ? (
                          <div className="p-4 text-center text-sm text-gray-500">No matching connections.</div>
                        ) : (
                          filteredFriends.map((friend) => (
                            <button
                              type="button"
                              key={friend.id}
                              onClick={() => handleSelectFriend(friend.id)}
                              className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50"
                            >
                              <Avatar
                                src={friend.avatarUrl}
                                initials={friend.fullName.split(' ').map((n) => n[0]).join('').slice(0, 2) || '?'}
                                alt={friend.fullName}
                                size="sm"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-gray-900">{friend.fullName}</p>
                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                  <RoleBadge role={friend.role ?? undefined} />
                                  {friend.currentClub && <span className="truncate">{friend.currentClub}</span>}
                                  {!friend.currentClub && friend.baseLocation && <span className="truncate">{friend.baseLocation}</span>}
                                </div>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Relationship type */}
            <div>
              <label htmlFor={relationshipSelectId} className="text-sm font-medium text-gray-700">Relationship</label>
              <select
                id={relationshipSelectId}
                className={cn(
                  'mt-2 w-full rounded-xl border bg-white px-3 py-2.5 text-sm focus:border-hockia-primary focus:outline-none',
                  relationshipType ? 'border-gray-200 text-gray-900' : 'border-gray-200 text-gray-400'
                )}
                value={relationshipType}
                onChange={(event) => setRelationshipType(event.target.value)}
              >
                <option value="" disabled>Select relationship...</option>
                {relationshipOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>

              {/* Umpire → Player is legitimate in narrow cases (career pivot,
                  senior player voice) but federations flag umpires soliciting
                  player endorsements for officiated matches as a conflict of
                  interest. Nudge toward stronger sources without blocking. */}
              {requesterRole?.toLowerCase() === 'umpire' && selectedFriend?.role?.toLowerCase() === 'player' && (
                <p className="mt-2 text-xs text-gray-500 leading-relaxed">
                  Umpires usually get stronger references from peer umpires, assessors, or coaches who've observed them at matches.
                </p>
              )}
            </div>

            {/* Optional note */}
            <div>
              <label className="text-sm font-medium text-gray-700">
                Note <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <textarea
                value={requestNote}
                onChange={(event) => setRequestNote(event.target.value)}
                placeholder="Brief context for this request"
                rows={3}
                autoCapitalize="sentences"
                spellCheck
                className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-hockia-primary focus:outline-none"
                maxLength={MAX_NOTE_LENGTH}
              />
              <p className="mt-1 text-right text-xs text-gray-400">{requestNote.length}/{MAX_NOTE_LENGTH}</p>
            </div>

            {/* Confirmation summary */}
            {selectedFriend && relationshipType && (
              <p className="rounded-xl bg-gray-50 px-3 py-2.5 text-center text-sm text-gray-600">
                Requesting <span className="font-semibold text-gray-900">{selectedFriend.fullName}</span>{' '}
                as your <span className="font-semibold text-gray-900">{relationshipType}</span>
              </p>
            )}

            {/* Submit button */}
            <button
              type="button"
              disabled={!selectedFriend || !relationshipType || isSubmitting}
              onClick={handleSubmit}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition-opacity disabled:opacity-60"
            >
              <UserPlus className="h-4 w-4" />
              {isSubmitting ? 'Sending...' : 'Send Request'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
