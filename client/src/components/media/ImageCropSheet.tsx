import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Minus, Plus } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/logger'
import { useMediaT } from '@/i18n/ns/media'
import {
  clampCrop, coverZoom, cropBackground, drawnSize, initialCrop, isPerson, isSmallImage, zoomBounds, zoomTo,
  type Crop, type ImageAnalysis, type ImageKind,
} from '@/lib/imageFit'
import { loadImageFile, releaseImage, renderCrop, sampleImage, type LoadedImage } from '@/lib/imageCropRender'

interface ImageCropSheetProps {
  file: File
  kind: ImageKind
  /** The square to store, or null when the member cancels. */
  onDone: (square: File | null) => void
}

interface Ready {
  image: LoadedImage
  analysis: ImageAnalysis
  background: string | null
}

/** Organisations are rounded squares (25 % radius), people are circles. */
const SHAPE: Record<ImageKind, string> = { person: 'rounded-full', crest: 'rounded-[25%]', logo: 'rounded-[25%]' }
const PREVIEW_SIZES = [72, 48, 32]

function imageStyle(crop: Crop, width: number, height: number): CSSProperties {
  const size = drawnSize(width, height, crop.zoom)
  return {
    width: `${size.w * 100}%`,
    height: `${size.h * 100}%`,
    left: `${(0.5 + crop.x - size.w / 2) * 100}%`,
    top: `${(0.5 + crop.y - size.h / 2) * 100}%`,
  }
}

/**
 * The adjust step after picking a photo, crest or logo. It opens on the
 * automatic fit, so "Use" without touching anything already gives a tidy
 * result; drag, pinch, scroll or the slider change it, and the small previews
 * show the shape the app will use everywhere.
 */
