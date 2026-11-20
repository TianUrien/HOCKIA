/**
 * Crests and logos from the crop step: the fitted square and the picked file
 * are stored side by side under the owner's folder, a failed original never
 * blocks the square, a person's own crop replaces the centre crop, and no
 * delete path leaves the kept original behind.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const upload = vi.fn()
const remove = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { storage: { from: () => ({
    upload: (...a: unknown[]) => upload(...a),
    remove: (...a: unknown[]) => remove(...a),
    getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn.test/storage/v1/object/public/avatars/${p}` } }),
  }) } },
}))
const optimizeAvatarImage = vi.fn(async () => new File(['centre'], 'a.jpg', { type: 'image/jpeg' }))
const optimizeImage = vi.fn(async (_f: File, o: { mimeType?: string }) => new File(['kept'], 'k', { type: o.mimeType ?? 'image/jpeg' }))
vi.mock('@/lib/imageOptimization', async (original) => ({
  ...(await original<typeof import('@/lib/imageOptimization')>()),
  optimizeAvatarImage: () => optimizeAvatarImage(),
  optimizeImage: (f: File, o: { mimeType?: string }) => optimizeImage(f, o),
}))

import { renderHook } from '@testing-library/react'
import { deleteOrgImage, uploadOrgImage } from '@/lib/orgImageUpload'
import { deleteStorageObject } from '@/lib/storage'
import { usePendingStorageCleanup } from '@/hooks/usePendingStorageCleanup'
import { uploadIdentityImage } from '@/lib/identityImage'
import { isFittedOrgImage } from '@/lib/orgImage'

const picked = new File(['x'], 'wide-logo.png', { type: 'image/png' })
const square = new File(['sq'], 'wide-logo.png', { type: 'image/png' })
const photo = new File(['x'], 'me.jpg', { type: 'image/jpeg' })
const photoSquare = new File(['sq'], 'me.jpg', { type: 'image/jpeg' })

beforeEach(() => {
  upload.mockReset(); upload.mockResolvedValue({ error: null })
  remove.mockReset(); remove.mockResolvedValue({ error: null })
  optimizeImage.mockClear(); optimizeAvatarImage.mockClear()
})

describe('uploadOrgImage', () => {
  it('stores the fitted square and keeps the picked file next to it', async () => {
    const url = await uploadOrgImage('owner-1', 'logo', square, picked)
    expect(upload).toHaveBeenCalledTimes(2)
    expect(upload.mock.calls[0][0]).toMatch(/^owner-1\/logo_fit_\d+\.png$/)
    expect(upload.mock.calls[0][1]).toBe(square)
    expect(upload.mock.calls[1][0]).toMatch(/^owner-1\/logo_orig_\d+\.png$/)
    // The original keeps its own shape: resized to fit 2048, never squared.
    expect(optimizeImage).toHaveBeenCalledWith(picked, expect.objectContaining({ maxWidth: 2048, maxHeight: 2048, mimeType: 'image/png' }))
    expect(isFittedOrgImage(url)).toBe(true)
  })

  it('still returns the square when the original cannot be kept', async () => {
    upload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: new Error('quota') })
    await expect(uploadOrgImage('owner-1', 'crest', square, picked)).resolves.toMatch(/crest_fit_\d+\.png$/)
  })

  it('fails when the square itself cannot be stored', async () => {
    upload.mockResolvedValueOnce({ error: new Error('denied') })
    await expect(uploadOrgImage('owner-1', 'crest', square, picked)).rejects.toThrow('denied')
    expect(upload).toHaveBeenCalledTimes(1)
  })
})

describe('removing a fitted crest or logo', () => {
  const FITTED = 'https://cdn.test/storage/v1/object/public/avatars/owner-1/crest_fit_7.png'

  it('removes the fitted file and its original in one call', async () => {
    deleteOrgImage(FITTED, 'test')
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
    expect(remove.mock.calls[0][0]).toEqual(['owner-1/crest_fit_7.png', 'owner-1/crest_orig_7.png'])
  })

  it('removes only the file itself for an older upload', async () => {
    deleteOrgImage('https://cdn.test/storage/v1/object/public/avatars/owner-1/avatar_7.png', 'test')
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
    expect(remove.mock.calls[0][0]).toEqual(['owner-1/avatar_7.png'])
  })

  it('does nothing without a URL', () => {
    deleteOrgImage(null, 'test')
    expect(remove).not.toHaveBeenCalled()
  })

  it('takes the original along on every path that deletes through the storage helper', async () => {
    // By public URL (direct replace) and by path (queued deletions).
    await deleteStorageObject({ bucket: 'avatars', publicUrl: FITTED.replace('crest', 'logo'), context: 'test' })
    await deleteStorageObject({ bucket: 'avatars', path: 'owner-1/crest_fit_9.jpg', context: 'test' })
    expect(remove.mock.calls[0][0]).toEqual(['owner-1/logo_fit_7.png', 'owner-1/logo_orig_7.png'])
    expect(remove.mock.calls[1][0]).toEqual(['owner-1/crest_fit_9.jpg', 'owner-1/crest_orig_9.jpg'])
  })

  it('a queued replacement (edit modal, onboarding) removes the pair when the save lands', async () => {
    const { result } = renderHook(() => usePendingStorageCleanup())
    result.current.queue({ bucket: 'avatars', publicUrl: FITTED, context: 'edit-profile:replace-avatar' })
    expect(remove).not.toHaveBeenCalled()
    await result.current.flush()
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove.mock.calls[0][0]).toEqual(['owner-1/crest_fit_7.png', 'owner-1/crest_orig_7.png'])
  })

  it('a cancelled edit deletes nothing: the row still points at the old file', async () => {
    const { result } = renderHook(() => usePendingStorageCleanup())
    result.current.queue({ bucket: 'avatars', publicUrl: FITTED, context: 'edit-profile:replace-avatar' })
    result.current.discard()
    await result.current.flush()
    expect(remove).not.toHaveBeenCalled()
  })

  it('never treats an original, a person photo or another bucket as a pair', async () => {
    await deleteStorageObject({ bucket: 'avatars', path: 'owner-1/crest_orig_7.png', context: 'test' })
    await deleteStorageObject({ bucket: 'avatars', path: 'owner-1/avatar_full_7.jpg', context: 'test' })
    expect(remove.mock.calls[0][0]).toEqual(['owner-1/crest_orig_7.png'])
    expect(remove.mock.calls[1][0]).toEqual(['owner-1/avatar_full_7.jpg'])
  })
})

describe('uploadIdentityImage', () => {
  it("stores a person's own crop as the square, plus the full-shape photo", async () => {
    const urls = await uploadIdentityImage('u1', 'person', photo, photoSquare)
    expect(optimizeAvatarImage).not.toHaveBeenCalled()
    expect(upload.mock.calls[0][0]).toMatch(/^u1\/avatar_\d+\.jpg$/)
    expect(upload.mock.calls[0][1]).toBe(photoSquare)
    expect(urls.avatarFullUrl).toMatch(/avatar_full_\d+\.jpg$/)
  })

  it('stores a crest as a fitted organisation image with no full-shape photo', async () => {
    const urls = await uploadIdentityImage('club-1', 'crest', picked, square)
    expect(isFittedOrgImage(urls.avatarUrl)).toBe(true)
    expect(urls.avatarFullUrl).toBeNull()
  })
})
