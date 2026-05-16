import { UserCircle2 } from 'lucide-react'
import DashboardCard from './DashboardCard'

/**
 * AboutMeCard — bio preview. Body shows the bio text (clamped to a few
 * lines on the card; full bio still visible at the source tab).
 * Owner sees an Edit CTA; visitor sees nothing extra.
 */
interface AboutMeCardProps {
  bio?: string | null
  readOnly: boolean
  onEdit?: () => void
  onViewFull?: () => void
}

export default function AboutMeCard({ bio, readOnly, onEdit, onViewFull }: AboutMeCardProps) {
  const hasBio = Boolean(bio?.trim())

  return (
    <DashboardCard
      icon={UserCircle2}
      title="About me"
      ctaLabel={!readOnly ? 'Edit' : hasBio ? 'View more' : undefined}
      onCtaClick={!readOnly ? onEdit : onViewFull}
      testId="about-me-card"
    >
      {hasBio ? (
        <p className="text-sm text-gray-700 leading-relaxed line-clamp-4 whitespace-pre-line">
          {bio}
        </p>
      ) : readOnly ? (
        <p className="text-sm text-gray-500 italic">No bio shared yet.</p>
      ) : (
        <p className="text-sm text-gray-500">
          Share your playing style, ambitions, and what you’re looking for in a club.
        </p>
      )}
    </DashboardCard>
  )
}