export default function ImageCropSheet({ file, kind, onDone }: ImageCropSheetProps) {
  const t = useMediaT()
  const [ready, setReady] = useState<Ready | null>(null)
  const [failed, setFailed] = useState(false)
  const [crop, setCrop] = useState<Crop>({ zoom: 1, x: 0, y: 0 })
  const [saving, setSaving] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const person = isPerson(kind)

  useEffect(() => {
    let cancelled = false
    let loaded: LoadedImage | null = null
    loadImageFile(file)
      .then((image) => {
        loaded = image
        if (cancelled) { releaseImage(image); return }
        const analysis = sampleImage(image)
        setCrop(initialCrop(analysis, image.width, image.height, kind))
        setReady({ image, analysis, background: cropBackground(analysis, kind) })
      })
      .catch((err) => {
        logger.error('[ImageCropSheet] could not open the image', err)
        if (!cancelled) setFailed(true)
      })
    return () => { cancelled = true; releaseImage(loaded) }
  }, [file, kind])

  const width = ready?.image.width ?? 1
  const height = ready?.image.height ?? 1
  const bounds = useMemo(() => zoomBounds(width, height, kind), [width, height, kind])

  const update = useCallback((next: (c: Crop) => Crop) => {
    setCrop((c) => clampCrop(next(c), width, height, kind))
  }, [width, height, kind])
  const setZoom = useCallback((zoom: number) => {
    setCrop((c) => zoomTo(c, zoom, width, height, kind))
  }, [width, height, kind])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!ready) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const before = pointers.current.get(e.pointerId)
    const side = stageRef.current?.clientWidth
    if (!before || !side) return
    const others = [...pointers.current.entries()].filter(([id]) => id !== e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (others.length === 0) {
      const dx = (e.clientX - before.x) / side
      const dy = (e.clientY - before.y) / side
      update((c) => ({ ...c, x: c.x + dx, y: c.y + dy }))
      return
    }
    // Two fingers: the change in their distance is the zoom.
    const other = others[0][1]
    const was = Math.hypot(before.x - other.x, before.y - other.y)
    const now = Math.hypot(e.clientX - other.x, e.clientY - other.y)
    if (was > 0 && now > 0) setCrop((c) => zoomTo(c, c.zoom * (now / was), width, height, kind))
  }
  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => { pointers.current.delete(e.pointerId) }

  // React attaches wheel listeners as passive, so the page would scroll too.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !ready) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setCrop((c) => zoomTo(c, c.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06), width, height, kind))
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [ready, width, height, kind])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = 0.02
    const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const by = move[e.key]
    if (by) { e.preventDefault(); update((c) => ({ ...c, x: c.x + by[0], y: c.y + by[1] })); return }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(crop.zoom * 1.1) }
    if (e.key === '-') { e.preventDefault(); setZoom(crop.zoom / 1.1) }
  }

  const confirm = async () => {
    if (!ready || saving) return
    setSaving(true)
    try {
      onDone(await renderCrop(ready.image, crop, { kind, background: ready.background, sourceType: file.type, name: file.name }))
    } catch (err) {
      logger.error('[ImageCropSheet] could not render the crop', err)
      setFailed(true)
      setSaving(false)
    }
  }

  const cancel = useCallback(() => { if (!saving) onDone(null) }, [onDone, saving])
  const fill = ready ? { backgroundColor: ready.background ?? undefined } : undefined
  const slider = bounds.max > bounds.min ? ((crop.zoom - bounds.min) / (bounds.max - bounds.min)) * 100 : 0
  const picture = (key: string) => ready && (
    <img key={key} src={ready.image.url} alt="" draggable={false} className="pointer-events-none absolute max-w-none select-none" style={imageStyle(crop, width, height)} />
  )

  return (
    <BottomSheet open onClose={cancel} ariaLabel={t(`imageCrop.title.${kind}`)} initialFocus="panel">
      <div className="px-5 pt-1" data-testid="image-crop-sheet">
        <h2 className="font-display text-[20px] font-bold text-ink-1">{t(`imageCrop.title.${kind}`)}</h2>
        <p className="mt-1 text-[14px] text-ink-2">{t(failed ? 'imageCrop.failed' : 'imageCrop.hint')}</p>

        {!failed && (
          <>
            <div
              ref={stageRef}
              role="group"
              tabIndex={0}
              aria-label={t('imageCrop.stageLabel')}
              data-testid="image-crop-stage"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onKeyDown={onKeyDown}
              className="relative mx-auto mt-4 aspect-square w-full max-w-[min(300px,32dvh)] cursor-grab touch-none overflow-hidden rounded-tile bg-white ring-1 ring-line focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary active:cursor-grabbing"
              style={fill}
            >
              {ready ? picture('stage') : <span className="absolute inset-0 animate-pulse bg-surface-muted" />}
              {/* Everything outside the final shape is veiled, so the shape is what the eye reads. */}
              <span aria-hidden="true" className={cn('pointer-events-none absolute inset-0 ring-[400px] ring-white/75', SHAPE[kind])} />
              <span aria-hidden="true" className={cn('pointer-events-none absolute inset-0 border border-line-strong', SHAPE[kind])} />
            </div>

            <div className="mx-auto mt-3 flex w-full max-w-[300px] items-center gap-3">
              <button type="button" aria-label={t('imageCrop.zoomOut')} onClick={() => setZoom(crop.zoom / 1.15)} disabled={!ready} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-surface-muted disabled:opacity-40">
                <Minus className="h-5 w-5" strokeWidth={1.8} />
              </button>
              <input
                type="range"
                min={0}
                max={100}
                step={0.5}
                value={slider}
                disabled={!ready}
                aria-label={t('imageCrop.zoom')}
                data-testid="image-crop-zoom"
                onChange={(e) => setZoom(bounds.min + (Number(e.target.value) / 100) * (bounds.max - bounds.min))}
                className="h-11 w-full accent-hockia-primary"
              />
              <button type="button" aria-label={t('imageCrop.zoomIn')} onClick={() => setZoom(crop.zoom * 1.15)} disabled={!ready} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-surface-muted disabled:opacity-40">
                <Plus className="h-5 w-5" strokeWidth={1.8} />
              </button>
            </div>

            {!person && ready && (
              <div className="mt-1 flex justify-center gap-2">
                <Button variant="tonal" size="small" data-testid="image-crop-fit" onClick={() => setCrop(initialCrop(ready.analysis, width, height, kind))}>{t('imageCrop.fit')}</Button>
                <Button variant="tonal" size="small" data-testid="image-crop-fill" onClick={() => setCrop(clampCrop({ zoom: coverZoom(width, height), x: 0, y: 0 }, width, height, kind))}>{t('imageCrop.fill')}</Button>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between gap-4 rounded-tile bg-surface-muted px-4 py-3">
              <span className="text-[13px] text-ink-2">{t('imageCrop.preview')}</span>
              <span className="flex items-end gap-3" data-testid="image-crop-previews">
                {PREVIEW_SIZES.map((size) => (
                  <span key={size} className={cn('relative block shrink-0 overflow-hidden bg-white ring-1 ring-line', SHAPE[kind])} style={{ width: size, height: size, ...fill }}>
                    {picture(`preview-${size}`)}
                  </span>
                ))}
              </span>
            </div>

            {ready && isSmallImage(width, height) && (
              <p className="mt-2 text-[13px] text-ink-2" data-testid="image-crop-small">{t('imageCrop.small', { width, height })}</p>
            )}
          </>
        )}

        {/* Stays in view on short screens: the rest of the sheet scrolls under it. */}
        <div className={cn('sticky bottom-0 -mx-5 mt-4 grid gap-3 bg-white px-5 pb-3 pt-3', failed ? 'grid-cols-1' : 'grid-cols-2')}>
          <Button variant="secondary" block onClick={cancel} disabled={saving} data-testid="image-crop-cancel">{t(failed ? 'imageCrop.close' : 'imageCrop.cancel')}</Button>
          {!failed && <Button block loading={saving} disabled={!ready} onClick={() => void confirm()} data-testid="image-crop-confirm">{t(`imageCrop.use.${kind}`)}</Button>}
        </div>
      </div>
    </BottomSheet>
  )
}
