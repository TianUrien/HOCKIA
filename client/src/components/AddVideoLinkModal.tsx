import { useState, useEffect, useRef, useId } from 'react'
import { X, Link as LinkIcon, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/lib/auth'
import Button from './Button'
import Input from './Input'
import type { Profile } from '@/lib/supabase'
import { isTopFocusTrap, useFocusTrap } from '@/hooks/useFocusTrap'
import { invalidateProfile } from '@/lib/profile'
import { validateAndNormalizeVideoUrl, videoEmbedUrl, videoPlatformLabel } from '@/lib/videoUrlValidator'
import { useMediaT } from '@/i18n/ns/media'

interface AddVideoLinkModalProps {
  isOpen: boolean
  onClose: () => void
  currentVideoUrl: string
}

export default function AddVideoLinkModal({ isOpen, onClose, currentVideoUrl }: AddVideoLinkModalProps) {
  const t = useMediaT()
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
      // Another trapped overlay is on top: its Escape closes it, not this one.
      if (event.key === 'Escape' && !isTopFocusTrap(dialogRef.current)) return
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

  // One checker for every video surface (parses the address; CodeQL 2026-10-23).
  const validateAndNormalizeUrl = validateAndNormalizeVideoUrl

  const handleSave = async () => {
    if (!videoUrl.trim()) {
      setError(t('videoLink.errors.empty'))
      return
    }

    const normalizedUrl = validateAndNormalizeUrl(videoUrl)
    if (!normalizedUrl) {
      setError(t('videoLink.errors.invalid'))
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
      setError(t('videoLink.errors.saveFailed'))
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
              {currentVideoUrl ? t('videoLink.titleManage') : t('videoLink.titleAdd')}
            </h2>
            <button
              onClick={() => !isLoading && onClose()}
              className="text-gray-400 hover:text-gray-600 transition-colors disabled:cursor-not-allowed"
              aria-label={t('videoLink.close')}
              disabled={isLoading}
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={videoUrlInputId}>
              {t('videoLink.urlLabel')}
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
              {t('videoLink.urlHint')}
            </p>
            {error && (
              <p className="mt-2 text-sm text-red-600">{error}</p>
            )}
            {!error && videoUrl.trim() && !validateAndNormalizeUrl(videoUrl) && (
              <p className="mt-2 text-sm text-amber-600">
                {t('videoLink.unrecognised')}
              </p>
            )}
          </div>

          {videoUrl && validateAndNormalizeUrl(videoUrl) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('videoLink.preview')}
              </label>
              <VideoPreview url={validateAndNormalizeUrl(videoUrl)!} />
            </div>
          )}

          <div className="rounded-lg border border-line bg-surface-subtle p-4">
            <p className="text-sm font-medium text-ink-1">{t('videoLink.platformsTitle')}</p>
            <p className="mt-1 text-sm text-ink-2">
              {t('videoLink.platformsBody')}
            </p>
          </div>
        </div>

        <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => !isLoading && onClose()}
            disabled={isLoading}
          >
            {t('videoLink.cancel')}
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
                {t('videoLink.saving')}
              </>
            ) : (
              t('videoLink.save')
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

// Video Preview Component
function VideoPreview({ url }: { url: string }) {
  const t = useMediaT()
  // Only a real YouTube / Vimeo / Drive player is embedded, never the raw text.
  const embedUrl = videoEmbedUrl(url)
  const platform = videoPlatformLabel(url)
  if (!embedUrl) return null

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
        title={t('videoLink.previewFrameTitle')}
      />
    </div>
  )
}
