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
