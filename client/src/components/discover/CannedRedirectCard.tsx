import { useNavigate } from 'react-router-dom'
import type { DiscoverCta } from '@/hooks/useDiscover'
import { Chip } from '@/components/ui/Chip'

interface CannedRedirectCardProps {
  message: string
  /** Explicit CTA from a platform_help response — takes precedence over
   *  inferring the destination from the message text. */
  cta?: DiscoverCta | null
}

/**
 * Canned-redirect / platform-help answer: the message as plain text plus
 * one navigate Chip.
 *   - platform_help responses pass an explicit `cta` ({ label, route });
 *   - legacy Phase-0 opportunity / product redirects embed the path in the
 *     message text; the destination is inferred from it.
 * Falls back to plain text when neither yields a destination.
 */
export default function CannedRedirectCard({ message, cta: explicitCta }: CannedRedirectCardProps) {
  const navigate = useNavigate()

  let cta: { label: string; path: string } | null = null
  if (explicitCta?.route) {
    cta = { label: explicitCta.label, path: explicitCta.route }
  } else if (message.includes('/opportunities')) {
    cta = { label: 'Browse opportunities', path: '/opportunities' }
  } else if (message.includes('/marketplace')) {
    cta = { label: 'Open Marketplace', path: '/marketplace' }
  }

  return (
    <div>
      <p className="text-row text-ink-1 whitespace-pre-line">{message}</p>
      {cta && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip label={cta.label} onClick={() => navigate(cta.path)} />
        </div>
      )}
    </div>
  )
}
