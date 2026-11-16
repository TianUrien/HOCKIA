import { useEffect, useState } from 'react'
import { Ban, MailOpen, Mail, Trash2 } from 'lucide-react'
import { ActionSheet } from '@/components/ui/ActionSheet'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { hapticLight } from '@/lib/haptics'
import { firstNameOf } from '@/lib/invites'
import { useInboxT } from '@/i18n/ns/inbox'

export interface ConversationActionTarget {
  id: string
  name: string
  unread: boolean
  /** The other person, when the menu may offer to block them. */
  otherId?: string | null
}

interface ConversationActionsSheetProps {
  target: ConversationActionTarget | null
  onClose: () => void
  onToggleUnread: (id: string, unread: boolean) => void | Promise<unknown>
  onDelete: (id: string) => Promise<unknown>
  /** Open straight on the delete confirmation (swipe → Delete). */
  confirmDeleteOnly?: boolean
  /** "Block <name>": the caller shows the confirmation (BlockMemberSheet). */
  onBlock?: (target: ConversationActionTarget) => void
}

/**
 * Press-and-hold menu for a conversation (Inbox rows, desktop list, chat
 * header): Mark as unread / Mark as read, and Delete conversation behind a
 * confirmation that says exactly what happens on each side.
 */
export function ConversationActionsSheet({ target, onClose, onToggleUnread, onDelete, confirmDeleteOnly = false, onBlock }: ConversationActionsSheetProps) {
  const t = useInboxT()
  const [confirming, setConfirming] = useState<ConversationActionTarget | null>(null)

  useEffect(() => {
    if (target && confirmDeleteOnly) setConfirming(target)
  }, [target, confirmDeleteOnly])

  useEffect(() => {
    if (target && !confirmDeleteOnly) void hapticLight()
  }, [target, confirmDeleteOnly])

  const first = confirming ? firstNameOf(confirming.name, confirming.name) : ''

  return (
    <>
      <ActionSheet
        open={Boolean(target) && !confirmDeleteOnly}
        onClose={onClose}
        title={target?.name}
        testId="conversation-actions"
        items={target ? [
          target.unread
            ? { key: 'read', label: t('actions.markRead'), icon: <MailOpen className="h-5 w-5" />, onSelect: () => void onToggleUnread(target.id, false), testId: 'conversation-mark-read' }
            : { key: 'unread', label: t('actions.markUnread'), icon: <Mail className="h-5 w-5" />, onSelect: () => void onToggleUnread(target.id, true), testId: 'conversation-mark-unread' },
          ...(onBlock && target.otherId ? [{ key: 'block', label: t('actions.block', { name: target.name }), icon: <Ban className="h-5 w-5" />, tone: 'danger' as const, onSelect: () => onBlock(target), testId: 'conversation-block' }] : []),
          { key: 'delete', label: t('actions.delete'), icon: <Trash2 className="h-5 w-5" />, tone: 'danger', onSelect: () => setConfirming(target), testId: 'conversation-delete' },
        ] : []}
      />
      <ConfirmSheet
        open={Boolean(confirming)}
        onClose={() => {
          setConfirming(null)
          if (confirmDeleteOnly) onClose()
        }}
        onConfirm={async () => {
          if (!confirming) return
          const ok = await onDelete(confirming.id)
          if (ok === false) throw new Error('delete failed')
        }}
        title={t('actions.deleteConfirm.title')}
        message={t('actions.deleteConfirm.message', { name: first })}
        confirmLabel={t('actions.deleteConfirm.confirm')}
        busyLabel={t('actions.deleteConfirm.busy')}
        testId="conversation-delete-confirm"
        initialFocus="panel"
      />
    </>
  )
}
