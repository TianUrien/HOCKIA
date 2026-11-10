import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { blockMember } from '@/lib/blockMember'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'

export interface BlockTarget {
  id: string
  name: string
}

interface BlockMemberSheetProps {
  target: BlockTarget | null
  onClose: () => void
  /** After the block succeeded (leave the chat, drop the row…). */
  onBlocked?: (target: BlockTarget) => void
}

/**
 * "Block <name>?" where the contact happens (founder 2026-11-10): the chat
 * "…" menu, a conversation's press-and-hold menu and the end of a report.
 * Blocking used to be reachable only from the person's profile, so someone
 * being pestered had to leave the chat to find it. Same server action as
 * everywhere else (block_user via lib/blockMember); the other person is
 * never told.
 */
export function BlockMemberSheet({ target, onClose, onBlocked }: BlockMemberSheetProps) {
  const viewerId = useAuthStore((s) => s.user?.id ?? null)
  const addToast = useToastStore((s) => s.addToast)

  return (
    <ConfirmSheet
      open={Boolean(target)}
      onClose={onClose}
      onConfirm={async () => {
        if (!target || !viewerId) return
        try {
          await blockMember(viewerId, target.id)
          addToast(`${target.name} has been blocked`, 'success')
          onBlocked?.(target)
        } catch (err) {
          logger.error('[BlockMemberSheet] block failed', err)
          addToast('Could not block. Please try again.', 'error')
          throw err
        }
      }}
      title={target ? `Block ${target.name}?` : 'Block'}
      message="They can't message you or see your profile and posts, and you won't see theirs. Your conversation leaves your inbox. They aren't told. You can unblock them in Settings."
      confirmLabel="Block"
      busyLabel="Blocking…"
      testId="block-member-confirm"
      initialFocus="panel"
    />
  )
}
