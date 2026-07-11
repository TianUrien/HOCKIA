/**
 * AddProductModal
 *
 * Modal for creating or editing a brand product.
 * Supports image upload, draft persistence for new products, and URL auto-prepend.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { ProductImageUploader } from './ProductImageUploader'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import type { BrandProduct, ProductImage, CreateProductInput, UpdateProductInput } from '@/hooks/useBrandProducts'

interface AddProductModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreateProductInput | UpdateProductInput, isEdit: boolean) => Promise<{ success: boolean; error?: string }>
  brandId: string
  editingProduct?: BrandProduct | null
}

interface FormData {
  name: string
  description: string
  external_url: string
  images: ProductImage[]
}

const DRAFT_PREFIX = 'hockia_brand_product_draft_'
const LEGACY_DRAFT_PREFIX = 'playr_brand_product_draft_'

function migrateLegacyDraft(draftKey: string, legacyKey: string): void {
  try {
    const legacy = localStorage.getItem(legacyKey)
    if (legacy && !localStorage.getItem(draftKey)) {
      localStorage.setItem(draftKey, legacy)
    }
    if (legacy) {
      localStorage.removeItem(legacyKey)
    }
  } catch {
    // Ignore
  }
}

function getEmptyForm(): FormData {
  return { name: '', description: '', external_url: '', images: [] }
}

export function AddProductModal({
  isOpen,
  onClose,
  onSubmit,
  brandId,
  editingProduct,
}: AddProductModalProps) {
  const { user } = useAuthStore()
  const isEdit = Boolean(editingProduct)
  const draftKey = `${DRAFT_PREFIX}${brandId}`
  const legacyDraftKey = `${LEGACY_DRAFT_PREFIX}${brandId}`
  const dialogRef = useRef<HTMLDivElement>(null)

  useFocusTrap({ containerRef: dialogRef, isActive: isOpen })

  const [formData, setFormData] = useState<FormData>(() => {
    if (editingProduct) {
      return {
        name: editingProduct.name,
        description: editingProduct.description ?? '',
        external_url: editingProduct.external_url ?? '',
        images: editingProduct.images ?? [],
      }
    }

    // Try to load draft for new products
    migrateLegacyDraft(draftKey, legacyDraftKey)
    try {
      const saved = localStorage.getItem(draftKey)
      if (saved) return JSON.parse(saved) as FormData
    } catch { /* ignore */ }

    return getEmptyForm()
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Reset form when editingProduct changes
  useEffect(() => {
    if (!isOpen) return

    if (editingProduct) {
      setFormData({
        name: editingProduct.name,
        description: editingProduct.description ?? '',
        external_url: editingProduct.external_url ?? '',
        images: editingProduct.images ?? [],
      })
    } else {
      // Try load draft
      migrateLegacyDraft(draftKey, legacyDraftKey)
      try {
        const saved = localStorage.getItem(draftKey)
        if (saved) {
          setFormData(JSON.parse(saved) as FormData)
        } else {
          setFormData(getEmptyForm())
        }
      } catch {
        setFormData(getEmptyForm())
      }
    }

    setErrors({})
  }, [isOpen, editingProduct, draftKey, legacyDraftKey])

  // Save draft for new products
  useEffect(() => {
    if (isEdit || !isOpen) return
    try {
      localStorage.setItem(draftKey, JSON.stringify(formData))
    } catch { /* ignore */ }
  }, [formData, isEdit, isOpen, draftKey])

  const handleChange = useCallback((field: keyof FormData, value: string | ProductImage[]) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    setErrors(prev => {
      const next = { ...prev }
      delete next[field]
      return next
    })
  }, [])

  const handleUrlBlur = useCallback(() => {
    const url = formData.external_url.trim()
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      setFormData(prev => ({ ...prev, external_url: `https://${url}` }))
    }
  }, [formData.external_url])

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.name.trim()) {
      newErrors.name = 'Product name is required'
    }

    if (formData.images.length === 0) {
      newErrors.images = 'At least one image is required'
    }

    if (formData.description.length > 300) {
      newErrors.description = 'Description must be 300 characters or less'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [formData])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    setIsSubmitting(true)
    try {
      const submitData = {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        images: formData.images,
        external_url: formData.external_url.trim() || undefined,
      }

      const result = await onSubmit(submitData, isEdit)

      if (!result.success) {
        throw new Error(result.error || 'Failed to save product')
      }

      // Clear draft on success
      if (!isEdit) {
        try { localStorage.removeItem(draftKey) } catch { /* ignore */ }
      }

      setFormData(getEmptyForm())
      onClose()
    } catch (err) {
      logger.error('[AddProductModal] Submit error:', err)
      setErrors(prev => ({
        ...prev,
        submit: err instanceof Error ? err.message : 'Failed to save product',
      }))
    } finally {
      setIsSubmitting(false)
    }
  }, [formData, validate, onSubmit, isEdit, onClose, draftKey])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/50" onClick={onClose} />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-product-title"
          tabIndex={-1}
          className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto focus:outline-none"
        >
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <h2 id="add-product-title" className="text-xl font-semibold text-gray-900">
              {isEdit ? 'Edit Product' : 'Add Product'}
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

            {/* Images */}
            {user && (
              <div>
                <ProductImageUploader
                  images={formData.images}
                  onChange={(images) => handleChange('images', images)}
                  userId={user.id}
                />
                {errors.images && (
                  <p className="mt-1 text-sm text-red-600">{errors.images}</p>
                )}
              </div>
            )}

            {/* Name */}
            <div>
              <label htmlFor="product-name" className="block text-sm font-medium text-gray-700 mb-1">
                Product Name <span className="text-red-500">*</span>
              </label>
              <input
                id="product-name"
                type="text"
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                placeholder="e.g. Pro Field Hockey Stick"
                className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                  errors.name ? 'border-red-300' : 'border-gray-300'
                }`}
              />
              {errors.name && (
                <p className="mt-1 text-sm text-red-600">{errors.name}</p>
              )}
            </div>

            {/* Description */}
            <div>
              <label htmlFor="product-description" className="block text-sm font-medium text-gray-700 mb-1">
                Description <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                id="product-description"
                value={formData.description}
                onChange={(e) => handleChange('description', e.target.value)}
                placeholder="Short description of your product or service..."
                rows={3}
                maxLength={300}
                autoCapitalize="sentences"
                spellCheck
                className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none ${
                  errors.description ? 'border-red-300' : 'border-gray-300'
                }`}
              />
              <div className="flex justify-between mt-1">
                {errors.description ? (
                  <p className="text-sm text-red-600">{errors.description}</p>
                ) : (
                  <span />
                )}
                <span className={`text-xs ${formData.description.length > 280 ? 'text-amber-600' : 'text-gray-400'}`}>
                  {formData.description.length}/300
                </span>
              </div>
            </div>

            {/* External URL */}
            <div>
              <label htmlFor="product-url" className="block text-sm font-medium text-gray-700 mb-1">
                Product URL <span className="text-gray-400">(optional)</span>
              </label>
              <input
                id="product-url"
                type="text"
                value={formData.external_url}
                onChange={(e) => handleChange('external_url', e.target.value)}
                onBlur={handleUrlBlur}
                placeholder="www.yourbrand.com/product"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="mt-1 text-xs text-gray-400">
                Links to your website. If empty, the card will link to your brand's website.
              </p>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 px-4 bg-gradient-to-r from-hockia-primary to-hockia-secondary text-white rounded-lg font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSubmitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Product'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
