import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { optimizeImage, validateImage } from '@/lib/imageOptimization'
import { deleteStorageObject } from '@/lib/storage'
import { clearClubProfileScrollCache } from './useClubProfileScrollData'

/**
 * A club's photos (club_media) for the phone Manage media screen. Same paths
 * as the desktop GalleryManager (mode "club"): optimise to 1200px JPEG,
 * upload to the `club-media` bucket under the club's id, insert above
 * everything else (newest-first: higher order_index = higher in the grid);
 * reorder writes reversed indexes and reads the rows back (.select('id') —
 * an RLS-refused UPDATE looks like success otherwise).
 *
 * Delete removes the ROW first and the storage object only once that has
 * succeeded, so a refused delete never leaves a row pointing at a missing
 * file (the 2026-07-30 broken-avatar incident class). The club profile's
 * cover reads the same rows, so its cache is cleared on every change.
 */
export type ClubPhoto = { id: string; url: string; caption: string | null; orderIndex: number }

const MAX_BATCH = 10
const MAX_MB = 10
const OPTIMIZE = { maxWidth: 1200, maxHeight: 1200, maxSizeMB: 1, quality: 0.85 }

export function useClubMedia(clubId: string | null | undefined) {
  const [photos, setPhotos] = useState<ClubPhoto[]>([])
  const [loading, setLoading] = useState(Boolean(clubId))
  const [busy, setBusy] = useState(false)
  const photosRef = useRef<ClubPhoto[]>([])
  photosRef.current = photos

  const load = useCallback(async () => {
    if (!clubId) { setLoading(false); return }
    const { data, error } = await supabase
      .from('club_media')
      .select('id, file_url, caption, order_index, created_at')
      .eq('club_id', clubId)
      .order('order_index', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) { logger.error('[useClubMedia] load failed', error); setLoading(false); return }
    setPhotos((data ?? []).map((r) => ({ id: r.id, url: r.file_url, caption: r.caption, orderIndex: r.order_index ?? 0 })))
    setLoading(false)
  }, [clubId])

  useEffect(() => { void load() }, [load])

  const touched = useCallback(() => { if (clubId) clearClubProfileScrollCache(clubId) }, [clubId])

  const add = useCallback(async (files: File[]): Promise<{ added: number; failed: string[] }> => {
    if (!clubId) return { added: 0, failed: [] }
    const batch = files.slice(0, MAX_BATCH)
    const failed: string[] = []
    setBusy(true)
    try {
      const current = photosRef.current
      // First picked = highest index, so a multi-select keeps the picked order.
      const base = (current.length ? Math.max(...current.map((p) => p.orderIndex)) : -1) + batch.length
      let added = 0
      for (let i = 0; i < batch.length; i += 1) {
        const file = batch[i]
        const check = validateImage(file, { maxFileSizeMB: MAX_MB })
        if (!check.valid) { failed.push(`${file.name}: ${check.error ?? 'invalid image'}`); continue }
        try {
          const optimized = await optimizeImage(file, OPTIMIZE)
          const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
          const path = `${clubId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
          const { error: upErr } = await supabase.storage.from('club-media').upload(path, optimized, { cacheControl: '31536000' })
          if (upErr) throw upErr
          const url = supabase.storage.from('club-media').getPublicUrl(path).data.publicUrl
          const { error: dbErr } = await supabase.from('club_media').insert({ club_id: clubId, file_url: url, file_name: file.name, file_size: optimized.size, order_index: base - i })
          if (dbErr) {
            // The row never pointed at it — safe to drop the orphan upload.
            void deleteStorageObject({ bucket: 'club-media', publicUrl: url, context: 'club-manage-media:insert-failed' })
            throw dbErr
          }
          added += 1
        } catch (err) {
          logger.error('[useClubMedia] upload failed', err)
          failed.push(file.name)
        }
      }
      touched()
      await load()
      return { added, failed }
    } finally {
      setBusy(false)
    }
  }, [clubId, load, touched])

  const remove = useCallback(async (photo: ClubPhoto): Promise<boolean> => {
    setBusy(true)
    try {
      const { data, error } = await supabase.from('club_media').delete().eq('id', photo.id).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('delete refused')
      void deleteStorageObject({ bucket: 'club-media', publicUrl: photo.url, context: 'club-manage-media:delete-photo' })
      touched()
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id))
      return true
    } catch (err) {
      logger.error('[useClubMedia] delete failed', err)
      return false
    } finally {
      setBusy(false)
    }
  }, [touched])

  /** `ordered` is the new top-to-bottom arrangement. */
  const reorder = useCallback(async (ordered: ClubPhoto[]): Promise<boolean> => {
    const next = ordered.map((p, i) => ({ ...p, orderIndex: ordered.length - 1 - i }))
    setPhotos(next)
    try {
      const results = await Promise.all(next.map((p) => supabase.from('club_media').update({ order_index: p.orderIndex, updated_at: new Date().toISOString() }).eq('id', p.id).select('id')))
      if (results.some((r) => r.error || !r.data?.length)) throw new Error('reorder refused')
      touched()
      return true
    } catch (err) {
      logger.error('[useClubMedia] reorder failed', err)
      await load()
      return false
    }
  }, [load, touched])

  return { photos, loading, busy, add, remove, reorder, reload: load }
}
