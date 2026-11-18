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
import { tRecruiting } from '@/i18n/ns/recruiting'

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
        label: tRecruiting('evidence.items.matchVideo'),
        detail: fullMatch > 1 ? tRecruiting('evidence.items.fullMatchCount', { count: fullMatch }) : tRecruiting('evidence.items.fullMatch'),
      })
      reasons.push(fullMatch > 1 ? tRecruiting('evidence.reasons.fullMatchCount', { count: fullMatch }) : tRecruiting('evidence.reasons.fullMatch'))
    } else if (candidate.highlight_video_url) {
      score += W_HIGHLIGHT
      items.push({ key: 'video', label: tRecruiting('evidence.items.highlight'), detail: tRecruiting('evidence.items.highlightDetail') })
      reasons.push(tRecruiting('evidence.reasons.highlight'))
    }
  }

  // ── References (who vouches) ──
  const refs = candidate.accepted_reference_count ?? 0
  if (refs > 0) {
    score += (isCoach ? W_COACH_REFERENCES_MAX : W_REFERENCES_MAX) * (Math.min(refs, REF_CAP) / REF_CAP)
    items.push({
      key: 'references',
      label: tRecruiting('evidence.items.references', { count: refs }),
      detail: tRecruiting('evidence.items.referencesDetail', { count: refs }),
    })
    reasons.push(tRecruiting('evidence.reasons.references', { count: refs }))
  }

  // ── Verified badge ──
  if (candidate.is_verified) {
    score += isCoach ? W_COACH_VERIFIED : W_VERIFIED
    items.push({ key: 'verified', label: tRecruiting('evidence.items.verified'), detail: tRecruiting('evidence.items.verifiedDetail') })
    reasons.push(tRecruiting('evidence.reasons.verified'))
  }

  // ── Provable level (linked club → league) ──
  if (candidate.current_world_club_id) {
    score += isCoach ? W_COACH_LEVEL : W_LEVEL
    items.push({
      key: 'level',
      label: tRecruiting('evidence.items.provenLevel'),
      detail: isCoach ? tRecruiting('evidence.items.levelCoach') : tRecruiting('evidence.items.levelPlayer'),
    })
    reasons.push(isCoach ? tRecruiting('evidence.reasons.levelCoach') : tRecruiting('evidence.reasons.levelPlayer'))
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
    rows.push({ key: 'full_match', label: tRecruiting('evidence.checklist.fullMatch'), present: (candidate.full_game_video_count ?? 0) > 0 })
    rows.push({ key: 'highlight', label: tRecruiting('evidence.checklist.highlight'), present: Boolean(candidate.highlight_video_url) })
  }
  rows.push({
    key: 'references',
    label: refs > 0 ? tRecruiting('evidence.checklist.referencesCount', { count: refs }) : tRecruiting('evidence.checklist.references'),
    present: refs > 0,
  })
  rows.push({ key: 'club', label: tRecruiting('evidence.checklist.club'), present: Boolean(candidate.current_world_club_id || candidate.current_club?.trim()) })
  rows.push({ key: 'league', label: tRecruiting('evidence.checklist.league'), present: candidate.competition_level_band != null })
  // Labelled "Career history" — the recruiter-facing product language used
  // across HOCKIA (matches the data: career_history / career_entry_count).
  // The row KEY stays 'career'; only the display label is user-facing.
  rows.push({ key: 'career', label: tRecruiting('evidence.checklist.career'), present: (candidate.career_entry_count ?? 0) > 0 })
  rows.push({
    key: 'open',
    label: isCoach ? tRecruiting('evidence.checklist.openToCoach') : tRecruiting('evidence.checklist.openToPlay'),
    present: Boolean(isCoach ? candidate.open_to_coach : candidate.open_to_play),
  })
  return rows
}

/** UI label for an evidence level — single source of truth. */
export function evidenceLevelLabel(level: EvidenceLevel): string {
  switch (level) {
    case 'strong':
      return tRecruiting('evidence.level.strong')
    case 'moderate':
      return tRecruiting('evidence.level.moderate')
    case 'limited':
      return tRecruiting('evidence.level.limited')
  }
}

/** 4-bucket DISPLAY label for the card pill — adds the gentle "Minimal evidence"
 *  for a player/coach with no signals yet (isApplicable=false). Never hidden:
 *  measures how much there is to review, NOT skill. */
export function evidenceDisplayLabel(result: EvidenceResult): string {
  return result.isApplicable ? evidenceLevelLabel(result.level) : tRecruiting('evidence.level.minimal')
}

/** Non-rating tooltip copy — the guardrail that keeps the pill read as
 *  information-completeness, not a public quality score. */
export function evidenceTooltip(): string {
  return tRecruiting('evidence.tooltip')
}

/** What the profile is missing, as a plain list (audit A2: no completeness
 *  percentage or completeness tier word in recruiter views). */
export function missingLine(rows: { label: string; present: boolean }[]): string | null {
  const missing = rows.filter((r) => !r.present).map((r) => r.label)
  if (missing.length === 0) return null
  return tRecruiting('evidence.missing', { items: missing.map((m, i) => (i === 0 ? m : m.charAt(0).toLowerCase() + m.slice(1))).join(', ') })
}
