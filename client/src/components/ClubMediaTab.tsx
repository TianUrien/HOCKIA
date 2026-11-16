import GalleryManager from './GalleryManager'
import { useWorldT } from '@/i18n/ns/world'

interface ClubMediaTabProps {
  clubId?: string
  readOnly?: boolean
  /** Fired with the photo count on every gallery change — the Club
   *  dashboard wires this to its profile-strength refresh so the
   *  completion arc updates without a route change. */
  onCountChange?: (count: number) => void
  /** Public-portfolio cap (readOnly only) — see GalleryManager. */
  previewLimit?: number
}

export default function ClubMediaTab({ clubId, readOnly = false, onCountChange, previewLimit }: ClubMediaTabProps) {
  const t = useWorldT()
  return (
    <GalleryManager
      mode="club"
      entityId={clubId}
      readOnly={readOnly}
      title={t('club.media.title')}
      description={t('club.media.description')}
      emptyStateDescription={t('club.media.empty')}
      addButtonLabel={t('club.media.add')}
      onCountChange={onCountChange}
      previewLimit={previewLimit}
    />
  )
}
