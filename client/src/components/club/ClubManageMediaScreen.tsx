import { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ImagePlus, Plus, X } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { SmoothImage } from '@/components/ui/SmoothImage'
import ConfirmActionModal from '@/components/ConfirmActionModal'
import { MediaLightbox } from '@/components/home/MediaLightbox'
import { useClubMedia, type ClubPhoto } from '@/hooks/useClubMedia'
import { useToastStore } from '@/lib/toast'
import { getImageSrcSet, getImageUrl } from '@/lib/imageUrl'

/**
 * Club photos (the Photos row of Edit club profile, D1.27 DEV NOTE "club_media
 * → Manage media"). D1 has no club frame for it, so this mirrors the player
 * Manage media screen (Figma 04 Player 145:758) with only its Photos section —
 * clubs have no highlight or full-match video. Grid newest-first, Reorder
 * stages moves and deletes until Done (Cancel throws them away), + adds
 * photos. The first photo is the cover on the club profile. Phone only.
 */
interface ClubManageMediaScreenProps {
  clubId: string
  /** Back label: the screen it returns to ("Profile", or "Edit profile"). */
  parent: string
  onBack: () => void
}

export default function ClubManageMediaScreen({ clubId, parent, onBack }: ClubManageMediaScreenProps) {
  const addToast = useToastStore((s) => s.addToast)
  const media = useClubMedia(clubId)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [photoIndex, setPhotoIndex] = useState<number | null>(null)
  const [reordering, setReordering] = useState(false)
  const [draftOrder, setDraftOrder] = useState<ClubPhoto[] | null>(null)
  const [stagedDeletes, setStagedDeletes] = useState<Set<string>>(new Set())
  const [confirmStaged, setConfirmStaged] = useState(false)
  const shown = draftOrder ?? media.photos
  const visible = shown.filter((p) => !stagedDeletes.has(p.id))

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return
    const { added, failed } = await media.add(Array.from(files))
    if (added) addToast(added === 1 ? 'Photo added.' : `${added} photos added.`, 'success')
    for (const f of failed) addToast(`Could not add ${f}.`, 'error')
  }

  const move = (index: number, dir: -1 | 1) => {
    const list = [...visible]
    const j = index + dir
    if (j < 0 || j >= list.length) return
    ;[list[index], list[j]] = [list[j], list[index]]
    // Staged deletes stay in the draft so Cancel can bring them back.
    setDraftOrder([...list, ...shown.filter((p) => stagedDeletes.has(p.id))])
  }
  const cancelReorder = () => { setReordering(false); setDraftOrder(null); setStagedDeletes(new Set()) }
  const applyReorder = async () => {
    setConfirmStaged(false)
    setReordering(false)
    const base = draftOrder ?? media.photos
    const order = base.filter((p) => !stagedDeletes.has(p.id))
    const removed = base.filter((p) => stagedDeletes.has(p.id))
    const moved = order.some((p, i) => media.photos.filter((x) => !stagedDeletes.has(x.id))[i]?.id !== p.id)
    setDraftOrder(null)
    setStagedDeletes(new Set())
    let failed = 0
    for (const p of removed) { if (!(await media.remove(p))) failed += 1 }
    if (moved && order.length > 1 && !(await media.reorder(order))) addToast('Could not save the new order.', 'error')
    if (failed) addToast(failed === 1 ? 'One photo could not be removed.' : `${failed} photos could not be removed.`, 'error')
    else if (removed.length) addToast(removed.length === 1 ? 'Photo removed.' : `${removed.length} photos removed.`, 'success')
  }
  const finishReorder = () => { if (stagedDeletes.size) setConfirmStaged(true); else void applyReorder() }
  const pick = () => fileRef.current?.click()

  return (
    <div className="min-h-screen bg-white pb-12 lg:hidden" data-testid="club-manage-media-screen">
      <div className="sticky top-0 z-20 bg-white pt-[env(safe-area-inset-top)]">
        <DetailNavBar parent={parent} title="Media" showParent onBack={onBack} />
      </div>

      <div className="flex flex-col gap-3 px-5 pt-2">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg" multiple className="hidden" data-testid="club-media-input" onChange={(e) => { void addPhotos(e.target.files); e.target.value = '' }} />
        <div className="flex items-center justify-between">
          <h2 className="text-body font-semibold text-ink-1">Photos · {media.photos.length}</h2>
          <span className="flex items-center gap-4">
            {reordering && <button type="button" onClick={cancelReorder} className="text-row font-semibold text-ink-2">Cancel</button>}
            {media.photos.length > 0 && (
              <button type="button" onClick={() => (reordering ? finishReorder() : (setDraftOrder(media.photos), setReordering(true)))} className="text-row font-semibold text-hockia-primary">
                {reordering ? 'Done' : 'Reorder'}
              </button>
            )}
          </span>
        </div>

        {media.loading ? (
          <div className="grid grid-cols-3 gap-1.5">{[0, 1, 2].map((i) => <div key={i} className="aspect-square animate-pulse rounded-[10px] bg-surface-grouped" />)}</div>
        ) : media.photos.length === 0 ? (
          <button type="button" onClick={pick} disabled={media.busy} className="flex items-center gap-3.5 rounded-card bg-hockia-soft p-4 text-left disabled:opacity-60" data-testid="club-media-empty">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-hockia-primary text-white">
              {media.busy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <ImagePlus className="h-5 w-5" strokeWidth={1.8} />}
            </span>
            <span className="min-w-0">
              <span className="block text-row font-semibold text-hockia-primary">Add photos of your club</span>
              <span className="block text-secondary leading-[18px] text-ink-2">Your pitch, your teams, match days. The first photo is the cover on your profile.</span>
            </span>
          </button>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {visible.map((p, i) => (
              <div key={p.id} className="relative aspect-square overflow-hidden rounded-[10px] bg-surface-grouped">
                <button type="button" onClick={() => !reordering && setPhotoIndex(i)} className="h-full w-full" aria-label={p.caption || `Photo ${i + 1}`}>
                  <SmoothImage src={getImageUrl(p.url, 'card-thumb') ?? p.url} srcSet={getImageSrcSet(p.url, 'card-thumb') ?? undefined} sizes="33vw" alt="" eager={i < 6} className="object-cover" />
                </button>
                {reordering && (
                  <>
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move earlier" className="absolute bottom-1 left-1 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-ink-1 disabled:opacity-30"><ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.2} /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === visible.length - 1} aria-label="Move later" className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-ink-1 disabled:opacity-30"><ArrowRight className="h-3.5 w-3.5" strokeWidth={2.2} /></button>
                    <button type="button" onClick={() => setStagedDeletes((set) => new Set(set).add(p.id))} aria-label="Delete photo" className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white"><X className="h-3.5 w-3.5" strokeWidth={2.4} /></button>
                  </>
                )}
              </div>
            ))}
            {!reordering && (
              <button type="button" onClick={pick} disabled={media.busy} aria-label="Add photos" className="flex aspect-square items-center justify-center rounded-[10px] bg-surface-grouped text-ink-2 disabled:opacity-60">
                {media.busy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-ink-3 border-t-transparent" /> : <Plus className="h-6 w-6" strokeWidth={1.8} />}
              </button>
            )}
          </div>
        )}
        {reordering && <p className="text-caption text-ink-3">Use the arrows to arrange; the first photo is your cover. Tap Done to save{stagedDeletes.size ? ` and remove ${stagedDeletes.size === 1 ? '1 photo' : `${stagedDeletes.size} photos`}` : ''}, or Cancel to keep everything as it was.</p>}
      </div>

      <ConfirmActionModal isOpen={confirmStaged} onClose={() => setConfirmStaged(false)} onConfirm={() => void applyReorder()} title={stagedDeletes.size === 1 ? 'Remove 1 photo?' : `Remove ${stagedDeletes.size} photos?`} description="They disappear from your club profile. This cannot be undone." confirmLabel="Remove" confirmTone="danger" />
      {photoIndex !== null && (
        <MediaLightbox images={visible.map((p, i) => ({ url: p.url, media_type: 'image', order: i }))} initialIndex={photoIndex} onClose={() => setPhotoIndex(null)} caption={visible[photoIndex]?.caption ?? null} />
      )}
    </div>
  )
}
