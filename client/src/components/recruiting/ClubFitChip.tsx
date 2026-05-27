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
 * Recruiter-only (player candidates + club viewers with a declared
 * team category). Returns null otherwise so consumers don't need to
 * gate at the call site.
 *
 * Copy single-source-of-truth: `clubFitStateLabel()` in clubFit.ts
 * drives both the visible label, the title attribute, the aria-label,
 * and the popover heading.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useClubFit } from '@/hooks/useClubFit'
import { clubFitStateLabel, type ClubFitState } from '@/lib/clubFit'
import type { FitCandidateFields } from '@/lib/clubFit'

interface ClubFitChipProps {
  candidate: FitCandidateFields | null | undefined
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
  variant = 'pill',
  className = '',
}: ClubFitChipProps) {
  const fit = useClubFit(candidate)
  const [open, setOpen] = useState(false)
  const popoverId = useId()
  const chipRef = useRef<HTMLSpanElement>(null)

  // Click-outside + Escape to close.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (chipRef.current && !chipRef.current.contains(e.target as Node)) {
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
        aria-label={`Club fit: ${label}. Tap for reasoning.`}
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
      aria-label={`Club fit: ${label}. Tap for reasoning.`}
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
}

/** Absolutely-positioned reasoning panel anchored to the chip. Stops
 *  propagation on every interactive event so the parent button never
 *  fires while the popover is open. */
function ReasoningPopover({ id, target, label, reasons }: ReasoningPopoverProps) {
  return (
    <span
      id={id}
      role="tooltip"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="absolute z-30 left-0 top-full mt-1.5 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-xl text-left cursor-auto"
    >
      <span className="block text-[11px] font-bold text-gray-900 mb-1">
        {label}
        {target && (
          <span className="font-normal text-gray-500"> · for your {target.toLowerCase()}'s team</span>
        )}
      </span>
      <span className="block text-[10px] text-gray-500 mb-2 leading-relaxed">
        Based on facts in this player's profile. Never published back to the player.
      </span>
      <span className="block space-y-1 text-[11px] text-gray-700">
        {reasons.map((r, i) => (
          <span key={i} className="flex gap-1.5">
            <span className="text-gray-400 mt-0.5">·</span>
            <span>{r}</span>
          </span>
        ))}
      </span>
    </span>
  )
}
