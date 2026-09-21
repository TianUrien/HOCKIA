import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Check, Sparkles, X } from 'lucide-react'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'

interface ApplicationSentProps {
  clubName: string
  clubLogo: string | null
  publisherRole: string | null | undefined
  onClose: () => void
}

/**
 * Application sent (Figma 115:865): a confirmation that sets an expectation
 * and uses the moment for the one action that raises reply rate — a full
 * match video. Secondary button goes back to roles; most players apply to
 * more than one.
 */
export function ApplicationSent({ clubName, clubLogo, publisherRole, onClose }: ApplicationSentProps) {
  const navigate = useNavigate()
  useBodyScrollLock(true)
  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[10001] flex flex-col bg-white pt-[env(safe-area-inset-top)]" role="dialog" aria-modal="true" aria-label="Application sent">
      <div className="flex h-11 items-center px-2">
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full text-ink-1">
          <X className="h-6 w-6" strokeWidth={1.8} />
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center gap-4 px-8 pt-16 text-center">
        <span className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-positive-soft text-positive">
          <Check className="h-10 w-10" strokeWidth={2.5} />
        </span>
        <h1 className="text-[28px] font-bold leading-[34px] text-ink-1">Application sent</h1>
        <EntityAvatar src={clubLogo} name={clubName} role={publisherRole ?? 'club'} size={64} />
        <p className="text-row text-ink-2">
          {clubName} has your profile, career and highlights. Their answer arrives in your Inbox.
        </p>
        <button
          type="button"
          onClick={() => { onClose(); navigate('/dashboard/profile/media') }}
          className="flex w-full items-start gap-2.5 rounded-card bg-surface-grouped px-3.5 py-3 text-left"
        >
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-hockia-primary" strokeWidth={1.8} />
          <span className="text-secondary text-ink-2">Add a full match video now — it is the first thing clubs ask applicants for.</span>
        </button>
      </div>
      <div className="flex flex-col gap-2.5 px-5 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2">
        <button
          type="button"
          onClick={() => { onClose(); navigate('/opportunities/applications') }}
          className="flex h-[52px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white"
        >
          View my applications
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-[52px] w-full items-center justify-center rounded-full bg-surface-grouped text-body font-semibold text-ink-1"
        >
          Back to roles
        </button>
      </div>
    </div>,
    document.body,
  )
}
