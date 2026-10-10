import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Camera, ImagePlus } from 'lucide-react'
import { buttonClassName } from '@/components/ui/buttonClasses'
import { useToastStore } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { COVER_COPY, coverSupportingText } from '@/lib/coverCopy'

/**
 * Profile cover (banner) — founder ruling 10 Oct 2026.
 *
 * Owner, no cover: a soft brand gradient with a centred empty state (icon,
 * "Add a cover photo", a role-specific line, a secondary "Add cover photo"
 * pill). The pill AND the whole banner open the image picker.
 * Owner, has cover: the image with a small glass "Change cover" pill at the
 * bottom-right.
 * Visitor: never any editing prompt — the image, or a decorative default
 * cover (brand gradient + the HOCKIA symbol watermark), aria-hidden.
 *
 * The empty-state content sits in a safe zone that clears the top-right
 * buttons (top bar height + safe-area inset) and the avatar overlap at the
 * bottom-left. When that zone is too short or narrow (native safe area,
 * 320 px phones), the supporting line drops before anything can overlap.
 *
 * Upload reuses the host's existing media pipeline (`onUpload` = the
 * gallery / club-media `add`, which makes the new photo the first one —
 * the cover). The banner shows a local preview with a spinner while it
 * runs; a failure toasts and the previous state returns.
 */
export interface ProfileCoverProps {
  /** Owner sees the edit affordances; visitor never does. */
  owner: boolean
  /** Profile role — picks the empty-state supporting line. */
  role: string | null | undefined
  /** Whether a cover image exists (the image layer is passed as children). */
  hasCover: boolean
  /** Identity of the current cover (its url) — a change ends the upload preview. */
  coverKey?: string | null
  /** Tailwind height class(es) for the banner. */
  heightClassName: string
  /** Pixels the avatar overlaps the banner's bottom edge (kept clear). */
  avatarOverlap: number
  /** Upload one picked file through the existing pipeline; resolve true on success. */
  onUpload?: (file: File) => Promise<boolean>
  /** The image layer (img / carousel). Rendered only when hasCover. */
  children?: ReactNode
  /** Top bar (back / share / settings), drawn above everything. */
  topBar?: ReactNode
  /** Extra overlays above the image (scrims, page dots). */
  overlays?: ReactNode
  className?: string
}

/** Below this zone width the supporting line drops (≈ 340 px phones). */
const MIN_WIDTH_FOR_TEXT = 300
/** Headline row + gap + text + gap + button. */
const FULL_HEIGHT = 92
/** Headline row + gap + button. */
const COMPACT_HEIGHT = 70

