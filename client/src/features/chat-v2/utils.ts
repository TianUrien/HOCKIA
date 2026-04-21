import type { ConversationParticipant } from '@/types/chat'

export const buildPublicProfilePath = (participant?: ConversationParticipant | null) => {
  if (!participant) return null
  const slug = participant.username ? participant.username : `id/${participant.id}`
  if (participant.role === 'club') return `/clubs/${slug}`
  if (participant.role === 'umpire') return `/umpires/${slug}`
  return `/players/${slug}`
}
