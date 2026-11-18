import { Lock } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import SignInPromptModal from '@/components/SignInPromptModal'
import { useMediaT } from '@/i18n/ns/media'

/**
 * What a video tile opens when it cannot play: guests get the one Join
 * sheet; members who are not a club or a coach get the reason the video
 * is locked (any recruiters-only video, not just full matches). "Recruiter"
 * = a club or a coach who recruits (SQL is_recruiter). Shared by the profile's Video rows and Videos — all.
 */
export type VideoBlock = 'join' | 'locked' | null

export function VideoAccessSheets({ block, firstName, onClose }: { block: VideoBlock; firstName: string | null; onClose: () => void }) {
  const t = useMediaT()
  return (
    <>
      <SignInPromptModal isOpen={block === 'join'} onClose={onClose} title={t('videoAccess.signInTitle')} action="view" />
      <BottomSheet open={block === 'locked'} onClose={onClose} ariaLabel={t('videoAccess.lockedLabel')}>
        <div className="px-5 pb-3 pt-1">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-grouped text-ink-1"><Lock className="h-5 w-5" strokeWidth={2} /></span>
          <h2 className="mt-3 text-title text-ink-1">{t('videoAccess.lockedTitle')}</h2>
          <p className="mt-1.5 text-row text-ink-2">{firstName ? t('videoAccess.lockedBodyNamed', { firstName }) : t('videoAccess.lockedBody')}</p>
          <button type="button" onClick={onClose} className="mt-5 flex h-[50px] w-full items-center justify-center rounded-full bg-surface-grouped text-body font-semibold text-ink-1">{t('videoAccess.ok')}</button>
        </div>
      </BottomSheet>
    </>
  )
}
