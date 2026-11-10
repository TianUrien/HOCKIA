import { useEffect, useState } from 'react'
import { MailOpen, Mail, Trash2 } from 'lucide-react'
import { ActionSheet } from '@/components/ui/ActionSheet'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { hapticLight } from '@/lib/haptics'
import { firstNameOf } from '@/lib/invites'

export interface ConversationActionTarget {
  id: string
  name: string
  unread: boolean
}

interface ConversationActionsSheetProps {
  target: ConversationActionTarget | null
  onClose: () => void
  onToggleUnread: (id: string, unread: boolean) => void | Promise<unknown>
  onDelete: (id: string) => Promise<unknown>
  /** Open straight on the delete confirmation (swipe → Delete). */
  confirmDeleteOnly?: boolean
}

/**
 * Press-and-hold menu for a conversation (Inbox rows, desktop list, chat
 * header): Mark as unread / Mark as read, and Delete conversation behind a
 * confirmation that says exactly what happens on each side.
 */
export function ConversationActionsSheet({ target, onClose, onToggleUnread, onDelete, confirmDeleteOnly = false }: ConversationActionsSheetProps) {
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
            ? { key: 'read', label: 'Mark as read', icon: <MailOpen className="h-5 w-5" />, onSelect: () => void onToggleUnread(target.id, false), testId: 'conversation-mark-read' }
            : { key: 'unread', label: 'Mark as unread', icon: <Mail className="h-5 w-5" />, onSelect: () => void onToggleUnread(target.id, true), testId: 'conversation-mark-unread' },
          { key: 'delete', label: 'Delete conversation', icon: <Trash2 className="h-5 w-5" />, tone: 'danger', onSelect: () => setConfirming(target), testId: 'conversation-delete' },
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
        title="Delete this conversation?"
        message={`It's removed from your inbox and the messages are cleared for you. ${first} still has the conversation, and if they write again it comes back with only the new messages.`}
        confirmLabel="Delete"
        busyLabel="Deleting…"
        testId="conversation-delete-confirm"
      />
    </>
  )
}
