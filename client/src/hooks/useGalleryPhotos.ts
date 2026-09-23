import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { optimizeImage, validateImage } from '@/lib/imageOptimization'
import { deleteStorageObject } from '@/lib/storage'
import { clearCoverPhotoCache } from './useCoverPhoto'
import { clearProfileScrollCache } from './useProfileScrollData'

/**
 * A profile's gallery photos (Figma Manage media · Gallery · Photo viewer):
 * gallery_photos, newest first — higher order_index = higher in the grid, the
 * order the owner arranged. Mutations mirror GalleryManager exactly: optimise
 * to 1200px JPEG, upload to the `gallery` bucket under the owner's id, insert
 * above everything else; reorder writes reversed indexes; delete removes the
 * object then the row. The profile's cover and Photos preview read the same
 * order, so their caches are cleared on every change.
 */
export type GalleryPhoto = { id: string; url: string; caption: string | null; orderIndex: number; createdAt: string }

const MAX_BATCH = 10
const OPTIMIZE = { maxWidth: 1200, maxHeight: 1200, maxSizeMB: 1, quality: 0.85 }

export function useGalleryPhotos(profileId: string | null | undefined) {
  const [photos, setPhotos] = useState<GalleryPhoto[]>([])
  const [loading, setLoading] = useState(Boolean(profileId))
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!profileId) { setLoading(false); return }
    const { data, error } = await supabase
      .from('gallery_photos')
      .select('id, photo_url, caption, order_index, created_at')
      .eq('user_id', profileId)
      .order('order_index', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) { logger.error('[useGalleryPhotos] load failed', error); setLoading(false); return }
    setPhotos((data ?? []).map((r) => ({ id: r.id, url: r.photo_url, caption: r.caption, orderIndex: r.order_index ?? 0, createdAt: r.created_at })))
    setLoading(false)
  }, [profileId])

  useEffect(() => { void load() }, [load])

  const touched = () => { if (profileId) { clearCoverPhotoCache(profileId); clearProfileScrollCache(profileId) } }

  const add = useCallback(async (files: File[]): Promise<{ added: number; failed: string[] }> => {
    if (!profileId) return { added: 0, failed: [] }
    const batch = files.slice(0, MAX_BATCH)
    const failed: string[] = []
    setBusy(true)
    try {
      let top = photos.length ? Math.max(...photos.map((p) => p.orderIndex)) : -1
      let added = 0
      // First picked = highest index, so a multi-select keeps the picked order.
      const base = top + batch.length
      for (let i = 0; i < batch.length; i += 1) {
        const file = batch[i]
        const check = validateImage(file, { maxFileSizeMB: 10 })
        if (!check.valid) { failed.push(`${file.name}: ${check.error ?? 'invalid image'}`); continue }
        try {
          const optimized = await optimizeImage(file, OPTIMIZE)
          const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
          const path = `${profileId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
          const { error: upErr } = await supabase.storage.from('gallery').upload(path, optimized, { cacheControl: '31536000' })
          if (upErr) throw upErr
          const url = supabase.storage.from('gallery').getPublicUrl(path).data.publicUrl
          const { error: dbErr } = await supabase.from('gallery_photos').insert({ user_id: profileId, photo_url: url, file_name: file.name, file_size: optimized.size, order_index: base - i })
          if (dbErr) throw dbErr
          added += 1
          top = Math.max(top, base - i)
        } catch (err) {
          logger.error('[useGalleryPhotos] upload failed', err)
          failed.push(file.name)
        }
      }
      touched()
      await load()
      return { added, failed }
    } finally {
      setBusy(false)
    }
  }, [profileId, photos, load]) // eslint-disable-line react-hooks/exhaustive-deps

  const remove = useCallback(async (photo: GalleryPhoto): Promise<boolean> => {
    setBusy(true)
    try {
      await deleteStorageObject({ bucket: 'gallery', publicUrl: photo.url, context: 'manage-media:delete-photo' })
      const { error } = await supabase.from('gallery_photos').delete().eq('id', photo.id)
      if (error) throw error
      touched()
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id))
      return true
    } catch (err) {
      logger.error('[useGalleryPhotos] delete failed', err)
      return false
    } finally {
      setBusy(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** `ordered` is the new top-to-bottom arrangement. */
  const reorder = useCallback(async (ordered: GalleryPhoto[]): Promise<boolean> => {
    const next = ordered.map((p, i) => ({ ...p, orderIndex: ordered.length - 1 - i }))
    setPhotos(next)
    try {
      // .select('id') is load-bearing: an RLS-refused UPDATE looks like success
      // without reading the row back.
      const results = await Promise.all(next.map((p) => supabase.from('gallery_photos').update({ order_index: p.orderIndex, updated_at: new Date().toISOString() }).eq('id', p.id).select('id')))
      if (results.some((r) => r.error || !r.data?.length)) throw new Error('reorder refused')
      touched()
      return true
    } catch (err) {
      logger.error('[useGalleryPhotos] reorder failed', err)
      await load()
      return false
    }
  }, [load]) // eslint-disable-line react-hooks/exhaustive-deps

  return { photos, loading, busy, add, remove, reorder, reload: load }
}
