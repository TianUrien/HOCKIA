import { create } from 'zustand'
import { Upload as TusUpload } from 'tus-js-client'
import { supabase } from './supabase'
import { validateVideoFull } from './imageOptimization'
import { logger } from './logger'

// ---------------------------------------------------------------------------
// Post video uploads go to CLOUDFLARE STREAM (not Supabase Storage).
//
// A Home "Add video" post is a HOME VIDEO POST (player_videos.kind='post'): the
// bytes are tus-uploaded straight to Cloudflare (they never touch our server) and
// Postgres stores only the video record; the post references it by `video_id`.
// It is its own product concept — distinct from a Gallery video (kind='reel')
// and from recruitment evidence (kind='highlight'/'full_match'). Surfaces do not
// overlap. Playback is a signed, role-gated token minted at render, so a post
// video is never an open public URL. Images still go to Supabase Storage.
//
// This store stays GLOBAL so an upload survives closing the composer, tab
// switches, and navigation — same contract as the old Supabase path.
// ---------------------------------------------------------------------------

const POLL_MS = 4000
const POLL_TIMEOUT_MS = 10 * 60 * 1000 // 10 min ceiling
const CF_CHUNK_SIZE = 50 * 1024 * 1024 // Cloudflare tus requires a fixed chunk size

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UploadStatus =
  | 'validating'
  | 'uploading'
  | 'processing' // bytes are up; Cloudflare is transcoding
  | 'paused'
  | 'completed'
  | 'error'
  | 'cancelled'

export interface VideoUploadResult {
  /** player_videos.id — the post stores this, NOT a URL. */
  videoId: string
  width: number | null
  height: number | null
  duration: number | null
}

export interface UploadEntry {
  id: string
  fileName: string
  status: UploadStatus
  progress: number // 0-100
  error: string | null
  result: VideoUploadResult | null
  /** Internal — TUS instance for pause/resume/cancel */
  tusUpload: TusUpload | null
  /** Callback invoked on success (set by the dispatching component) */
  onComplete: ((result: VideoUploadResult) => void) | null
}

interface UploadManagerState {
  uploads: Record<string, UploadEntry>

  /** Kick off a Cloudflare video upload. Returns the upload ID. */
  startVideoUpload: (params: {
    file: File
    onComplete: (result: VideoUploadResult) => void
  }) => string

