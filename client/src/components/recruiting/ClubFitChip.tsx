/**
 * ClubFitChip — minimalist signal-strength indicator for player ↔ club
 * recruiting fit, with tap-to-expand reasoning that works inside
 * parent button elements (MemberTile, carousel cards).
 *
 * Design language: three vertical bars in HOCKIA purple, filled
 * progressively (1/2/3 bars = lower/possible/strong fit). Universal
 * cell-signal metaphor — more bars = stronger signal. Monochromatic
 * so there's no traffic-light color guessing.
 *
 * Render contract: a `<span role="button">` (NOT an actual `<button>`)
 * so the chip can safely live inside another `<button>` like
 * MemberTile's full-card click target. Click + Enter/Space toggle an
 * inline popover with the per-component reasoning. The handler stops
 * propagation so tapping the chip doesn't also trigger the parent
 * tile's preview action.
 *
 * Recruiter-only (player candidates + club or coach viewers with a
 * resolvable target — either profile-derived for clubs or override
 * from an active recruiting_context for coaches). Returns null
 * otherwise so consumers don't need to gate at the call site.
 *
 * Copy single-source-of-truth: `clubFitStateLabel()` in clubFit.ts
 * drives both the visible label, the title attribute, the aria-label,
 * and the popover heading.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useClubFit } from '@/hooks/useClubFit'
import { clubFitStateLabel, type ClubFitState } from '@/lib/clubFit'
import type { FitCandidateFields } from '@/lib/clubFit'

/** The minimal fit shape this chip renders. Both ClubFitResult and
 *  CoachFitResult satisfy it, so the chip is the single visual surface for
 *  both the player (Club Fit) and coach (Coach Fit) models. */
export interface ChipFitResult {
  isApplicable: boolean
  state: ClubFitState
  reasons: string[]
  target: string | null
}

interface ClubFitChipProps {
  /** Player candidate — used for the default Club Fit path (the chip
   *  computes the fit itself via useClubFit). Omit when passing a
   *  precomputed `fitResult` (e.g. coach fit). */
  candidate?: FitCandidateFields | null | undefined
  /** Precomputed fit result. When provided, the chip renders THIS instead
   *  of computing player fit — the path used for coach candidates (Phase
   *  2C), whose fit is computed by useCoachFit upstream. */
  fitResult?: ChipFitResult | null
  /** Which model this chip represents — only affects the aria-label
   *  wording ('Club fit' vs 'Coach fit'). Defaults to 'club'. */
  kind?: 'club' | 'coach'
  /** Compact = just the signal bars (carousel cards).
   *  Default = bars + label (tiles, profiles). */
  variant?: 'pill' | 'badge'
  className?: string
}

const STATE_TO_BARS: Record<ClubFitState, 1 | 2 | 3> = {
  green: 3,
  yellow: 2,
  grey: 1,
}

/**
 * Module-level "currently open chip" closer. After F5/F15 portaled
 * each popover to document.body, the old "click another chip → close
 * me" relied on outside-click — which doesn't fire because the new
 * chip's click handler stops propagation. So two popovers could
 * coexist (QA R1, high regression).
 *
 * Fix: every chip that opens registers its close fn here, evicting
 * whoever was registered before. Opening B closes A automatically.
 * Cleanup on unmount or close removes itself. Only one popover can
 * be open across the entire page at any time — matches the spec's
 * "don't stack" rule.
 */
let activeChipCloser: (() => void) | null = null

function registerActiveChip(close: () => void) {
  const previous = activeChipCloser
  activeChipCloser = close
  if (previous && previous !== close) {
    previous()
  }
}

function unregisterActiveChip(close: () => void) {
  if (activeChipCloser === close) {
    activeChipCloser = null
  }
}

/** Three-bar signal indicator. Heights grow left→right; filled bars
 *  in HOCKIA purple, unfilled in a subtle gray. Pure visual — the
 *  surrounding chip owns the accessible label. */
