import type { ConversationParticipant } from '@/types/chat'

export const buildPublicProfilePath = (participant?: ConversationParticipant | null) => {
  if (!participant) return null
  const slug = participant.username ? participant.username : `id/${participant.id}`
  if (participant.role === 'club') return `/clubs/${slug}`
  if (participant.role === 'umpire') return `/umpires/${slug}`
  // Brands have their own /brands/<slug> route. Without this branch a brand
  // DM partner falls through to /players/<slug> which 404s — broken since
  // brand messaging was enabled server-side (migration 202603070200).
  if (participant.role === 'brand') return `/brands/${slug}`
  // Player + coach share /players/<slug> (multi-role union in PublicPlayerProfile).
  return `/players/${slug}`
}

/** "See the offer": the ring stays a fixed 2 s (QA 2 Oct saw 3 s vs 11 s — a thread update used to cancel the removal). */
export const ANCHOR_HIGHLIGHT_MS = 2000

/**
 * The offer card "See the offer" lands on: the newest card for the given
 * application, else (no application) the newest offer card in the thread.
 * A given application with no card in the thread → null (never another role's offer).
 */
export function findOfferAnchor<M extends { id: string; metadata?: unknown }>(messages: M[], applicationId: string | null | undefined): M | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    const meta = m.metadata && typeof m.metadata === 'object' ? (m.metadata as { type?: unknown; application_id?: unknown }) : null
    if (meta?.type !== 'opportunity_offer') continue
    if (!applicationId || meta.application_id === applicationId) return m
  }
  return null
}

/**
 * What the "See the offer" ring (and scroll) wraps: the offer card inside
 * the message row (MessageBubble marks it `data-offer-card`), never the row
 * itself — the row also holds the day/time separator above the first card
 * (QA round 7 re-check: the ring wrapped the separator). A row without the
 * mark (card still loading) rings as a whole.
 */
export function offerRingTarget(row: HTMLElement): HTMLElement {
  return row.querySelector<HTMLElement>('[data-offer-card]') ?? row
}
