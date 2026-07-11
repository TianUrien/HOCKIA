import { useRef, useCallback } from 'react'
import { ImagePlus, X, Loader2, Film, Play } from 'lucide-react'
import { useSignedVideoThumbnail } from '@/hooks/useSignedVideoThumbnail'

export interface UploadedMedia {
  url?: string
  /** player_videos.id — Cloudflare-backed video item (no url). */
  video_id?: string
  thumb_url?: string | null
  media_type: 'image' | 'video'
  width?: number | null
  height?: number | null
  duration?: number | null
  order: number
}

interface PostMediaUploaderProps {
  media: UploadedMedia[]
  onAddImage: (file: File) => Promise<void>
  onAddVideo: (file: File) => void | Promise<void>
  onRemove: (index: number) => void
  onCancelUpload?: () => void
  isUploading: boolean
  uploadProgress?: number | null
  maxItems?: number
  /** Hide the video path entirely. False on announcements (transfer/signing):
   *  their cards can't play video and the RPCs reject Cloudflare video items —
   *  offering the button would produce a dead tile or a server error. Also
   *  false while the video_posts_enabled launch flag is off. */
  allowVideo?: boolean
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Composer preview for a video item. A Cloudflare item ({video_id}, no url)
 *  is only handed to the composer once processing is READY, so its
 *  auto-generated poster frame is fetchable immediately — showing it confirms
 *  to the user the video processed correctly and how the post will look.
 *  Legacy items keep their stored thumb_url; the dark Film tile is only the
 *  loading/failure fallback. */
function VideoPreview({ item, index }: { item: UploadedMedia; index: number }) {
  const { thumb, onThumbError, onThumbLoad } = useSignedVideoThumbnail(item.video_id)
  const isSigned = !item.thumb_url && Boolean(thumb)
  const poster = item.thumb_url ?? thumb

  return (
    <>
      {/* Video thumbnail or poster */}
      {poster ? (
        <img
          src={poster}
          alt={`Video ${index + 1}`}
          onError={isSigned ? onThumbError : undefined}
          onLoad={isSigned ? onThumbLoad : undefined}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full bg-gray-800 flex items-center justify-center">
          <Film className="w-10 h-10 text-gray-400" />
        </div>
      )}
      {/* Play icon overlay */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
          <Play className="w-6 h-6 text-white ml-0.5" fill="white" />
        </div>
      </div>
      {/* Duration badge */}
      {item.duration != null && (
        <span className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/70 text-white text-xs rounded-full font-medium">
          {formatDuration(item.duration)}
        </span>
      )}
    </>
  )
}

export function PostMediaUploader({
  media,
  onAddImage,
  onAddVideo,
  onRemove,
  onCancelUpload,
  isUploading,
  uploadProgress,
  maxItems = 5,
  allowVideo = true,
}: PostMediaUploaderProps) {
  const imageInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  const handleImageChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    await onAddImage(file)
  }, [onAddImage])