export default function ProfileCover({
  owner, role, hasCover, coverKey = null, heightClassName, avatarOverlap, onUpload, children, topBar, overlays, className,
}: ProfileCoverProps) {
  const addToast = useToastStore((s) => s.addToast)
  const fileRef = useRef<HTMLInputElement>(null)
  const zoneRef = useRef<HTMLDivElement>(null)
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [fit, setFit] = useState<'full' | 'compact' | 'minimal'>('full')
  const canEdit = owner && Boolean(onUpload)

  const clearPreview = useCallback(() => {
    setPreview((url) => {
      if (url) { try { URL.revokeObjectURL(url) } catch { /* jsdom */ } }
      return null
    })
  }, [])

  // A new cover arrived from the host (refresh after upload) → drop the preview.
  useEffect(() => {
    if (!uploading) clearPreview()
  }, [coverKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearPreview(), [clearPreview])

  // Fit the empty state into the safe zone; drop the line before overlapping.
  const showEmpty = canEdit && !hasCover && !preview
  useLayoutEffect(() => {
    if (!showEmpty) return
    const measure = () => {
      const el = zoneRef.current
      if (!el) return
      const h = el.clientHeight
      const w = el.clientWidth
      if (!h || !w) { setFit('full'); return } // not laid out (tests)
      if (h < COMPACT_HEIGHT) setFit('minimal')
      else if (h < FULL_HEIGHT || w < MIN_WIDTH_FOR_TEXT) setFit('compact')
      else setFit('full')
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [showEmpty])

  const pick = () => {
    if (!canEdit || uploading) return
    fileRef.current?.click()
  }

  const onFile = async (file: File | undefined) => {
    if (!file || !onUpload) return
    let url: string | null = null
    try { url = URL.createObjectURL(file) } catch { url = null }
    clearPreview()
    setPreview(url)
    setUploading(true)
    let ok = false
    try {
      ok = await onUpload(file)
    } catch {
      ok = false
    }
    setUploading(false)
    if (ok) {
      addToast('Cover updated.', 'success')
      // The host refreshes its cover; keep the preview until coverKey changes,
      // with a fallback so it never lingers.
      window.setTimeout(clearPreview, 8000)
    } else {
      clearPreview()
      addToast('Could not upload the cover. Please try again.', 'error')
    }
  }

  const supporting = coverSupportingText(role)
  // Top bar = safe-area/12 px + 36 px buttons + 8 px air.
  const zoneStyle = {
    top: 'calc(max(env(safe-area-inset-top), 0.75rem) + 44px)',
    bottom: `${avatarOverlap + 8}px`,
  }

  return (
    <div
      className={cn('relative w-full overflow-hidden', heightClassName, className)}
      data-testid="profile-cover"
      data-cover-state={hasCover ? 'image' : owner ? 'owner-empty' : 'default'}
    >
      {/* Background: owner-empty = plain soft brand gradient; visitor = decorative default cover. */}
      {!hasCover && (
        owner ? (
          <div className="absolute inset-0 bg-gradient-to-b from-hockia-soft to-white" aria-hidden="true" />
        ) : (
          <div className="absolute inset-0" aria-hidden="true" data-testid="profile-cover-default">
            <div className="absolute inset-0 bg-gradient-to-b from-hockia-soft to-white" />
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  'radial-gradient(ellipse 65% 90% at 85% 10%, rgba(167,139,250,0.30) 0%, rgba(167,139,250,0) 65%), radial-gradient(ellipse 60% 70% at 10% 0%, rgba(108,43,217,0.10) 0%, rgba(108,43,217,0) 70%)',
              }}
            />
            <img
              src="/brand/svg/hockia-logo-violet.svg"
              alt=""
              width={300}
              height={243}
              className="pointer-events-none absolute -bottom-10 -right-14 h-[200px] w-auto select-none opacity-[0.06] [mask-image:linear-gradient(to_bottom,#000_45%,transparent_85%)]"
              draggable={false}
            />
          </div>
        )
      )}

      {hasCover && children}

      {/* Local preview while uploading / until the host shows the new cover. */}
      {preview && <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover" data-testid="profile-cover-preview" />}

      {overlays}

      {/* Owner, no cover: the whole banner is a tap target (below the top bar). */}
      {showEmpty && (
        <>
          <button
            type="button"
            onClick={pick}
            aria-label={COVER_COPY.headline}
            className="absolute inset-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hockia-primary/60"
            data-testid="profile-cover-tap"
          />
          <div ref={zoneRef} className="pointer-events-none absolute inset-x-4 flex flex-col items-center justify-center text-center" style={zoneStyle}>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/80 text-hockia-primary shadow-sm" data-testid="profile-cover-icon">
                <ImagePlus className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
              </span>
              {fit !== 'minimal' && <span className="text-row font-semibold text-ink-1">{COVER_COPY.headline}</span>}
            </div>
            {fit === 'full' && <p className="mt-1 max-w-[300px] text-secondary text-ink-2">{supporting}</p>}
            <button
              type="button"
              onClick={pick}
              className={buttonClassName({ variant: 'secondary', size: 'small', radius: 'rounded-full', className: 'pointer-events-auto mt-2.5 gap-1.5 shadow-sm' })}
              data-testid="profile-cover-add"
            >
              <Camera className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              {COVER_COPY.button}
            </button>
          </div>
        </>
      )}

      {/* Owner, has cover: a discoverable glass pill, bottom-right. */}
      {canEdit && (hasCover || preview) && !uploading && (
        <button
          type="button"
          onClick={pick}
          aria-label={COVER_COPY.change}
          className="absolute bottom-3 right-3 z-10 inline-flex h-8 items-center gap-1.5 rounded-full bg-black/40 px-3 text-caption font-semibold text-white backdrop-blur-md transition-colors active:bg-black/55 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          data-testid="profile-cover-change"
        >
          <Camera className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
          {COVER_COPY.change}
        </button>
      )}

      {uploading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/35" role="status" aria-live="polite" data-testid="profile-cover-uploading">
          <span className="inline-flex items-center gap-2 rounded-full bg-black/45 px-3.5 py-2 text-secondary font-semibold text-white backdrop-blur-md">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />
            Uploading cover…
          </span>
        </div>
      )}

      {topBar && <div className="absolute inset-x-0 top-0 z-20">{topBar}</div>}

      {canEdit && (
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          data-testid="profile-cover-input"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void onFile(f) }}
        />
      )}
    </div>
  )
}
