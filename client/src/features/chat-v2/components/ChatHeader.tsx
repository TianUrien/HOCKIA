import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft } from 'lucide-react'
import Avatar from '@/components/Avatar'
import RoleBadge from '@/components/RoleBadge'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { supabase } from '@/lib/supabase'
import { getImageUrl } from '@/lib/imageUrl'
import { humanizeToken, identityLine } from '@/lib/identity'
import { getSpecializationLabel } from '@/lib/coachSpecializations'
import type { ConversationParticipant } from '@/types/chat'
import { cn } from '@/lib/utils'

interface ChatHeaderProps {
  participant?: ConversationParticipant
  onBack: () => void
  /** Label beside the chevron on phones — "Inbox", or where the chat was opened from. */
  backLabel?: string
  profilePath: string | null
  isMobile: boolean
}

const fallbackName = 'HOCKIA Member'

type Detail = { line: string; active: boolean }
const detailCache = new Map<string, Detail>()

/** "Club · Serie A1 · active today" — the role line as everywhere else in the
 *  app; "active today" only when the member shows their activity
 *  (show_last_active). One small read per participant per session. */
function useParticipantDetail(participant: ConversationParticipant | undefined): Detail | null {
  const id = participant?.id ?? null
  const [detail, setDetail] = useState<Detail | null>(() => (id ? detailCache.get(id) ?? null : null))
  useEffect(() => {
    if (!id) return
    const hit = detailCache.get(id)
    if (hit) { setDetail(hit); return }
    let cancelled = false
    void supabase
      .from('profiles')
      .select('role, position, coach_specialization, coach_specialization_custom, mens_league_division, womens_league_division, umpire_level, last_active_at, show_last_active')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return
        const role = data.role
        const extra =
          role === 'player' ? humanizeToken(data.position) :
          role === 'coach' ? (data.coach_specialization ? getSpecializationLabel(data.coach_specialization, data.coach_specialization_custom) : null) :
          role === 'club' ? (data.womens_league_division || data.mens_league_division || null) :
          role === 'umpire' ? data.umpire_level : null
        const active = Boolean(data.show_last_active && data.last_active_at && Date.now() - new Date(data.last_active_at).getTime() < 86_400_000)
        const next = { line: identityLine(role, extra), active }
        detailCache.set(id, next)
        setDetail(next)
      })
    return () => { cancelled = true }
  }, [id])
  return detail
}

export function ChatHeader({ participant, onBack, backLabel = 'Inbox', profilePath, isMobile }: ChatHeaderProps) {
  const participantName = participant?.full_name || participant?.username || fallbackName
  const initials = participant?.full_name?.charAt(0).toUpperCase() || 'P'
  const detail = useParticipantDetail(participant)

  if (isMobile) {
    // Figma Chat (100:636): "‹ Inbox" in purple, 32px avatar (clubs squared),
    // 15/semibold name, 12px role line, hairline below.
    const roleLine = [detail?.line ?? identityLine(participant?.role), detail?.active ? 'active today' : null].filter(Boolean).join(' · ')
    const avatar = participant?.avatar_url ? getImageUrl(participant.avatar_url, 'avatar-sm') ?? participant.avatar_url : null
    const identity = (
      <>
        <EntityAvatar src={avatar} name={participantName} role={participant?.role} size={32} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-row font-semibold text-ink-1">{participantName}</span>
          <span className="block truncate text-caption text-ink-2">{roleLine}</span>
        </span>
      </>
    )
    return (
      <header className="relative flex h-[52px] flex-shrink-0 items-center gap-2 border-b border-line bg-white pl-2 pr-4" data-testid="chat-header">
        <button type="button" onClick={onBack} aria-label={`Back to ${backLabel}`} className="flex h-11 items-center pr-1 text-body text-hockia-primary">
          <span className="flex h-11 w-9 items-center justify-center"><ChevronLeft className="h-6 w-6" strokeWidth={2} /></span>
          <span className="max-w-[72px] truncate">{backLabel}</span>
        </button>
        {profilePath ? (
          <Link to={profilePath} className="flex min-w-0 flex-1 items-center gap-2.5" aria-label={`View ${participantName} profile`}>{identity}</Link>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2.5">{identity}</div>
        )}
      </header>
    )
  }

  const headerContents = (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        {profilePath ? (
          <Link
            to={profilePath}
            className="max-w-[200px] truncate text-base font-semibold text-gray-900 transition hover:text-purple-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 sm:max-w-[280px]"
          >
            {participantName}
          </Link>
        ) : (
          <h2 className="max-w-[200px] truncate text-base font-semibold text-gray-900 sm:max-w-[280px]">{participantName}</h2>
        )}
        <RoleBadge role={participant?.role ?? 'member'} className="text-xs flex-shrink-0" />
      </div>
    </div>
  )

  return (
    <header className={cn('relative flex h-16 flex-shrink-0 items-center gap-3 border-b border-gray-200 bg-white py-3 text-left', 'px-4 md:px-5')}>
      {isMobile && (
        <button type="button" onClick={onBack} className="-ml-1 rounded-full p-2 transition-colors hover:bg-gray-100" aria-label="Back to conversations">
          <ArrowLeft className="h-5 w-5 text-gray-700" />
        </button>
      )}
      {profilePath ? (
        <Link to={profilePath} className="flex-shrink-0 rounded-full" aria-label={`View ${participantName} profile`}>
          <Avatar src={participant?.avatar_url || undefined} alt={participantName} initials={initials} className="h-10 w-10 text-base ring-2 ring-gray-100" enablePreview={false} role={participant?.role} />
        </Link>
      ) : (
        <Avatar src={participant?.avatar_url || undefined} alt={participantName} initials={initials} className="h-10 w-10 text-base ring-2 ring-gray-100" enablePreview={false} role={participant?.role} />
      )}
      {headerContents}
    </header>
  )
}
