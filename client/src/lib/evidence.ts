/**
 * Evidence / "Proven" lens — Increment #1 of the hockey recruitment
 * matching model (see project memory: project_hockia_matching_model).
 *
 * Field-hockey coaches don't trust profiles or self-written CVs — they
 * trust what they can VERIFY: match video, who vouches for the player
 * (references), an admin-verified badge, and a provable level (a real
 * club + league on record). This module turns those signals — all of
 * which HOCKIA already stores — into a single CONFIDENCE signal that sits
 * alongside Fit: "how sure can I be this candidate is what they look
 * like". A strong fit with no evidence should read differently from a
 * strong fit backed by a full match and three references.
 *
 * This is a property of the CANDIDATE alone (no viewer target needed,
 * unlike Club Fit). The recruiter-only gating lives in useEvidence.
 *
 * Honest by construction: we only ever surface evidence that EXISTS. A
 * candidate with no evidence produces isApplicable=false (the card shows
 * nothing rather than a discouraging empty state); the nudge to add
 * video/references belongs on the candidate's own profile, not here.
 */

export type EvidenceLevel = 'strong' | 'moderate' | 'limited'

/** One concrete, glanceable evidence fact (drives the chip row). */
export interface EvidenceItem {
  key: 'video' | 'references' | 'verified' | 'level'
  /** Short chip label, e.g. "Match video", "3 references". */
  label: string
  /** Fuller sentence for the tier-pill tooltip / popover. */
  detail: string
}

export interface EvidenceResult {
  /** True only when the candidate is a person (player/coach) AND has at
   *  least one evidence signal. Consumers render nothing on false. */
  isApplicable: boolean
  level: EvidenceLevel
  /** 0..1 confidence score — internal, for ranking/tiering. */
  score: number
  /** Present evidence facts, in display order (chips). */
  items: EvidenceItem[]
  /** Same facts as full sentences (tier-pill detail). */
  reasons: string[]
}

/** Candidate fields the evidence math reads. All optional — missing data
 *  simply contributes nothing (never lowers confidence below zero). */
export interface EvidenceCandidateFields {
  role: string | null
  highlight_video_url?: string | null
  full_game_video_count?: number | null
  accepted_reference_count?: number | null
  is_verified?: boolean | null
  /** A linked world club implies a provable club + league (level). */
  current_world_club_id?: string | null
}

// Weights — video is the dominant hockey evidence for a PLAYER (a coach
// wants to WATCH), references next (who vouches), then verification +
// provable level. Full match footage outweighs a highlight reel.
const W_FULL_MATCH = 0.4
const W_HIGHLIGHT = 0.28
const W_REFERENCES_MAX = 0.3 // scaled by min(count, REF_CAP)/REF_CAP
const W_VERIFIED = 0.15
const W_LEVEL = 0.15
const REF_CAP = 3

// Coach weights — coaches have NO video-upload surface, so match footage
// can't apply (penalising them for it implies a missing artifact they
// can't provide). Their evidence is who vouches (references), an
// admin-verified badge, and an on-record club/league. Re-normalised to sum
// to 1.0 so a well-evidenced coach can still reach "strong".
const W_COACH_REFERENCES_MAX = 0.5
const W_COACH_VERIFIED = 0.25
const W_COACH_LEVEL = 0.25

const LEVEL_THRESHOLDS = { strong: 0.66, moderate: 0.33 } as const

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

/**
 * Compute the evidence/confidence signal for a candidate. Pure — no
 * viewer context (recruiter gating is applied in useEvidence).
 */
export function computeEvidence(
  candidate: EvidenceCandidateFields | null | undefined,
): EvidenceResult {
  const none: EvidenceResult = {
    isApplicable: false,
    level: 'limited',
    score: 0,
    items: [],
    reasons: [],
  }
  if (!candidate) return none
  // Evidence is only meaningful for people we recruit (players + coaches).
  if (candidate.role !== 'player' && candidate.role !== 'coach') return none

  // Coaches have no video-upload surface, so the evidence model swaps to
  // coach-appropriate signals (references + verified + provable club) and
  // never reads or mentions video.
  const isCoach = candidate.role === 'coach'

  const items: EvidenceItem[] = []
  const reasons: string[] = []
  let score = 0

  // ── Video (PLAYERS only — coaches can't upload footage) ──
  if (!isCoach) {
    const fullMatch = candidate.full_game_video_count ?? 0
    if (fullMatch > 0) {
      score += W_FULL_MATCH
      items.push({
        key: 'video',
        label: 'Match video',
        detail: fullMatch > 1 ? `Full match footage (${fullMatch})` : 'Full match footage',
      })
      reasons.push(fullMatch > 1 ? `Full match footage available (${fullMatch} games).` : 'Full match footage available.')
    } else if (candidate.highlight_video_url) {
      score += W_HIGHLIGHT
      items.push({ key: 'video', label: 'Highlight reel', detail: 'Highlight reel available' })
      reasons.push('Highlight reel available.')
    }
  }

  // ── References (who vouches) ──
  const refs = candidate.accepted_reference_count ?? 0
  if (refs > 0) {
    score += (isCoach ? W_COACH_REFERENCES_MAX : W_REFERENCES_MAX) * (Math.min(refs, REF_CAP) / REF_CAP)
    items.push({
      key: 'references',
      label: refs > 1 ? `${refs} references` : '1 reference',
      detail: refs > 1 ? `${refs} accepted references` : '1 accepted reference',
    })
    reasons.push(refs > 1 ? `${refs} accepted references.` : '1 accepted reference.')
  }

  // ── Verified badge ──
  if (candidate.is_verified) {
    score += isCoach ? W_COACH_VERIFIED : W_VERIFIED
    items.push({ key: 'verified', label: 'Verified', detail: 'Verified profile' })
    reasons.push('Admin-verified profile.')
  }

  // ── Provable level (linked club → league) ──
  if (candidate.current_world_club_id) {
    score += isCoach ? W_COACH_LEVEL : W_LEVEL
    items.push({
      key: 'level',
      label: 'Proven level',
      detail: isCoach ? 'Coaches at a listed club & league' : 'Plays at a listed club & league',
    })
    reasons.push(
      isCoach
        ? 'Coaches at a listed club & league (provable level).'
        : 'Plays at a listed club & league (provable level).',
    )
  }

  if (items.length === 0) return none

  score = clamp01(score)
  const level: EvidenceLevel =
    score >= LEVEL_THRESHOLDS.strong ? 'strong' : score >= LEVEL_THRESHOLDS.moderate ? 'moderate' : 'limited'

  return { isApplicable: true, level, score, items, reasons }
}

/** UI label for an evidence level — single source of truth. */
export function evidenceLevelLabel(level: EvidenceLevel): string {
  switch (level) {
    case 'strong':
      return 'Strong evidence'
    case 'moderate':
      return 'Some evidence'
    case 'limited':
      return 'Limited evidence'
  }
}
