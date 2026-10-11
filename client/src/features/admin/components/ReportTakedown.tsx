import { useState } from 'react'
import { ExternalLink, User } from 'lucide-react'
import { profilePathForRole } from '@/lib/feedPaths'
import { formatAdminDateTime } from '../utils/formatDate'

/**
 * Admin reports — takedown (Figma A1 93:1013): the content preview line under
 * the reason, and the "Remove this …?" confirm. Backed by
 * admin_content_preview / admin_takedown_content / admin_restore_content
 * (20261011150700): removal hides it for everyone, resolves every report on
 * that target, and can be undone for 30 days.
 */
export interface ContentPreview {
  found: boolean
  author_id: string | null
  author_name: string | null
  author_avatar: string | null
  author_role: string | null
  excerpt: string
  context: 'post' | 'post_comment' | 'reference_comment' | 'profile_comment' | 'feed_item' | 'video'
  post_id: string | null
  context_profile_id: string | null
  context_profile_name: string | null
  context_profile_role: string | null
  report_count: number
  takedown_id: string | null
  removed_at: string | null
  removed_by_name: string | null
  restorable: boolean
}

const NOUN: Record<string, string> = {
  post: 'post',
  comment: 'comment',
  profile_comment: 'comment',
  feed_item: 'post',
  feed_item_comment: 'comment',
  video: 'video',
}

function contentNoun(type: string | null): string {
  return (type && NOUN[type]) || 'content'
}

function contextLine(p: ContentPreview): string {
  const owner = p.context_profile_name ? `${p.context_profile_name}’s` : 'a'
  switch (p.context) {
    case 'post_comment': return `on ${owner} post`
    case 'reference_comment': return `on ${owner} reference`
    case 'profile_comment': return `on ${owner} profile`
    case 'video': return 'video'
    case 'feed_item': return 'reference'
    default: return 'post'
  }
}

function contextPath(p: ContentPreview): string | null {
  if (p.post_id) return `/post/${p.post_id}`
  if (p.context_profile_id && p.context_profile_role) return profilePathForRole(p.context_profile_role as never, p.context_profile_id)
  return null
}

export function ContentPreviewLine({ preview, contentType }: { preview: ContentPreview; contentType: string | null }) {
  const removed = Boolean(preview.takedown_id)
  const path = contextPath(preview)
  return (
    <div className={`mt-2 flex items-center gap-2.5 rounded-lg border border-gray-200 px-3 py-2.5 text-sm ${removed ? 'bg-white text-gray-400' : 'bg-white text-gray-800'}`} data-testid="admin-report-preview">
      {preview.author_avatar ? (
        <img src={preview.author_avatar} alt="" className={`h-6 w-6 shrink-0 rounded-full object-cover ${removed ? 'opacity-50' : ''}`} />
      ) : (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-200"><User className="h-3 w-3 text-gray-500" /></span>
      )}
      <span className="min-w-0 flex-1 truncate">
        {removed ? (
          <>
            {contentNoun(contentType).replace(/^./, (c) => c.toUpperCase())} removed by admin
            {preview.removed_by_name ? ` · ${preview.removed_by_name}` : ''}
            {preview.removed_at ? ` · ${formatAdminDateTime(preview.removed_at)}` : ''}
          </>
        ) : (
          <>
            <span className="font-medium">{preview.author_name ?? 'Member'}</span>: “{preview.excerpt || '…'}” <span className="text-gray-500">{contextLine(preview)}</span>
          </>
        )}
      </span>
      {path && (
        <a href={path} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-violet-700 hover:underline">
          Open in context <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  )
}

export function TakedownConfirm({ contentType, reportCount, busy, onCancel, onConfirm }: {
  contentType: string | null
  reportCount: number
  busy: boolean
  onCancel: () => void
  onConfirm: (notifyAuthor: boolean) => void
}) {
  const [notify, setNotify] = useState(true)
  const noun = contentNoun(contentType)
  const reports = reportCount === 1 ? 'the report is' : `the ${reportCount} reports are`
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-labelledby="takedown-title">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h2 id="takedown-title" className="text-lg font-semibold text-gray-900">Remove this {noun}?</h2>
        <p className="mt-2 text-sm text-gray-600">
          It’s hidden for everyone right away, {reports} marked resolved and it can be restored for 30 days.
        </p>
        <label className="mt-4 flex items-center gap-2.5 text-sm text-gray-800">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 rounded accent-violet-700" />
          Notify the author (neutral notice, no reporter name)
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button
            type="button"
            onClick={() => onConfirm(notify)}
            disabled={busy}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            data-testid="admin-takedown-confirm"
          >
            Remove content
          </button>
        </div>
      </div>
    </div>
  )
}
