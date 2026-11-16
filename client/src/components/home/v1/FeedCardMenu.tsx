import { useState } from 'react'
import { MoreMenu, type MoreMenuItem } from '@/components/safety/MoreMenu'
import { ReportSheet } from '@/components/safety/ReportSheet'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { blockMember } from '@/lib/blockMember'
import { canReport, type ReportSubject } from '@/lib/report'
import { getShareOrigin } from '@/lib/profileShare'
import { logger } from '@/lib/logger'
import { useHomeT } from '@/i18n/ns/home'

/**
 * ⋯ on EVERY feed card (Figma H10; App Store 1.2 / Play UGC): Share post ·
 * Copy link · Report post · Block <author> · Cancel. The tagged member of a
 * New signing gets "Remove my tag" instead of Block (H16); the author gets
 * their own actions (delete) instead of Report / Block.
 */
interface FeedCardMenuProps {
  authorId: string | null
  authorName: string | null
  /** Path for Share / Copy link, e.g. /post/<id>. */
  sharePath: string
  report?: { subject: ReportSubject; contentId: string | null }
  /** The viewer is the tagged member of this signing (H16). */
  onRemoveTag?: () => void
  /** Author-only actions, e.g. Delete post. */
  ownerItems?: MoreMenuItem[]
  /** Open the app share sheet (send in chat …); falls back to the system share. */
  onShare?: () => void
}

export function FeedCardMenu({ authorId, authorName, sharePath, report, onRemoveTag, ownerItems = [], onShare }: FeedCardMenuProps) {
  const t = useHomeT()
  const viewerId = useAuthStore((s) => s.user?.id ?? null)
  const addToast = useToastStore((s) => s.addToast)
  const [reporting, setReporting] = useState(false)
  const [confirmBlock, setConfirmBlock] = useState(false)
  const isOwner = Boolean(viewerId && authorId && viewerId === authorId)
  const url = `${getShareOrigin()}${sharePath}`
  const name = authorName || t('cardMenu.fallbackName')

  const share = async () => {
    if (onShare) { onShare(); return }
    try {
      if (navigator.share) { await navigator.share({ url }); return }
    } catch { /* dismissed */ return }
    await copy()
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      addToast(t('cardMenu.linkCopied'), 'success')
    } catch {
      addToast(t('cardMenu.copyFailed'), 'error')
    }
  }
  const block = async () => {
    setConfirmBlock(false)
    if (!viewerId || !authorId) return
    try {
      await blockMember(viewerId, authorId)
      addToast(t('cardMenu.blockedToast', { name }), 'success')
    } catch (err) {
      logger.error('[FeedCardMenu] block failed', err)
      addToast(t('cardMenu.blockFailed'), 'error')
    }
  }

  const items: MoreMenuItem[] = [
    { key: 'share', label: t('cardMenu.share'), onSelect: () => void share() },
    { key: 'copy', label: t('cardMenu.copyLink'), onSelect: () => void copy() },
  ]
  if (isOwner) {
    items.push(...ownerItems)
  } else if (viewerId) {
    if (onRemoveTag) {
      items.push({
        key: 'untag',
        label: t('cardMenu.removeTag'),
        description: t('cardMenu.removeTagHint'),
        destructive: true,
        onSelect: onRemoveTag,
      })
    }
    if (report && canReport(viewerId, authorId)) {
      items.push({ key: 'report', label: t('cardMenu.report'), destructive: true, onSelect: () => setReporting(true) })
    }
    if (authorId && !onRemoveTag) {
      items.push({ key: 'block', label: t('cardMenu.block', { name }), destructive: true, onSelect: () => setConfirmBlock(true) })
    }
  }

  return (
    <>
      <MoreMenu
        items={items}
        label={t('cardMenu.menuLabel')}
        triggerClassName="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-1 transition-colors hover:bg-surface-muted"
        iconClassName="h-[22px] w-[22px]"
        testId="feed-card-menu"
      />
      {reporting && authorId && report && (
        <ReportSheet open onClose={() => setReporting(false)} targetId={authorId} subject={report.subject} contentId={report.contentId ?? undefined} />
      )}
      <ConfirmDialog
        isOpen={confirmBlock}
        onClose={() => setConfirmBlock(false)}
        onConfirm={block}
        title={t('cardMenu.blockTitle', { name })}
        message={t('cardMenu.blockBody')}
        confirmLabel={t('cardMenu.blockConfirm')}
        variant="danger"
        testId="feed-card-block-confirm"
      />
    </>
  )
}
