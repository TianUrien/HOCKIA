import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Sparkles, X } from 'lucide-react'
import Avatar from './Avatar'
import RoleBadge from './RoleBadge'
import { logger } from '@/lib/logger'
import { trackReferenceNudgeDismiss, trackReferenceModalOpen } from '@/lib/analytics'
import type { ReferenceFriendOption } from './AddReferenceModal'

interface RecentlyConnectedCardProps {
  /** Accepted-friendship options from useReferenceFriendOptions / FriendsTab. */
  friendOptions: ReferenceFriendOption[]
  /** Owner profile id. Used to scope the localStorage dismissal key so a
   *  shared browser does not leak User A's dismissals onto User B. Also
   *  used for a defence-in-depth filter so the owner is never offered
   *  themselves as a vouch candidate (data corruption case). */
  ownerProfileId: string
  /** Friend ids excluded from the nudge — typically those already in pending
   *  or accepted references for this owner. */
  excludeIds?: Set<string>
  /** Number of accepted references the owner already has. The card is
   *  hidden once they have 1+ — the prompt is a discovery moment, not a
   *  recurring badger. */
  acceptedReferenceCount: number
  /** Window in days. A friendship counts as "recently connected" when its
   *  accepted_at falls inside this window. */
  windowDays?: number
  /** Triggered when the owner taps "Ask {Name}". Receives the friend id;
   *  the parent dashboard is responsible for navigating to FriendsTab,
   *  scrolling to references, and opening the modal pre-selected. */
  onAsk: (friendId: string) => void
}

const DISMISS_KEY_PREFIX = 'hockia-recently-connected-dismiss:'
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000
const DEFAULT_WINDOW_DAYS = 14

function getDismissKey(ownerId: string, friendId: string): string {
  // Scope the key by owner — otherwise dismissals leak across sign-ins on
  // shared browsers. Format: hockia-recently-connected-dismiss:<owner>:<friend>
  return `${DISMISS_KEY_PREFIX}${ownerId}:${friendId}`
}

function isDismissed(ownerId: string, friendId: string, now: number = Date.now()): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false
    const raw = window.localStorage.getItem(getDismissKey(ownerId, friendId))
    if (!raw) return false
    const ts = Date.parse(raw)
    if (Number.isNaN(ts)) return false
    return now - ts < DISMISS_COOLDOWN_MS
  } catch {
    return false
  }
}

function recordDismiss(ownerId: string, friendId: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(getDismissKey(ownerId, friendId), new Date().toISOString())
  } catch (err) {
    logger.error('[RecentlyConnectedCard] failed to persist dismissal', err)
  }
}

/**
 * Phase 4 References UX Plan — Phase 3.1 (post-friendship prompt).
 *
 * The deep-audit headline finding was "users do not know references exist."
 * Phase 1 surfaced the badge and Phase 2 fixed empty-state education, but a
 * user with zero references and no reason to visit the Friends tab still
 * never sees the feature. This card closes that gap on the Profile tab —
 * the surface owners actually visit — by promoting a single recent
 * connection as a vouch candidate.
 *
 * Render rules:
 *   - Hidden once the owner has any accepted reference (this is a discovery
 *     nudge, not a backfill prompt).
 *   - Picks the most-recent un-dismissed friend whose accepted_at is inside
 *     the window AND who is not already in pending/accepted references.
 *   - Per-friend dismissal persists for 14 days in localStorage. Browsers
 *     that block storage simply re-show the prompt — acceptable.
 */
