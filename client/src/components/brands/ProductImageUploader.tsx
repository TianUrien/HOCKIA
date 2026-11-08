/**
 * ProductImageUploader
 *
 * Multi-image upload grid (up to 4 images) for brand products.
 * Handles validation, optimization, and upload to Supabase storage.
 */

import { useCallback, useRef, useState } from 'react'
import { ImagePlus, X, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { validateImage, optimizeImage } from '@/lib/imageOptimization'
import { logger } from '@/lib/logger'
import type { ProductImage } from '@/hooks/useBrandProducts'

interface ProductImageUploaderProps {
  images: ProductImage[]
  onChange: (images: ProductImage[]) => void
  maxImages?: number
  userId: string
}

const BUCKET = 'brand-products'

export function ProductImageUploader({
  images,
  onChange,
  maxImages = 4,
  userId,
}: ProductImageUploaderProps) {
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingSlotRef = useRef<number>(0)

  const handleSlotClick = useCallback((slotIndex: number) => {
    if (uploadingSlot !== null) return
    pendingSlotRef.current = slotIndex
    fileInputRef.current?.click()
  }, [uploadingSlot])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Reset input so the same file can be selected again
    e.target.value = ''

    const slotIndex = pendingSlotRef.current
    setError(null)
    setUploadingSlot(slotIndex)

    try {
      // Validate
      const validation = validateImage(file, { maxFileSizeMB: 10 })
      if (!validation.valid) {
        throw new Error(validation.error)
      }

      // Optimize
      const optimized = await optimizeImage(file, {
        maxWidth: 1200,
        maxHeight: 1200,
        maxSizeMB: 1,
        quality: 0.85,
      })

      // Generate filename
      const ext = optimized.type === 'image/png' ? 'png' : 'jpg'
      const random = Math.random().toString(36).slice(2, 8)
      const fileName = `${userId}/${Date.now()}_${random}.${ext}`

      // Upload to Supabase
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(fileName, optimized, {
          contentType: optimized.type,
          upsert: false,
          cacheControl: '31536000',
        })

      if (uploadError) throw uploadError

      // Get public URL
      const { data: urlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(fileName)

      const publicUrl = urlData.publicUrl

      // Update images array
      const newImage: ProductImage = { url: publicUrl, order: slotIndex }
      const updated = [...images]

      // Replace if slot already has an image, otherwise push
      const existingIdx = updated.findIndex(img => img.order === slotIndex)
      if (existingIdx >= 0) {
        updated[existingIdx] = newImage
      } else {
        updated.push(newImage)
      }

      // Normalize order values
      const sorted = updated.sort((a, b) => a.order - b.order).map((img, i) => ({
        ...img,
        order: i,
      }))

      onChange(sorted)
    } catch (err) {
      logger.error('[ProductImageUploader] Upload error:', err)
      setError(err instanceof Error ? err.message : 'Failed to upload image')
    } finally {
      setUploadingSlot(null)
    }
  }, [images, onChange, userId])

  const handleRemove = useCallback((slotIndex: number) => {
    const updated = images
      .filter(img => img.order !== slotIndex)
      .map((img, i) => ({ ...img, order: i }))
    onChange(updated)
  }, [images, onChange])

  // Build slots: filled images + empty slots up to maxImages
  const slots: Array<ProductImage | null> = []
  for (let i = 0; i < maxImages; i++) {
    const img = images.find(img => img.order === i) ?? null
    slots.push(img)
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Product Images <span className="text-gray-400">(up to {maxImages})</span>
      </label>

      <div className="grid grid-cols-2 gap-3">
        {slots.map((slot, i) => {
          const isUploading = uploadingSlot === i

          if (slot) {
            // Filled slot
            return (
              <div
                key={i}
                className="relative aspect-[4/3] rounded-lg overflow-hidden bg-gray-100 group"
              >
                <img
                  src={slot.url}
                  alt={`Product image ${i + 1}`}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => handleRemove(i)}
                  className="absolute top-2 right-2 p-1 bg-black/60 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                  aria-label={`Remove image ${i + 1}`}
                >
                  <X className="w-4 h-4" />
                </button>
                {i === 0 && (
                  <span className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/60 rounded text-white text-xs font-medium">
                    Main
                  </span>
                )}
              </div>
            )
          }

          // Empty slot
          return (
            <button
              key={i}
              type="button"
              onClick={() => handleSlotClick(i)}
              disabled={isUploading}
              className="aspect-[4/3] rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploading ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <>
                  <ImagePlus className="w-6 h-6" />
                  <span className="text-xs">Add image</span>
                </>
              )}
            </button>
          )
        })}
      </div>

      {error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,image/jpeg,image/png"
        onChange={handleFileChange}
        className="hidden"
        aria-label="Upload product image"
      />
    </div>
  )
}
