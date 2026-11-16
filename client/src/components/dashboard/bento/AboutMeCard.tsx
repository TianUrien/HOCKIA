import { UserCircle2 } from 'lucide-react'
import DashboardCard from './DashboardCard'
import { useHomeT } from '@/i18n/ns/home'

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
  const t = useHomeT()
  const hasBio = Boolean(bio?.trim())

  return (
    <DashboardCard
      icon={UserCircle2}
      title={t('aboutMe.title')}
      ctaLabel={!readOnly ? t('aboutMe.edit') : hasBio ? t('aboutMe.viewMore') : undefined}
      onCtaClick={!readOnly ? onEdit : onViewFull}
      testId="about-me-card"
    >
      {hasBio ? (
        <p className="text-sm text-gray-700 leading-relaxed line-clamp-4 whitespace-pre-line">
          {bio}
        </p>
      ) : readOnly ? (
        <p className="text-sm text-gray-500 italic">{t('aboutMe.emptyVisitor')}</p>
      ) : (
        <p className="text-sm text-gray-500">
          {t('aboutMe.emptyOwner')}
        </p>
      )}
    </DashboardCard>
  )
}