export default function RecentlyConnectedCard({
  friendOptions,
  ownerProfileId,
  excludeIds,
  acceptedReferenceCount,
  windowDays = DEFAULT_WINDOW_DAYS,
  onAsk,
}: RecentlyConnectedCardProps) {
  // Track which friend ids have been dismissed in this session so the card
  // visibly drops off when the user taps the X (or Ask) without waiting for
  // a refetch. Reset only when the owner identity changes — resetting on
  // every friendOptions reference would clobber a just-dismissed-this-render
  // friend the moment useReferenceFriendOptions re-fetches.
  const [sessionDismissed, setSessionDismissed] = useState<Set<string>>(new Set())

  useEffect(() => {
    setSessionDismissed(new Set())
  }, [ownerProfileId])

  const candidate = useMemo(() => {
    if (!ownerProfileId) return null
    if (acceptedReferenceCount > 0) return null
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000

    const eligible = friendOptions
      .filter((f) => {
        if (!f.acceptedAt) return false
        // Defence-in-depth: never offer the owner themselves as a vouch
        // candidate. profile_friend_edges should never produce self-pairs
        // (CHECK constraint on profile_friendships), but if data corruption
        // ever creates one, this prevents a "Ask Yourself to vouch" card.
        if (f.id === ownerProfileId) return false
        if (excludeIds?.has(f.id)) return false
        if (sessionDismissed.has(f.id)) return false
        if (isDismissed(ownerProfileId, f.id)) return false
        const ts = Date.parse(f.acceptedAt)
        if (Number.isNaN(ts)) return false
        return ts >= cutoff
      })
      .sort((a, b) => {
        const ta = a.acceptedAt ? Date.parse(a.acceptedAt) : 0
        const tb = b.acceptedAt ? Date.parse(b.acceptedAt) : 0
        return tb - ta
      })

    return eligible[0] ?? null
  }, [friendOptions, ownerProfileId, excludeIds, acceptedReferenceCount, windowDays, sessionDismissed])

  if (!candidate) return null

  const handleDismiss = () => {
    recordDismiss(ownerProfileId, candidate.id)
    trackReferenceNudgeDismiss()
    setSessionDismissed((prev) => {
      const next = new Set(prev)
      next.add(candidate.id)
      return next
    })
  }

  const handleAsk = () => {
    // Mark this friend dismissed at the moment we hand off to the modal flow.
    // The dashboard's useTrustedReferences instance does NOT refetch when the
    // user submits the request inside FriendsTab (it's a separate hook
    // instance), so without this dismissal the same friend would re-appear in
    // the nudge after the user navigates back to the Profile tab — and a
    // double-tap would attempt a duplicate request. The 14-day cooldown gives
    // the friend time to accept/decline before this candidate could resurface.
    recordDismiss(ownerProfileId, candidate.id)
    setSessionDismissed((prev) => {
      const next = new Set(prev)
      next.add(candidate.id)
      return next
    })
    trackReferenceModalOpen('recently_connected')
    onAsk(candidate.id)
  }

  const firstName = candidate.fullName?.split(' ')[0] ?? candidate.fullName ?? 'them'

  return (
    <div className="relative rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/80 via-white to-emerald-50/40 p-4 sm:p-5 shadow-sm">
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss this nudge"
        className="absolute top-2.5 right-2.5 p-1.5 rounded-full text-emerald-700/60 hover:text-emerald-900 hover:bg-emerald-100 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-start gap-3 pr-8">
        <div className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-full bg-emerald-100 text-emerald-700">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Recently connected
          </p>
          <p className="mt-1 text-sm font-semibold text-gray-900">
            Ask {firstName} to vouch for your hockey?
          </p>
          <p className="mt-1 text-xs text-gray-600">
            Trusted references from coaches, teammates, or clubs are visible on your profile —
            clubs scouting on HOCKIA see them when they look at you.
          </p>

          <div className="mt-3 flex items-center gap-3 rounded-lg border border-emerald-100 bg-white/80 p-2.5">
            <Avatar
              src={candidate.avatarUrl}
              alt={candidate.fullName}
              initials={candidate.fullName.slice(0, 2)}
              size="sm"
            />
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">{candidate.fullName}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <RoleBadge role={candidate.role ?? undefined} className="px-1.5 py-0 text-[10px]" />
                {candidate.currentClub && (
                  <span className="truncate text-[11px] text-gray-500">{candidate.currentClub}</span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={handleAsk}
              className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1"
            >
              Ask to vouch
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
