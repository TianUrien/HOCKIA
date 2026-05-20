import GalleryManager from './GalleryManager'

interface ClubMediaTabProps {
  clubId?: string
  readOnly?: boolean
  /** Fired with the photo count on every gallery change — the Club
   *  dashboard wires this to its profile-strength refresh so the
   *  completion arc updates without a route change. */
  onCountChange?: (count: number) => void
}

export default function ClubMediaTab({ clubId, readOnly = false, onCountChange }: ClubMediaTabProps) {
  return (
    <GalleryManager
      mode="club"
      entityId={clubId}
      readOnly={readOnly}
      title="Photo Gallery"
      description="Manage your club photos"
      emptyStateDescription="No photos yet"
      addButtonLabel="Add Photos"
      onCountChange={onCountChange}
    />
  )
}
