import { ReportSheet } from '@/components/safety/ReportSheet'

interface ReportUserModalProps {
  /** The profile ID of the user being reported (or author of the content) */
  targetId: string
  /** Kept for existing callers; the sheet never names the reported person. */
  targetName?: string
  /** What type of content is being reported */
  contentType?: 'user' | 'post' | 'comment'
  /** The ID of the specific content being reported (post_id or comment_id) */
  contentId?: string
  onClose: () => void
}

/**
 * Mount-to-open wrapper around the one report sheet (components/safety/
 * ReportSheet), for callers that render it conditionally.
 */
export default function ReportUserModal({ targetId, contentType = 'user', contentId, onClose }: ReportUserModalProps) {
  const subject = contentType === 'post' ? 'post' : contentType === 'comment' ? 'comment' : 'profile'
  return <ReportSheet open onClose={onClose} targetId={targetId} subject={subject} contentId={contentId} />
}
