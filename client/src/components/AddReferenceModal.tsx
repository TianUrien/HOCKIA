import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Search, Shield, UserPlus, X, CheckCircle, ChevronDown } from 'lucide-react'
import Modal from './Modal'
import Avatar from './Avatar'
import RoleBadge from './RoleBadge'
import { Trans } from 'react-i18next'
import { cn } from '@/lib/utils'
import { tMedia, useMediaT } from '@/i18n/ns/media'

export type ReferenceFriendOption = {
  id: string
  fullName: string
  username: string | null
  avatarUrl: string | null
  role: string | null
  baseLocation: string | null
  currentClub: string | null
  /** When this friendship was accepted. Drives the "recently connected"
   *  nudge surface so we can prompt users to ask for a vouch while the
   *  connection is still fresh. */
  acceptedAt: string | null
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
    // Coach-context relationships. The earlier 'Player / Former Player /
    // Team Captain / Mentor' list mirrored what a player would say about
    // a coach, which read backwards on a coach's profile. Reworked to
    // describe how the coach knows the player.
    player: ['Athlete I Coached', 'Former Athlete', 'Mentee', 'Team Captain', 'Player'],
    // Add 'Assistant Coach I Worked With' to cover the common scenario
    // of head-coach / assistant-coach pairings without forcing 'Colleague'.
    coach:  ['Assistant Coach I Worked With', 'Head Coach', 'Colleague', 'Fellow Coach', 'Former Colleague'],
    club:   ['Club Director', 'Club', 'Former Club'],
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

/**
 * The words shown for each stored relationship value (the values above stay
 * English: they are saved on the reference). Built on each call so the text
 * follows the interface language.
 */
function relationshipLabels(): Record<string, string> {
  return {
    'Teammate': tMedia('references.relationship.teammate'),
    'Team Captain': tMedia('references.relationship.teamCaptain'),
    'Former Teammate': tMedia('references.relationship.formerTeammate'),
    'Former Captain': tMedia('references.relationship.formerCaptain'),
    'Head Coach': tMedia('references.relationship.headCoach'),
    'Assistant Coach': tMedia('references.relationship.assistantCoach'),
    'Former Coach': tMedia('references.relationship.formerCoach'),
    'Academy Coach': tMedia('references.relationship.academyCoach'),
    'Club': tMedia('references.relationship.club'),
    'Former Club': tMedia('references.relationship.formerClub'),
    'Match Umpire': tMedia('references.relationship.matchUmpire'),
    'Tournament Official': tMedia('references.relationship.tournamentOfficial'),
    'Athlete I Coached': tMedia('references.relationship.athleteICoached'),
    'Former Athlete': tMedia('references.relationship.formerAthlete'),
    'Mentee': tMedia('references.relationship.mentee'),
    'Player': tMedia('references.relationship.player'),
    'Assistant Coach I Worked With': tMedia('references.relationship.assistantCoachIWorkedWith'),
    'Colleague': tMedia('references.relationship.colleague'),
    'Fellow Coach': tMedia('references.relationship.fellowCoach'),
    'Former Colleague': tMedia('references.relationship.formerColleague'),
    'Club Director': tMedia('references.relationship.clubDirector'),
    'Club Member': tMedia('references.relationship.clubMember'),
    'Former Member': tMedia('references.relationship.formerMember'),
    'Club Captain': tMedia('references.relationship.clubCaptain'),
    'Club Coach': tMedia('references.relationship.clubCoach'),
    'Club Umpire': tMedia('references.relationship.clubUmpire'),
    'Tournament Umpire': tMedia('references.relationship.tournamentUmpire'),
    'Umpiring Partner': tMedia('references.relationship.umpiringPartner'),
    'Fellow Umpire': tMedia('references.relationship.fellowUmpire'),
    'Senior Umpire': tMedia('references.relationship.seniorUmpire'),
    'Umpire Mentor': tMedia('references.relationship.umpireMentor'),
    'Umpire Assessor': tMedia('references.relationship.umpireAssessor'),
    'Panel Colleague': tMedia('references.relationship.panelColleague'),
    'Coach at Matches I Officiated': tMedia('references.relationship.coachAtMatchesIOfficiated'),
    'Tournament Coach': tMedia('references.relationship.tournamentCoach'),
    'Development Panel Coach': tMedia('references.relationship.developmentPanelCoach'),
    'Opposing Coach': tMedia('references.relationship.opposingCoach'),
    'Home Club': tMedia('references.relationship.homeClub'),
    'Club I Regularly Officiated For': tMedia('references.relationship.clubIRegularlyOfficiatedFor'),
    'Tournament Host Club': tMedia('references.relationship.tournamentHostClub'),
    'Team Captain I Officiated': tMedia('references.relationship.teamCaptainIOfficiated'),
    'Senior National Player': tMedia('references.relationship.seniorNationalPlayer'),
    'Sponsor': tMedia('references.relationship.sponsor'),
    'Equipment Partner': tMedia('references.relationship.equipmentPartner'),
    'Clinic / Academy Host': tMedia('references.relationship.clinicAcademyHost'),
    'Mentor': tMedia('references.relationship.mentor'),
  }
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
  const t = useMediaT()
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
  const labels = relationshipLabels()
  const labelOf = (value: string) => labels[value] ?? value

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
            <p className="mt-3 text-lg font-semibold text-gray-900">{t('references.add.successTitle')}</p>
            <p className="mt-1 text-sm text-gray-500">
              {t('references.add.successBody', { name: selectedFriend?.fullName ?? '' })}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Header */}
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-hockia-primary">{t('references.add.kicker')}</p>
              <h2 className="text-xl font-bold text-gray-900">{t('references.add.title')}</h2>
              <p className="mt-1 text-sm text-gray-500">{t('references.add.used', { used: 5 - remainingSlots, max: 5 })}</p>
            </div>

            {/* Person selector */}
            <div>
              <label className="text-sm font-medium text-gray-700">{t('references.add.connection')}</label>

              {selectedFriend ? (
                <div className="mt-2 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 px-3 py-2.5">
                  <Avatar
                    src={selectedFriend.avatarUrl}
                    initials={selectedFriend.fullName.split(' ').map((n) => n[0]).join('').slice(0, 2) || '?'}
                    alt={selectedFriend.fullName}
                    size="sm"
                    role={selectedFriend.role}
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
                    // 44x44 minimum tap target (Apple HIG); icon stays small.
                    className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                    aria-label={t('references.add.changeSelection')}
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
                    <span className="text-gray-400">{t('references.add.searchTrigger')}</span>
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
                            placeholder={t('references.add.searchPlaceholder')}
                            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-gray-400 focus:border-hockia-primary focus:outline-none"
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                            aria-label={t('references.add.searchLabel')}
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
                          <div className="p-4 text-center text-sm text-gray-500">{t('references.add.noMatches')}</div>
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
                                role={friend.role}
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
              <label htmlFor={relationshipSelectId} className="text-sm font-medium text-gray-700">{t('references.add.relationship')}</label>
              {/* Tell the user WHY the options here look different than they
                  might expect — relationship choices are filtered by the
                  selected friend's role (umpires get match/tournament
                  context, players get team/coach context, etc.). */}
              <p className="mt-1 text-xs text-gray-500">
                {selectedFriend?.fullName?.split(' ')[0]
                  ? t('references.add.optionsHintNamed', { name: selectedFriend.fullName.split(' ')[0] })
                  : t('references.add.optionsHint')}
              </p>
              <select
                id={relationshipSelectId}
                className={cn(
                  'mt-2 w-full rounded-xl border bg-white px-3 py-2.5 text-sm focus:border-hockia-primary focus:outline-none',
                  relationshipType ? 'border-gray-200 text-gray-900' : 'border-gray-200 text-gray-400'
                )}
                value={relationshipType}
                onChange={(event) => setRelationshipType(event.target.value)}
              >
                <option value="" disabled>{t('references.add.selectRelationship')}</option>
                {relationshipOptions.map((option) => (
                  <option key={option} value={option}>{labelOf(option)}</option>
                ))}
              </select>

              {/* Umpire → Player is legitimate in narrow cases (career pivot,
                  senior player voice) but federations flag umpires soliciting
                  player endorsements for officiated matches as a conflict of
                  interest. Nudge toward stronger sources without blocking. */}
              {requesterRole?.toLowerCase() === 'umpire' && selectedFriend?.role?.toLowerCase() === 'player' && (
                <p className="mt-2 text-xs text-gray-500 leading-relaxed">
                  {t('references.add.umpireHint')}
                </p>
              )}
            </div>

            {/* Optional note */}
            <div>
              <label className="text-sm font-medium text-gray-700">
                {t('references.add.note')} <span className="font-normal text-gray-400">{t('references.add.optional')}</span>
              </label>
              <textarea
                value={requestNote}
                onChange={(event) => setRequestNote(event.target.value.slice(0, MAX_NOTE_LENGTH))}
                placeholder={t('references.add.notePlaceholder')}
                rows={3}
                autoCapitalize="sentences"
                spellCheck
                className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-hockia-primary focus:outline-none"
                maxLength={MAX_NOTE_LENGTH}
              />
              {/* Counter color flips to red past the limit so the UI can't
                  silently look fine when a programmatic / paste path
                  bypassed the maxLength attribute. We also slice in
                  onChange above so the underlying value stays clamped. */}
              <p
                className={`mt-1 text-right text-xs ${
                  requestNote.length > MAX_NOTE_LENGTH ? 'text-red-600 font-medium' : 'text-gray-400'
                }`}
              >
                {requestNote.length}/{MAX_NOTE_LENGTH}
              </p>
            </div>

            {/* Confirmation summary */}
            {selectedFriend && relationshipType && (
              <p className="rounded-xl bg-gray-50 px-3 py-2.5 text-center text-sm text-gray-600">
                <Trans
                  t={t}
                  i18nKey="references.add.summary"
                  values={{ name: selectedFriend.fullName, relationship: labelOf(relationshipType) }}
                  components={{ b: <span className="font-semibold text-gray-900" /> }}
                />
              </p>
            )}

            {/* Phase 4 References UX Plan #2.3 — "why this matters" inline
                note. Connects the action to its real-world value so users
                understand WHY they're sending the request, not just what
                the button does. Sits above the submit button so it's the
                last thing the user reads before tapping Send. */}
            {/* Trailing trust copy varies by requester role. Umpires aren't
                being scouted by clubs in the recruitment sense — they're
                appointed by assigners — so the default "clubs scouting"
                language reads off-tone for them. */}
            <p className="flex items-start gap-1.5 rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-2.5 text-xs text-emerald-800 leading-relaxed">
              <Shield className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              <span>
                {(() => {
                  const umpire = requesterRole?.toLowerCase() === 'umpire'
                  if (selectedFriend) {
                    const name = selectedFriend.fullName.split(' ')[0]
                    return umpire ? t('references.add.trustUmpireNamed', { name }) : t('references.add.trustNamed', { name })
                  }
                  return umpire ? t('references.add.trustUmpire') : t('references.add.trust')
                })()}
              </span>
            </p>

            {/* Submit button */}
            <div>
              <button
                type="button"
                disabled={
                  !selectedFriend ||
                  !relationshipType ||
                  isSubmitting ||
                  requestNote.length > MAX_NOTE_LENGTH
                }
                onClick={handleSubmit}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-primary px-4 py-3 text-sm font-semibold text-white shadow-lg transition-opacity disabled:opacity-60"
              >
                <UserPlus className="h-4 w-4" />
                {isSubmitting ? t('references.add.sending') : t('references.add.send')}
              </button>
              {/* Helper text explaining why the button is disabled, so a
                  user staring at a greyed-out CTA knows what's missing. */}
              {!isSubmitting && (!selectedFriend || !relationshipType || requestNote.length > MAX_NOTE_LENGTH) && (
                <p className="mt-2 text-center text-xs text-gray-500">
                  {!selectedFriend
                    ? t('references.add.needConnection')
                    : !relationshipType
                      ? t('references.add.needRelationship')
                      : t('references.add.noteTooLong')}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
