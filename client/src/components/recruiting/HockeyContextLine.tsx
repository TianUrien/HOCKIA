/**
 * HockeyContextLine — single fact-only line for player cards.
 *
 * Spec G.2 of the Recruitment Build Spec v1:
 *   "One line, fact-only: {currentClub} · {currentCompetition.name}
 *    · {position}. Falls back to 'Not added yet' per missing field
 *    (italic, muted)."
 *
 * Locked principle (Section A): facts, not judgment. No completeness
 * %, no commentary on quality. Just the three structured fields the
 * recruiter needs to triage at a glance: where they play, in what
 * league, and at what position.
 *
 * Render contract: 3 segments separated by middle-dot. Each missing
 * segment becomes an italic muted "Not added yet" — explicit absence
 * is more honest than collapsing the dot separators (which would
 * make a 1-segment line look like the player has only one fact, when
 * really they have one out of three).
 */

interface HockeyContextLineProps {
  /** Player's current club display name (free-text from profile.current_club
   *  OR the world_clubs.name resolved by the parent). */
  clubName?: string | null
  /** Display name of the current league. Server-side computed by
   *  get_top_community_members for carousel cards; resolved via
   *  getPlayerLeagueName() from the prefetch cache for grid cards. */
  competitionName?: string | null
  /** Player position (Forward, Midfield, Defender, Goalkeeper). */
  position?: string | null
  className?: string
}

const MISSING_LABEL = 'Not added yet'

export default function HockeyContextLine({
  clubName,
  competitionName,
  position,
  className = '',
}: HockeyContextLineProps) {
  const club = clubName?.trim()
  const competition = competitionName?.trim()
  const pos = position?.trim()

  return (
    <p
      className={[
        'text-xs text-gray-600 truncate',
        className,
      ].join(' ')}
    >
      <Segment value={club} />
      <span className="text-gray-300 mx-1" aria-hidden="true">·</span>
      <Segment value={competition} />
      <span className="text-gray-300 mx-1" aria-hidden="true">·</span>
      <Segment value={pos} />
    </p>
  )
}

function Segment({ value }: { value: string | null | undefined }) {
  if (!value) {
    return <span className="italic text-gray-400">{MISSING_LABEL}</span>
  }
  return <span>{value}</span>
}
