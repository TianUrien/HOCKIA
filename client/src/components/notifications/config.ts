import type { LucideIcon } from 'lucide-react'
import {
  AlertCircle,
  Award,
  BadgeCheck,
  Bell,
  Briefcase,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  Handshake,
  Heart,
  Hourglass,
  Megaphone,
  PartyPopper,
  MessageCircle,
  MessageSquare,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react'
import type { NotificationKind, NotificationRecord } from '@/lib/api/notifications'
import { formatRelationshipType } from '@/lib/utils'
import { positionLabel } from '@/lib/identity'
import { tNotifications } from '@/i18n/ns/notifications'
import { currentLanguage } from '@/i18n'
import { recruitingTitle } from '@/lib/recruitingTitles'

/** The content_removed notice names a comment, a post or a video. */
const removedTitle = (type: string | null): string =>
  type === 'post' || type === 'feed_item'
    ? tNotifications('kinds.contentRemoved.titlePost')
    : type === 'video' ? tNotifications('kinds.contentRemoved.titleVideo') : tNotifications('kinds.contentRemoved.titleComment')

export type NotificationRenderConfig = {
  icon: LucideIcon
  badgeText: string
  /** Icon tile (rebrand page 19): violet for opportunities, gold for references, amber only when the recruiter must act, green for real positives, neutral otherwise. */
  accentClassName: string
  getTitle: (notification: NotificationRecord) => string
  getDescription?: (notification: NotificationRecord) => string | null
  getRoute?: (notification: NotificationRecord) => string | null
}

const getActorName = (notification: NotificationRecord) =>
  notification.actor?.fullName || notification.actor?.username || tNotifications('actorFallback')

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
/** The team words the generated headline starts with (lib/opportunityCopy genderPill). */
const TEAM_PREFIX = /^(?:men[’']s|women[’']s|boys|girls|mixed)\s+/i
/** A role posted without a typed title is stored under its generated headline
 *  ("Men's midfielder" — lib/postRole defaultTitle); the founder wants the bare
 *  position there. MIRRORED in send-push/push-payload.ts isGeneratedHeadline. */
export const isGeneratedHeadline = (title: string, humanPosition: string | null): boolean => {
  if (!humanPosition) return false
  return title.trim().replace(TEAM_PREFIX, '').trim().toLowerCase() === humanPosition.trim().toLowerCase()
}

/** Human, player-facing copy for an application status update. The raw enum
 *  status (shortlisted / maybe / rejected) was leaking into the UI as
 *  "Application maybe"; this maps it to clear product language naming the club
 *  and the opportunity. MIRRORED in supabase/functions/send-push/push-payload.ts
 *  (the push body) — keep both in sync. */
const applicationStatusCopy = (notification: NotificationRecord): { title: string; body: string } => {
  const status = getMetadataString(notification, 'status')
  const club = getMetadataString(notification, 'club_name') ?? tNotifications('applicationStatus.clubFallback')
  const vacancyTitle = getMetadataString(notification, 'vacancy_title')
  // Prefer the structured position enum; the title split is a last resort and only
  // when the title actually has a "Position — Club" separator (else: neutral phrase).
  const humanPos = humanizePosition(getMetadataString(notification, 'position'))
  // Shown in the active language ("Volante"); humanPos stays English for the headline match below.
  const shownPos = currentLanguage() === 'es' ? positionLabel(getMetadataString(notification, 'position')) : humanPos
  const position = shownPos ?? titleHeadPosition(vacancyTitle) ?? tNotifications('applicationStatus.positionFallback')
  // The role is named by its typed title (QA 2 Oct: "considered for Midfielder"
  // named no role); a generated headline yields the bare position (round 9).
  const typedTitle = vacancyTitle && !isGeneratedHeadline(vacancyTitle, humanPos) ? vacancyTitle.trim() : null
  const role = typedTitle || position
  switch (status) {
    case 'shortlisted':
      return { title: tNotifications('applicationStatus.shortlistedTitle', { club }), body: tNotifications('applicationStatus.shortlistedBody', { role }) }
    case 'maybe':
      return { title: tNotifications('applicationStatus.maybeTitle', { club }), body: tNotifications('applicationStatus.maybeBody', { position }) }
    case 'rejected':
      return { title: tNotifications('applicationStatus.rejectedTitle', { club }), body: tNotifications('applicationStatus.rejectedBody', { position }) }
    case 'filled': {
      // Founder copy 2026-09-26; names the role by its title (round 4), falling back to
      // the position, then "The role".
      const role = typedTitle ?? shownPos ?? tNotifications('applicationStatus.filledRoleFallback')
      return { title: tNotifications('applicationStatus.filledTitle', { club }), body: tNotifications('applicationStatus.filledBody', { role }) }
    }
    default:
      return { title: tNotifications('applicationStatus.updatedTitle', { club }), body: tNotifications('applicationStatus.updatedBody', { position }) }
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

/** B2 · publisher reminders (club-reminders): the applicant (one), the role's
 *  Applicants (one role), else Opportunities. MIRRORS
 *  supabase/functions/_shared/club-reminders.ts reminderRouteFromMetadata, which
 *  the push uses, so the row and the push open the same screen. */
export const clubReminderRoute = (notification: NotificationRecord): string => {
  const opportunityId = getMetadataString(notification, 'opportunity_id')
  const applicationId = getMetadataString(notification, 'application_id')
  if (opportunityId && applicationId) return `/dashboard/opportunities/${encodeURIComponent(opportunityId)}/applicants/${encodeURIComponent(applicationId)}`
  if (opportunityId) return `/dashboard/opportunities/${encodeURIComponent(opportunityId)}/applicants`
  return '/opportunities'
}

const defaultConfig: NotificationRenderConfig = {
  icon: Bell,
  get badgeText() { return tNotifications('kinds.default.badge') },
  accentClassName: 'bg-gray-100 text-gray-600',
  getTitle: () => tNotifications('kinds.default.title'),
  getDescription: (notification) => getMetadataString(notification, 'summary'),
  getRoute: (notification) => {
    const targetUrl = typeof notification.targetUrl === 'string' ? notification.targetUrl : null
    return targetUrl ?? getMetadataString(notification, 'target_url')
  },
}

const notificationConfigs: Partial<Record<NotificationKind, NotificationRenderConfig>> = {
  friend_request_received: {
    icon: UserPlus,
    get badgeText() { return tNotifications('kinds.friendRequestReceived.badge') },
    accentClassName: 'bg-surface-grouped text-ink-2',
    getTitle: (notification) => tNotifications('kinds.friendRequestReceived.title', { name: getActorName(notification) }),
    getDescription: (notification) => notification.actor?.baseLocation ?? null,
    getRoute: () => friendRequestsRoute,
  },
  friend_request_accepted: {
    icon: UserCheck,
    get badgeText() { return tNotifications('kinds.friendRequestAccepted.badge') },
    accentClassName: 'bg-surface-grouped text-ink-2',
    getTitle: (notification) => tNotifications('kinds.friendRequestAccepted.title', { name: getActorName(notification) }),
    getDescription: () => tNotifications('kinds.friendRequestAccepted.description'),
    getRoute: () => friendsRoute,
  },
  profile_comment_created: {
    icon: MessageCircle,
    get badgeText() { return tNotifications('kinds.profileCommentCreated.badge') },
    accentClassName: 'bg-surface-grouped text-ink-2',
    getTitle: (notification) => tNotifications('kinds.profileCommentCreated.title', { name: getActorName(notification) }),
    getDescription: (notification) => getMetadataString(notification, 'snippet'),
    getRoute: () => commentRoute,
  },
  user_post_comment_received: {
    icon: MessageCircle,
    get badgeText() { return tNotifications('kinds.userPostCommentReceived.badge') },
    accentClassName: 'bg-surface-grouped text-ink-2',
    getTitle: (notification) => tNotifications('kinds.userPostCommentReceived.title', { name: getActorName(notification) }),
    getDescription: (notification) => getMetadataString(notification, 'snippet'),
    getRoute: () => '/home',
  },
  feed_item_comment_received: {
    icon: MessageCircle,
    get badgeText() { return tNotifications('kinds.feedItemCommentReceived.badge') },
    accentClassName: 'bg-surface-grouped text-ink-2',
    getTitle: (notification) => tNotifications('kinds.feedItemCommentReceived.title', { name: getActorName(notification) }),
    getDescription: (notification) => getMetadataString(notification, 'snippet'),
    getRoute: () => '/home',
  },
  congrats_received: {
    icon: PartyPopper,
    get badgeText() { return tNotifications('kinds.congratsReceived.badge') },
    accentClassName: 'bg-gold-soft text-gold',
    getTitle: (notification) => {
      const count = Number((notification.metadata as Record<string, unknown> | null)?.count ?? 1)
      const others = count - 1
      return others > 0
        ? tNotifications('kinds.congratsReceived.titleWithOthers', { name: getActorName(notification), count: others })
        : tNotifications('kinds.congratsReceived.title', { name: getActorName(notification) })
    },
    getDescription: () => null,
    getRoute: () => '/home',
  },
  signing_tagged: {
    icon: PartyPopper,
    get badgeText() { return tNotifications('kinds.signingTagged.badge') },
    accentClassName: 'bg-hockia-soft text-hockia-primary',
    getTitle: (notification) => tNotifications('kinds.signingTagged.title', { name: getMetadataString(notification, 'club_name') ?? getActorName(notification) }),
    getDescription: () => tNotifications('kinds.signingTagged.description'),
    getRoute: () => '/home',
  },
  content_removed: {
    icon: ShieldAlert,
    get badgeText() { return tNotifications('kinds.contentRemoved.badge') },
    accentClassName: 'bg-surface-grouped text-ink-2',
    // Neutral notice (Figma A1): never the reporter, never the admin.
    getTitle: (notification) => removedTitle(getMetadataString(notification, 'content_type')),
    getDescription: () => null,
    getRoute: () => '/home',
  },
  profile_comment_reply: {
    icon: MessageCircle,
    get badgeText() { return tNotifications('kinds.profileCommentReply.badge') },
    accentClassName: 'bg-surface-grouped text-ink-2',
    getTitle: (notification) => tNotifications('kinds.profileCommentReply.title', { name: getActorName(notification) }),
    getDescription: (notification) => getMetadataString(notification, 'snippet'),
    getRoute: () => commentRoute,
  },
  profile_comment_like: {
    icon: Heart,
    get badgeText() { return tNotifications('kinds.profileCommentLike.badge') },
    accentClassName: 'bg-surface-grouped text-ink-2',
    getTitle: (notification) => tNotifications('kinds.profileCommentLike.title', { name: getActorName(notification) }),
    getDescription: () => tNotifications('kinds.profileCommentLike.description'),
    getRoute: () => commentRoute,
  },
  reference_request_received: {
    icon: Handshake,
    get badgeText() { return tNotifications('kinds.referenceRequestReceived.badge') },
    accentClassName: 'bg-gold-soft text-gold',
    getTitle: (notification) => tNotifications('kinds.referenceRequestReceived.title', { name: getActorName(notification) }),
    getDescription: (notification) => formatRelationshipType(getMetadataString(notification, 'relationship_type')) || null,
    // Reference requests are accepted/declined inside TrustedReferencesSection
    // which now lives on the dedicated /references tab (split from /friends
    // 2026-05-08). Was routing to friendRequestsRoute previously, which was
    // for friend-list incoming requests — same noun, different feature.
    getRoute: () => referencesRoute,
  },
  reference_request_accepted: {
    icon: ShieldCheck,
    get badgeText() { return tNotifications('kinds.referenceRequestAccepted.badge') },
    accentClassName: 'bg-gold-soft text-gold',
    getTitle: (notification) => tNotifications('kinds.referenceRequestAccepted.title', { name: getActorName(notification) }),
    getDescription: (notification) => getMetadataString(notification, 'endorsement_text'),
    getRoute: () => referenceAcceptedRoute,
  },
  reference_request_rejected: {
    icon: UserX,
    get badgeText() { return tNotifications('kinds.referenceRequestRejected.badge') },
    accentClassName: 'bg-surface-grouped text-ink-2',
    getTitle: (notification) => tNotifications('kinds.referenceRequestRejected.title', { name: getActorName(notification) }),
    getDescription: (notification) => formatRelationshipType(getMetadataString(notification, 'relationship_type')) || null,
    getRoute: () => referencesRoute,
  },
  reference_updated: {
    icon: RefreshCcw,
    get badgeText() { return tNotifications('kinds.referenceUpdated.badge') },
    accentClassName: 'bg-gold-soft text-gold',
    getTitle: (notification) => tNotifications('kinds.referenceUpdated.title', { name: getActorName(notification) }),
    getDescription: (notification) => getMetadataString(notification, 'endorsement_text'),
    getRoute: () => referencesRoute,
  },
  message_received: {
    icon: MessageSquare,
    get badgeText() { return tNotifications('kinds.messageReceived.badge') },
    accentClassName: 'bg-surface-grouped text-ink-2',
    getTitle: (notification) => {
      const messageCount = notification.metadata?.message_count
      const count = typeof messageCount === 'number' ? messageCount : 1
      if (count > 1) {
        return tNotifications('kinds.messageReceived.titleMany', { name: getActorName(notification), count })
      }
      return tNotifications('kinds.messageReceived.title', { name: getActorName(notification) })
    },
    getDescription: (notification) => getMetadataString(notification, 'snippet'),
    getRoute: conversationRoute,
  },
  conversation_started: {
    icon: MessageSquare,
    get badgeText() { return tNotifications('kinds.conversationStarted.badge') },
    accentClassName: 'bg-surface-grouped text-ink-2',
    getTitle: (notification) => tNotifications('kinds.conversationStarted.title', { name: getActorName(notification) }),
    getDescription: (notification) => getMetadataString(notification, 'subject'),
    getRoute: conversationRoute,
  },
  opportunity_published: {
    icon: Briefcase,
    get badgeText() { return tNotifications('kinds.opportunityPublished.badge') },
    accentClassName: 'bg-hockia-soft text-hockia-primary',
    getTitle: (notification) => {
      const title = getMetadataString(notification, 'opportunity_title')
      const clubName = getMetadataString(notification, 'club_name')
      return title
        ? tNotifications('kinds.opportunityPublished.title', { club: clubName || tNotifications('kinds.opportunityPublished.clubFallback'), title })
        : tNotifications('kinds.opportunityPublished.titleNoRole')
    },
    getDescription: (notification) => {
      const position = getMetadataString(notification, 'position')
      const city = getMetadataString(notification, 'location_city')
      const country = getMetadataString(notification, 'location_country')
      const location = [city, country].filter(Boolean).join(', ')
      // positionLabel covers player positions and coach roles ('head_coach'
      // → 'Head coach'), so the raw enum never reaches the row.
      const parts = [positionLabel(position), location || null].filter(Boolean)
      return parts.length > 0 ? parts.join(' \u2022 ') : null
    },
    getRoute: opportunityDetailRoute,
  },
  vacancy_application_received: {
    icon: Briefcase,
    get badgeText() { return tNotifications('kinds.vacancyApplicationReceived.badge') },
    accentClassName: 'bg-hockia-soft text-hockia-primary',
    // Producer emits 'opportunity_title' (NOT 'vacancy_title' — that key
    // belongs to vacancy_application_status), and no applicant_name: the
    // ACTOR of this notification is the applicant. Reading the wrong keys
    // rendered every club-side applicant notification as a generic
    // "New opportunity applicant" with an empty description.
    getTitle: (notification) => {
      const vacancyTitle = getMetadataString(notification, 'opportunity_title')
      return vacancyTitle ? tNotifications('kinds.vacancyApplicationReceived.title', { title: vacancyTitle }) : tNotifications('kinds.vacancyApplicationReceived.titleNoRole')
    },
    getDescription: (notification) =>
      notification.actor?.fullName || notification.actor?.username || null,
    getRoute: opportunityApplicantsRoute,
  },
  vacancy_application_status: {
    icon: ClipboardCheck,
    get badgeText() { return tNotifications('kinds.vacancyApplicationStatus.badge') },
    accentClassName: 'bg-hockia-soft text-hockia-primary',
    getTitle: (notification) => applicationStatusCopy(notification).title,
    getDescription: (notification) => applicationStatusCopy(notification).body,
    // Recipient is the applicant, not the club, so route to the public
    // opportunity detail page (the applicant's view) — not the club's
    // applicants list. The previous opportunityApplicantsRoute would
    // 404 / 403 the applicant since they don't own the opportunity.
    getRoute: opportunityDetailRoute,
  },
  applications_expired: {
    icon: Hourglass,
    get badgeText() { return tNotifications('kinds.applicationsExpired.badge') },
    accentClassName: 'bg-surface-grouped text-ink-2',
    // Per-player AGGREGATE from the auto-expiry sweep (Task 3b): one
    // notification covering every application that closed that day. Copy is
    // NEUTRAL about the club (teams often answer off-platform — never blame
    // either side); route to open opportunities to redirect the energy forward.
    getTitle: (notification) => {
      const count = Number(notification.metadata?.count ?? 1)
      return tNotifications('kinds.applicationsExpired.title', { count })
    },
    getDescription: () =>
      tNotifications('kinds.applicationsExpired.description'),
    getRoute: () => '/opportunities',
  },
  // B2 · publisher reminders. The server writes the copy (first names only,
  // founder wording of 9 Oct 2026) into title / summary; the fallbacks keep a
  // row readable without metadata. Amber: the publisher is the one to act.
  applicant_last_call: {
    icon: Hourglass,
    get badgeText() { return tNotifications('kinds.applicantLastCall.badge') },
    accentClassName: 'bg-status-warning-soft text-status-warning',
    getTitle: (notification) => getMetadataString(notification, 'title') || tNotifications('kinds.applicantLastCall.title'),
    getDescription: (notification) => getMetadataString(notification, 'summary') || tNotifications('kinds.applicantLastCall.description'),
    getRoute: clubReminderRoute,
  },
  applicants_closing_soon: {
    icon: Hourglass,
    get badgeText() { return tNotifications('kinds.applicantsClosingSoon.badge') },
    accentClassName: 'bg-status-warning-soft text-status-warning',
    getTitle: (notification) => getMetadataString(notification, 'title') || tNotifications('kinds.applicantsClosingSoon.title'),
    getDescription: (notification) => getMetadataString(notification, 'summary') || tNotifications('kinds.applicantsClosingSoon.description'),
    getRoute: clubReminderRoute,
  },
  profile_completed: {
    icon: CheckCircle2,
    get badgeText() { return tNotifications('kinds.profileCompleted.badge') },
    accentClassName: 'bg-status-positive-soft text-status-positive',
    getTitle: () => tNotifications('kinds.profileCompleted.title'),
    // Role-agnostic copy. The notification fires for every role (player,
    // coach, club, brand, umpire); "so scouts can find you" implied a
    // recruitment relationship that doesn't apply to brand or umpire.
    getDescription: () => tNotifications('kinds.profileCompleted.description'),
    getRoute: () => '/dashboard/profile',
  },
  account_verified: {
    icon: BadgeCheck,
    get badgeText() { return tNotifications('kinds.accountVerified.badge') },
    accentClassName: 'bg-status-positive-soft text-status-positive',
    getTitle: () => tNotifications('kinds.accountVerified.title'),
    getDescription: () => tNotifications('kinds.accountVerified.description'),
    getRoute: () => '/settings',
  },
  ambassador_request_received: {
    icon: Award,
    get badgeText() { return tNotifications('kinds.ambassadorRequestReceived.badge') },
    accentClassName: 'bg-surface-grouped text-ink-2',
    getTitle: (notification) => {
      const brandName = getMetadataString(notification, 'brand_name')
      return tNotifications('kinds.ambassadorRequestReceived.title', { name: brandName || getActorName(notification) })
    },
    getDescription: () => tNotifications('kinds.ambassadorRequestReceived.description'),
    getRoute: () => '/dashboard/profile',
  },
  ambassador_request_accepted: {
    icon: Award,
    get badgeText() { return tNotifications('kinds.ambassadorRequestAccepted.badge') },
    accentClassName: 'bg-surface-grouped text-ink-2',
    getTitle: (notification) => tNotifications('kinds.ambassadorRequestAccepted.title', { name: getActorName(notification) }),
    getDescription: () => tNotifications('kinds.ambassadorRequestAccepted.description'),
    getRoute: () => '/dashboard/profile?tab=ambassadors',
  },
  // Brand offers (Phase 1): the admin's review of an offer or a change to one.
  // MIRRORED in supabase/functions/send-push/push-payload.ts.
  brand_offer_approved: {
    icon: CheckCircle2,
    get badgeText() { return tNotifications('kinds.brandOfferApproved.badge') },
    accentClassName: 'bg-status-positive-soft text-status-positive',
    getTitle: (notification) => (notification.metadata?.change === true ? tNotifications('kinds.brandOfferApproved.titleChange') : tNotifications('kinds.brandOfferApproved.title')),
    getDescription: (notification) => {
      const title = getMetadataString(notification, 'offer_title')
      return title ? tNotifications('kinds.brandOfferApproved.description', { title }) : tNotifications('kinds.brandOfferApproved.descriptionNoTitle')
    },
    getRoute: () => '/dashboard/offers',
  },
  brand_offer_not_approved: {
    icon: AlertCircle,
    get badgeText() { return tNotifications('kinds.brandOfferNotApproved.badge') },
    accentClassName: 'bg-status-warning-soft text-status-warning',
    // Since 2026-10-25 offers publish at once; this notice is an admin take-down
    // (metadata.takedown). Older rows were review rejections.
    getTitle: (notification) => (notification.metadata?.takedown === true ? tNotifications('kinds.brandOfferNotApproved.titleTakedown') : tNotifications('kinds.brandOfferNotApproved.title')),
    getDescription: (notification) => {
      const title = getMetadataString(notification, 'offer_title')
      const reason = (getMetadataString(notification, 'reason') ?? '').trim().replace(/[.!]+$/, '')
      const takedown = notification.metadata?.takedown === true
      const head = takedown
        ? (title ? tNotifications('kinds.brandOfferNotApproved.takedownHead', { title }) : tNotifications('kinds.brandOfferNotApproved.takedownHeadNoTitle'))
        : (title ? tNotifications('kinds.brandOfferNotApproved.rejectedHead', { title }) : tNotifications('kinds.brandOfferNotApproved.rejectedHeadNoTitle'))
      return reason ? tNotifications('kinds.brandOfferNotApproved.withReason', { head, reason }) : head
    },
    getRoute: () => '/dashboard/offers',
  },
  club_invitation_received: {
    icon: Users,
    get badgeText() { return tNotifications('kinds.clubInvitationReceived.badge') },
    accentClassName: 'bg-hockia-soft text-hockia-primary',
    getTitle: (notification) => tNotifications('kinds.clubInvitationReceived.title', { name: getActorName(notification) }),
    getDescription: (notification) => notification.actor?.baseLocation ?? null,
    // Route to the inviting club's profile so the invitee can see who it is.
    getRoute: (notification) => (notification.actor?.id ? `/clubs/id/${notification.actor.id}` : null),
  },
  club_invitation_accepted: {
    icon: UserCheck,
    get badgeText() { return tNotifications('kinds.clubInvitationAccepted.badge') },
    accentClassName: 'bg-hockia-soft text-hockia-primary',
    getTitle: (notification) => tNotifications('kinds.clubInvitationAccepted.title', { name: getActorName(notification) }),
    getDescription: () => tNotifications('kinds.clubInvitationAccepted.description'),
    getRoute: () => '/dashboard/profile',
  },
  profile_viewed: {
    icon: Eye,
    get badgeText() { return tNotifications('kinds.profileViewed.badge') },
    accentClassName: 'bg-hockia-soft text-hockia-primary',
    getTitle: (notification) => {
      const uniqueViewers = notification.metadata?.unique_viewers
      const count = typeof uniqueViewers === 'number' ? uniqueViewers : 1
      return count === 1
        ? tNotifications('kinds.profileViewed.title', { name: getActorName(notification) })
        : tNotifications('kinds.profileViewed.titleMany', { count })
    },
    getDescription: (notification) => {
      const totalViews = notification.metadata?.total_views
      return typeof totalViews === 'number' && totalViews > 1
        ? tNotifications('kinds.profileViewed.totalViews', { count: totalViews })
        : null
    },
    getRoute: () => '/dashboard/profile?tab=profile&section=viewers',
  },
  // Invite / offer / signing steps (Track C). The server writes the readable
  // title + summary into metadata, so the copy lives in one place (SQL) and
  // clients that predate this kind still show the summary via defaultConfig.
  recruiting_update: {
    icon: Handshake,
    get badgeText() { return tNotifications('kinds.recruitingUpdate.badge') },
    accentClassName: 'bg-surface-grouped text-ink-2',
    getTitle: (notification) => {
      const stored = getMetadataString(notification, 'title')
      return (stored && recruitingTitle(getMetadataString(notification, 'event'), stored)) || tNotifications('kinds.recruitingUpdate.title')
    },
    getDescription: (notification) => getMetadataString(notification, 'summary'),
    getRoute: defaultConfig.getRoute,
  },
  system_announcement: {
    icon: Megaphone,
    get badgeText() { return tNotifications('kinds.systemAnnouncement.badge') },
    accentClassName: 'bg-surface-grouped text-ink-2',
    getTitle: (notification) => getMetadataString(notification, 'title') || tNotifications('kinds.systemAnnouncement.title'),
    getDescription: (notification) => getMetadataString(notification, 'summary'),
    // The safety notice about a removed account is read in place when its
    // conversation is no longer listed (it would open an empty inbox).
    getRoute: (notification) => {
      const route = defaultConfig.getRoute?.(notification) ?? null
      return getMetadataString(notification, 'notice') === 'removed_account' && route === '/messages' ? null : route
    },
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
