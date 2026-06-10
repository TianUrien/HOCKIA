/**
 * EvidenceSignal — the "Proven" lens pill, now EXPANDABLE into a recruiter
 * evidence checklist (Phase 2). Same tier pill + glanceable item row as
 * ProvenSignal, but the pill is tappable and opens a portal popover listing
 * every tracked signal as present (✓) or missing (✗), so a recruiter can
 * see at a glance WHY the evidence reads strong or limited.
 *
 * Portal popover (not inline accordion) because the Community tile is
 * `overflow-hidden` inside a fixed-height grid — an inline expand would
 * clip. Mirrors ClubFitChip's proven pattern: render contract is a
 * `<span role="button">` so it nests safely inside the tile's card button,
 * click/Enter/Space toggles, propagation is stopped so the tile's preview
 * doesn't also fire, and a module-level registry keeps only one popover
 * open page-wide.
 *
 * Recruiter-facing throughout — describes the PROFILE's evidence, never
 * instructs the candidate.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Video, Users, BadgeCheck, Trophy, ShieldCheck, Check, X } from 'lucide-react'
import type { ComponentType } from 'react'
import {
  evidenceLevelLabel,
  type EvidenceItem,
  type EvidenceResult,
  type EvidenceChecklistRow,
} from '@/lib/evidence'

const ITEM_ICON: Record<EvidenceItem['key'], ComponentType<{ className?: string }>> = {
  video: Video,
  references: Users,
  verified: BadgeCheck,
  level: Trophy,
}

// Single-active-popover registry — opening one closes any other (matches
// ClubFitChip so the two never stack).
let activeCloser: (() => void) | null = null
function registerActive(close: () => void) {
  const prev = activeCloser
  activeCloser = close
  if (prev && prev !== close) prev()
}
function unregisterActive(close: () => void) {
  if (activeCloser === close) activeCloser = null
}

interface EvidenceSignalProps {
  result: EvidenceResult
  /** Full present/missing checklist for the popover. Empty → not expandable
   *  (falls back to a plain pill). */
  checklist?: EvidenceChecklistRow[]
  className?: string
}

export default function EvidenceSignal({ result, checklist = [], className = '' }: EvidenceSignalProps) {
  const [open, setOpen] = useState(false)
  const popoverId = useId()
  const pillRef = useRef<HTMLSpanElement>(null)
  const popoverElRef = useRef<HTMLSpanElement>(null)
  const expandable = checklist.length > 0

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    registerActive(close)
    return () => unregisterActive(close)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (!pillRef.current?.contains(t) && !popoverElRef.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setOpen((v) => !v)
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') toggle(e)
    },
    [toggle],
  )

  if (!result.isApplicable) return null
  const tier = evidenceLevelLabel(result.level)

  return (
    <div className={['flex flex-col gap-1', className].join(' ')}>
      <span
        ref={pillRef}
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        onClick={expandable ? toggle : undefined}
        onKeyDown={expandable ? onKeyDown : undefined}
        onMouseDown={expandable ? (e) => e.stopPropagation() : undefined}
        className={[
          'inline-flex items-center gap-1 self-start rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700',
          expandable
            ? 'cursor-pointer hover:bg-slate-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA]/40'
            : '',
        ].join(' ')}
        title={result.reasons.length > 0 ? `${tier} — ${result.reasons.join(' · ')}` : tier}
        aria-label={
          expandable
            ? `Evidence: ${tier}. Tap to see the full checklist.`
            : `Evidence: ${tier}. ${result.reasons.join('. ')}`
        }
        aria-expanded={expandable ? open : undefined}
        aria-controls={expandable ? popoverId : undefined}
      >
        <ShieldCheck className="w-3 h-3" aria-hidden="true" />
        {tier}
        {expandable && <span className="text-slate-400" aria-hidden="true">⌄</span>}
      </span>

      {/* Glanceable present-items row (unchanged from ProvenSignal). */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-gray-500">
        {result.items.map((item) => {
          const Icon = ITEM_ICON[item.key]
          return (
            <span key={item.key} className="inline-flex items-center gap-0.5" title={item.detail}>
              <Icon className="w-3 h-3 text-gray-400" />
              {item.label}
            </span>
          )
        })}
      </div>

      {open && expandable && (
        <ChecklistPopover
          id={popoverId}
          tier={tier}
          rows={checklist}
          anchorRef={pillRef}
          popoverRef={popoverElRef}
        />
      )}
    </div>
  )
}

const POPOVER_WIDTH = 232
const VIEWPORT_PADDING = 8
const ANCHOR_GAP = 6

interface ChecklistPopoverProps {
  id: string
  tier: string
  rows: EvidenceChecklistRow[]
  anchorRef: React.RefObject<HTMLSpanElement | null>
  popoverRef: React.RefObject<HTMLSpanElement | null>
}

function ChecklistPopover({ id, tier, rows, anchorRef, popoverRef }: ChecklistPopoverProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const measure = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const maxLeft = window.innerWidth - POPOVER_WIDTH - VIEWPORT_PADDING
    const left = Math.max(VIEWPORT_PADDING, Math.min(rect.left, maxLeft))
    setPos({ top: rect.bottom + ANCHOR_GAP, left })
  }, [anchorRef])

  useLayoutEffect(() => {
    measure()
  }, [measure])

  useEffect(() => {
    let rafId: number | null = null
    const onChange = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        measure()
      })
    }
    window.addEventListener('scroll', onChange, true)
    window.addEventListener('resize', onChange)
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      window.removeEventListener('scroll', onChange, true)
      window.removeEventListener('resize', onChange)
    }
  }, [measure])

  if (!pos) return null

  return createPortal(
    <span
      ref={popoverRef}
      id={id}
      role="tooltip"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
      className="z-50 rounded-lg border border-gray-200 bg-white p-3 shadow-xl text-left cursor-auto"
    >
      <span className="mb-2 block text-[11px] font-bold text-gray-900">
        {tier} <span className="font-normal text-gray-500">· evidence on file</span>
      </span>
      <span className="block space-y-1">
        {rows.map((r) => (
          <span key={r.key} className="flex items-center gap-1.5 text-[11px]">
            {r.present ? (
              <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600" aria-hidden="true" />
            ) : (
              <X className="h-3.5 w-3.5 flex-shrink-0 text-gray-300" aria-hidden="true" />
            )}
            <span className={r.present ? 'text-gray-700' : 'text-gray-400'}>{r.label}</span>
          </span>
        ))}
      </span>
      <span className="mt-2 block text-[10px] leading-relaxed text-gray-400">
        Based on facts in this profile. Never shown to the candidate.
      </span>
    </span>,
    document.body,
  )
}