  cancelUpload: (uploadId: string) => void
  pauseUpload: (uploadId: string) => void
  resumeUpload: (uploadId: string) => void
  dismissUpload: (uploadId: string) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Translate raw upload/network errors into user-friendly messages */
function formatUploadError(raw: string): string {
  const lower = raw.toLowerCase()
  if (
    lower.includes('exceeded the maximum allowed size') ||
    lower.includes('maximum size exceeded') ||
    lower.includes('payload too large') ||
    lower.includes('content too large')
  )
    return 'This file is too large. Videos must be under 100 MB.'
  if (lower.includes('mime type') || lower.includes('content type') || lower.includes('not allowed'))
    return 'This file type is not supported. Use MP4, MOV, or WebM.'
  if (lower.includes('network error') || lower.includes('failed to fetch'))
    return 'Network error — please check your connection and try again.'
  if (lower.includes('provider_not_configured'))
    return 'Video uploads are temporarily unavailable. Please try again later.'
  return raw
}

/** video-create-upload requires a 1–120 char title; derive one from the file. */
function deriveTitle(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, '').trim()
  return (base || 'Video').slice(0, 120)
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useUploadManager = create<UploadManagerState>((set, get) => {
  const updateUpload = (id: string, patch: Partial<UploadEntry>) => {
    set((state) => {
      const existing = state.uploads[id]
      if (!existing) return state
      return { uploads: { ...state.uploads, [id]: { ...existing, ...patch } } }
    })
  }

  // --- Visibility change: pause/resume TUS on tab hide/show ---
  let visibilityBound = false
  const bindVisibility = () => {
    if (visibilityBound || typeof document === 'undefined') return
    visibilityBound = true

    document.addEventListener('visibilitychange', () => {
      const { uploads } = get()
      for (const entry of Object.values(uploads)) {
        if (document.visibilityState === 'hidden' && entry.status === 'uploading' && entry.tusUpload) {
          entry.tusUpload.abort(false)
          updateUpload(entry.id, { status: 'paused' })
          logger.info('[UploadManager] Paused upload (tab hidden):', entry.id)
        } else if (document.visibilityState === 'visible' && entry.status === 'paused' && entry.tusUpload) {
          entry.tusUpload.start()
          updateUpload(entry.id, { status: 'uploading' })
          logger.info('[UploadManager] Resumed upload (tab visible):', entry.id)
        }
      }
    })
  }

  return {
    uploads: {},

    startVideoUpload: ({ file, onComplete }) => {
      bindVisibility()

      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

      const entry: UploadEntry = {
        id,
        fileName: file.name,
        status: 'validating',
        progress: 0,
        error: null,
        result: null,
        tusUpload: null,
        onComplete,
      }

      set((state) => ({ uploads: { ...state.uploads, [id]: entry } }))

      const isCancelled = () => get().uploads[id]?.status === 'cancelled'

      // Fire-and-forget async pipeline
      ;(async () => {
        try {
          // Step 1 — client-side validation (size / type / duration)
          const validation = await validateVideoFull(file)
          if (!validation.valid) {
            updateUpload(id, { status: 'error', error: validation.error || 'Invalid video' })
            return
          }
          if (isCancelled()) return

          // Step 2 — ask the edge fn for a Cloudflare resumable (tus) upload URL.
          // kind='post' → a HOME VIDEO POST: it renders as the feed post itself,
          // never as a recruitment "New highlight" card (only highlight/full_match
          // do that), and never in the Gallery (that's kind='reel').
          updateUpload(id, { status: 'uploading', progress: 0 })
          const { data, error: fnErr } = await supabase.functions.invoke('video-create-upload', {
            body: {
              title: deriveTitle(file),
              kind: 'post',
              visibility: 'public',
              fileSize: file.size,
            },
          })
          if (fnErr) {
            // functions.invoke throws a FunctionsHttpError whose message is the
            // static "non-2xx status code" — the real reason is only in the
            // response body on error.context. Read it so users see something useful.
            const ctx = (fnErr as { context?: Response }).context
            let reason = ''
            try {
              reason = ctx ? ((await ctx.clone().json()) as { error?: string }).error ?? '' : ''
            } catch { /* body not JSON — fall through to the generic message */ }
            throw new Error(reason || 'Could not start the upload. Please try again.')
          }
          const created = data as { videoId?: string; tusUploadUrl?: string } | null
          if (!created?.videoId || !created?.tusUploadUrl) {
            throw new Error('Could not start the upload. Please try again.')
          }
          if (isCancelled()) return

          // Step 3 — push bytes straight to Cloudflare (never through our server)
          await new Promise<void>((resolve, reject) => {
            const tus = new TusUpload(file, {
              uploadUrl: created.tusUploadUrl,
              chunkSize: CF_CHUNK_SIZE,
              retryDelays: [0, 3000, 6000, 12000],
              metadata: { filename: file.name, filetype: file.type },
              onProgress: (sent, total) => {
                updateUpload(id, { progress: Math.round((sent / total) * 100) })
              },
              onError: (err) => reject(err),
              onSuccess: () => resolve(),
            })
            updateUpload(id, { tusUpload: tus })
            if (isCancelled()) {
              reject(new Error('Cancelled'))
              return
            }
            tus.start()
          })
          if (isCancelled()) return
          updateUpload(id, { progress: 100, status: 'processing', tusUpload: null })

          // Step 4 — Cloudflare transcodes; the webhook flips player_videos to
          // 'ready'. Poll so we only hand the composer a PLAYABLE video.
          const startedAt = Date.now()
          for (;;) {
            if (isCancelled()) return
            if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
              throw new Error('Still processing — check back in a few minutes.')
            }
            await new Promise((r) => setTimeout(r, POLL_MS))
            const { data: row } = await supabase
              .from('player_videos')
              .select('status')
              .eq('id', created.videoId)
              .single()
            const status = (row as { status?: string } | null)?.status
            if (status === 'ready') break
            if (status === 'errored') {
              throw new Error('Cloudflare could not process this video. Try a different file.')
            }
          }

          const result: VideoUploadResult = {
            videoId: created.videoId,
            width: validation.width ?? null,
            height: validation.height ?? null,
            duration: validation.duration ?? null,
          }

          updateUpload(id, { status: 'completed', progress: 100, result, tusUpload: null })
          get().uploads[id]?.onComplete?.(result)
        } catch (err) {
          if (isCancelled()) return
          const message = err instanceof Error ? err.message : 'Upload failed'
          logger.error('[UploadManager] Cloudflare upload pipeline error:', err)
          updateUpload(id, {
            status: 'error',
            error: formatUploadError(message),
            tusUpload: null,
          })
        }
      })()

      return id
    },

    cancelUpload: (uploadId) => {
      const entry = get().uploads[uploadId]
      if (!entry) return
      if (entry.tusUpload) entry.tusUpload.abort(true)
      updateUpload(uploadId, { status: 'cancelled', tusUpload: null })
    },

    pauseUpload: (uploadId) => {
      const entry = get().uploads[uploadId]
      if (!entry || entry.status !== 'uploading' || !entry.tusUpload) return
      entry.tusUpload.abort(false)
      updateUpload(uploadId, { status: 'paused' })
    },

    resumeUpload: (uploadId) => {
      const entry = get().uploads[uploadId]
      if (!entry || entry.status !== 'paused' || !entry.tusUpload) return
      entry.tusUpload.start()
      updateUpload(uploadId, { status: 'uploading' })
    },

    dismissUpload: (uploadId) => {
      set((state) => {
        const next = { ...state.uploads }
        delete next[uploadId]
        return { uploads: next }
      })
    },
  }
})
