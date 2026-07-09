import { vi, describe, it, expect, beforeEach } from 'vitest'

/**
 * The Home composer's global upload store creates HOME VIDEO POSTS —
 * player_videos kind='post', never 'reel' (Gallery) and never 'highlight'
 * (recruitment). The kind it sends to video-create-upload is the only thing
 * deciding which product surface the video belongs to, so this test fails
 * loudly if someone flips it back to 'reel' (the pre-taxonomy bug) or lets it
 * default to 'highlight'.
 */

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: invokeMock },
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { status: 'ready' } }) }) }),
    }),
  },
}))

vi.mock('@/lib/imageOptimization', () => ({
  validateVideoFull: vi.fn().mockResolvedValue({ valid: true, duration: 30, width: 640, height: 480 }),
}))

vi.mock('tus-js-client', () => ({
  Upload: class {
    opts: { onSuccess?: () => void }
    constructor(_file: unknown, opts: { onSuccess?: () => void }) { this.opts = opts }
    start() { this.opts.onSuccess?.() }
    abort() {}
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}))

import { useUploadManager } from '@/lib/uploadManager'

beforeEach(() => {
  invokeMock.mockReset()
  // Fail the pipeline right after the create call — the assertion only needs
  // the request body, not a full upload.
  invokeMock.mockResolvedValue({ data: null, error: null })
})

describe('Home post upload ↔ video-kind separation', () => {
  it('requests a Cloudflare upload with kind=post (never reel/highlight)', async () => {
    useUploadManager.getState().startVideoUpload({
      file: new File(['x'], 'match-clip.mp4', { type: 'video/mp4' }),
      onComplete: () => {},
    })

    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalled())

    const [fn, opts] = invokeMock.mock.calls[0] as [string, { body: Record<string, unknown> }]
    expect(fn).toBe('video-create-upload')
    expect(opts.body.kind).toBe('post')
    expect(opts.body.visibility).toBe('public')
  })
})
