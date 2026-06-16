import { useState, useEffect, useRef, useCallback } from 'react'
import { Upload, Trash2, GripVertical, Edit2, X, Check, ArrowUp, ArrowDown, Loader2, ImageIcon } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import type { ClubMedia, GalleryPhoto } from '@/lib/supabase'
import ConfirmActionModal from './ConfirmActionModal'
import MediaLightbox from './MediaLightbox'
import Skeleton from './Skeleton'
import StorageImage from './StorageImage'
import { deleteStorageObject } from '@/lib/storage'
import { optimizeImage, type OptimizeOptions, validateImage } from '@/lib/imageOptimization'

const FILE_INPUT_ACCEPT = '.jpg,.jpeg,.png,image/jpeg,image/png'
const MAX_BATCH_UPLOAD = 10

export type GalleryMode = 'club' | 'profile'

interface GalleryManagerProps {
  mode: GalleryMode
  entityId?: string
  readOnly?: boolean
  title?: string
  description?: string
  emptyStateDescription?: string
  addButtonLabel?: string
  /** Fired with the current photo count whenever the gallery changes
   *  (load, upload, delete). Lets a parent dashboard recompute profile
   *  completeness without waiting for a route change. */
  onCountChange?: (count: number) => void
}

interface UploadProgress {
  file: File
  progress: number
  status: 'uploading' | 'success' | 'error'
  error?: string
}

interface ModeConfig {
  bucket: 'club-media' | 'gallery'
  table: 'club_media' | 'gallery_photos'
  ownerColumn: 'club_id' | 'user_id'
  urlField: 'file_url' | 'photo_url'
  title: string
  description: string
  emptyStateDescription: string
  addButtonLabel: string
  optimizeUploads: boolean
  optimizeOptions?: OptimizeOptions
  maxFileSizeMB: number
}

interface NormalizedMedia {
  id: string
  ownerId: string
  url: string
  fileName: string
  fileSize: number | null
  caption: string | null
  altText: string | null
  orderIndex: number
  createdAt: string
  updatedAt: string
}

// Shared gallery photo optimization (profile AND club galleries). These are
// photographs (match/training/facility shots), not logos, so JPEG output is
// correct — transparent assets live in the `avatars` bucket, never here.
// 1200px caps to the lightbox preset; q0.85 keeps photos crisp at display size.
const GALLERY_OPTIMIZE_OPTIONS: OptimizeOptions = {
  maxWidth: 1200,
  maxHeight: 1200,
  maxSizeMB: 1,
  quality: 0.85,
}

const MODE_CONFIG: Record<GalleryMode, ModeConfig> = {
  club: {
    bucket: 'club-media',
    table: 'club_media',
    ownerColumn: 'club_id',
    urlField: 'file_url',
    title: 'Photo Gallery',
    description: 'Manage your club photos',
    emptyStateDescription: 'No photos yet',
    addButtonLabel: 'Add Photos',
    optimizeUploads: true,
    optimizeOptions: GALLERY_OPTIMIZE_OPTIONS,
    maxFileSizeMB: 10,
  },
  profile: {
    bucket: 'gallery',
    table: 'gallery_photos',
    ownerColumn: 'user_id',
    urlField: 'photo_url',
    title: 'Gallery',
    description: 'Share photos from matches, training, and your career',
    emptyStateDescription: 'No photos yet. Start building your gallery!',
    addButtonLabel: 'Add Photo',
    optimizeUploads: true,
    optimizeOptions: GALLERY_OPTIMIZE_OPTIONS,
    maxFileSizeMB: 10,
  }
}

