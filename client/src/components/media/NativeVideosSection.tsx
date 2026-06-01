import { useState, useEffect, useCallback } from 'react'
import { Film, Plus, Trash2, Loader2, Clock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import Button from '../Button'
import NativeVideoPlayer from './NativeVideoPlayer'
import UploadVideoModal from './UploadVideoModal'
import ConfirmActionModal from '../ConfirmActionModal'

/**
 * NativeVideosSection — the player's natively-uploaded (Cloudflare Stream)
 * videos. Owner sees an "Upload" CTA + delete controls + their own
 * processing/failed rows; visitors see only ready rows that RLS exposes
 * to them (public always; recruiters-only to club/coach).
 *
 * This runs ALONGSIDE the legacy embed highlight (hybrid). Embeds keep
 * working; native upload is the new, reliable primary path.
 */
interface PlayerVideoRow {
  id: string
  title: string
  description: string | null
  visibility: 'public' | 'recruiters'
  status: string
  playback_id: string | null
  thumbnail_url: string | null
  duration_seconds: number | null
}

interface NativeVideosSectionProps {
  playerUserId: string
  readOnly: boolean
}

export default function NativeVideosSection({ playerUserId, readOnly }: NativeVideosSectionProps) {
  const [videos, setVideos] = useState<PlayerVideoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PlayerVideoRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchVideos = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('player_videos')
        .select('id, title, description, visibility, status, playback_id, thumbnail_url, duration_seconds')
        .eq('user_id', playerUserId)
        .order('created_at', { ascending: false })
      if (error) throw error
      setVideos((data ?? []) as unknown as PlayerVideoRow[])
    } catch (err) {
      logger.error('[NativeVideosSection] fetch failed', err)
      setVideos([])
    } finally {
      setLoading(false)
    }
  }, [playerUserId])

  useEffect(() => { void fetchVideos() }, [fetchVideos])

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const { error } = await supabase.from('player_videos').delete().eq('id', deleteTarget.id)
      if (error) throw error
      setVideos((prev) => prev.filter((v) => v.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (err) {
      logger.error('[NativeVideosSection] delete failed', err)
    } finally {
      setDeleting(false)
    }
  }

  // Visitors with zero visible native videos: render nothing (the embed
  // highlight + full-game section already cover the empty case).
  const visibleReady = videos.filter((v) => v.status === 'ready')
  if (readOnly && visibleReady.length === 0) return null

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold text-gray-900">
            <Film className="h-4 w-4 text-[#8026FA]" />
            Uploaded videos
          </h3>
          <p className="text-xs text-gray-500">Videos hosted on HOCKIA — play instantly, no external links.</p>
        </div>
        {!readOnly && (
          <Button variant="outline" onClick={() => setUploadOpen(true)} className="flex items-center gap-1.5 whitespace-nowrap">
            <Plus className="h-4 w-4" />
            Upload
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : videos.length === 0 ? (
        !readOnly && (
          <p className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
            No uploaded videos yet. Tap “Upload” to add your first highlight — it plays directly inside HOCKIA.
          </p>
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {videos.map((v) => (
            <div key={v.id} className="space-y-1.5">
              {v.status === 'ready' ? (
                <NativeVideoPlayer
                  videoId={v.id}
                  thumbnailUrl={v.thumbnail_url}
                  title={v.title}
                  durationSeconds={v.duration_seconds}
                />
              ) : (
                // Owner-only processing / failed state.
                <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl bg-gray-100 text-gray-500">
                  {v.status === 'errored' ? (
                    <span className="text-xs">Processing failed — try re-uploading</span>
                  ) : (
                    <>
                      <Clock className="h-5 w-5 animate-pulse" />
                      <span className="text-xs">Processing…</span>
                    </>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{v.title}</p>
                  {v.visibility === 'recruiters' && (
                    <span className="text-[11px] font-medium text-[#8026FA]">Recruiters only</span>
                  )}
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(v)}
                    aria-label={`Delete ${v.title}`}
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <UploadVideoModal
        isOpen={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => { void fetchVideos() }}
      />
      <ConfirmActionModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete this video?"
        description="This permanently removes the video from your profile."
        confirmLabel="Delete"
        confirmLoading={deleting}
        confirmTone="danger"
      />
    </section>
  )
}