function SignalBars({ filled }: { filled: 1 | 2 | 3 }) {
  return (
    <span className="inline-flex items-end gap-[2px] h-3" aria-hidden="true">
      <span
        className={[
          'w-[3px] rounded-sm transition-colors h-[5px]',
          filled >= 1 ? 'bg-[#8026FA]' : 'bg-gray-200',
        ].join(' ')}
      />
      <span
        className={[
          'w-[3px] rounded-sm transition-colors h-[8px]',
          filled >= 2 ? 'bg-[#8026FA]' : 'bg-gray-200',
        ].join(' ')}
      />
      <span
        className={[
          'w-[3px] rounded-sm transition-colors h-[11px]',
          filled >= 3 ? 'bg-[#8026FA]' : 'bg-gray-200',
        ].join(' ')}
      />
    </span>
  )
}

export default function ClubFitChip({
  candidate,
  fitResult,
  kind = 'club',
  variant = 'pill',
  className = '',
}: ClubFitChipProps) {
  // Rules of hooks: always compute the player fit. When a precomputed
  // `fitResult` is supplied (coach path), it takes precedence and the
  // player computation (NOT_APPLICABLE for a coach candidate) is ignored.
  const computed = useClubFit(candidate ?? null)
  const fit: ChipFitResult = fitResult ?? computed
  const [open, setOpen] = useState(false)
  const popoverId = useId()
  const chipRef = useRef<HTMLSpanElement>(null)

  // Popover element ref — for the click-outside check (need to exclude
  // the portal-rendered popover from the "outside" calculation).
  const popoverElRef = useRef<HTMLSpanElement>(null)

  // R1 fix: single-active-chip registry. When this chip opens, evict
  // any previously open chip. On close/unmount, deregister so we
  // don't leak a stale closer.
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    registerActiveChip(close)
    return () => unregisterActiveChip(close)
  }, [open])

  // Click-outside + Escape to close. The popover is portaled to
  // document.body so chipRef.contains() alone isn't enough — clicks
  // INSIDE the popover would otherwise fire the close handler.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      const insideChip = chipRef.current?.contains(target)
      const insidePopover = popoverElRef.current?.contains(target)
      if (!insideChip && !insidePopover) {
        setOpen(false)
      }
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

  const handleActivate = useCallback((e: React.SyntheticEvent) => {
    // Critical: stop propagation so the parent button (MemberTile,
    // carousel card) doesn't also fire its preview-open handler when
    // the user taps the chip itself.
    e.stopPropagation()
    e.preventDefault()
    setOpen((v) => !v)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      handleActivate(e)
    }
  }, [handleActivate])

  if (!fit.isApplicable) return null

  const bars = STATE_TO_BARS[fit.state]
  const label = clubFitStateLabel(fit.state)
  const tooltip = fit.reasons.length > 0
    ? `${label} — ${fit.reasons.join(' · ')}`
    : label

  // ── Badge variant: just bars, still tappable for the popover ────
  if (variant === 'badge') {
    return (
      <span
        ref={chipRef}
        role="button"
        tabIndex={0}
        onClick={handleActivate}
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
        className={[
          'relative inline-flex items-center justify-center px-1 cursor-pointer',
          'rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA]/40',
          className,
        ].join(' ')}
        title={tooltip}
        aria-label={`${kind === 'coach' ? 'Coach' : 'Club'} fit: ${label}. Tap for reasoning.`}
        aria-expanded={open}
        aria-controls={popoverId}
      >
        <SignalBars filled={bars} />
        {open && (
          <ReasoningPopover
            id={popoverId}
            target={fit.target}
            label={label}
            reasons={fit.reasons}
            kind={kind}
            anchorRef={chipRef}
            popoverRef={popoverElRef}
          />
        )}
      </span>
    )
  }

  // ── Pill variant: bars + label, also tappable for the popover ────
  const textClass = (() => {
    if (fit.state === 'green') return 'text-[#8026FA] font-semibold'
    if (fit.state === 'yellow') return 'text-gray-800 font-medium'
    return 'text-gray-500'
  })()

  return (
    <span
      ref={chipRef}
      role="button"
      tabIndex={0}
      onClick={handleActivate}
      onKeyDown={handleKeyDown}
      onMouseDown={(e) => e.stopPropagation()}
      className={[
        'relative inline-flex items-center gap-1.5 text-[11px] leading-none cursor-pointer',
        'rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA]/40',
        'hover:opacity-80 transition-opacity',
        textClass,
        className,
      ].join(' ')}
      title={tooltip}
      aria-label={`${kind === 'coach' ? 'Coach' : 'Club'} fit: ${label}. Tap for reasoning.`}
      aria-expanded={open}
      aria-controls={popoverId}
    >
      <SignalBars filled={bars} />
      {label}
      {open && (
        <ReasoningPopover
          id={popoverId}
          target={fit.target}
          label={label}
          reasons={fit.reasons}
          kind={kind}
          anchorRef={chipRef}
          popoverRef={popoverElRef}
        />
      )}
    </span>
  )
}

