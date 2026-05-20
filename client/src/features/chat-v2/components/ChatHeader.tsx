import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Avatar from '@/components/Avatar'
import RoleBadge from '@/components/RoleBadge'
import type { ConversationParticipant } from '@/types/chat'
import { cn } from '@/lib/utils'

interface ChatHeaderProps {
  participant?: ConversationParticipant
  onBack: () => void
  profilePath: string | null
  isMobile: boolean
}

const fallbackName = 'HOCKIA Member'

export function ChatHeader({ participant, onBack, profilePath, isMobile }: ChatHeaderProps) {
  const participantName = participant?.full_name || participant?.username || fallbackName
  const initials = participant?.full_name?.charAt(0).toUpperCase() || 'P'
  // The window container owns the notch inset (padding-top), so the
  // header just needs its own vertical rhythm.
  const layoutClass = 'px-4 md:px-5'

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
    <header
      className={cn(
        // The window container owns positioning; the header is a normal
        // flex child, so it stays pinned to the top without fixed
        // positioning fighting the keyboard.
        'relative flex h-16 flex-shrink-0 items-center gap-3 border-b border-gray-200 bg-white py-3 text-left',
        layoutClass
      )}
    >
      {isMobile && (
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 rounded-full p-2 transition-colors hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
          aria-label="Back to conversations"
        >
          <ArrowLeft className="h-5 w-5 text-gray-700" />
        </button>
      )}
      {profilePath ? (
        <Link
          to={profilePath}
          className="flex-shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
          aria-label={`View ${participantName} profile`}
        >
          <Avatar
            src={participant?.avatar_url || undefined}
            alt={participantName}
            initials={initials}
            className="h-10 w-10 text-base ring-2 ring-gray-100"
            enablePreview={false}
            role={participant?.role}
          />
        </Link>
      ) : (
        <Avatar
          src={participant?.avatar_url || undefined}
          alt={participantName}
          initials={initials}
          className="h-10 w-10 text-base ring-2 ring-gray-100"
          enablePreview={false}
          role={participant?.role}
        />
      )}
      {headerContents}
    </header>
  )
}
