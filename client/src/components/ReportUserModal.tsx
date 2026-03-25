import { useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

const REPORT_CATEGORIES = [
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'spam', label: 'Spam or scam' },
  { value: 'inappropriate_content', label: 'Inappropriate content' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'hate_speech', label: 'Hate speech' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'misinformation', label: 'Misinformation' },
  { value: 'other', label: 'Other' },
] as const

interface ReportUserModalProps {
  /** The profile ID of the user being reported (or author of the content) */
  targetId: string
  targetName: string
  /** What type of content is being reported */
  contentType?: 'user' | 'post' | 'comment'
  /** The ID of the specific content being reported (post_id or comment_id) */
  contentId?: string
  onClose: () => void
}

export default function ReportUserModal({ targetId, targetName, contentType = 'user', contentId, onClose }: ReportUserModalProps) {
  const [category, setCategory] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const label = contentType === 'post' ? 'Post' : contentType === 'comment' ? 'Comment' : 'User'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!category || !reason.trim()) return

    setLoading(true)
    setError('')

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcError } = await (supabase as any).rpc('report_user', {
        p_target_id: targetId,
        p_reason: reason.trim(),
        p_category: category,
        p_content_type: contentType,
        p_content_id: contentId ?? null,
      })

      if (rpcError) throw rpcError

      setSubmitted(true)
    } catch (err) {
      logger.error('Failed to submit report:', err)
      setError('Failed to submit report. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900">Report {label}</h3>
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg transition-colors" aria-label="Close">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {submitted ? (
          <div className="p-6 text-center">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="font-semibold text-gray-900 mb-1">Report Submitted</p>
            <p className="text-sm text-gray-600 mb-4">
              Thank you for helping keep HOCKIA safe. Our team will review this report within 24 hours.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 bg-[#8026FA] text-white rounded-lg hover:bg-[#6b1fd4] transition-colors font-medium"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <p className="text-sm text-gray-600">
              {contentType === 'user' ? (
                <>Report <span className="font-semibold">{targetName}</span> for violating our community guidelines.</>
              ) : (
                <>Report this {contentType} by <span className="font-semibold">{targetName}</span> for violating our community guidelines.</>
              )}
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                required
                aria-label="Report category"
              >
                <option value="">Select a reason...</option>
                {REPORT_CATEGORIES.map(cat => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Details</label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Please describe what happened..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#8026FA] focus:border-transparent resize-none"
                rows={3}
                maxLength={1000}
                required
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !category || !reason.trim()}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {loading ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
