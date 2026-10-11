import { useLayoutEffect, type RefObject } from 'react'

/**
 * Continuous corners ("squircle", Figma corner smoothing) for large surfaces
 * (Community finish pass, spec 26:1046). Figma's smoothing math, per corner,
 * as an SVG path applied with `clip-path: path()` — no dependency.
 *
 * The element keeps its border-radius as the fallback (browsers without
 * clip-path path(), and the first paint before measuring). A clip also cuts
 * an outer box-shadow, so surfaces that need one keep plain radius.
 */
export interface Radii { tl: number; tr: number; br: number; bl: number }

type Corner = { r: number; p: number; a: number; b: number; c: number; d: number; arc: number }

const rad = (deg: number) => (deg * Math.PI) / 180

function corner(radius: number, smoothing: number, limit: number): Corner {
  const r = Math.min(radius, limit)
  if (r <= 0) return { r: 0, p: 0, a: 0, b: 0, c: 0, d: 0, arc: 0 }
  // Smoothing borrows straight edge, but never more than half the side.
  const s = Math.min(smoothing, limit / r - 1)
  const p = (1 + Math.max(s, 0)) * r
  const arcMeasure = 90 * (1 - s)
  const arc = Math.sin(rad(arcMeasure / 2)) * r * Math.SQRT2
  const angleAlpha = (90 - arcMeasure) / 2
  const p3ToP4 = r * Math.tan(rad(angleAlpha / 2))
  const angleBeta = 45 * s
  const c = p3ToP4 * Math.cos(rad(angleBeta))
  const d = c * Math.tan(rad(angleBeta))
  const b = (p - arc - c - d) / 3
  const a = 2 * b
  return { r, p, a, b, c, d, arc }
}

const n = (v: number) => Number(v.toFixed(2))

export function squirclePath(w: number, h: number, radii: Radii, smoothing = 0.6): string {
  const limit = Math.min(w, h) / 2
  const tl = corner(radii.tl, smoothing, limit)
  const tr = corner(radii.tr, smoothing, limit)
  const br = corner(radii.br, smoothing, limit)
  const bl = corner(radii.bl, smoothing, limit)
  const parts: string[] = [`M ${n(w - tr.p)} 0`]
  if (tr.r) parts.push(`c ${n(tr.a)} 0 ${n(tr.a + tr.b)} 0 ${n(tr.a + tr.b + tr.c)} ${n(tr.d)}`, `a ${n(tr.r)} ${n(tr.r)} 0 0 1 ${n(tr.arc)} ${n(tr.arc)}`, `c ${n(tr.d)} ${n(tr.c)} ${n(tr.d)} ${n(tr.b + tr.c)} ${n(tr.d)} ${n(tr.a + tr.b + tr.c)}`)
  parts.push(`L ${n(w)} ${n(h - br.p)}`)
  if (br.r) parts.push(`c 0 ${n(br.a)} 0 ${n(br.a + br.b)} ${n(-br.d)} ${n(br.a + br.b + br.c)}`, `a ${n(br.r)} ${n(br.r)} 0 0 1 ${n(-br.arc)} ${n(br.arc)}`, `c ${n(-br.c)} ${n(br.d)} ${n(-(br.b + br.c))} ${n(br.d)} ${n(-(br.a + br.b + br.c))} ${n(br.d)}`)
  parts.push(`L ${n(bl.p)} ${n(h)}`)
  if (bl.r) parts.push(`c ${n(-bl.a)} 0 ${n(-(bl.a + bl.b))} 0 ${n(-(bl.a + bl.b + bl.c))} ${n(-bl.d)}`, `a ${n(bl.r)} ${n(bl.r)} 0 0 1 ${n(-bl.arc)} ${n(-bl.arc)}`, `c ${n(-bl.d)} ${n(-bl.c)} ${n(-bl.d)} ${n(-(bl.b + bl.c))} ${n(-bl.d)} ${n(-(bl.a + bl.b + bl.c))}`)
  parts.push(`L 0 ${n(tl.p)}`)
  if (tl.r) parts.push(`c 0 ${n(-tl.a)} 0 ${n(-(tl.a + tl.b))} ${n(tl.d)} ${n(-(tl.a + tl.b + tl.c))}`, `a ${n(tl.r)} ${n(tl.r)} 0 0 1 ${n(tl.arc)} ${n(-tl.arc)}`, `c ${n(tl.c)} ${n(-tl.d)} ${n(tl.b + tl.c)} ${n(-tl.d)} ${n(tl.a + tl.b + tl.c)} ${n(-tl.d)}`)
  parts.push('Z')
  return parts.join(' ')
}

const supported = () => typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('clip-path', 'path("M0 0")')

/** Keep a squircle clip on an element as it resizes. `radii` = one radius or per corner. */
export function useSquircle<T extends HTMLElement>(ref: RefObject<T | null>, radii: number | Partial<Radii>, smoothing = 0.6, enabled = true) {
  const r: Radii = typeof radii === 'number' ? { tl: radii, tr: radii, br: radii, bl: radii } : { tl: 0, tr: 0, br: 0, bl: 0, ...radii }
  const key = `${r.tl},${r.tr},${r.br},${r.bl},${smoothing}`
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !enabled || !supported() || typeof ResizeObserver === 'undefined') return
    const apply = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width > 0 && height > 0) el.style.clipPath = `path('${squirclePath(width, height, r, smoothing)}')`
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => { ro.disconnect(); el.style.clipPath = '' }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, key, enabled])
}