export default function GalleryManager({
  mode,
  entityId,
  readOnly = false,
  title,
  description,
  emptyStateDescription,
  addButtonLabel,
  onCountChange,
}: GalleryManagerProps) {
  const config = MODE_CONFIG[mode]
  const { user } = useAuthStore()
  const targetEntityId = entityId || user?.id
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { addToast } = useToastStore()

  const [media, setMedia] = useState<NormalizedMedia[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([])
  const [draggedItem, setDraggedItem] = useState<NormalizedMedia | null>(null)
  const [editingCaption, setEditingCaption] = useState<string | null>(null)
  const [captionText, setCaptionText] = useState('')
  const [altText, setAltText] = useState('')
  const [pendingDelete, setPendingDelete] = useState<NormalizedMedia | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [previewMedia, setPreviewMedia] = useState<NormalizedMedia | null>(null)
  const [isUploadDragActive, setIsUploadDragActive] = useState(false)

  // Surface the photo count to the parent on every change (load,
  // upload, delete) so dashboards can keep profile completeness fresh.
  useEffect(() => {
    if (!isLoading) onCountChange?.(media.length)
  }, [media.length, isLoading, onCountChange])
  const [savingCaptionId, setSavingCaptionId] = useState<string | null>(null)

  const fetchMedia = useCallback(async () => {
    if (!targetEntityId) return
    setIsLoading(true)
    try {
      const ownerColumn = config.ownerColumn
      const selectQuery = supabase
        .from(config.table)
        .select('*')
        .eq(ownerColumn, targetEntityId)
        .order('order_index', { ascending: true })
        .order('created_at', { ascending: false })

      const { data, error } = await selectQuery
      if (error) throw error

      const normalized = (data || []).map((item) => normalizeMedia(item, mode))
      setMedia(normalized)
    } catch (error) {
      logger.error('Error fetching gallery media:', error)
      addToast('Unable to load gallery items. Please try again.', 'error')
    } finally {
      setIsLoading(false)
    }
  }, [config.ownerColumn, config.table, mode, targetEntityId, addToast])

  useEffect(() => {
    if (targetEntityId) {
      void fetchMedia()
    } else {
      setIsLoading(false)
    }
  }, [targetEntityId, fetchMedia])

  const validateFile = (file: File): string | null => {
    const validation = validateImage(file, { maxFileSizeMB: config.maxFileSizeMB })
    return validation.valid ? null : validation.error || 'Invalid image'
  }

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || !user || !targetEntityId || readOnly) return

    const fileArray = Array.from(files).slice(0, MAX_BATCH_UPLOAD)
    const validFiles: File[] = []

    for (const file of fileArray) {
      const error = validateFile(file)
      if (error) {
        addToast(`${file.name}: ${error}`, 'error')
        continue
      }
      validFiles.push(file)
    }

    if (validFiles.length === 0) return

    const progressItems: UploadProgress[] = validFiles.map((file) => ({
      file,
      progress: 0,
      status: 'uploading',
    }))
    setUploadProgress(progressItems)

    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i]
      try {
        const processedFile = config.optimizeUploads
          ? await optimizeImage(file, config.optimizeOptions)
          : file

        const fileExt = file.name.split('.').pop() || 'jpg'
        const fileName = `${targetEntityId}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt.toLowerCase()}`

        const { error: uploadError } = await supabase.storage
          .from(config.bucket)
          .upload(fileName, processedFile, { cacheControl: '31536000' })

        if (uploadError) throw uploadError

        // Verify the file was actually uploaded by checking it exists
        const { data: fileExists, error: listError } = await supabase.storage
          .from(config.bucket)
          .list(targetEntityId, { search: fileName.split('/').pop() })

        if (listError || !fileExists || fileExists.length === 0) {
          logger.error('File upload verification failed:', { fileName, listError, fileExists })
          throw new Error('File upload could not be verified. Please try again.')
        }

        const { data: urlData } = supabase.storage
          .from(config.bucket)
          .getPublicUrl(fileName)

        const maxOrder = media.length > 0 ? Math.max(...media.map((m) => m.orderIndex)) : -1
        const nextOrderIndex = maxOrder + 1

        if (mode === 'club') {
          const { error: dbError } = await supabase
            .from('club_media')
            .insert({
              club_id: targetEntityId,
              file_url: urlData.publicUrl,
              file_name: file.name,
              file_size: processedFile.size,
              order_index: nextOrderIndex,
            })

          if (dbError) throw dbError
        } else {
          const { error: dbError } = await supabase
            .from('gallery_photos')
            .insert({
              user_id: targetEntityId,
              photo_url: urlData.publicUrl,
              file_name: file.name,
              file_size: processedFile.size,
              order_index: nextOrderIndex,
            })

          if (dbError) throw dbError
        }

        setUploadProgress((prev) =>
          prev.map((item, idx) =>
            idx === i ? { ...item, progress: 100, status: 'success' } : item
          )
        )
      } catch (error) {
        logger.error('Error uploading file:', error)
        const message = error instanceof Error ? error.message : 'Upload failed. Please use PNG or JPG up to 10MB.'
        setUploadProgress((prev) =>
          prev.map((item, idx) =>
            idx === i ? { ...item, status: 'error', error: message } : item
          )
        )
      }
    }

    await fetchMedia()

    setTimeout(() => {
      setUploadProgress([])
    }, 2000)

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const requestDelete = (mediaItem: NormalizedMedia) => {
    setPendingDelete(mediaItem)
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return

    setDeletingId(pendingDelete.id)
    try {
      await deleteStorageObject({
        bucket: config.bucket,
        publicUrl: pendingDelete.url,
        context: `${mode}-gallery:delete`,
      })

      const { error: dbError } = await supabase
        .from(config.table)
        .delete()
        .eq('id', pendingDelete.id)

      if (dbError) throw dbError

      await fetchMedia()
      addToast('Photo removed from gallery.', 'success')
      setPendingDelete(null)
    } catch (error) {
      logger.error('Error deleting media:', error)
      addToast('Failed to delete photo. Please try again.', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  const handleDragStart = (e: React.DragEvent, item: NormalizedMedia) => {
    if (readOnly) return
    setDraggedItem(item)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleReorderDragOver = (e: React.DragEvent) => {
    if (readOnly) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const persistOrder = async (updatedList: NormalizedMedia[]) => {
    const normalized = updatedList.map((item, index) => ({
      ...item,
      orderIndex: index,
    }))

    setMedia(normalized)

    try {
      await Promise.all(
        normalized.map((item) =>
          supabase
            .from(config.table)
            .update({ order_index: item.orderIndex, updated_at: new Date().toISOString() })
            .eq('id', item.id)
        )
      )
    } catch (error) {
      logger.error('Error updating order:', error)
      addToast('Failed to update order. Refresh and try again.', 'error')
      await fetchMedia()
    }
  }

  const handleDrop = (e: React.DragEvent, targetItem: NormalizedMedia) => {
    if (readOnly) return
    e.preventDefault()

    if (!draggedItem || draggedItem.id === targetItem.id) {
      setDraggedItem(null)
      return
    }

    const reorderedMedia = [...media]
    const draggedIndex = reorderedMedia.findIndex((m) => m.id === draggedItem.id)
    const targetIndex = reorderedMedia.findIndex((m) => m.id === targetItem.id)

    const [removed] = reorderedMedia.splice(draggedIndex, 1)
    reorderedMedia.splice(targetIndex, 0, removed)

    setDraggedItem(null)
    void persistOrder(reorderedMedia)
  }

  const moveMedia = (itemId: string, direction: 'up' | 'down') => {
    if (readOnly) return
    const currentIndex = media.findIndex((item) => item.id === itemId)
    if (currentIndex === -1) return

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (targetIndex < 0 || targetIndex >= media.length) return

    const reordered = [...media]
    const [item] = reordered.splice(currentIndex, 1)
    reordered.splice(targetIndex, 0, item)

    void persistOrder(reordered)
  }

  const startEditingCaption = (item: NormalizedMedia) => {
    if (readOnly) return
    setEditingCaption(item.id)
    setCaptionText(item.caption || '')
    setAltText(item.altText || '')
  }

  const saveCaption = async (itemId: string) => {
    if (readOnly) return
    setSavingCaptionId(itemId)
    try {
      const { error } = await supabase
        .from(config.table)
        .update({
          caption: captionText.trim() || null,
          alt_text: altText.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', itemId)

      if (error) throw error

      setEditingCaption(null)
      await fetchMedia()
    } catch (error) {
      logger.error('Error updating caption:', error)
      addToast('Failed to update caption. Please try again.', 'error')
    } finally {
      setSavingCaptionId(null)
    }
  }

  const cancelEdit = () => {
    setEditingCaption(null)
    setCaptionText('')
    setAltText('')
  }

  const handleUploadDragEnter = (e: React.DragEvent) => {
    if (readOnly) return
    e.preventDefault()
    e.stopPropagation()
    setIsUploadDragActive(true)
  }

  const handleUploadDragLeave = (e: React.DragEvent) => {
    if (readOnly) return
    e.preventDefault()
    e.stopPropagation()
    const related = e.relatedTarget as Node | null
    if (related && e.currentTarget.contains(related)) {
      return
    }
    setIsUploadDragActive(false)
  }

  const handleUploadDragOver = (e: React.DragEvent) => {
    if (readOnly) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setIsUploadDragActive(true)
  }

  const handleUploadDrop = (e: React.DragEvent) => {
    if (readOnly) return
    e.preventDefault()
    e.stopPropagation()
    setIsUploadDragActive(false)
    const files = e.dataTransfer.files
    void handleFileUpload(files)
  }

  const resolvedTitle = title ?? config.title
  const resolvedDescription = description ?? config.description
  const resolvedEmptyState = emptyStateDescription ?? config.emptyStateDescription
  const resolvedAddButtonLabel = addButtonLabel ?? config.addButtonLabel

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{resolvedTitle}</h2>
          <p className="mt-1 text-gray-600 sm:mt-0 sm:text-sm">{resolvedDescription}</p>
        </div>
        {!readOnly && (
          <>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] px-6 py-3 font-medium text-white transition-opacity hover:opacity-90 sm:w-auto"
              type="button"
            >
              <Upload className="h-5 w-5" />
              {resolvedAddButtonLabel}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={FILE_INPUT_ACCEPT}
              multiple
              onChange={(e) => void handleFileUpload(e.target.files)}
              className="hidden"
              aria-label="Upload photos"
            />
          </>
        )}
      </div>

      {uploadProgress.length > 0 && (
        <div className="space-y-2">
          {uploadProgress.map((item, index) => (
            <div key={index} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700 truncate flex-1">{item.file.name}</span>
                <span className="text-sm text-gray-500 ml-2">
                  {item.status === 'success'
                    ? '✓'
                    : item.status === 'error'
                    ? '✗'
                    : `${item.progress}%`}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <progress
                  value={item.progress}
                  max={100}
                  className={`progress-bar h-2 w-full rounded-full ${
                    item.status === 'success'
                      ? 'text-green-500'
                      : item.status === 'error'
                      ? 'text-red-500'
                      : 'text-blue-500'
                  }`}
                />
              </div>
              {item.error && <p className="text-sm text-red-600 mt-1">{item.error}</p>}
            </div>
          ))}
        </div>
      )}

      {!readOnly && media.length === 0 && !isLoading && (
        <div
          onDragEnter={handleUploadDragEnter}
          onDragOver={handleUploadDragOver}
          onDragLeave={handleUploadDragLeave}
          onDrop={handleUploadDrop}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition-colors ${
            isUploadDragActive ? 'border-[#924CEC] bg-[#f5f3ff]' : 'border-gray-300 hover:border-[#924CEC]'
          }`}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              fileInputRef.current?.click()
            }
          }}
          role="button"
          tabIndex={0}
        >
          <Upload className="mx-auto mb-4 h-12 w-12 text-gray-400" />
          <p className="mb-1 font-medium text-gray-600">
            Drag and drop photos here, or click to browse
          </p>
          <p className="text-sm text-gray-500">
            JPG/JPEG or PNG • Max {config.maxFileSizeMB}MB per file • Up to {MAX_BATCH_UPLOAD} files at once
          </p>
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="aspect-[3/4] w-full" variant="rectangular" />
          ))}
        </div>
      )}

      {!isLoading && media.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {media.map((item, index) => (
            <div
              key={item.id}
              draggable={!readOnly}
              onDragStart={(e) => handleDragStart(e, item)}
              onDragOver={handleReorderDragOver}
              onDrop={(e) => handleDrop(e, item)}
              className={`group rounded-xl border border-gray-200 bg-white transition-shadow hover:shadow-lg ${
                !readOnly ? 'cursor-move active:cursor-grabbing' : ''
              }`}
            >
              <div
                className="relative aspect-[3/4] overflow-hidden bg-gray-100"
                role="button"
                tabIndex={0}
                onClick={() => setPreviewMedia(item)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setPreviewMedia(item)
                  }
                }}
              >
                <StorageImage
                  src={item.url}
                  imageSize="gallery"
                  alt={item.altText || item.fileName}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  containerClassName="h-full w-full"
                  fallbackClassName="h-full w-full aspect-[3/4]"
                  fallback={<ImageIcon className="h-8 w-8 text-gray-400" />}
                  showLoading={true}
                />
                {!readOnly && (
                  <div className="pointer-events-none absolute left-2 top-2 rounded-lg bg-white/80 p-2 shadow-lg backdrop-blur">
                    <GripVertical className="w-4 h-4 text-gray-600" />
                  </div>
                )}
                {!readOnly && (
                  <button
                    data-block-preview
                    onClick={(event) => {
                      event.stopPropagation()
                      requestDelete(item)
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                    disabled={deletingId === item.id}
                    className="absolute right-2 top-2 rounded-lg bg-red-500 p-2 text-white shadow-lg transition-colors hover:bg-red-600 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Delete photo"
                    aria-label="Delete photo"
                    type="button"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="p-4 space-y-2">
                {editingCaption === item.id ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={captionText}
                      onChange={(e) => setCaptionText(e.target.value.slice(0, 200))}
                      placeholder="Caption (optional, max 200 chars)"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                    />
                    <input
                      type="text"
                      value={altText}
                      onChange={(e) => setAltText(e.target.value)}
                      placeholder="Alt text for accessibility (optional)"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                      <button
                        onClick={() => saveCaption(item.id)}
                        className="flex-1 rounded-lg bg-green-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-green-600 disabled:cursor-not-allowed disabled:bg-green-400 sm:flex-none sm:min-w-[120px]"
                        disabled={savingCaptionId === item.id}
                        type="button"
                      >
                        {savingCaptionId === item.id ? (
                          <span className="flex items-center justify-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Saving…
                          </span>
                        ) : (
                          <span className="flex items-center justify-center gap-1">
                            <Check className="h-4 w-4" />
                            Save
                          </span>
                        )}
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="flex-1 rounded-lg border border-[#924CEC] px-3 py-2 text-sm font-medium text-[#924CEC] transition-colors hover:bg-[#f5f3ff] disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none sm:min-w-[120px]"
                        disabled={savingCaptionId === item.id}
                        type="button"
                      >
                        <span className="flex items-center justify-center gap-1">
                          <X className="h-4 w-4" />
                          Cancel
                        </span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {!readOnly && (
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 bg-white">
                          <button
                            onClick={() => moveMedia(item.id, 'up')}
                            className="tap-target px-2 py-1 text-gray-500 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#924CEC] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                            disabled={index === 0}
                            type="button"
                          >
                            <ArrowUp className="h-4 w-4" />
                            <span className="sr-only">Move photo earlier</span>
                          </button>
                          <button
                            onClick={() => moveMedia(item.id, 'down')}
                            className="tap-target px-2 py-1 text-gray-500 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#924CEC] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                            disabled={index === media.length - 1}
                            type="button"
                          >
                            <ArrowDown className="h-4 w-4" />
                            <span className="sr-only">Move photo later</span>
                          </button>
                        </div>
                        <button
                          onClick={() => startEditingCaption(item)}
                          className="p-1 text-gray-400 transition-colors hover:text-purple-600"
                          title="Edit caption"
                          type="button"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                    {item.caption && <p className="text-sm text-gray-600 line-clamp-2">{item.caption}</p>}
                    <p className="text-xs text-gray-400">Uploaded {new Date(item.createdAt).toLocaleDateString()}</p>
                  </>
                )}
              </div>
            </div>
          ))}
          {!readOnly && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={handleUploadDragEnter}
              onDragOver={handleUploadDragOver}
              onDragLeave={handleUploadDragLeave}
              onDrop={handleUploadDrop}
              className={`flex aspect-[3/4] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed text-center transition-colors ${
                isUploadDragActive ? 'border-[#924CEC] bg-[#f5f3ff] text-[#924CEC]' : 'border-gray-300 text-gray-500 hover:border-[#924CEC]'
              }`}
            >
              <Upload className="h-8 w-8" />
              <span className="text-sm font-medium">Add more photos</span>
              <span className="text-xs text-gray-400">Drag files here or tap to browse</span>
            </button>
          )}
        </div>
      )}

      {!isLoading && media.length === 0 && (readOnly || !targetEntityId) && (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Upload className="w-8 h-8 text-gray-400" />
          </div>
          <p className="text-gray-600">{resolvedEmptyState}</p>
        </div>
      )}

      <ConfirmActionModal
        isOpen={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        confirmLabel="Delete Photo"
        confirmTone="danger"
        confirmLoading={Boolean(deletingId)}
        loadingLabel="Deleting..."
        title="Remove photo from gallery?"
        description="This will permanently delete the image from your gallery."
        icon={<Trash2 className="h-6 w-6" />}
        body={pendingDelete ? (
          <div className="space-y-3 text-sm text-gray-600">
            <p>Deleting this media removes it from every profile surface.</p>
            <img
              src={pendingDelete.url}
              alt={pendingDelete.altText || pendingDelete.fileName}
              className="h-48 w-full rounded-lg object-cover"
              loading="lazy"
            />
          </div>
        ) : undefined}
      />

      <MediaLightbox
        media={previewMedia ? { id: previewMedia.id, url: previewMedia.url, alt: previewMedia.altText || previewMedia.fileName } : null}
        onClose={() => setPreviewMedia(null)}
      />
    </div>
  )
}

function normalizeMedia(record: ClubMedia | GalleryPhoto, mode: GalleryMode): NormalizedMedia {
  if (mode === 'club') {
    const item = record as ClubMedia
    return {
      id: item.id,
      ownerId: item.club_id,
      url: item.file_url,
      fileName: item.file_name,
      fileSize: item.file_size,
      caption: item.caption,
      altText: item.alt_text,
      orderIndex: item.order_index ?? 0,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }
  }

  const item = record as GalleryPhoto
  return {
    id: item.id,
    ownerId: item.user_id,
    url: item.photo_url,
    fileName: item.file_name || `photo_${item.id}.jpg`,
    fileSize: item.file_size ?? null,
    caption: item.caption,
    altText: item.alt_text,
    orderIndex: item.order_index ?? 0,
    createdAt: item.created_at,
    updatedAt: item.updated_at || item.created_at,
  }
}
