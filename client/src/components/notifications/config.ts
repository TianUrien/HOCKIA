import type { LucideIcon } from 'lucide-react'
import {
  Award,
  BadgeCheck,
  Bell,
  Briefcase,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  Handshake,
  Heart,
  Megaphone,
  MessageCircle,
  MessageSquare,
  RefreshCcw,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react'
import type { NotificationKind, NotificationRecord } from '@/lib/api/notifications'
import { formatRelationshipType } from '@/lib/utils'

export type NotificationRenderConfig = {
  icon: LucideIcon
  badgeText: string
  accentClassName: string
  getTitle: (notification: NotificationRecord) => string
  getDescription?: (notification: NotificationRecord) => string | null
  getRoute?: (notification: NotificationRecord) => string | null
}

const getActorName = (notification: NotificationRecord) =>
  notification.actor?.fullName || notification.actor?.username || 'A HOCKIA member'

const getMetadataString = (notification: NotificationRecord, key: string): string | null => {
  const value = notification.metadata?.[key]
  return typeof value === 'string' ? value : null
}

/** 'head_coach' -> 'Head Coach'. */
const humanizePosition = (pos: string | null): string | null =>
  pos ? pos.split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ') : null
/** A free-text title only yields a position when it has a real "Position — Club"
 *  separator; most titles are free text where the whole string is NOT a position. */
const titleHeadPosition = (title: string | null): string | null => {
  if (!title) return null
  const parts = title.split(/\s+[—–-]\s+/)
  return parts.length >= 2 ? (parts[0]?.trim() || null) : null
}

/** Human, player-facing copy for an application status update. The raw enum
 *  status (shortlisted / maybe / rejected) was leaking into the UI as
 *  "Application maybe"; this maps it to clear product language naming the club
 *  and the opportunity. MIRRORED in supabase/functions/send-push/push-payload.ts
 *  (the push body) — keep both in sync. */
const applicationStatusCopy = (notification: NotificationRecord): { title: string; body: string } => {
  const status = getMetadataString(notification, 'status')
  const club = getMetadataString(notification, 'club_name') ?? 'The club'
  const vacancyTitle = getMetadataString(notification, 'vacancy_title')
  // Prefer the structured position enum; the title split is a last resort and only
  // when the title actually has a "Position — Club" separator (else: neutral phrase).
  const position =
    humanizePosition(getMetadataString(notification, 'position')) ??
    titleHeadPosition(vacancyTitle) ??
    'the opportunity'
  switch (status) {
    case 'shortlisted':
      return { title: `${club} shortlisted you`, body: `You're being considered for ${position}.` }
    case 'maybe':
      return { title: `${club} reviewed your application`, body: `Your application for ${position} is under consideration.` }
    case 'rejected':
      return { title: `${club} updated your application`, body: `You weren't selected for ${position} this time.` }
    default:
      return { title: `${club} updated your application`, body: `Your application for ${position} was updated.` }
  }
}

const commentRoute = '/dashboard/profile?tab=comments'
const friendsRoute = '/dashboard/profile?tab=friends'
// `section=incoming` deep-links to the Incoming Requests block on the
// Friends tab. Renamed from `section=requests` (2026-05-09) which
// collided with the trusted-references deep-link convention used inside
// FriendsTab — taps from a friend-request notification used to scroll
// to the references block (for clubs) or no-op (for player/coach/umpire
// with hideReferences) instead of landing on the actual incoming list.
const friendRequestsRoute = `${friendsRoute}&section=incoming`
// Reference notifications route to the dedicated /references tab
// (split out of /friends 2026-05-08). Sub-section preserved as `?section=`
// in case ReferencesTab grows internal anchors later.
const referencesRoute = '/dashboard/profile?tab=references'
const referenceAcceptedRoute = `${referencesRoute}&section=accepted`

const conversationRoute = (notification: NotificationRecord) => {
  const conversationId = getMetadataString(notification, 'conversation_id')
  return conversationId ? `/messages/${conversationId}` : '/messages'
}

const opportunityApplicantsRoute = (notification: NotificationRecord) => {
  const opportunityId = getMetadataString(notification, 'opportunity_id')
  return opportunityId ? `/dashboard/opportunities/${opportunityId}/applicants` : '/dashboard/profile?tab=opportunities'
}

const opportunityDetailRoute = (notification: NotificationRecord) => {
  const opportunityId = getMetadataString(notification, 'opportunity_id')
  return opportunityId ? `/opportunities/${opportunityId}` : '/opportunities'
}

const defaultConfig: NotificationRenderConfig = {
  icon: Bell,
  badgeText: 'Notification',
  accentClassName: 'bg-gray-100 text-gray-600',
  getTitle: () => 'You have a new update',
  getDescription: (notification) => getMetadataString(notification, 'summary'),
  getRoute: (notification) => {
    const targetUrl = typeof notification.targetUrl === 'string' ? notification.targetUrl : null
    return targetUrl ?? getMetadataString(notification, 'target_url')
  },
}

const notificationConfigs: Partial<Record<NotificationKind, NotificationRenderConfig>> = {
  friend_request_received: {
    icon: UserPlus,
    badgeText: 'Friend request',
    accentClassName: 'bg-indigo-50 text-indigo-600',
    getTitle: (notification) => `${getActorName(notification)} sent you a friend request`,
    getDescription: (notification) => notification.actor?.baseLocation ?? null,
    getRoute: () => friendRequestsRoute,
  },
  friend_request_accepted: {
    icon: UserCheck,
    badgeText: 'Friendship update',
    accentClassName: 'bg-indigo-50 text-indigo-600',
    getTitle: (notification) => `${getActorName(notification)} accepted your friend request`,
    getDescription: () => "You can now view each other's activity.",
    getRoute: () => friendsRoute,
  },
  profile_comment_created: {
    icon: MessageCircle,
    badgeText: 'Profile comment',
    accentClassName: 'bg-amber-50 text-amber-700',
    getTitle: (notification) => `${getActorName(notification)} commented on your profile`,
    getDescription: (notification) => getMetadataString(notification, 'snippet'),
    getRoute: () => commentRoute,
  },
  user_post_comment_received: {
    icon: MessageCircle,
    badgeText: 'Post comment',
    accentClassName: 'bg-amber-50 text-amber-700',
    getTitle: (notification) => `${getActorName(notification)} commented on your post`,
    getDescription: (notification) => getMetadataString(notification, 'snippet'),
    getRoute: () => '/home',
  },
  profile_comment_reply: {
    icon: MessageCircle,
    badgeText: 'Comment reply',
    accentClassName: 'bg-amber-50 text-amber-700',
    getTitle: (notification) => `${getActorName(notification)} replied to a profile comment`,
    getDescription: (notification) => getMetadataString(notification, 'snippet'),
    getRoute: () => commentRoute,
  },
  profile_comment_like: {
    icon: Heart,
    badgeText: 'Comment like',
    accentClassName: 'bg-rose-50 text-rose-600',
    getTitle: (notification) => `${getActorName(notification)} liked your profile comment`,
    getDescription: () => 'Keep the conversation going!',
    getRoute: () => commentRoute,
  },
  reference_request_received: {
    icon: Handshake,
    badgeText: 'Reference request',
    accentClassName: 'bg-emerald-50 text-emerald-700',
    getTitle: (notification) => `${getActorName(notification)} requested a reference`,
    getDescription: (notification) => formatRelationshipType(getMetadataString(notification, 'relationship_type')) || null,
    // Reference requests are accepted/declined inside TrustedReferencesSection
    // which now lives on the dedicated /references tab (split from /friends
    // 2026-05-08). Was routing to friendRequestsRoute previously, which was
    // for friend-list incoming requests — same noun, different feature.
    getRoute: () => referencesRoute,
  },
  reference_request_accepted: {
    icon: ShieldCheck,
    badgeText: 'Reference accepted',
    accentClassName: 'bg-indigo-50 text-indigo-600',
    getTitle: (notification) => `${getActorName(notification)} accepted your reference request`,
    getDescription: (notification) => getMetadataString(notification, 'endorsement_text'),
    getRoute: () => referenceAcceptedRoute,
  },
  reference_request_rejected: {
    icon: UserX,
    badgeText: 'Reference update',
    accentClassName: 'bg-rose-50 text-rose-600',
    getTitle: (notification) => `${getActorName(notification)} declined your reference request`,
    getDescription: (notification) => formatRelationshipType(getMetadataString(notification, 'relationship_type')) || null,
    getRoute: () => referencesRoute,
  },
  reference_updated: {
    icon: RefreshCcw,
    badgeText: 'Reference updated',
    accentClassName: 'bg-indigo-50 text-indigo-600',
    getTitle: (notification) => `${getActorName(notification)} updated their reference`,
    getDescription: (notification) => getMetadataString(notification, 'endorsement_text'),
    getRoute: () => referencesRoute,
  },
  message_received: {
    icon: MessageSquare,
    badgeText: 'Message',
    accentClassName: 'bg-sky-50 text-sky-600',
    getTitle: (notification) => {
      const messageCount = notification.metadata?.message_count
      const count = typeof messageCount === 'number' ? messageCount : 1
      if (count > 1) {
        return `${getActorName(notification)} sent ${count} new messages`
      }
      return `${getActorName(notification)} sent you a message`
    },
    getDescription: (notification) => getMetadataString(notification, 'snippet'),
    getRoute: conversationRoute,
  },
  conversation_started: {
    icon: MessageSquare,
    badgeText: 'Conversation',
    accentClassName: 'bg-sky-50 text-sky-600',
    getTitle: (notification) => `${getActorName(notification)} started a conversation`,
    getDescription: (notification) => getMetadataString(notification, 'subject'),
    getRoute: conversationRoute,
  },
  opportunity_published: {
    icon: Briefcase,
    badgeText: 'New opportunity',
    accentClassName: 'bg-orange-50 text-orange-600',
    getTitle: (notification) => {
      const title = getMetadataString(notification, 'opportunity_title')
      const clubName = getMetadataString(notification, 'club_name')
      return title
        ? `${clubName || 'A club'} published: ${title}`
        : 'A new opportunity was published'
    },
    getDescription: (notification) => {
      const position = getMetadataString(notification, 'position')
      const city = getMetadataString(notification, 'location_city')
      const country = getMetadataString(notification, 'location_country')
      const location = [city, country].filter(Boolean).join(', ')
      const parts = [position ? position.charAt(0).toUpperCase() + position.slice(1) : null, location || null].filter(Boolean)
      return parts.length > 0 ? parts.join(' \u2022 ') : null
    },
    getRoute: opportunityDetailRoute,
  },
  vacancy_application_received: {
    icon: Briefcase,
    badgeText: 'New applicant',
    accentClassName: 'bg-purple-50 text-purple-600',
    getTitle: (notification) => {
      const vacancyTitle = getMetadataString(notification, 'vacancy_title')
      return vacancyTitle ? `New applicant for ${vacancyTitle}` : 'New opportunity applicant'
    },
    getDescription: (notification) => getMetadataString(notification, 'applicant_name'),
    getRoute: opportunityApplicantsRoute,
  },
  vacancy_application_status: {
    icon: ClipboardCheck,
    badgeText: 'Application update',
    accentClassName: 'bg-purple-50 text-purple-600',
    getTitle: (notification) => applicationStatusCopy(notification).title,
    getDescription: (notification) => applicationStatusCopy(notification).body,
    // Recipient is the applicant, not the club, so route to the public
    // opportunity detail page (the applicant's view) — not the club's
    // applicants list. The previous opportunityApplicantsRoute would
    // 404 / 403 the applicant since they don't own the opportunity.
    getRoute: opportunityDetailRoute,
  },
  profile_completed: {
    icon: CheckCircle2,
    badgeText: 'Profile milestone',
    accentClassName: 'bg-emerald-50 text-emerald-600',
    getTitle: () => 'Your profile is complete',
    // Role-agnostic copy. The notification fires for every role (player,
    // coach, club, brand, umpire); "so scouts can find you" implied a
    // recruitment relationship that doesn't apply to brand or umpire.
    getDescription: () => 'Great work — keep it fresh so the right people find you.',
    getRoute: () => '/dashboard/profile',
  },
  account_verified: {
    icon: BadgeCheck,
    badgeText: 'Account verified',
    accentClassName: 'bg-emerald-50 text-emerald-600',
    getTitle: () => 'Your account has been verified',
    getDescription: () => 'You now have full access to the HOCKIA platform.',
    getRoute: () => '/settings',
  },
  ambassador_request_received: {
    icon: Award,
    badgeText: 'Ambassador invite',
    accentClassName: 'bg-rose-50 text-rose-600',
    getTitle: (notification) => {
      const brandName = getMetadataString(notification, 'brand_name')
      return brandName
        ? `${brandName} invited you to become a brand ambassador`
        : `${getActorName(notification)} invited you to become a brand ambassador`
    },
    getDescription: () => 'Review and respond to this invitation.',
    getRoute: () => '/dashboard/profile',
  },
  ambassador_request_accepted: {
    icon: Award,
    badgeText: 'Ambassador update',
    accentClassName: 'bg-rose-50 text-rose-600',
    getTitle: (notification) => `${getActorName(notification)} accepted your ambassador invitation`,
    getDescription: () => 'They now appear on your brand profile.',
    getRoute: () => '/dashboard/profile?tab=ambassadors',
  },
  club_invitation_received: {
    icon: Users,
    badgeText: 'Club invite',
    accentClassName: 'bg-violet-50 text-violet-600',
    getTitle: (notification) => `${getActorName(notification)} invited you to join their club`,
    getDescription: (notification) => notification.actor?.baseLocation ?? null,
    // Route to the inviting club's profile so the invitee can see who it is.
    getRoute: (notification) => (notification.actor?.id ? `/clubs/id/${notification.actor.id}` : null),
  },
  club_invitation_accepted: {
    icon: UserCheck,
    badgeText: 'Club update',
    accentClassName: 'bg-violet-50 text-violet-600',
    getTitle: (notification) => `${getActorName(notification)} joined your club`,
    getDescription: () => 'They now appear in your Members.',
    getRoute: () => '/dashboard/profile',
  },
  profile_viewed: {
    icon: Eye,
    badgeText: 'Profile views',
    accentClassName: 'bg-purple-50 text-purple-600',
    getTitle: (notification) => {
      const uniqueViewers = notification.metadata?.unique_viewers
      const count = typeof uniqueViewers === 'number' ? uniqueViewers : 1
      return count === 1
        ? `${getActorName(notification)} viewed your profile`
        : `${count} people viewed your profile today`
    },
    getDescription: (notification) => {
      const totalViews = notification.metadata?.total_views
      return typeof totalViews === 'number' && totalViews > 1
        ? `${totalViews} total views`
        : null
    },
    getRoute: () => '/dashboard/profile?tab=profile&section=viewers',
  },
  system_announcement: {
    icon: Megaphone,
    badgeText: 'Announcement',
    accentClassName: 'bg-gray-100 text-gray-700',
    getTitle: (notification) => getMetadataString(notification, 'title') || 'HOCKIA update',
    getDescription: (notification) => getMetadataString(notification, 'summary'),
    getRoute: defaultConfig.getRoute,
  },
}

export const getNotificationConfig = (notification: NotificationRecord): NotificationRenderConfig =>
  notificationConfigs[notification.kind] ?? defaultConfig

export const resolveNotificationRoute = (notification: NotificationRecord): string | null => {
  const config = getNotificationConfig(notification)
  const route = config.getRoute?.(notification)
  if (route) {
    return route
  }
  const targetUrl = typeof notification.targetUrl === 'string' ? notification.targetUrl : null
  return targetUrl ?? getMetadataString(notification, 'target_url')
}
