import { useState, useEffect, useRef, useId } from 'react'
import { X, Link as LinkIcon, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/lib/auth'
import Button from './Button'
import Input from './Input'
import type { Profile } from '@/lib/supabase'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { invalidateProfile } from '@/lib/profile'

interface AddVideoLinkModalProps {
  isOpen: boolean
  onClose: () => void
  currentVideoUrl: string
}

export default function AddVideoLinkModal({ isOpen, onClose, currentVideoUrl }: AddVideoLinkModalProps) {
  const { user } = useAuthStore()
  const [videoUrl, setVideoUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const titleId = useId()
  const videoUrlInputId = useId()

  useFocusTrap({ containerRef: dialogRef, isActive: isOpen, initialFocusRef: inputRef })

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isLoading) {
        event.preventDefault()
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isLoading, isOpen, onClose])

  useEffect(() => {
    if (isOpen) {
      setVideoUrl(currentVideoUrl)
      setError('')
    }
  }, [isOpen, currentVideoUrl])

  const validateAndNormalizeUrl = (url: string): string | null => {
    try {
      // YouTube patterns
      if (url.includes('youtube.com') || url.includes('youtu.be')) {
        let videoId = ''
        if (url.includes('youtu.be/')) {
          videoId = url.split('youtu.be/')[1]?.split('?')[0] || ''
        } else if (url.includes('youtube.com')) {
          const urlParams = new URLSearchParams(url.split('?')[1] || '')
          videoId = urlParams.get('v') || ''
        }
        if (!videoId) return null
        return `https://www.youtube.com/watch?v=${videoId}`
      }

      // Vimeo patterns
      if (url.includes('vimeo.com')) {
        const videoId = url.split('vimeo.com/')[1]?.split('?')[0]
        if (!videoId) return null
        return `https://vimeo.com/${videoId}`
      }

      // Google Drive patterns
      if (url.includes('drive.google.com')) {
        let fileId = ''
        if (url.includes('/file/d/')) {
          fileId = url.split('/file/d/')[1]?.split('/')[0] || ''
        } else {
          const urlParams = new URLSearchParams(url.split('?')[1] || '')
          fileId = urlParams.get('id') || ''
        }
        if (!fileId) return null
        return `https://drive.google.com/file/d/${fileId}/view`
      }

      return null
    } catch {
      return null
    }
  }

  const handleSave = async () => {
    if (!videoUrl.trim()) {
      setError('Please enter a video URL')
      return
    }

    const normalizedUrl = validateAndNormalizeUrl(videoUrl)
    if (!normalizedUrl) {
      setError('Invalid video URL. Please use YouTube, Vimeo, or Google Drive links.')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const updatePayload: Partial<Profile> = { highlight_video_url: normalizedUrl }

      const { error: updateError } = await supabase
        .from('profiles')
        .update(updatePayload)
        .eq('id', user?.id || '')

      if (updateError) throw updateError

      if (user?.id) {
        await invalidateProfile({ userId: user.id, reason: 'highlight-video-updated' })
      }
      onClose()
    } catch (err) {
      logger.error('Error saving video:', err)
      setError('Failed to save video. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="presentation">
      <div
        ref={dialogRef}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto focus:outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 id={titleId} className="text-2xl font-bold text-gray-900">
              {currentVideoUrl ? 'Manage Highlight Video' : 'Add Video Link'}
            </h2>
            <button
              onClick={() => !isLoading && onClose()}
              className="text-gray-400 hover:text-gray-600 transition-colors disabled:cursor-not-allowed"
              aria-label="Close modal"
              disabled={isLoading}
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={videoUrlInputId}>
              Video URL
            </label>
            <Input
              id={videoUrlInputId}
              ref={inputRef}
              type="text"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              icon={<LinkIcon className="w-5 h-5" />}
              disabled={isLoading}
            />
            <p className="mt-2 text-xs text-gray-500">
              Paste the full share link from YouTube, Vimeo, or Google Drive. We will normalize the URL automatically before saving.
            </p>
            {error && (
              <p className="mt-2 text-sm text-red-600">{error}</p>
            )}
            {!error && videoUrl.trim() && !validateAndNormalizeUrl(videoUrl) && (
              <p className="mt-2 text-sm text-amber-600">
                We don’t recognise this link. Use a YouTube, Vimeo, or Google Drive URL.
              </p>
            )}
          </div>

          {videoUrl && validateAndNormalizeUrl(videoUrl) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Preview:
              </label>
              <VideoPreview url={validateAndNormalizeUrl(videoUrl)!} />
            </div>
          )}

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm font-medium text-blue-900">Supported platforms</p>
            <p className="mt-1 text-sm text-blue-700">
              YouTube (`youtube.com`, `youtu.be`), Vimeo (`vimeo.com`), and Google Drive (`drive.google.com`). If your link includes splash page parameters we will clean them up.
            </p>
          </div>
        </div>

        <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => !isLoading && onClose()}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            // Disable Save until the URL is non-empty AND normalises to a
            // recognised platform. Previously the button stayed enabled
            // and validation only ran after click, which made the form
            // feel broken. Inline error message in the input below
            // surfaces the same validation as the user types.
            disabled={isLoading || !videoUrl.trim() || !validateAndNormalizeUrl(videoUrl)}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Video'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

// Video Preview Component
function VideoPreview({ url }: { url: string }) {
  const getEmbedUrl = (url: string) => {
    if (url.includes('youtube.com')) {
      const videoId = new URLSearchParams(url.split('?')[1]).get('v')
      return `https://www.youtube.com/embed/${videoId}`
    }

    if (url.includes('vimeo.com')) {
      const videoId = url.split('vimeo.com/')[1]
      return `https://player.vimeo.com/video/${videoId}`
    }

    if (url.includes('drive.google.com')) {
      const fileId = url.split('/file/d/')[1]?.split('/')[0]
      return `https://drive.google.com/file/d/${fileId}/preview`
    }

    return url
  }

  const embedUrl = getEmbedUrl(url)
  const platform = url.includes('youtube')
    ? 'YouTube'
    : url.includes('vimeo')
    ? 'Vimeo'
    : 'Google Drive'

  return (
    <div className="relative w-full rounded-lg overflow-hidden bg-black aspect-video">
      <div className="absolute top-3 left-3 z-10">
        <span className="px-2 py-1 bg-red-600 text-white text-xs font-semibold rounded">
          {platform}
        </span>
      </div>
      <iframe
        src={embedUrl}
        className="absolute top-0 left-0 w-full h-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        title="Video preview"
      />
    </div>
  )
}
