import { useOpportunitiesT } from '@/i18n/ns/opportunities'

/**
 * The club's own words under a decline note that is shown translated into the
 * reader's language (founder decision 2026-11-19: translation first, original
 * always visible). Renders nothing when the note was not translated.
 */
export function ClubNoteOriginal({ original, className = 'mt-2 text-caption text-ink-3' }: { original: string | null; className?: string }) {
  const t = useOpportunitiesT()
  if (!original) return null
  return (
    <p className={className} data-testid="club-note-original">
      {t('detail.noteOriginal')}{' '}
      <span className="whitespace-pre-wrap break-words">{original}</span>
    </p>
  )
}
