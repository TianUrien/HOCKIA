import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { blockMember } from '@/lib/blockMember'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { useInboxT } from '@/i18n/ns/inbox'

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
  const t = useInboxT()
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
          addToast(t('safety.block.blocked', { name: target.name }), 'success')
          onBlocked?.(target)
        } catch (err) {
          logger.error('[BlockMemberSheet] block failed', err)
          addToast(t('safety.block.failed'), 'error')
          throw err
        }
      }}
      title={target ? t('safety.block.title', { name: target.name }) : t('safety.block.titleNoName')}
      message={t('safety.block.message')}
      confirmLabel={t('safety.block.confirm')}
      busyLabel={t('safety.block.busy')}
      testId="block-member-confirm"
      initialFocus="panel"
    />
  )
}
