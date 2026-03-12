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
  UserX,
} from 'lucide-react'
import type { NotificationKind, NotificationRecord } from '@/lib/api/notifications'

export type NotificationRenderConfig = {
  icon: LucideIcon
  badgeText: string
  accentClassName: string
  getTitle: (notification: NotificationRecord) => string
  getDescription?: (notification: NotificationRecord) => string | null
  getRoute?: (notification: NotificationRecord) => string | null
}

const getActorName = (notification: NotificationRecord) =>
  notification.actor?.fullName || notification.actor?.username || 'A PLAYR member'

const getMetadataString = (notification: NotificationRecord, key: string): string | null => {
  const value = notification.metadata?.[key]
  return typeof value === 'string' ? value : null
}

const commentRoute = '/dashboard/profile?tab=comments'
const friendsRoute = '/dashboard/profile?tab=friends'
const friendRequestsRoute = `${friendsRoute}&section=requests`
const referenceAcceptedRoute = `${friendsRoute}&section=accepted`
const referencesRoute = `${friendsRoute}&section=references`

const conversationRoute = (notification: NotificationRecord) => {
  const conversationId = getMetadataString(notification, 'conversation_id')
  return conversationId ? `/messages/${conversationId}` : '/messages'
}

const opportunityApplicantsRoute = (notification: NotificationRecord) => {
  const opportunityId = getMetadataString(notification, 'opportunity_id')
  return opportunityId ? `/dashboard/opportunities/${opportunityId}/applicants` : '/dashboard?tab=vacancies'
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
    getDescription: (notification) => getMetadataString(notification, 'relationship_type'),
    getRoute: () => friendRequestsRoute,
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
    getDescription: (notification) => getMetadataString(notification, 'relationship_type'),
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
    getTitle: (notification) => {
      const status = getMetadataString(notification, 'status')
      return status ? `Application ${status}` : 'Application updated'
    },
    getDescription: (notification) => getMetadataString(notification, 'vacancy_title'),
    getRoute: opportunityApplicantsRoute,
  },
  profile_completed: {
    icon: CheckCircle2,
    badgeText: 'Profile milestone',
    accentClassName: 'bg-emerald-50 text-emerald-600',
    getTitle: () => 'Your profile is complete',
    getDescription: () => 'Great work! Keep it fresh so scouts can find you.',
    getRoute: () => '/dashboard/profile',
  },
  account_verified: {
    icon: BadgeCheck,
    badgeText: 'Account verified',
    accentClassName: 'bg-emerald-50 text-emerald-600',
    getTitle: () => 'Your account has been verified',
    getDescription: () => 'You now have full access to the PLAYR platform.',
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
    getRoute: () => '/dashboard?tab=ambassadors',
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
    getTitle: (notification) => getMetadataString(notification, 'title') || 'PLAYR update',
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
