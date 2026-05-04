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
  /** Owner's role — drives copy. Without it, the card always says
   *  "clubs scouting on HOCKIA" which leaks recruitment-flavored language
   *  to umpires (a trust-and-appointment role, not a recruitment one). */
  profileRole?: string | null
}

const DISMISS_KEY_PREFIX = 'hockia-recently-connected-dismiss:'
const LEGACY_CLEANUP_FLAG = 'hockia-recently-connected-cleanup-v1'
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000
const DEFAULT_WINDOW_DAYS = 14

function getDismissKey(ownerId: string, friendId: string): string {
  // Scope the key by owner — otherwise dismissals leak across sign-ins on
  // shared browsers. Format: hockia-recently-connected-dismiss:<owner>:<friend>
  return `${DISMISS_KEY_PREFIX}${ownerId}:${friendId}`
}

/**
 * One-shot cleanup of legacy unscoped dismiss keys from before the owner-id
 * scoping fix. Format used to be `hockia-recently-connected-dismiss:<friendId>`
 * (one colon, no owner). Those keys are dead after the migration but persist
 * in localStorage forever. Sweep them on first mount of the post-fix code,
 * then set a flag so we don't iterate again on every render.
 *
 * Cheap (one localStorage scan per browser, ever) and prevents indefinite
 * key accumulation. Scoped keys (two colons) are kept.
 */
function cleanupLegacyDismissKeys(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    if (window.localStorage.getItem(LEGACY_CLEANUP_FLAG)) return
    const toDelete: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (!key || !key.startsWith(DISMISS_KEY_PREFIX)) continue
      // Legacy format had exactly ONE colon after the prefix (separator
      // before the friendId). New format has two: prefix:owner:friend.
      const tail = key.slice(DISMISS_KEY_PREFIX.length)
      if (!tail.includes(':')) toDelete.push(key)
    }
    toDelete.forEach((k) => window.localStorage.removeItem(k))
    window.localStorage.setItem(LEGACY_CLEANUP_FLAG, '1')
  } catch (err) {
    logger.error('[RecentlyConnectedCard] legacy key cleanup failed', err)
  }
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
  profileRole,
}: RecentlyConnectedCardProps) {
  // Per-role rationale for the reference-ask. Default (player/coach) leans on
  // recruitment trust; umpire framing is peer/assigner trust; brand framing
  // is partnership trust. The card is owner-only so this is "what reads true
  // for me as I read it on my own dashboard."
  const rationaleByRole: Record<string, string> = {
    umpire:
      'References from coaches, fellow umpires and clubs appear on your profile and help assigners and clubs trust your background.',
    brand:
      'References from athletes, clubs and partners appear on your profile and help the community trust your brand.',
  }
  const defaultRationale =
    'References from coaches, teammates and clubs appear on your profile and help clubs scouting on HOCKIA trust your background.'
  const rationaleCopy = profileRole && rationaleByRole[profileRole]
    ? rationaleByRole[profileRole]
    : defaultRationale
  // Track which friend ids have been dismissed in this session so the card
  // visibly drops off when the user taps the X (or Ask) without waiting for
  // a refetch. Reset only when the owner identity changes — resetting on
  // every friendOptions reference would clobber a just-dismissed-this-render
  // friend the moment useReferenceFriendOptions re-fetches.
  const [sessionDismissed, setSessionDismissed] = useState<Set<string>>(new Set())

  useEffect(() => {
    setSessionDismissed(new Set())
  }, [ownerProfileId])

  // Run the legacy-key cleanup once per browser session.
  useEffect(() => {
    cleanupLegacyDismissKeys()
  }, [])

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
        // Skip friends whose display name fell back to the generic
        // "HOCKIA Member" placeholder (set by useReferenceFriendOptions /
        // FriendsTab when full_name AND username are both null). The card
        // would otherwise read "Ask HOCKIA for a reference?" — confusing
        // and unbranded. These are rare orphan profiles; better to skip.
        if (!f.fullName || f.fullName === 'HOCKIA Member') return false
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
    // Session-only dismiss so the same candidate doesn't re-appear before
    // the dashboard's useTrustedReferences instance picks up the new pending
    // row (it's a separate hook instance from TrustedReferencesSection's and
    // does NOT refetch on mutation). We do NOT persist this dismissal:
    //   - if the user submits, the friend ends up in pendingReferences and
    //     gets filtered into excludeIds on the next mount → still hidden.
    //   - if the user cancels the modal or the submit errors out (rate
    //     limit, no-longer-friends, etc.), persisting would silently
    //     suppress the nudge for 14 days even though the user took no
    //     action. Keep the persistent X dismissal as the only durable
    //     "don't ask me about this person again" signal.
    setSessionDismissed((prev) => {
      const next = new Set(prev)
      next.add(candidate.id)
      return next
    })
    trackReferenceModalOpen('recently_connected')
    onAsk(candidate.id)
  }

  const firstName = candidate.fullName?.split(' ')[0] || candidate.fullName || 'them'
  const acceptedAtMs = candidate.acceptedAt ? Date.parse(candidate.acceptedAt) : null
  const daysSinceConnected =
    acceptedAtMs && !Number.isNaN(acceptedAtMs)
      ? Math.max(0, Math.floor((Date.now() - acceptedAtMs) / (24 * 60 * 60 * 1000)))
      : null
  const connectedLabel =
    daysSinceConnected === null
      ? 'Recently connected'
      : daysSinceConnected === 0
        ? 'Connected today'
        : daysSinceConnected === 1
          ? 'Connected yesterday'
          : `Connected ${daysSinceConnected} days ago`

  return (
    <div className="relative rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/80 via-white to-emerald-50/40 p-4 sm:p-5 shadow-sm">
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss this nudge"
        // 44x44 minimum tap target (Apple HIG); icon stays visually small
        // via the inner span. p-1.5 alone gave ~28px which fails accessibility
        // and is hard to hit on mobile with a thumb.
        className="absolute top-1 right-1 inline-flex h-11 w-11 items-center justify-center rounded-full text-emerald-700/60 hover:text-emerald-900 hover:bg-emerald-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-start gap-3 pr-8">
        <div className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-full bg-emerald-100 text-emerald-700">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            {connectedLabel}
          </p>
          <p className="mt-1 text-sm font-semibold text-gray-900">
            Ask {firstName} for a reference?
          </p>
          <p className="mt-1 text-xs text-gray-600">{rationaleCopy}</p>

          <div className="mt-3 flex items-center gap-3 rounded-lg border border-emerald-100 bg-white/80 p-2.5">
            <Avatar
              src={candidate.avatarUrl}
              alt={candidate.fullName}
              initials={candidate.fullName.slice(0, 2)}
              size="sm"
              role={candidate.role}
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
