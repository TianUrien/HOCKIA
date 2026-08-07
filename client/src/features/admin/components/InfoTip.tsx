/**
 * InfoTip — the ⓘ next to every dashboard metric.
 *
 * Opens on hover AND click (touch/iPad admins), closes on leave, outside
 * click, or Escape. Renders the metric's explainer from metricInfo.ts:
 * what it measures, formula, why it matters, benchmark bands with the
 * current tier highlighted, and a plain-English interpretation.
 */

import { useId, useRef, useState } from 'react'
import { Info } from 'lucide-react'
import {
  METRIC_INFO,
  TIER_LABELS,
  TIER_COLORS,
  classifyMetric,
  type MetricExplainer,
  type MetricKey,
} from '../lib/metricInfo'

interface InfoTipProps {
  metric: MetricKey
  /** Current value, used to highlight the benchmark band + interpretation. */
  value?: number
  /** Plain-English reading of the current number, e.g. "Nearly half of
   *  monthly actives return every week." Shown as the closing line. */
  interpretation?: string
  /** 'right' anchors the panel's right edge to the icon — use for tips
   *  living near the viewport's right edge where centering would clip. */
  align?: 'center' | 'right'
}

export function InfoTip({ metric, value, interpretation, align = 'center' }: InfoTipProps) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelId = useId()
  // Widen from the per-key literal type so optional fields (unit,
  // benchmarks) are accessible on every member.
  const info: MetricExplainer = METRIC_INFO[metric]
  const band = value !== undefined ? classifyMetric(info, value) : null

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpen(true)
  }
  // Small delay so moving the pointer from icon to panel doesn't close it.
  const scheduleHide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
    >
      <button
        type="button"
        aria-label={`About ${info.title}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
        onBlur={scheduleHide}
        className="text-gray-300 hover:text-gray-500 focus:text-gray-500 focus:outline-none transition-colors"
      >
        <Info className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          id={panelId}
          role="tooltip"
          // normal-case + tracking-normal + font-normal: the ⓘ lives inside
          // tile labels styled uppercase/tracking-wider/semibold, and the
          // popover must not inherit that shouting.
          className={`absolute top-full z-40 mt-2 w-80 rounded-xl border border-gray-200 bg-white p-4 text-left normal-case tracking-normal font-normal shadow-xl ${
            align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2'
          }`}
        >
          <p className="text-[13px] font-semibold text-gray-900">{info.title}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{info.measures}</p>

          <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">How it’s calculated</p>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-600">{info.formula}</p>

          <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Why it matters</p>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-600">{info.why}</p>

          {info.benchmarks && (
            <>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Benchmarks</p>
              <div className="mt-1 space-y-0.5">
                {info.benchmarks.map((b) => {
                  const isCurrent = band?.tier === b.tier
                  return (
                    <div
                      key={b.tier}
                      className={`flex items-center justify-between rounded px-1.5 py-0.5 text-xs ${
                        isCurrent ? 'bg-gray-50 font-semibold' : ''
                      }`}
                    >
                      <span className={isCurrent ? TIER_COLORS[b.tier] : 'text-gray-500'}>
                        {TIER_LABELS[b.tier]}
                      </span>
                      <span className="text-gray-400">{b.label}</span>
                    </div>
                  )
                })}
              </div>
              {band && value !== undefined && (
                <p className="mt-1.5 text-xs font-medium text-gray-700">
                  HOCKIA: {value}
                  {info.unit ?? ''} → <span className={TIER_COLORS[band.tier]}>{TIER_LABELS[band.tier]}</span>
                </p>
              )}
            </>
          )}

          {interpretation && (
            <p className="mt-2 border-t border-gray-100 pt-2 text-xs leading-relaxed text-gray-700 italic">
              {interpretation}
            </p>
          )}
        </div>
      )}
    </span>
  )
}