interface ReasoningPopoverProps {
  id: string
  target: string | null
  label: string
  reasons: string[]
  /** 'coach' makes the privacy footer read "coach" instead of "player". */
  kind?: 'club' | 'coach'
  anchorRef: React.RefObject<HTMLSpanElement | null>
  popoverRef: React.RefObject<HTMLSpanElement | null>
}

const POPOVER_WIDTH = 256 // matches w-64 in the markup
const VIEWPORT_PADDING = 8 // breathing room from screen edges
const ANCHOR_GAP = 6 // mt-1.5

/**
 * Fixed-position reasoning panel rendered via React portal to
 * document.body so it escapes parent containers with `overflow:
 * hidden` (MemberTile + carousel cards). Anchored to the chip via
 * getBoundingClientRect, clamped to the viewport so it can't spill
 * off the left/right edges at 390px mobile widths. Re-measures on
 * scroll + resize so the popover follows the chip if the user
 * scrolls while it's open.
 *
 * Was: absolutely-positioned span inside the chip, which clipped on
 * every card boundary (QA F5/F15).
 */
function ReasoningPopover({
  id, target, label, reasons, kind = 'club', anchorRef, popoverRef,
}: ReasoningPopoverProps) {
  const subject = kind === 'coach' ? 'coach' : 'player'
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const measure = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const viewportW = window.innerWidth
    // Default anchor: bottom-left of the chip, popover left-aligned
    const desiredLeft = rect.left
    // Clamp horizontally so the popover never spills past either edge
    const maxLeft = viewportW - POPOVER_WIDTH - VIEWPORT_PADDING
    const left = Math.max(VIEWPORT_PADDING, Math.min(desiredLeft, maxLeft))
    const top = rect.bottom + ANCHOR_GAP
    setPos({ top, left })
  }, [anchorRef])

  // Measure on mount + whenever the chip moves (scroll, resize, fonts).
  // useLayoutEffect runs before paint so there's no flash at (0,0).
  useLayoutEffect(() => {
    measure()
  }, [measure])

  useEffect(() => {
    // rAF-coalesced — sync getBoundingClientRect inside the scroll
    // handler causes layout thrash if fired hundreds of times per
    // second during a momentum scroll. The rAF gate drops anything
    // beyond one measure per frame (~16ms at 60fps); the first
    // measure of a frame still runs synchronously inside the rAF
    // callback so positioning stays pixel-correct.
    let rafId: number | null = null
    const onChange = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        measure()
      })
    }
    window.addEventListener('scroll', onChange, true) // capture: catch nested scrolls too
    window.addEventListener('resize', onChange)
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      window.removeEventListener('scroll', onChange, true)
      window.removeEventListener('resize', onChange)
    }
  }, [measure])

  // Avoid SSR / first-render flash at (0,0) — render only once we
  // have a real measurement. Tests can still assert presence because
  // useLayoutEffect runs synchronously after mount.
  if (!pos) return null

  return createPortal(
    <span
      ref={popoverRef}
      id={id}
      role="tooltip"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: POPOVER_WIDTH,
      }}
      className="z-50 rounded-lg border border-gray-200 bg-white p-3 shadow-xl text-left cursor-auto"
    >
      <span className="block text-[11px] font-bold text-gray-900 mb-1">
        {label}
        {target && (
          <span className="font-normal text-gray-500"> · for your {target.toLowerCase()}'s team</span>
        )}
      </span>
      <span className="block text-[10px] text-gray-500 mb-2 leading-relaxed">
        Based on facts in this {subject}'s profile. Never published back to the {subject}.
      </span>
      <span className="block space-y-1 text-[11px] text-gray-700">
        {reasons.map((r, i) => (
          <span key={i} className="flex gap-1.5">
            <span className="text-gray-400 mt-0.5">·</span>
            <span>{r}</span>
          </span>
        ))}
      </span>
    </span>,
    document.body,
  )
}
