import { cn } from '@/lib/utils'

/**
 * CompletionArc — half-circle progress arc for the Hero card.
 *
 * Renders as a 180° arc from left → top → right (open at the bottom).
 * The percentage label + caption stack vertically in the middle of the
 * arc; total height = roughly half the width.
 *
 * The arc is purely cosmetic — the canonical % comes from
 * useProfileStrength. Component is render-only; no data fetch here.
 */
interface CompletionArcProps {
  /** 0–100 */
  percentage: number
  /** Defaults to "Profile complete". */
  caption?: string
  /** Pixel width of the arc. Height = width / 2 + label space. */
  size?: number
  className?: string
}

export default function CompletionArc({
  percentage,
  caption = 'Profile complete',
  size = 140,
  className,
}: CompletionArcProps) {
  // Clamp + round so the SVG arithmetic is always well-defined.
  const pct = Math.max(0, Math.min(100, Math.round(percentage)))

  // Stroke + geometry. We want the arc to leave a comfortable gap
  // between the path edge and the SVG viewBox so the stroke doesn't
  // clip on the sides.
  const strokeWidth = 10
  const radius = (size - strokeWidth) / 2
  const cy = size / 2

  // Half-circumference (we only draw the top half of the circle).
  // dashoffset shrinks as percent grows so the arc "fills up".
  const halfCircumference = Math.PI * radius
  const dashOffset = halfCircumference * (1 - pct / 100)

  return (
    <div
      className={cn('inline-flex flex-col items-center', className)}
      data-testid="completion-arc"
      aria-label={`${caption}: ${pct}%`}
    >
      <svg
        width={size}
        // Height is just the top half of the circle plus a tiny pad
        // for the rounded stroke caps to render without clipping.
        height={size / 2 + strokeWidth}
        viewBox={`0 0 ${size} ${size / 2 + strokeWidth}`}
        role="img"
      >
        {/* Background track */}
        <path
          d={`M ${strokeWidth / 2} ${cy} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${cy}`}
          fill="none"
          stroke="rgb(243 244 246)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Progress arc */}
        <path
          d={`M ${strokeWidth / 2} ${cy} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${cy}`}
          fill="none"
          stroke="url(#completion-arc-gradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={halfCircumference}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 600ms ease-out' }}
        />
        <defs>
          <linearGradient id="completion-arc-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8026FA" />
            <stop offset="100%" stopColor="#924CEC" />
          </linearGradient>
        </defs>
      </svg>

      <div className="-mt-7 text-center">
        <div className="text-2xl font-bold text-[#8026FA] tabular-nums leading-none">
          {pct}%
        </div>
        <div className="mt-1 text-[11px] font-medium text-gray-500">{caption}</div>
      </div>
    </div>
  )
}
