import { useState } from 'react'
import { Flag } from 'lucide-react'
import { ReportSheet } from './ReportSheet'
import type { MoreMenuItem } from './MoreMenu'
import { MENU_ICON_CLASS, REPORT_MENU_LABEL, type ReportSubject } from '@/lib/report'

/**
 * The "Report" item for a "…" menu plus the sheet it opens. Callers put
 * `item` in their menu and render `sheet` once.
 */
export function useReportAction(o: { targetId: string | null | undefined; subject: ReportSubject; contentId?: string | null }) {
  const [open, setOpen] = useState(false)
  const item: MoreMenuItem = {
    key: 'report',
    label: REPORT_MENU_LABEL,
    icon: <Flag className={MENU_ICON_CLASS} strokeWidth={1.8} />,
    onSelect: () => setOpen(true),
  }
  const sheet = o.targetId ? (
    <ReportSheet open={open} onClose={() => setOpen(false)} targetId={o.targetId} subject={o.subject} contentId={o.contentId} />
  ) : null
  return { item, sheet, open: () => setOpen(true) }
}
