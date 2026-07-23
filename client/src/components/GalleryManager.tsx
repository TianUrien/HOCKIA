import { useState, useEffect, useRef, useCallback } from 'react'
import { Upload, Trash2, GripVertical, Edit2, X, Check, ArrowUp, ArrowDown, Loader2, ImageIcon, Play, Film, Clock, AlertCircle } from 'lucide-react'
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
import { optimizeImage, type OptimizeOptions, validateImage, validateVideoFull } from '@/lib/imageOptimization'
import { useNativeVideoUpload } from '@/hooks/useNativeVideoUpload'
import { useSignedVideoThumbnail } from '@/hooks/useSignedVideoThumbnail'

const FILE_INPUT_ACCEPT = '.jpg,.jpeg,.png,image/jpeg,image/png'
const VIDEO_INPUT_ACCEPT = '.mp4,.mov,.webm,video/mp4,video/quicktime,video/webm'
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
  /** Fired with the current PHOTO count whenever the gallery changes
   *  (load, upload, delete). Lets a parent dashboard recompute profile
   *  completeness without waiting for a route change. Videos are excluded
   *  so the profile-strength meaning of this number never shifts. */
  onCountChange?: (count: number) => void
  /** Public-portfolio cap: when set AND readOnly, the grid shows at most
   *  this many tiles with an in-place "Show all N" toggle. Owner mode
   *  ignores it (management needs the full grid + drag reorder). */
  previewLimit?: number
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
  /** Profile galleries hold photos AND videos (player_videos kind='reel').
   *  Club galleries are photo-only (club_media is a different table whose
   *  owner column is a club id, not a user id). */
  supportsVideo: boolean
}

type MediaItemType = 'photo' | 'video'

interface NormalizedMedia {
  id: string
  type: MediaItemType
  ownerId: string
  /** Photo source. NULL for a video: a Cloudflare asset has no durable URL —
   *  NativeVideoPlayer mints a signed one per view. */
  url: string | null
  fileName: string
  fileSize: number | null
  caption: string | null
  altText: string | null
  orderIndex: number
  createdAt: string
  updatedAt: string
  /** Video-only. */
  status?: string
  durationSeconds?: number | null
}

/** A Gallery video row. Deliberately a narrow shape — we never select `kind`
 *  back out, because the query already pins it. */
interface GalleryVideoRow {
  id: string
  user_id: string
  title: string
  description: string | null
  status: string
  duration_seconds: number | null
  display_order: number | null
  created_at: string
  updated_at: string
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
    supportsVideo: false,
  },
  profile: {
    bucket: 'gallery',
    table: 'gallery_photos',
    ownerColumn: 'user_id',
    urlField: 'photo_url',
    title: 'Gallery',
    description: 'Share photos and videos from matches, training, and your career',
    emptyStateDescription: 'No photos or videos yet. Start building your gallery!',
    addButtonLabel: 'Add Photo',
    optimizeUploads: true,
    optimizeOptions: GALLERY_OPTIMIZE_OPTIONS,
    maxFileSizeMB: 10,
    supportsVideo: true,
  }
}

/** player_videos.title has a 1–120 char CHECK. Derive one from the file name. */
function deriveVideoTitle(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, '').trim()
  return (base || 'Video').slice(0, 120)
}

