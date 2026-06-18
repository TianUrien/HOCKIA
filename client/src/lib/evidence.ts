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

/** One row of the recruiter evidence checklist — present OR missing, so a
 *  recruiter can see at a glance WHAT backs (or doesn't back) a candidate.
 *  Unlike EvidenceItem (positives only), this enumerates the full set. */
export interface EvidenceChecklistRow {
  key: string
  label: string
  present: boolean
}

/** Candidate fields the checklist reads — a superset of the scoring fields,
 *  adding the signals that don't affect the confidence score but still help
 *  a recruiter decide whether to open the profile. All already fetched by
 *  the Community grid (no DB change). */
export interface EvidenceChecklistFields extends EvidenceCandidateFields {
  current_club?: string | null
  career_entry_count?: number | null
  open_to_play?: boolean | null
  open_to_coach?: boolean | null
  /** Resolved 1..10 league band — present (non-null) ⇒ league on record. */
  competition_level_band?: number | null
}

/**
 * Full evidence checklist for a candidate — present and missing signals,
 * recruiter-facing. Video rows are dropped for coaches (no upload surface),
 * mirroring computeEvidence so we never mark a coach "missing" an artifact
 * they can't provide. Order = recruiter priority (watchable proof first).
 */
export function evidenceChecklist(
  candidate: EvidenceChecklistFields | null | undefined,
): EvidenceChecklistRow[] {
  if (!candidate || (candidate.role !== 'player' && candidate.role !== 'coach')) return []
  const isCoach = candidate.role === 'coach'
  const refs = candidate.accepted_reference_count ?? 0
  const rows: EvidenceChecklistRow[] = []

  if (!isCoach) {
    rows.push({ key: 'full_match', label: 'Full match footage', present: (candidate.full_game_video_count ?? 0) > 0 })
    rows.push({ key: 'highlight', label: 'Highlight video', present: Boolean(candidate.highlight_video_url) })
  }
  rows.push({
    key: 'references',
    label: refs > 0 ? `${refs} reference${refs === 1 ? '' : 's'}` : 'References',
    present: refs > 0,
  })
  rows.push({ key: 'club', label: 'Current club', present: Boolean(candidate.current_world_club_id || candidate.current_club?.trim()) })
  rows.push({ key: 'league', label: 'League on record', present: candidate.competition_level_band != null })
  // Labelled "Career History" — the recruiter-facing product language used
  // across HOCKIA (matches the data: career_history / career_entry_count).
  // The row KEY stays 'career'; only the display label is user-facing.
  rows.push({ key: 'career', label: 'Career History', present: (candidate.career_entry_count ?? 0) > 0 })
  rows.push({
    key: 'open',
    label: isCoach ? 'Open to coach' : 'Open to play',
    present: Boolean(isCoach ? candidate.open_to_coach : candidate.open_to_play),
  })
  return rows
}

/** UI label for an evidence level — single source of truth. */
export function evidenceLevelLabel(level: EvidenceLevel): string {
  switch (level) {
    case 'strong':
      return 'Strong evidence'
    case 'moderate':
      return 'Enough evidence'
    case 'limited':
      return 'Limited evidence'
  }
}

/** 4-bucket DISPLAY label for the card pill — adds the gentle "Minimal evidence"
 *  for a player/coach with no signals yet (isApplicable=false). Never hidden:
 *  measures how much there is to review, NOT skill. */
export function evidenceDisplayLabel(result: EvidenceResult): string {
  return result.isApplicable ? evidenceLevelLabel(result.level) : 'Minimal evidence'
}

/** Non-rating tooltip copy — the guardrail that keeps the pill read as
 *  information-completeness, not a public quality score. */
export const EVIDENCE_TOOLTIP =
  'Evidence Level reflects how much verifiable information this profile provides for evaluation — video, references, a provable level. It does not rate skill or talent.'
