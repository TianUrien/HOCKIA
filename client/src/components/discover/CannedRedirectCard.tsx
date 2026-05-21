import { ArrowRight, Briefcase, ShoppingBag, LayoutDashboard, Home, Users, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { DiscoverCta } from '@/hooks/useDiscover'

interface CannedRedirectCardProps {
  message: string
  /** Explicit CTA from a platform_help response — takes precedence over
   *  inferring the destination from the message text. */
  cta?: DiscoverCta | null
}

/** Pick a leading icon for the CTA button from its route. */
function iconForRoute(route: string): typeof Briefcase {
  if (route.startsWith('/opportunities')) return Briefcase
  if (route.startsWith('/marketplace')) return ShoppingBag
  if (route.startsWith('/dashboard')) return LayoutDashboard
  if (route.startsWith('/home')) return Home
  if (route.startsWith('/community')) return Users
  if (route.startsWith('/discover')) return Sparkles
  return ArrowRight
}

/**
 * Canned-redirect / platform-help renderer. Renders the assistant message
 * plus a CTA button:
 *   - platform_help responses pass an explicit `cta` ({ label, route }) —
 *     used as-is, with an icon picked from the route.
 *   - legacy Phase-0 opportunity / product redirects embed the path in the
 *     message text; we infer the CTA from it.
 *
 * Falls back to plain-text rendering when neither yields a destination.
 */
export default function CannedRedirectCard({ message, cta: explicitCta }: CannedRedirectCardProps) {
  const navigate = useNavigate()

  let cta: { label: string; path: string; icon: typeof Briefcase } | null = null
  if (explicitCta?.route) {
    cta = { label: explicitCta.label, path: explicitCta.route, icon: iconForRoute(explicitCta.route) }
  } else if (message.includes('/opportunities')) {
    cta = { label: 'Browse opportunities', path: '/opportunities', icon: Briefcase }
  } else if (message.includes('/marketplace')) {
    cta = { label: 'Open Marketplace', path: '/marketplace', icon: ShoppingBag }
  }

  return (
    <div className="bg-white border border-gray-200/80 rounded-2xl rounded-tl-md px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <p className="text-[14px] text-gray-800 leading-[1.55] whitespace-pre-line">{message}</p>
      {cta && (
        <button
          type="button"
          onClick={() => navigate(cta.path)}
          className="
            mt-3.5 inline-flex items-center gap-2
            min-h-[40px] px-4 py-2
            rounded-full
            bg-gradient-to-br from-[#8026FA] to-[#924CEC]
            text-white text-[12px] font-semibold tracking-[0.01em]
            shadow-sm shadow-[#8026FA]/20
            hover:shadow-md hover:shadow-[#8026FA]/30
            active:scale-[0.98] active:translate-y-px
            transition-all duration-150
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA]/40
          "
        >
          <cta.icon className="w-3.5 h-3.5" aria-hidden="true" />
          {cta.label}
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
