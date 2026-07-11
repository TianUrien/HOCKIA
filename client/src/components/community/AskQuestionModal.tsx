/**
 * AskQuestionModal
 * 
 * Modal dialog for creating a new question.
 */

import { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { QUESTION_CATEGORIES, CATEGORY_LABELS } from '@/types/questions'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import type { QuestionCategory, CreateQuestionInput } from '@/types/questions'

interface AskQuestionModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (input: CreateQuestionInput) => Promise<boolean>
  isSubmitting?: boolean
}

export function AskQuestionModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting = false,
}: AskQuestionModalProps) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState<QuestionCategory>('other')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useFocusTrap({ containerRef: dialogRef, isActive: isOpen, initialFocusRef: titleInputRef })

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setTitle('')
      setBody('')
      setCategory('other')
    }
  }, [isOpen])

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!title.trim()) return

    const success = await onSubmit({
      title: title.trim(),
      body: body.trim() || undefined,
      category,
    })

    if (success) {
      onClose()
    }
  }

  const titleLength = title.length
  const bodyLength = body.length
  const isTitleValid = titleLength > 0 && titleLength <= 120
  const isBodyValid = bodyLength <= 1500

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          ref={dialogRef}
          className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl transform transition-all focus:outline-none"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          tabIndex={-1}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-100">
            <h2 id="modal-title" className="text-xl font-semibold text-gray-900">
              Ask a Question
            </h2>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-gray-100 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Title */}
            <div>
              <label htmlFor="question-title" className="block text-sm font-medium text-gray-700 mb-1.5">
                Your Question <span className="text-red-500">*</span>
              </label>
              <input
                ref={titleInputRef}
                id="question-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., How do I find trials abroad?"
                maxLength={120}
                autoCapitalize="sentences"
                spellCheck
                className={`w-full px-4 py-3 rounded-lg border transition-colors ${
                  titleLength > 120
                    ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                    : 'border-gray-300 focus:border-purple-500 focus:ring-purple-500'
                } focus:outline-none focus:ring-2 focus:ring-opacity-50`}
                required
              />
              <div className="flex justify-end mt-1">
                <span className={`text-xs ${titleLength > 120 ? 'text-red-500' : 'text-gray-400'}`}>
                  {titleLength}/120
                </span>
              </div>
            </div>

            {/* Category */}
            <div>
              <label htmlFor="question-category" className="block text-sm font-medium text-gray-700 mb-1.5">
                Category
              </label>
              <select
                id="question-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as QuestionCategory)}
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-purple-500 focus:ring-purple-500 focus:outline-none focus:ring-2 focus:ring-opacity-50 bg-white"
              >
                {QUESTION_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </div>

            {/* Body (optional) */}
            <div>
              <label htmlFor="question-body" className="block text-sm font-medium text-gray-700 mb-1.5">
                Additional Details <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                id="question-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Add any context that might help others understand your question better..."
                rows={4}
                maxLength={1500}
                autoCapitalize="sentences"
                spellCheck
                className={`w-full px-4 py-3 rounded-lg border transition-colors resize-none ${
                  bodyLength > 1500
                    ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                    : 'border-gray-300 focus:border-purple-500 focus:ring-purple-500'
                } focus:outline-none focus:ring-2 focus:ring-opacity-50`}
              />
              <div className="flex justify-end mt-1">
                <span className={`text-xs ${bodyLength > 1500 ? 'text-red-500' : 'text-gray-400'}`}>
                  {bodyLength}/1,500
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-lg text-gray-700 font-medium hover:bg-gray-100 transition-colors"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!isTitleValid || !isBodyValid || isSubmitting}
                className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-hockia-primary to-hockia-secondary text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Posting...
                  </>
                ) : (
                  'Post Question'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