/** Floor, never round — a 36.8s clip must read 0:36, not 0:37. */
function formatDuration(seconds: number): string {
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** video-delete's machine codes, in the user's language. */
const VIDEO_DELETE_MESSAGES: Record<string, string> = {
  video_in_use: 'This video is used by one of your posts. Delete the post first.',
  forbidden: 'You can only delete your own videos.',
  not_found: 'That video no longer exists.',
  unauthenticated: 'Please sign in again and retry.',
}
const VIDEO_DELETE_FALLBACK = 'Failed to delete video. Please try again.'

/** functions.invoke throws a FunctionsHttpError whose message is the static
 *  "non-2xx status code" — the real reason is only in the response body, and
 *  it's a machine code, never something to show a user verbatim. */
async function videoDeleteErrorMessage(err: unknown): Promise<string> {
  const ctx = (err as { context?: Response }).context
  try {
    const body = ctx ? ((await ctx.clone().json()) as { error?: string }) : null
    return (body?.error && VIDEO_DELETE_MESSAGES[body.error]) || VIDEO_DELETE_FALLBACK
  } catch {
    return VIDEO_DELETE_FALLBACK
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
  previewLimit,
}: GalleryManagerProps) {
  const config = MODE_CONFIG[mode]
  const { user } = useAuthStore()
  const targetEntityId = entityId || user?.id
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const { addToast } = useToastStore()

  const [media, setMedia] = useState<NormalizedMedia[]>([])
  const [isLoading, setIsLoading] = useState(true)
  // Public-portfolio cap toggle (readOnly + previewLimit only).
  const [galleryExpanded, setGalleryExpanded] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([])
  const [draggedItem, setDraggedItem] = useState<NormalizedMedia | null>(null)
  const [editingCaption, setEditingCaption] = useState<string | null>(null)
  const [captionText, setCaptionText] = useState('')
  const [altText, setAltText] = useState('')
  const [pendingDelete, setPendingDelete] = useState<NormalizedMedia | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [previewMedia, setPreviewMedia] = useState<NormalizedMedia | null>(null)
  const [isUploadDragActive, setIsUploadDragActive] = useState(false)

  const {
    phase: videoPhase,
    progress: videoProgress,
    error: videoError,
    upload: uploadVideo,
    cancel: cancelVideo,
    reset: resetVideo,
  } = useNativeVideoUpload()

  // A video upload takes minutes (transcode). Reading `media` from the closure
  // afterwards would use a snapshot from before the upload started, so a photo
  // added meanwhile would collide on the same order index.
  const mediaRef = useRef<NormalizedMedia[]>([])
  useEffect(() => {
    mediaRef.current = media
  }, [media])

  const photoCount = media.filter((m) => m.type === 'photo').length

  // Surface the photo count to the parent on every change (load, upload,
  // delete) so dashboards can keep profile completeness fresh.
  useEffect(() => {
    if (!isLoading) onCountChange?.(photoCount)
  }, [photoCount, isLoading, onCountChange])
  const [savingCaptionId, setSavingCaptionId] = useState<string | null>(null)

  const fetchMedia = useCallback(async () => {
    if (!targetEntityId) return
    setIsLoading(true)
    try {
      const ownerColumn = config.ownerColumn

      const photoPromise = supabase
        .from(config.table)
        .select('*')
        .eq(ownerColumn, targetEntityId)
        .order('order_index', { ascending: false })
        .order('created_at', { ascending: false })

      // GALLERY VIDEOS ONLY — kind='reel'.
      //
      // ⚠ player_videos RLS is KIND-AGNOSTIC: its SELECT policy gates on
      // status + visibility + ownership and never looks at `kind`. The product
      // separation lives ENTIRELY in this filter. Drop it and a Home video post
      // (kind='post') and a recruitment highlight / full_match would both bleed
      // into the Gallery. Never widen it.
      const videoPromise = config.supportsVideo
        ? supabase
            .from('player_videos')
            .select('id, user_id, title, description, status, duration_seconds, display_order, created_at, updated_at')
            .eq('user_id', targetEntityId)
            .eq('kind', 'reel')
            .order('display_order', { ascending: false })
            .order('created_at', { ascending: false })
        : null

      const [photoRes, videoRes] = await Promise.all([photoPromise, videoPromise])
      if (photoRes.error) throw photoRes.error
      if (videoRes?.error) throw videoRes.error

      const photos = (photoRes.data || []).map((item) => normalizePhoto(item as ClubMedia | GalleryPhoto, mode))

      // RLS already hides non-ready rows from visitors, but the OWNER's own
      // rows come back regardless of status — and "readOnly && own profile" is
      // Network View, where the owner is previewing what a visitor sees.
      const videos = ((videoRes?.data ?? []) as unknown as GalleryVideoRow[])
        .filter((v) => !readOnly || v.status === 'ready')
        .map(normalizeVideo)

      // One grid, NEWEST FIRST: higher order value = higher in the grid. New
      // uploads take max+1 (top); existing rows were numbered oldest→newest, so
      // descending shows the most recent media first. Photos carry order_index,
      // videos display_order — the same counter, so they interleave as arranged.
      // Duplicated order values are COMMON in production (38 tie groups at last
      // count), so ties fall back to newest-first and finally to id — the grid
      // must never swap items between two fetches of identical data.
      const merged = [...photos, ...videos].sort(
        (a, b) =>
          b.orderIndex - a.orderIndex ||
          b.createdAt.localeCompare(a.createdAt) ||
          a.id.localeCompare(b.id),
      )
      setMedia(merged)
    } catch (error) {
      logger.error('Error fetching gallery media:', error)
      addToast('Unable to load gallery items. Please try again.', 'error')
    } finally {
      setIsLoading(false)
    }
  }, [config.ownerColumn, config.table, config.supportsVideo, mode, readOnly, targetEntityId, addToast])

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

  /** Photos and videos share ONE 0-based order space (gallery_photos.order_index
   *  and player_videos.display_order), which is what lets them interleave in a
   *  single grid. Display is newest-first, so max+1 puts a new upload at the
   *  TOP. Always read the freshest list. */
  const nextOrderIndex = () => {
    const current = mediaRef.current
    return (current.length > 0 ? Math.max(...current.map((m) => m.orderIndex)) : -1) + 1
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

    // Newest-first grid: higher value = higher position. Give the FIRST
    // selected file the highest index of the batch so a multi-select shows in
    // the order the user picked, with the whole batch above older media.
    const batchTop = nextOrderIndex() + validFiles.length - 1

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

        const orderIndex = batchTop - i

        if (mode === 'club') {
          const { error: dbError } = await supabase
            .from('club_media')
            .insert({
              club_id: targetEntityId,
              file_url: urlData.publicUrl,
              file_name: file.name,
              file_size: processedFile.size,
              order_index: orderIndex,
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
              order_index: orderIndex,
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

  // A Gallery video is kind='reel', always public: it is gallery content, not
  // recruitment evidence (highlight/full_match) and not a Home post (post).
  // Bytes go straight to Cloudflare via tus; Postgres stores only the row.
  const handleVideoUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || !user || !targetEntityId || readOnly) return
    if (!config.supportsVideo || targetEntityId !== user.id) return

    const file = files[0]
    if (videoInputRef.current) videoInputRef.current.value = ''

    const validation = await validateVideoFull(file)
    if (!validation.valid) {
      addToast(validation.error || 'Invalid video', 'error')
      return
    }

    const videoId = await uploadVideo(file, {
      title: deriveVideoTitle(file),
      kind: 'reel',
      visibility: 'public',
    })
    // The hook renders its own error state; bail quietly.
    if (!videoId) return

    // Order index AFTER the upload — see mediaRef. The row is born with
    // display_order=0, which would tie with the first photo.
    const { data: ordered, error: orderErr } = await supabase
      .from('player_videos')
      .update({ display_order: nextOrderIndex() })
      .eq('id', videoId)
      .select('id')

    await fetchMedia()
    resetVideo()

    if (orderErr || !ordered || ordered.length === 0) {
      logger.error('Error setting gallery video order:', orderErr)
      addToast('Video added, but we could not save its position. Drag it where you want it.', 'error')
      return
    }
    addToast('Video added to your gallery.', 'success')
  }

  const requestDelete = (mediaItem: NormalizedMedia) => {
    setPendingDelete(mediaItem)
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return

    setDeletingId(pendingDelete.id)
    try {
      if (pendingDelete.type === 'video') {
        // video-delete removes the Cloudflare asset AND the row. A plain row
        // delete would orphan the asset forever.
        const { error } = await supabase.functions.invoke('video-delete', {
          body: { videoId: pendingDelete.id },
        })
        if (error) throw new Error(await videoDeleteErrorMessage(error))
      } else {
        await deleteStorageObject({
          bucket: config.bucket,
          publicUrl: pendingDelete.url ?? '',
          context: `${mode}-gallery:delete`,
        })

        const { error: dbError } = await supabase
          .from(config.table)
          .delete()
          .eq('id', pendingDelete.id)

        if (dbError) throw dbError
      }

      await fetchMedia()
      addToast(pendingDelete.type === 'video' ? 'Video removed from gallery.' : 'Photo removed from gallery.', 'success')
      setPendingDelete(null)
    } catch (error) {
      logger.error('Error deleting media:', error)
      const message = error instanceof Error ? error.message : null
      addToast(message || 'Failed to delete. Please try again.', 'error')
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
    // Display is newest-first (higher value = higher in the grid), so the item
    // the user dragged to the TOP gets the HIGHEST index. Ascending here would
    // silently reverse the arrangement on the next fetch.
    const normalized = updatedList.map((item, index) => ({
      ...item,
      orderIndex: updatedList.length - 1 - index,
    }))

    setMedia(normalized)

    try {
      // .select('id') is load-bearing: an RLS-rejected UPDATE returns
      // { data: [], error: null } — success-shaped. Without reading the rows
      // back, a silently-refused reorder would look like it worked until the
      // next refetch snapped everything back.
      const results = await Promise.all(
        normalized.map((item) =>
          item.type === 'video'
            ? supabase
                .from('player_videos')
                .update({ display_order: item.orderIndex })
                .eq('id', item.id)
                .select('id')
            : supabase
                .from(config.table)
                .update({ order_index: item.orderIndex, updated_at: new Date().toISOString() })
                .eq('id', item.id)
                .select('id')
        )
      )
      const rejected = results.find((r) => r.error || !r.data || r.data.length === 0)
      if (rejected) throw rejected.error ?? new Error('Reorder was rejected')
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

  const saveCaption = async (item: NormalizedMedia) => {
    if (readOnly) return
    setSavingCaptionId(item.id)
    try {
      // Videos have no alt_text; their caption lives in player_videos.description
      // (title stays the derived file name, which the CHECK requires non-empty).
      const query =
        item.type === 'video'
          ? supabase
              .from('player_videos')
              .update({ description: captionText.trim() || null })
              .eq('id', item.id)
              .select('id')
          : supabase
              .from(config.table)
              .update({
                caption: captionText.trim() || null,
                alt_text: altText.trim() || null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', item.id)
              .select('id')

      const { data, error } = await query
      if (error) throw error
      if (!data || data.length === 0) throw new Error('Caption update was rejected')

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

  const openPreview = (item: NormalizedMedia) => {
    // A still-processing or failed video has nothing to play.
    if (item.type === 'video' && item.status !== 'ready') return
    setPreviewMedia(item)
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

  const canAddVideo = config.supportsVideo && !readOnly && targetEntityId === user?.id
  const videoBusy = videoPhase === 'creating' || videoPhase === 'uploading' || videoPhase === 'processing'

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{resolvedTitle}</h2>
          {/* The subtitle is manage-instructional ("Manage your club
              photos" / "Share photos and videos…") — owner copy that must
              never show on the public portfolio. */}
          {!readOnly && (
            <p className="mt-1 text-gray-600 sm:mt-0 sm:text-sm">{resolvedDescription}</p>
          )}
        </div>
        {!readOnly && (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-hockia-primary to-hockia-secondary px-6 py-3 font-medium text-white transition-opacity hover:opacity-90 sm:w-auto"
              type="button"
            >
              <Upload className="h-5 w-5" />
              {resolvedAddButtonLabel}
            </button>
            {canAddVideo && (
              <button
                onClick={() => videoInputRef.current?.click()}
                disabled={videoBusy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-hockia-primary px-6 py-3 font-medium text-hockia-primary transition-colors hover:bg-[#f5f3ff] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                type="button"
              >
                <Film className="h-5 w-5" />
                Add Video
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={FILE_INPUT_ACCEPT}
              multiple
              onChange={(e) => void handleFileUpload(e.target.files)}
              className="hidden"
              aria-label="Upload photos"
            />
            {canAddVideo && (
              <input
                ref={videoInputRef}
                type="file"
                accept={VIDEO_INPUT_ACCEPT}
                onChange={(e) => void handleVideoUpload(e.target.files)}
                className="hidden"
                aria-label="Upload video"
              />
            )}
          </div>
        )}
      </div>

      {/* Gallery video upload — one at a time; bytes stream to Cloudflare, then
          we wait for transcoding so the tile is never a dead frame. */}
      {(videoBusy || videoPhase === 'error') && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          {videoPhase === 'error' ? (
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900">Video upload failed</p>
                <p className="mt-0.5 text-sm text-red-600">{videoError}</p>
              </div>
              <button type="button" onClick={resetVideo} className="text-sm font-medium text-gray-500 hover:text-gray-700">
                Dismiss
              </button>
            </div>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <Loader2 className="h-4 w-4 animate-spin text-hockia-primary" />
                  {videoPhase === 'creating' && 'Preparing upload…'}
                  {videoPhase === 'uploading' && 'Uploading video…'}
                  {videoPhase === 'processing' && 'Processing video — this can take a minute.'}
                </span>
                {videoPhase === 'uploading' && (
                  <span className="flex items-center gap-3">
                    <span className="text-sm text-gray-500">{videoProgress}%</span>
                    <button type="button" onClick={cancelVideo} className="text-sm font-medium text-gray-500 hover:text-gray-700">
                      Cancel
                    </button>
                  </span>
                )}
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                <progress
                  value={videoPhase === 'processing' ? 100 : videoProgress}
                  max={100}
                  className="progress-bar h-2 w-full rounded-full text-hockia-primary"
                />
              </div>
            </>
          )}
        </div>
      )}

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
            isUploadDragActive ? 'border-hockia-secondary bg-[#f5f3ff]' : 'border-gray-300 hover:border-hockia-secondary'
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
          {canAddVideo && (
            <p className="mt-2 text-sm text-gray-500">
              Videos: MP4, MOV or WebM • Up to 3 minutes — use <span className="font-medium text-hockia-primary">Add Video</span>
            </p>
          )}
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
          {(readOnly && previewLimit && !galleryExpanded
            ? media.slice(0, previewLimit)
            : media
          ).map((item, index) => (
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
                // Photos are announced via their inner img alt; a video tile's
                // poster is decorative (alt=""), so name the button itself.
                aria-label={
                  item.type === 'video'
                    ? `Play video${item.caption ? `: ${item.caption}` : ''}`
                    : undefined
                }
                onClick={() => openPreview(item)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openPreview(item)
                  }
                }}
              >
                {item.type === 'video' ? (
                  <VideoTile item={item} />
                ) : (
                  <StorageImage
                    src={item.url ?? ''}
                    imageSize="gallery"
                    fallbackSrc={item.url ?? ''}
                    alt={item.altText || item.fileName}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    containerClassName="h-full w-full"
                    fallbackClassName="h-full w-full aspect-[3/4]"
                    fallback={<ImageIcon className="h-8 w-8 text-gray-400" />}
                    showLoading={true}
                  />
                )}
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
                    title={item.type === 'video' ? 'Delete video' : 'Delete photo'}
                    aria-label={item.type === 'video' ? 'Delete video' : 'Delete photo'}
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
                    {item.type === 'photo' && (
                      <input
                        type="text"
                        value={altText}
                        onChange={(e) => setAltText(e.target.value)}
                        placeholder="Alt text for accessibility (optional)"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    )}
                    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                      <button
                        onClick={() => saveCaption(item)}
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
                        className="flex-1 rounded-lg border border-hockia-secondary px-3 py-2 text-sm font-medium text-hockia-secondary transition-colors hover:bg-[#f5f3ff] disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none sm:min-w-[120px]"
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
                            className="tap-target px-2 py-1 text-gray-500 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-secondary focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                            disabled={index === 0}
                            type="button"
                          >
                            <ArrowUp className="h-4 w-4" />
                            <span className="sr-only">Move item earlier</span>
                          </button>
                          <button
                            onClick={() => moveMedia(item.id, 'down')}
                            className="tap-target px-2 py-1 text-gray-500 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-secondary focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                            disabled={index === media.length - 1}
                            type="button"
                          >
                            <ArrowDown className="h-4 w-4" />
                            <span className="sr-only">Move item later</span>
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
                isUploadDragActive ? 'border-hockia-secondary bg-[#f5f3ff] text-hockia-secondary' : 'border-gray-300 text-gray-500 hover:border-hockia-secondary'
              }`}
            >
              <Upload className="h-8 w-8" />
              <span className="text-sm font-medium">Add more photos</span>
              <span className="text-xs text-gray-400">Drag files here or tap to browse</span>
            </button>
          )}
        </div>
      )}

      {/* Public-portfolio cap toggle — expands in place, no sub-page. */}
      {!isLoading && readOnly && Boolean(previewLimit) && media.length > (previewLimit ?? 0) && (
        <div className="pt-3">
          <button
            type="button"
            onClick={() => setGalleryExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-hockia-primary hover:underline"
          >
            {galleryExpanded ? 'Show fewer' : `Show all ${media.length}`}
          </button>
        </div>
      )}

      {!isLoading && media.length === 0 && (readOnly || !targetEntityId) && (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Upload className="w-8 h-8 text-gray-400" />
          </div>
          {/* Visitors get a neutral statement — the configured empty copy
              is owner-instructional ("Start building your gallery!"). */}
          <p className="text-gray-600">
            {readOnly
              ? config.supportsVideo
                ? 'No photos or videos yet.'
                : 'No photos yet.'
              : resolvedEmptyState}
          </p>
        </div>
      )}

      <ConfirmActionModal
        isOpen={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        confirmLabel={pendingDelete?.type === 'video' ? 'Delete Video' : 'Delete Photo'}
        confirmTone="danger"
        confirmLoading={Boolean(deletingId)}
        loadingLabel="Deleting..."
        title={pendingDelete?.type === 'video' ? 'Remove video from gallery?' : 'Remove photo from gallery?'}
        description={
          pendingDelete?.type === 'video'
            ? 'This permanently deletes the video. It cannot be recovered.'
            : 'This will permanently delete the image from your gallery.'
        }
        icon={<Trash2 className="h-6 w-6" />}
        body={pendingDelete ? (
          <div className="space-y-3 text-sm text-gray-600">
            <p>Deleting this media removes it from every profile surface.</p>
            {pendingDelete.type === 'video' ? (
              <div className="flex h-48 w-full items-center justify-center rounded-lg bg-gradient-to-br from-[#1a1030] via-[#2a1a4a] to-hockia-primary/40">
                <Film className="h-10 w-10 text-white/80" />
              </div>
            ) : (
              <img
                src={pendingDelete.url ?? undefined}
                alt={pendingDelete.altText || pendingDelete.fileName}
                className="h-48 w-full rounded-lg object-cover"
                loading="lazy"
              />
            )}
          </div>
        ) : undefined}
      />

      <MediaLightbox
        media={
          previewMedia
            ? previewMedia.type === 'video'
              ? {
                  id: previewMedia.id,
                  videoId: previewMedia.id,
                  alt: previewMedia.caption || previewMedia.fileName,
                  isOwner: !readOnly,
                }
              : {
                  id: previewMedia.id,
                  url: previewMedia.url,
                  alt: previewMedia.altText || previewMedia.fileName,
                }
            : null
        }
        onClose={() => setPreviewMedia(null)}
      />
    </div>
  )
}

/** Grid tile for a Gallery video. Fetches only the signed THUMBNAIL — the
 *  player (and its stream token) is mounted by the lightbox on tap. Cloudflare
 *  generates the poster frame automatically for every video, so tiles are
 *  visual without the user uploading anything; the branded gradient is only
 *  the loading/failure fallback. */
function VideoTile({ item }: { item: NormalizedMedia }) {
  const tileRef = useRef<HTMLDivElement>(null)
  // Mint only when the tile approaches the viewport: every mint is an edge-fn
  // call PLUS a Cloudflare token API call, and CF rate-limits that API. A
  // 30-video gallery must not fire 30 mints on first paint for tiles nobody
  // scrolled to. Cached tiles skip the gate (no network involved).
  const [inView, setInView] = useState(false)
  const { thumb, onThumbError, onThumbLoad } = useSignedVideoThumbnail(
    item.id,
    item.status === 'ready' && inView,
  )

  useEffect(() => {
    const el = tileRef.current
    if (!el || inView || thumb) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setInView(true)
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [inView, thumb])

  const handleThumbError = () => {
    // The lazy <img> only attempts a load near the viewport, so an error means
    // the tile is visible — keep the gate open for the hook's re-mint.
    setInView(true)
    onThumbError()
  }

  if (item.status === 'errored') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gray-100 px-3 text-center text-gray-500">
        <AlertCircle className="h-6 w-6 text-red-400" />
        <span className="text-xs">Processing failed — delete and re-upload</span>
      </div>
    )
  }

  if (item.status !== 'ready') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gray-100 text-gray-500">
        <Clock className="h-6 w-6 animate-pulse" />
        <span className="text-xs">Processing…</span>
      </div>
    )
  }

  return (
    <div ref={tileRef} className="relative flex h-full w-full items-center justify-center bg-gradient-to-br from-[#1a1030] via-[#2a1a4a] to-hockia-primary/40 transition-transform duration-300 group-hover:scale-105">
      {thumb && (
        <>
          <img
            src={thumb}
            alt=""
            aria-hidden="true"
            loading="lazy"
            onError={handleThumbError}
            onLoad={onThumbLoad}
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* Keeps the play button + badges legible over bright frames. */}
          <span className="absolute inset-0 bg-black/20" aria-hidden="true" />
        </>
      )}
      <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-white/95 shadow-lg">
        <Play className="ml-0.5 h-6 w-6 text-hockia-primary" fill="currentColor" />
      </span>
      <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
        <Film className="h-3 w-3" />
        Video
      </span>
      {item.durationSeconds != null && (
        <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
          {formatDuration(item.durationSeconds)}
        </span>
      )}
    </div>
  )
}

function normalizePhoto(record: ClubMedia | GalleryPhoto, mode: GalleryMode): NormalizedMedia {
  if (mode === 'club') {
    const item = record as ClubMedia
    return {
      id: item.id,
      type: 'photo',
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
    type: 'photo',
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

function normalizeVideo(row: GalleryVideoRow): NormalizedMedia {
  return {
    id: row.id,
    type: 'video',
    ownerId: row.user_id,
    url: null,
    fileName: row.title,
    fileSize: null,
    caption: row.description,
    altText: null,
    orderIndex: row.display_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    status: row.status,
    durationSeconds: row.duration_seconds,
  }
}
