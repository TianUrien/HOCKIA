import { Shield, X } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Avatar from '@/components/Avatar'
import { useAuthStore } from '@/lib/auth'
import { recordReferenceNudgeDismiss } from '@/lib/referenceNudgeDismissal'
import { profilePath } from '@/lib/profileNavigation'
import type { PulseItem } from '@/hooks/useMyPulse'

/**
 * FriendshipReferencePulseCard — Loop Layer L1 (v5 plan).
 *
 * Fires when the owner accepts a friendship with a non-test, non-blocked
 * peer who isn't already in an active reference pair. Prompts the owner
 * to ask the new friend for a vouch. Trigger-driven (server-side), 7-day
 * per-user frequency cap.
 *
 * Tap "Ask to vouch" → navigates to the owner's own Friends tab with
 * `?section=references&ask=<friend_id>`, the same deep-link
 * RecentlyConnectedCard uses. Action_completed is stamped optimistically
 * here; the actual reference-request submission lives in the references
 * flow downstream.
 */

interface FriendshipReferencePulseCardProps {
  item: PulseItem
  onClick: (id: string) => void
  onDismiss: (id: string) => void
}

function readString(metadata: PulseItem['metadata'], key: string): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function firstName(fullName: string | null): string {
  if (!fullName) return 'them'
  const trimmed = fullName.trim()
  if (!trimmed) return 'them'
  return trimmed.split(/\s+/)[0]
}

export function FriendshipReferencePulseCard({
  item,
  onClick,
  onDismiss,
}: FriendshipReferencePulseCardProps) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const profile = useAuthStore((state) => state.profile)

  const friendId = readString(item.metadata, 'friend_id')
  const friendName = readString(item.metadata, 'friend_name')
  const friendAvatar = readString(item.metadata, 'friend_avatar_url')

  // Defensive: if metadata is malformed, render nothing rather than a
  // broken card. PulseSection's known-types filter still marks the row
  // seen so it doesn't re-fire mark-seen forever.
  if (!friendId) return null

  const handleAsk = () => {
    onClick(item.id)
    // Suppress the same friend on RecentlyConnectedCard so the user
    // doesn't see the prompt twice once they've actioned it from Pulse.
    if (profile?.id) recordReferenceNudgeDismiss(profile.id, friendId)
    // Deep-link to the owner's Friends tab → references section, with the
    // friend pre-selected. Same URL shape RecentlyConnectedCard's onAsk
    // uses on the dashboards.
    const path = profilePath(profile?.role, profile?.username, profile?.id)
    if (!path) return
    const next = new URLSearchParams(searchParams)
    next.set('tab', 'friends')
    next.set('section', 'references')
    next.set('ask', friendId)
    navigate(`${path}?${next.toString()}`)
  }

  const handleDismiss = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    // Mirror dismissal to the dashboard surface (RecentlyConnectedCard
    // reads from the same localStorage key) so the user isn't pestered
    // about the same connection in two places.
    if (profile?.id) recordReferenceNudgeDismiss(profile.id, friendId)
    onDismiss(item.id)
  }

  const subtitle = friendName
    ? `Ask ${firstName(friendName)} to vouch for you. References from connections build trust fast.`
    : 'Ask your new connection to vouch for you. References from connections build trust fast.'

  return (
    <article
      className="relative rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm"
      data-testid="pulse-friendship-reference-opportunity"
    >
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute top-3 right-3 p-1 text-gray-400 hover:text-gray-600 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <Avatar
          src={friendAvatar}
          alt={friendName ?? 'New connection'}
          initials={friendName?.slice(0, 2) ?? '??'}
          size="md"
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            New connection
          </p>
          <p className="text-sm font-semibold text-gray-900 mt-0.5">
            {friendName ? `Ask ${firstName(friendName)} for a reference?` : 'Ask your new connection for a reference?'}
          </p>
          <p className="text-xs text-gray-600 mt-1 leading-relaxed">{subtitle}</p>
          <button
            type="button"
            onClick={handleAsk}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
          >
            <Shield className="w-3 h-3" aria-hidden="true" />
            Ask to vouch
          </button>
        </div>
      </div>
    </article>
  )
}
