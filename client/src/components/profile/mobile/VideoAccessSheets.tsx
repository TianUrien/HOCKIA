import { Lock } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import SignInPromptModal from '@/components/SignInPromptModal'

/**
 * What a video tile opens when it cannot play: guests get the one Join
 * sheet; members who are not a club or a coach get the reason a full match
 * is locked. Shared by the profile's Video rows and Videos — all.
 */
export type VideoBlock = 'join' | 'locked' | null

export function VideoAccessSheets({ block, firstName, onClose }: { block: VideoBlock; firstName: string | null; onClose: () => void }) {
  return (
    <>
      <SignInPromptModal isOpen={block === 'join'} onClose={onClose} title="Sign in to watch videos" action="view" />
      <BottomSheet open={block === 'locked'} onClose={onClose} ariaLabel="Full matches are for clubs and coaches">
        <div className="px-5 pb-3 pt-1">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-grouped text-ink-1"><Lock className="h-5 w-5" strokeWidth={2} /></span>
          <h2 className="mt-3 text-title text-ink-1">For clubs &amp; coaches</h2>
          <p className="mt-1.5 text-row text-ink-2">{firstName ?? 'This player'} shares full matches with clubs and coaches only. Highlights and reels are open to everyone.</p>
          <button type="button" onClick={onClose} className="mt-5 flex h-[50px] w-full items-center justify-center rounded-full bg-surface-grouped text-body font-semibold text-ink-1">OK</button>
        </div>
      </BottomSheet>
    </>
  )
}