  const handleVideoChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    await onAddVideo(file)
  }, [onAddVideo])

  const canAddMore = media.length < maxItems
  const hasVideo = media.some(m => m.media_type === 'video')

  // Hidden file inputs shared across all states
  const fileInputs = (
    <>
      <input
        ref={imageInputRef}
        type="file"
        accept=".jpg,.jpeg,.png"
        onChange={handleImageChange}
        className="hidden"
        aria-label="Select image file"
      />
      {allowVideo && (
        <input
          ref={videoInputRef}
          type="file"
          accept=".mp4,.mov,.webm"
          onChange={handleVideoChange}
          className="hidden"
          aria-label="Select video file"
        />
      )}
    </>
  )

  // Empty state — show add buttons with file size limits
  if (media.length === 0 && !isUploading) {
    return (
      <div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={isUploading}
            className="flex-1 py-8 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors disabled:opacity-50"
          >
            <ImagePlus className="w-6 h-6" />
            <span className="text-sm">Add photos</span>
          </button>
          {allowVideo && (
            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              disabled={isUploading}
              className="flex-1 py-8 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-purple-400 hover:text-purple-500 transition-colors disabled:opacity-50"
            >
              <Film className="w-6 h-6" />
              <span className="text-sm">Add video</span>
            </button>
          )}
          {fileInputs}
        </div>
        <p className="text-xs text-gray-400 mt-1.5">
          {allowVideo
            ? `Photos: up to 10 MB each · Video: up to 100 MB, 3 min max · Up to ${maxItems} items`
            : `Photos: up to 10 MB each · Up to ${maxItems} items`}
        </p>
      </div>
    )
  }

  // Full-screen upload progress (no media yet, uploading first item)
  if (media.length === 0 && isUploading) {
    return (
      <div>
        <div className="py-10 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-3 text-gray-500">
          <Loader2 className="w-8 h-8 animate-spin text-hockia-primary" />
          {uploadProgress != null ? (
            <div className="w-48 text-center">
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-hockia-primary rounded-full transition-all duration-300"
                  style={{ width: `${Math.round(uploadProgress)}%` }}
                />
              </div>
              <span className="text-sm mt-1.5 block font-medium">{Math.round(uploadProgress)}%</span>
              <span className="text-xs text-gray-400">Uploading video...</span>
            </div>
          ) : (
            <span className="text-sm">Uploading...</span>
          )}
          {onCancelUpload && (
            <button
              type="button"
              onClick={onCancelUpload}
              className="mt-1 px-4 py-1.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
            >
              Cancel upload
            </button>
          )}
        </div>
        {fileInputs}
      </div>
    )
  }

  // Grid layout based on item count
  const gridClass =
    media.length === 1
      ? 'grid-cols-1'
      : 'grid-cols-2'

  return (
    <div>
      <div className={`grid ${gridClass} gap-2`}>
        {media.map((item, i) => (
          <div
            key={item.video_id ?? item.url}
            className={`relative rounded-lg overflow-hidden bg-gray-100 group ${
              media.length === 1 ? 'aspect-[16/9]' : 'aspect-square'
            }`}
          >
            {item.media_type === 'video' ? (
              <VideoPreview item={item} index={i} />
            ) : (
              <img
                src={item.url}
                alt={`Upload ${i + 1}`}
                className="w-full h-full object-cover"
              />
            )}

            {/* Remove button */}
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="absolute top-2 right-2 p-1.5 bg-black/60 rounded-full text-white hover:bg-black/80 transition-colors opacity-0 group-hover:opacity-100"
              aria-label={`Remove ${item.media_type === 'video' ? 'video' : 'image'} ${i + 1}`}
            >
              <X className="w-3.5 h-3.5" />
            </button>

            {/* Order badge */}
            {i === 0 && media.length > 1 && (
              <span className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/60 text-white text-xs rounded-full">
                Main
              </span>
            )}
          </div>
        ))}

        {/* Add more button */}
        {canAddMore && !isUploading && (
          <div className={`flex gap-1 ${media.length === 1 ? 'aspect-[16/9]' : 'aspect-square'}`}>
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="flex-1 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors"
            >
              <ImagePlus className="w-5 h-5" />
              <span className="text-[10px]">Photo</span>
            </button>
            {allowVideo && !hasVideo && (
              <button
                type="button"
                onClick={() => videoInputRef.current?.click()}
                className="flex-1 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-purple-400 hover:text-purple-500 transition-colors"
              >
                <Film className="w-5 h-5" />
                <span className="text-[10px]">Video</span>
              </button>
            )}
          </div>
        )}

        {/* Upload progress indicator (when adding to existing media) */}
        {isUploading && (
          <div className={`border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-2 text-gray-400 ${
            media.length === 1 ? 'aspect-[16/9]' : 'aspect-square'
          }`}>
            <Loader2 className="w-6 h-6 animate-spin text-hockia-primary" />
            {uploadProgress != null ? (
              <div className="w-3/4 text-center">
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-hockia-primary rounded-full transition-all duration-300"
                    style={{ width: `${Math.round(uploadProgress)}%` }}
                  />
                </div>
                <span className="text-xs mt-1 block">{Math.round(uploadProgress)}%</span>
              </div>
            ) : (
              <span className="text-xs">Uploading...</span>
            )}
            {onCancelUpload && (
              <button
                type="button"
                onClick={onCancelUpload}
                className="px-3 py-1 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-1.5">
        {media.length}/{maxItems} items · Photos: up to 10 MB{hasVideo ? '' : ' · Video: up to 100 MB, 3 min'}
      </p>

      {fileInputs}
    </div>
  )
}
