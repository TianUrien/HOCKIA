import { useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronDown, ExternalLink, Film, Lock, Plus, Trash2, Video, X } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { BottomSheet } from '@/components/ui/BottomSheet'
import ConfirmActionModal from '@/components/ConfirmActionModal'
import UploadVideoModal from '@/components/media/UploadVideoModal'
import FullGameVideoFormModal from '@/components/FullGameVideoFormModal'
import { MediaLightbox } from '@/components/home/MediaLightbox'
import { ProfileVideoTile } from './ProfileVideoTile'
import { useProfileVideos, type ProfileVideo } from '@/hooks/useProfileVideos'
import { useFullGameVideos, type FullGameVideo } from '@/hooks/useFullGameVideos'
import { useGalleryPhotos, type GalleryPhoto } from '@/hooks/useGalleryPhotos'
import { clearProfileScrollCache } from '@/hooks/useProfileScrollData'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { getImageUrl } from '@/lib/imageUrl'
import { formatVideoDuration } from '@/lib/videoCopy'
import { invalidateProfile } from '@/lib/profile'

/**
 * Manage media (Figma 145:758): everything that shows on the profile,
 * editable in one place — highlights with their visibility (public / clubs &
 * coaches), the full-match upload as the one highlighted empty slot, and the
 * photo grid with reorder and add. Owner only. Every write is the same one
 * the legacy Media tab makes: player_videos.visibility, video-delete for a
 * Cloudflare asset, gallery_photos order_index / delete, profiles.highlight_video_url.
 */
interface ManageMediaScreenProps {
  profileId: string
  onBack: () => void
}

type Pending =
  | { kind: 'video'; video: ProfileVideo }
  | { kind: 'link'; link: FullGameVideo }
  | { kind: 'legacy' }
  | { kind: 'photo'; photo: GalleryPhoto }

