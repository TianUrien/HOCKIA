/**
 * AddPostModal
 *
 * Modal for creating or editing a brand post (announcement).
 * Supports optional image upload.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, ImagePlus, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { validateImage, optimizeImage } from '@/lib/imageOptimization'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import type { BrandPost, CreatePostInput, UpdatePostInput } from '@/hooks/useBrandPosts'

interface AddPostModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreatePostInput | UpdatePostInput, isEdit: boolean) => Promise<{ success: boolean; error?: string }>
  brandId: string
  editingPost?: BrandPost | null
}

const MAX_CONTENT_LENGTH = 1000
const BUCKET = 'brand-posts'

export function AddPostModal({
  isOpen,
  onClose,
  onSubmit,
  editingPost,
}: AddPostModalProps) {
  const { user } = useAuthStore()
  const isEdit = Boolean(editingPost)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useFocusTrap({ containerRef: dialogRef, isActive: isOpen })

  const [content, setContent] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Reset form when modal opens / editingPost changes
  useEffect(() => {
    if (!isOpen) return

    if (editingPost) {
      setContent(editingPost.content)
      setImageUrl(editingPost.image_url)
    } else {
      setContent('')
      setImageUrl(null)
    }

    setErrors({})
  }, [isOpen, editingPost])

  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    e.target.value = ''

    setIsUploading(true)
    setErrors(prev => { const n = { ...prev }; delete n.image; return n })

    try {
      const validation = validateImage(file, { maxFileSizeMB: 10 })
      if (!validation.valid) {
        throw new Error(validation.error)
      }

      const optimized = await optimizeImage(file, {
        maxWidth: 1200,
        maxHeight: 1200,
        maxSizeMB: 1,
        quality: 0.85,
      })

      const ext = optimized.type === 'image/png' ? 'png' : 'jpg'
      const random = Math.random().toString(36).slice(2, 8)
      const fileName = `${user.id}/${Date.now()}_${random}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(fileName, optimized, {
          contentType: optimized.type,
          upsert: false,
          cacheControl: '31536000',
        })

      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(fileName)

      setImageUrl(urlData.publicUrl)
    } catch (err) {
      logger.error('[AddPostModal] Image upload error:', err)
      setErrors(prev => ({
        ...prev,
        image: err instanceof Error ? err.message : 'Failed to upload image',
      }))
    } finally {
      setIsUploading(false)
    }
  }, [user])

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {}

    if (!content.trim()) {
      newErrors.content = 'Post content is required'
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      newErrors.content = `Content exceeds ${MAX_CONTENT_LENGTH} character limit`
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [content])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    setIsSubmitting(true)
    try {
      const submitData = {
        content: content.trim(),
        image_url: imageUrl ?? undefined,
      }

      const result = await onSubmit(submitData, isEdit)

      if (!result.success) {
        throw new Error(result.error || 'Failed to save post')
      }

      setContent('')
      setImageUrl(null)
      onClose()
    } catch (err) {
      logger.error('[AddPostModal] Submit error:', err)
      setErrors(prev => ({
        ...prev,
        submit: err instanceof Error ? err.message : 'Failed to save post',
      }))
    } finally {
      setIsSubmitting(false)
    }
  }, [content, imageUrl, validate, onSubmit, isEdit, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/50" onClick={onClose} />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-post-title"
          tabIndex={-1}
          className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto focus:outline-none"
        >
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <h2 id="add-post-title" className="text-xl font-semibold text-gray-900">
              {isEdit ? 'Edit Post' : 'Create Post'}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Submit error */}
            {errors.submit && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {errors.submit}
              </div>
            )}

            {/* Content */}
            <div>
              <label htmlFor="post-content" className="block text-sm font-medium text-gray-700 mb-1">
                What's new with your brand?
              </label>
              <textarea
                id="post-content"
                value={content}
                onChange={(e) => {
                  setContent(e.target.value)
                  setErrors(prev => { const n = { ...prev }; delete n.content; return n })
                }}
                placeholder="Share an update, announcement, or news..."
                rows={5}
                maxLength={MAX_CONTENT_LENGTH}
                autoCapitalize="sentences"
                spellCheck
                className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none ${
                  errors.content ? 'border-red-300' : 'border-gray-300'
                }`}
              />
              <div className="flex justify-between mt-1">
                {errors.content ? (
                  <p className="text-sm text-red-600">{errors.content}</p>
                ) : (
                  <span />
                )}
                <span className={`text-xs ${content.length > MAX_CONTENT_LENGTH - 100 ? 'text-amber-600' : 'text-gray-400'}`}>
                  {content.length}/{MAX_CONTENT_LENGTH}
                </span>
              </div>
            </div>

            {/* Image */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Image <span className="text-gray-400">(optional)</span>
              </label>

              {imageUrl ? (
                <div className="relative rounded-lg overflow-hidden bg-gray-100 group">
                  <img
                    src={imageUrl}
                    alt="Post image"
                    className="w-full max-h-[300px] object-cover"
                  />
                  <button
                    type="button"
                    aria-label="Remove image"
                    onClick={() => setImageUrl(null)}
                    className="absolute top-2 right-2 p-1.5 bg-black/60 rounded-full text-white hover:bg-black/80 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="w-full py-8 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors disabled:opacity-50"
                >
                  {isUploading ? (
                    <Loader2 className="w-6 h-6 animate-spin" />
                  ) : (
                    <>
                      <ImagePlus className="w-6 h-6" />
                      <span className="text-sm">Add an image</span>
                    </>
                  )}
                </button>
              )}

              {errors.image && (
                <p className="mt-1 text-sm text-red-600">{errors.image}</p>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png"
                onChange={handleImageUpload}
                className="hidden"
                aria-label="Upload post image"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting || isUploading}
              className="w-full py-2.5 px-4 bg-gradient-to-r from-hockia-primary to-hockia-secondary text-white rounded-lg font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSubmitting ? 'Posting...' : isEdit ? 'Save Changes' : 'Publish Post'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
