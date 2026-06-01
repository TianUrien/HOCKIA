import { useState, useCallback, useRef } from 'react'
import { Upload } from 'tus-js-client'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

/**
 * useNativeVideoUpload — drives a native player-video upload to Cloudflare
 * Stream end-to-end:
 *   1. POST video-create-upload (Edge Fn) → { videoId, uploadURL }.
 *   2. PUT/POST the file straight to Cloudflare's one-shot uploadURL
 *      (bytes never touch our server) with progress.
 *   3. Poll player_videos.status until 'ready' (the Cloudflare webhook
 *      flips it; polling is the UI's source of truth so we show progress
 *      even if the webhook is briefly late).
 *
 * Returns granular state so the modal can render upload % then a
 * "processing…" spinner, then success.
 */

export type UploadPhase =
  | 'idle'
  | 'creating'      // asking the edge fn for an upload URL
  | 'uploading'     // pushing bytes to Cloudflare
  | 'processing'    // Cloudflare transcoding; we poll for ready
  | 'ready'
  | 'error'

interface UploadOptions {
  title: string
  description?: string
  visibility?: 'public' | 'recruiters'
  kind?: 'highlight' | 'full_match'
}

const MAX_BYTES = 1_073_741_824 // 1 GB
const ALLOWED = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v']
const POLL_MS = 4000
const POLL_TIMEOUT_MS = 10 * 60 * 1000 // 10 min ceiling

export function useNativeVideoUpload() {
  const [phase, setPhase] = useState<UploadPhase>('idle')
  const [progress, setProgress] = useState(0) // 0..100 (upload bytes)
  const [error, setError] = useState<string | null>(null)
  const [videoId, setVideoId] = useState<string | null>(null)
  const cancelRef = useRef(false)
  const uploadRef = useRef<Upload | null>(null)

  const reset = useCallback(() => {
    cancelRef.current = false
    setPhase('idle')
    setProgress(0)
    setError(null)
    setVideoId(null)
  }, [])

  const upload = useCallback(async (file: File, opts: UploadOptions): Promise<string | null> => {
    cancelRef.current = false
    setError(null)
    setProgress(0)

    // ── Client-side guardrails (the edge fn + Cloudflare enforce too) ──
    if (!ALLOWED.includes(file.type)) {
      setError('Please upload an MP4, MOV, WebM or M4V video.')
      setPhase('error')
      return null
    }
    if (file.size > MAX_BYTES) {
      setError('Video is larger than 1 GB. Please trim or compress it first.')
      setPhase('error')
      return null
    }

    // ── 1. Ask the edge fn for a Cloudflare RESUMABLE (tus) upload URL ──
    setPhase('creating')
    let createData: { videoId: string; tusUploadUrl: string } | null = null
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('video-create-upload', {
        body: {
          title: opts.title,
          description: opts.description ?? null,
          visibility: opts.visibility ?? 'public',
          kind: opts.kind ?? 'highlight',
          fileSize: file.size,
        },
      })
      if (fnErr) throw fnErr
      if (!data?.tusUploadUrl || !data?.videoId) throw new Error('No upload URL returned')
      createData = data as { videoId: string; tusUploadUrl: string }
    } catch (err) {
      logger.error('[useNativeVideoUpload] create-upload failed', err)
      setError('Could not start the upload. Please try again.')
      setPhase('error')
      return null
    }
    setVideoId(createData.videoId)

    // ── 2. Resumable upload straight to Cloudflare via tus ──
    //    tus has no 200 MB cap (the basic one-shot does) and resumes if a
    //    mobile connection drops mid-upload. The edge fn already created
    //    the asset + set its metadata, so here we only push bytes to the
    //    returned upload URL (no auth needed client-side).
    setPhase('uploading')
    const uploadOk = await new Promise<boolean>((resolve) => {
      const tus = new Upload(file, {
        uploadUrl: createData!.tusUploadUrl,
        chunkSize: 50 * 1024 * 1024, // 50 MB chunks — CF tus requires a fixed chunkSize
        retryDelays: [0, 3000, 6000, 12000],
        metadata: { filename: file.name, filetype: file.type },
        onProgress: (sent, total) => setProgress(Math.round((sent / total) * 100)),
        onError: (err) => {
          logger.error('[useNativeVideoUpload] tus error', err)
          resolve(false)
        },
        onSuccess: () => resolve(true),
      })
      uploadRef.current = tus
      if (cancelRef.current) { resolve(false); return }
      tus.start()
    })
    uploadRef.current = null
    if (cancelRef.current) { setPhase('idle'); return null }
    if (!uploadOk) {
      setError('The upload was interrupted. Please try again.')
      setPhase('error')
      return null
    }
    setProgress(100)

    // ── 3. Poll player_videos.status until ready (webhook flips it) ──
    setPhase('processing')
    const startedAt = Date.now()
    while (!cancelRef.current) {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        // Not an error per se — processing can finish later; tell the user.
        setError('Still processing — check back in a few minutes.')
        setPhase('error')
        return createData.videoId
      }
      await new Promise((r) => setTimeout(r, POLL_MS))
      const { data: row } = await supabase
        .from('player_videos')
        .select('status')
        .eq('id', createData.videoId)
        .single()
      const status = (row as { status?: string } | null)?.status
      if (status === 'ready') {
        setPhase('ready')
        return createData.videoId
      }
      if (status === 'errored') {
        setError('Cloudflare could not process this video. Try a different file.')
        setPhase('error')
        return createData.videoId
      }
    }
    return createData.videoId
  }, [])

  const cancel = useCallback(() => {
    cancelRef.current = true
    if (uploadRef.current) {
      void uploadRef.current.abort()
      uploadRef.current = null
    }
  }, [])

  return { phase, progress, error, videoId, upload, cancel, reset }
}
