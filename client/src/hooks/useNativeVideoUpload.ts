import { useState, useCallback, useRef } from 'react'
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

    // ── 1. Ask the edge fn for a Cloudflare direct-upload URL ──
    setPhase('creating')
    let createData: { videoId: string; uploadURL: string } | null = null
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('video-create-upload', {
        body: {
          title: opts.title,
          description: opts.description ?? null,
          visibility: opts.visibility ?? 'public',
          kind: opts.kind ?? 'highlight',
        },
      })
      if (fnErr) throw fnErr
      if (!data?.uploadURL || !data?.videoId) throw new Error('No upload URL returned')
      createData = data as { videoId: string; uploadURL: string }
    } catch (err) {
      logger.error('[useNativeVideoUpload] create-upload failed', err)
      setError('Could not start the upload. Please try again.')
      setPhase('error')
      return null
    }
    setVideoId(createData.videoId)

    // ── 2. Upload bytes straight to Cloudflare (XHR for progress) ──
    setPhase('uploading')
    const uploadOk = await new Promise<boolean>((resolve) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', createData!.uploadURL, true)
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100))
      }
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300)
      xhr.onerror = () => resolve(false)
      xhr.onabort = () => resolve(false)
      if (cancelRef.current) { xhr.abort(); return }
      const form = new FormData()
      form.append('file', file)
      xhr.send(form)
    })
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
  }, [])

  return { phase, progress, error, videoId, upload, cancel, reset }
}