function VideoCard({ video, onPlay, onVisibility, onDelete }: { video: ProfileVideo; onPlay: () => void; onVisibility: () => void; onDelete: () => void }) {
  const locked = video.visibility === 'recruiters'
  return (
    <div className="flex gap-3">
      <ProfileVideoTile video={video} locked={locked} compact onOpen={onPlay} className="h-[72px] w-[120px] shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-row font-semibold text-ink-1">{video.title}</p>
        <p className="text-secondary text-ink-2">{[formatVideoDuration(video.durationSeconds), 'ready'].filter(Boolean).join(' · ')}</p>
        <button type="button" onClick={onVisibility} className="mt-1.5 inline-flex h-[26px] max-w-full items-center gap-1 whitespace-nowrap rounded-full bg-surface-grouped px-2.5 text-caption font-semibold text-ink-2">
          {locked ? <Lock className="h-3 w-3" strokeWidth={2.2} /> : null}
          {locked ? 'Clubs & coaches only' : 'Everyone on Hockia'}
          <ChevronDown className="h-3 w-3" strokeWidth={2.2} />
        </button>
      </div>
      <button type="button" onClick={onDelete} aria-label={`Delete ${video.title}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-3"><Trash2 className="h-4 w-4" strokeWidth={1.8} /></button>
    </div>
  )
}

function Section({ title, action, onAction, secondary, onSecondary, children }: { title: string; action?: string; onAction?: () => void; secondary?: string; onSecondary?: () => void; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-body font-semibold text-ink-1">{title}</h2>
        <span className="flex items-center gap-4">
          {secondary && <button type="button" onClick={onSecondary} className="text-row font-semibold text-ink-2">{secondary}</button>}
          {action && <button type="button" onClick={onAction} className="text-row font-semibold text-hockia-primary">{action}</button>}
        </span>
      </div>
      {children}
    </section>
  )
}

export default function ManageMediaScreen({ profileId, onBack }: ManageMediaScreenProps) {
  const { profile, refreshProfile } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const videos = useProfileVideos(profileId)
  const fullGames = useFullGameVideos(profileId)
  const gallery = useGalleryPhotos(profileId)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [uploadKind, setUploadKind] = useState<'highlight' | 'full_match' | null>(null)
  const [linkForm, setLinkForm] = useState<{ open: boolean; edit: FullGameVideo | null }>({ open: false, edit: null })
  const [fullMatchChoice, setFullMatchChoice] = useState(false)
  const [visibilityFor, setVisibilityFor] = useState<ProfileVideo | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [playing, setPlaying] = useState<ProfileVideo | null>(null)
  const [photoIndex, setPhotoIndex] = useState<number | null>(null)
  const [reordering, setReordering] = useState(false)
  const [draftOrder, setDraftOrder] = useState<GalleryPhoto[] | null>(null)
  // Reorder mode stages EVERYTHING — moves and deletes — until Done; Cancel
  // throws all of it away. Done confirms staged deletes first (no undo).
  const [stagedDeletes, setStagedDeletes] = useState<Set<string>>(new Set())
  const [confirmStaged, setConfirmStaged] = useState(false)
  const [localVideos, setLocalVideos] = useState<Record<string, Partial<ProfileVideo> | null>>({})

  // Optimistic overlay on the video list (visibility changes, deletes) until
  // the next navigation refetches.
  const highlights = useMemo(() => videos.videos.filter((v) => v.kind === 'highlight').flatMap((v) => (localVideos[v.id] === null ? [] : [{ ...v, ...(localVideos[v.id] ?? {}) }])), [videos.videos, localVideos])
  const fullMatches = useMemo(() => videos.videos.filter((v) => v.kind === 'full_match').flatMap((v) => (localVideos[v.id] === null ? [] : [{ ...v, ...(localVideos[v.id] ?? {}) }])), [videos.videos, localVideos])
  const legacyHighlight = profile?.highlight_video_url ?? null
  const shownPhotos = draftOrder ?? gallery.photos

  const setVisibility = async (video: ProfileVideo, visibility: 'public' | 'recruiters') => {
    setVisibilityFor(null)
    if (video.visibility === visibility) return
    setLocalVideos((m) => ({ ...m, [video.id]: { ...(m[video.id] ?? {}), visibility } }))
    const { error } = await supabase.from('player_videos').update({ visibility }).eq('id', video.id).select('id')
    if (error) { logger.error('[ManageMedia] visibility failed', error); addToast('Could not change who can watch that.', 'error'); setLocalVideos((m) => ({ ...m, [video.id]: { ...(m[video.id] ?? {}), visibility: video.visibility ?? 'public' } })); return }
    clearProfileScrollCache(profileId)
  }

  const confirmDelete = async () => {
    if (!pending) return
    setDeleting(true)
    try {
      if (pending.kind === 'video') {
        // video-delete removes the Cloudflare asset too; a plain row delete
        // would leave it alive and billable.
        const { error } = await supabase.functions.invoke('video-delete', { body: { videoId: pending.video.id } })
        if (error) throw error
        setLocalVideos((m) => ({ ...m, [pending.video.id]: null }))
      } else if (pending.kind === 'link') {
        if (!(await fullGames.deleteVideo(pending.link.id))) throw new Error('delete refused')
      } else if (pending.kind === 'legacy') {
        const { error } = await supabase.from('profiles').update({ highlight_video_url: null }).eq('id', profileId)
        if (error) throw error
        await invalidateProfile({ userId: profileId, reason: 'highlight-link-removed' })
        await refreshProfile()
      } else if (!(await gallery.remove(pending.photo))) throw new Error('delete refused')
      clearProfileScrollCache(profileId)
      addToast('Removed.', 'success')
      setPending(null)
    } catch (err) {
      logger.error('[ManageMedia] delete failed', err)
      addToast('Could not remove that. Please try again.', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return
    const { added, failed } = await gallery.add(Array.from(files))
    if (added) addToast(added === 1 ? 'Photo added.' : `${added} photos added.`, 'success')
    for (const f of failed) addToast(f, 'error')
  }

  const move = (index: number, dir: -1 | 1) => {
    const visible = shownPhotos.filter((p) => !stagedDeletes.has(p.id))
    const j = index + dir
    if (j < 0 || j >= visible.length) return
    ;[visible[index], visible[j]] = [visible[j], visible[index]]
    // Keep staged-deleted photos in the draft so Cancel can restore them.
    setDraftOrder([...visible, ...shownPhotos.filter((p) => stagedDeletes.has(p.id))])
  }
  const cancelReorder = () => { setReordering(false); setDraftOrder(null); setStagedDeletes(new Set()) }
  const applyReorder = async () => {
    setConfirmStaged(false)
    setReordering(false)
    const order = (draftOrder ?? gallery.photos).filter((p) => !stagedDeletes.has(p.id))
    const removed = (draftOrder ?? gallery.photos).filter((p) => stagedDeletes.has(p.id))
    setDraftOrder(null)
    setStagedDeletes(new Set())
    let failed = 0
    for (const p of removed) { if (!(await gallery.remove(p))) failed += 1 }
    if (removed.length) clearProfileScrollCache(profileId)
    if (order.length > 1) { const ok = await gallery.reorder(order); if (!ok) addToast('Could not save the new order.', 'error') }
    if (failed) addToast(failed === 1 ? 'One photo could not be removed.' : `${failed} photos could not be removed.`, 'error')
    else if (removed.length) addToast(removed.length === 1 ? 'Photo removed.' : `${removed.length} photos removed.`, 'success')
  }
  const finishReorder = () => { if (stagedDeletes.size) setConfirmStaged(true); else void applyReorder() }

  const pendingLabel = pending?.kind === 'video' ? pending.video.title : pending?.kind === 'link' ? pending.link.match_title || 'this full match' : pending?.kind === 'legacy' ? 'the linked highlight' : 'this photo'

  return (
    <div className="min-h-screen bg-white pb-28 lg:hidden" data-testid="manage-media-screen">
      <div className="sticky top-0 z-20 bg-white pt-[env(safe-area-inset-top)]">
        <DetailNavBar parent="Profile" title="Media" onBack={onBack} />
      </div>

      <div className="flex flex-col gap-7 px-5 pt-2">
        <Section title="Highlight video" action={highlights.length || legacyHighlight ? 'Add' : undefined} onAction={() => setUploadKind('highlight')}>
          {videos.loading ? (
            <div className="h-[72px] animate-pulse rounded-card bg-surface-grouped" />
          ) : (
            <>
              {highlights.map((v) => <VideoCard key={v.id} video={v} onPlay={() => setPlaying(v)} onVisibility={() => setVisibilityFor(v)} onDelete={() => setPending({ kind: 'video', video: v })} />)}
              {legacyHighlight && (
                <div className="flex items-center gap-3">
                  <a href={legacyHighlight} target="_blank" rel="noopener noreferrer" className="flex h-[72px] w-[120px] shrink-0 items-center justify-center rounded-card bg-gradient-to-br from-ink-1 to-ink-2 text-white"><ExternalLink className="h-5 w-5" /></a>
                  <div className="min-w-0 flex-1"><p className="text-row font-semibold text-ink-1">Linked highlight</p><p className="truncate text-secondary text-ink-2">{legacyHighlight.replace(/^https?:\/\//, '')}</p></div>
                  <button type="button" onClick={() => setPending({ kind: 'legacy' })} aria-label="Remove the linked highlight" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-3"><Trash2 className="h-4 w-4" strokeWidth={1.8} /></button>
                </div>
              )}
              {!highlights.length && !legacyHighlight && (
                <button type="button" onClick={() => setUploadKind('highlight')} className="flex items-center gap-3.5 rounded-card border border-dashed border-line p-4 text-left">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-grouped text-ink-2"><Film className="h-5 w-5" strokeWidth={1.8} /></span>
                  <span className="min-w-0"><span className="block text-row font-semibold text-ink-1">Upload a highlight</span><span className="block text-secondary text-ink-2">2–4 minutes of your best moments. The first thing on your profile.</span></span>
                </button>
              )}
            </>
          )}
        </Section>

        <Section title="Full match video" action={fullMatches.length || fullGames.videos.length ? 'Add' : undefined} onAction={() => setFullMatchChoice(true)}>
          {fullMatches.map((v) => <VideoCard key={v.id} video={v} onPlay={() => setPlaying(v)} onVisibility={() => setVisibilityFor(v)} onDelete={() => setPending({ kind: 'video', video: v })} />)}
          {fullGames.videos.map((l) => (
            <div key={l.id} className="flex items-center gap-3">
              <a href={l.video_url} target="_blank" rel="noopener noreferrer" className="relative flex h-[72px] w-[120px] shrink-0 items-center justify-center rounded-card bg-gradient-to-br from-ink-1 to-ink-2 text-white"><ExternalLink className="h-5 w-5" />{l.visibility === 'recruiters' && <span className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/55"><Lock className="h-2.5 w-2.5" strokeWidth={2.4} /></span>}</a>
              <button type="button" onClick={() => setLinkForm({ open: true, edit: l })} className="min-w-0 flex-1 text-left"><span className="block truncate text-row font-semibold text-ink-1">{l.match_title || (l.opponent_team ? `vs ${l.opponent_team}` : 'Full match')}</span><span className="block truncate text-secondary text-ink-2">{[l.match_date?.slice(0, 7), l.competition].filter(Boolean).join(' · ') || 'Linked video'}</span></button>
              <button type="button" onClick={() => setPending({ kind: 'link', link: l })} aria-label={`Delete ${l.match_title || 'full match'}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-3"><Trash2 className="h-4 w-4" strokeWidth={1.8} /></button>
            </div>
          ))}
          {!fullMatches.length && !fullGames.videos.length && !videos.loading && (
            <button type="button" onClick={() => setFullMatchChoice(true)} className="flex items-center gap-3.5 rounded-card bg-hockia-soft p-4 text-left">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-hockia-primary text-white"><Video className="h-5 w-5" strokeWidth={1.8} /></span>
              <span className="min-w-0"><span className="block text-row font-semibold text-hockia-primary">Upload a full match</span><span className="block text-secondary leading-[18px] text-ink-2">60+ minutes, any quality. It is the first thing clubs ask for — and the one thing missing from your profile.</span></span>
            </button>
          )}
        </Section>

        <Section
          title={`Photos · ${gallery.photos.length}`}
          action={gallery.photos.length > 0 ? (reordering ? 'Done' : 'Reorder') : undefined}
          onAction={() => (reordering ? finishReorder() : (setDraftOrder(gallery.photos), setReordering(true)))}
          secondary={reordering ? 'Cancel' : undefined}
          onSecondary={cancelReorder}
        >
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" multiple className="hidden" onChange={(e) => { void addPhotos(e.target.files); e.target.value = '' }} />
          <div className="grid grid-cols-3 gap-1.5">
            {shownPhotos.filter((p) => !stagedDeletes.has(p.id)).map((p, i, visible) => (
              <div key={p.id} className="relative aspect-square overflow-hidden rounded-[10px] bg-surface-grouped">
                <button type="button" onClick={() => !reordering && setPhotoIndex(i)} className="h-full w-full" aria-label={p.caption || `Photo ${i + 1}`}>
                  <img src={getImageUrl(p.url, 'gallery') ?? p.url} alt="" className="h-full w-full object-cover" />
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
              <button type="button" onClick={() => fileRef.current?.click()} disabled={gallery.busy} aria-label="Add photos" className="flex aspect-square items-center justify-center rounded-[10px] bg-surface-grouped text-ink-2 disabled:opacity-60">
                {gallery.busy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-ink-3 border-t-transparent" /> : <Plus className="h-6 w-6" strokeWidth={1.8} />}
              </button>
            )}
          </div>
          {reordering && <p className="text-caption text-ink-3">Use the arrows to arrange; the first photo is your cover. Tap Done to save{stagedDeletes.size ? ` and remove ${stagedDeletes.size === 1 ? '1 photo' : `${stagedDeletes.size} photos`}` : ''}, or Cancel to keep everything as it was.</p>}
        </Section>
      </div>

      <UploadVideoModal isOpen={uploadKind !== null} kind={uploadKind ?? 'highlight'} onClose={() => setUploadKind(null)} onUploaded={() => { setUploadKind(null); clearProfileScrollCache(profileId); void videos.reload() }} />
      <FullGameVideoFormModal
        isOpen={linkForm.open}
        initialValue={linkForm.edit}
        onClose={() => setLinkForm({ open: false, edit: null })}
        onSubmit={async (input) => {
          const ok = linkForm.edit ? await fullGames.updateVideo(linkForm.edit.id, input) : Boolean(await fullGames.addVideo(input))
          if (ok) { clearProfileScrollCache(profileId); setLinkForm({ open: false, edit: null }) }
          return ok
        }}
      />

      <BottomSheet open={fullMatchChoice} onClose={() => setFullMatchChoice(false)} ariaLabel="Add a full match">
        <div className="px-5 pb-3 pt-1">
          <h2 className="text-title text-ink-1">Add a full match</h2>
          <div className="mt-3 divide-y divide-line overflow-hidden rounded-card bg-surface-grouped">
            <button type="button" onClick={() => { setFullMatchChoice(false); setUploadKind('full_match') }} className="flex h-[54px] w-full items-center gap-3 px-4 text-left text-body text-ink-1"><Video className="h-5 w-5 text-hockia-primary" strokeWidth={1.8} /> Upload the video<span className="ml-auto text-secondary text-ink-3">plays on Hockia</span></button>
            <button type="button" onClick={() => { setFullMatchChoice(false); setLinkForm({ open: true, edit: null }) }} className="flex h-[54px] w-full items-center gap-3 px-4 text-left text-body text-ink-1"><ExternalLink className="h-5 w-5 text-hockia-primary" strokeWidth={1.8} /> Paste a link<span className="ml-auto text-secondary text-ink-3">YouTube, Vimeo, Drive</span></button>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet open={visibilityFor !== null} onClose={() => setVisibilityFor(null)} ariaLabel="Who can watch">
        {visibilityFor && (
          <div className="px-5 pb-3 pt-1">
            <h2 className="text-title text-ink-1">Who can watch</h2>
            <p className="mt-1 truncate text-secondary text-ink-2">{visibilityFor.title}</p>
            <div className="mt-3 divide-y divide-line overflow-hidden rounded-card bg-surface-grouped">
              {([['recruiters', 'Clubs & coaches', 'Recruiters only.'], ['public', 'Everyone on Hockia', 'Any signed-in member.']] as const).map(([value, title, sub]) => {
                const on = (visibilityFor.visibility ?? 'public') === value
                return (
                  <button key={value} type="button" role="radio" aria-checked={on} onClick={() => void setVisibility(visibilityFor, value)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                    <span className="min-w-0 flex-1"><span className="block text-body text-ink-1">{title}</span><span className="block text-secondary text-ink-2">{sub}</span></span>
                    {on && <Check className="h-5 w-5 shrink-0 text-hockia-primary" strokeWidth={2.4} />}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </BottomSheet>

      <ConfirmActionModal isOpen={confirmStaged} onClose={() => setConfirmStaged(false)} onConfirm={() => void applyReorder()} title={stagedDeletes.size === 1 ? 'Remove 1 photo?' : `Remove ${stagedDeletes.size} photos?`} description="They disappear from your profile. This cannot be undone." confirmLabel="Remove" confirmTone="danger" />
      <ConfirmActionModal isOpen={pending !== null} onClose={() => setPending(null)} onConfirm={() => void confirmDelete()} title={`Remove ${pendingLabel}?`} description="It disappears from your profile. This cannot be undone." confirmLabel="Remove" confirmTone="danger" confirmLoading={deleting} loadingLabel="Removing…" />

      {playing && (
        <MediaLightbox images={[{ video_id: playing.id, media_type: 'video', duration: playing.durationSeconds, order: 0 }]} initialIndex={0} onClose={() => setPlaying(null)} videoLabel={playing.kind === 'highlight' ? 'Highlight' : 'Full match'} isOwner caption={[playing.title, formatVideoDuration(playing.durationSeconds)].filter(Boolean).join(' · ')} />
      )}
      {photoIndex !== null && (
        <MediaLightbox images={shownPhotos.map((p, i) => ({ url: p.url, media_type: 'image', order: i }))} initialIndex={photoIndex} onClose={() => setPhotoIndex(null)} caption={shownPhotos[photoIndex]?.caption ?? null} />
      )}
    </div>
  )
}
