import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: (...args: unknown[]) => invokeMock(...args) } } }))

import { clearPlaybackTokenCache, getPlaybackToken, PlaybackTokenError, prefetchProfileVideoPosters } from '@/lib/playbackToken'

const payload = (id: string) => ({ videoId: id, token: `t-${id}`, hls: `h-${id}`, thumbnail: `https://c/${id}/thumb.jpg`, durationSeconds: 10, expiresInSeconds: 3600 })

// Thumbnails, founder ruling 2026-09-24: all tiles on a screen share ONE
// token request, cached for the session, with a per-id fallback for an older
// deployed function.
describe('getPlaybackToken batching', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    clearPlaybackTokenCache()
  })

  it('sends tokens requested together as one batch call', async () => {
    invokeMock.mockResolvedValue({ data: { results: { a: payload('a'), b: payload('b'), c: payload('c') } }, error: null })
    const [a, b, c] = await Promise.all([getPlaybackToken('a'), getPlaybackToken('b'), getPlaybackToken('c')])
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('video-playback-token', { body: { videoIds: ['a', 'b', 'c'] } })
    expect([a.thumbnail, b.thumbnail, c.thumbnail]).toEqual(['https://c/a/thumb.jpg', 'https://c/b/thumb.jpg', 'https://c/c/thumb.jpg'])
  })

  it('serves the session cache without a second call', async () => {
    invokeMock.mockResolvedValue({ data: { results: { a: payload('a'), b: payload('b') } }, error: null })
    await Promise.all([getPlaybackToken('a'), getPlaybackToken('b')])
    await getPlaybackToken('a')
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the single-id request shape for one video', async () => {
    invokeMock.mockResolvedValue({ data: payload('solo'), error: null })
    await getPlaybackToken('solo')
    expect(invokeMock).toHaveBeenCalledWith('video-playback-token', { body: { videoId: 'solo' } })
  })

  it('rejects only the denied id, with its status', async () => {
    invokeMock.mockResolvedValue({ data: { results: { ok: payload('ok'), locked: { error: 'forbidden', status: 403 } } }, error: null })
    const [ok, locked] = await Promise.allSettled([getPlaybackToken('ok'), getPlaybackToken('locked')])
    expect(ok.status).toBe('fulfilled')
    expect(locked.status).toBe('rejected')
    const err = (locked as PromiseRejectedResult).reason as PlaybackTokenError
    expect(err.status).toBe(403)
  })

  it('falls back to one call per id when the function has no batch mode', async () => {
    invokeMock.mockImplementation((_fn: string, { body }: { body: { videoId?: string; videoIds?: string[] } }) =>
      Promise.resolve(body.videoIds ? { data: { error: 'missing_videoId' }, error: null } : { data: payload(body.videoId as string), error: null }))
    const [x, y] = await Promise.all([getPlaybackToken('x'), getPlaybackToken('y')])
    expect(x.thumbnail).toBe('https://c/x/thumb.jpg')
    expect(y.thumbnail).toBe('https://c/y/thumb.jpg')
    expect(invokeMock).toHaveBeenCalledTimes(3)
  })
})

// Thumbnails, founder ruling 2026-09-24: the profile's first tokens are
// requested at page mount, by id or username, before the video list is read.
describe('prefetchProfileVideoPosters', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    clearPlaybackTokenCache()
  })

  it('asks for the profile tiles in one call and serves the tiles from it', async () => {
    invokeMock.mockResolvedValue({ data: { results: { a: payload('a'), b: payload('b') }, order: ['a', 'b'] }, error: null })
    prefetchProfileVideoPosters({ username: 'leandro' })
    const [a, b] = await Promise.all([getPlaybackToken('a'), getPlaybackToken('b')])
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('video-playback-token', { body: { profileVideos: { id: undefined, username: 'leandro', limit: 4 } } })
    expect([a.thumbnail, b.thumbnail]).toEqual(['https://c/a/thumb.jpg', 'https://c/b/thumb.jpg'])
  })

  it('mints a tile the prefetch did not return, after it lands', async () => {
    invokeMock
      .mockResolvedValueOnce({ data: { results: { a: payload('a') }, order: ['a'] }, error: null })
      .mockResolvedValueOnce({ data: payload('z'), error: null })
    prefetchProfileVideoPosters('owner-1')
    const z = await getPlaybackToken('z')
    expect(z.thumbnail).toBe('https://c/z/thumb.jpg')
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'video-playback-token', { body: { videoId: 'z' } })
  })

  it('prefetches a profile once per session', async () => {
    invokeMock.mockResolvedValue({ data: { results: {}, order: [] }, error: null })
    prefetchProfileVideoPosters('owner-2')
    prefetchProfileVideoPosters({ id: 'owner-2' })
    await Promise.resolve()
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })
})
