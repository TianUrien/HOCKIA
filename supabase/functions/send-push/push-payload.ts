/**
 * Maps notification kind + metadata to a push notification payload.
 * Mirrors the client-side config at client/src/components/notifications/config.ts.
 */

export interface PushPayload {
  title: string
  body: string
  url: string
  tag?: string
}

// deno-lint-ignore no-explicit-any
type Metadata = Record<string, any>

function getString(metadata: Metadata, key: string): string | null {
  const value = metadata?.[key]
  return typeof value === 'string' ? value : null
}

export function buildPushPayload(
  kind: string,
  metadata: Metadata,
  actorName: string
): PushPayload {
  switch (kind) {
    // ── Friends ──
    case 'friend_request_received':
      return {
        title: 'Friend Request',
        body: `${actorName} wants to connect`,
        // section=incoming scrolls to the incoming-requests block in
        // FriendsTab. section=requests was the old name (removed 2026-05-09)
        // and silently no-ops, leaving the user at the top of the Friends
        // tab with no idea where their request went.
        url: '/dashboard/profile?tab=friends&section=incoming',
        tag: 'friend-request',
      }
    case 'friend_request_accepted':
      return {
        title: 'Friend Accepted',
        body: `${actorName} accepted your friend request`,
        url: '/dashboard/profile?tab=friends',
        tag: 'friend-accepted',
      }

    // ── References ──
    case 'reference_request_received':
      return {
        title: 'Reference Request',
        body: `${actorName} requested a reference`,
        url: '/dashboard/profile?tab=friends&section=incoming',
        tag: 'reference-request',
      }
    case 'reference_request_accepted':
      return {
        title: 'Reference Accepted',
        body: `${actorName} accepted your reference request`,
        // Reference responses live on the dedicated References tab now,
        // not under Friends. section=accepted on Friends was dead.
        url: '/dashboard/profile/references',
        tag: 'reference-accepted',
      }
    case 'reference_updated':
      return {
        title: 'Reference Updated',
        body: `${actorName} updated their reference`,
        url: '/dashboard/profile?tab=friends&section=references',
        tag: 'reference-updated',
      }
    case 'reference_request_rejected':
      return {
        title: 'Reference Update',
        body: `${actorName} declined your reference request`,
        url: '/dashboard/profile?tab=friends&section=references',
        tag: 'reference-rejected',
      }

    // ── Ambassador (brand role) ──
    case 'ambassador_request_received': {
      const brandName = getString(metadata, 'brand_name')
      return {
        title: 'Ambassador Invite',
        body: brandName
          ? `${brandName} invited you to become a brand ambassador`
          : `${actorName} invited you to become a brand ambassador`,
        url: '/dashboard/profile',
        tag: 'ambassador-invite',
      }
    }
    case 'ambassador_request_accepted':
      return {
        title: 'Ambassador Accepted',
        body: `${actorName} accepted your ambassador invitation`,
        url: '/dashboard/profile?tab=ambassadors',
        tag: 'ambassador-accepted',
      }

    // ── Profile views (aggregated daily) ──
    case 'profile_viewed': {
      const uniqueViewers = typeof metadata?.unique_viewers === 'number' ? metadata.unique_viewers : 1
      return {
        title: 'Profile Views',
        body: uniqueViewers === 1
          ? `${actorName} viewed your profile`
          : `${uniqueViewers} people viewed your profile today`,
        url: '/dashboard/profile?tab=profile&section=viewers',
        // Single tag — daily aggregate, replace prior day's push if any.
        tag: 'profile-viewed',
      }
    }

    // ── Comments ──
    case 'profile_comment_created':
      return {
        title: 'New Comment',
        body: `${actorName} commented on your profile`,
        url: '/dashboard/profile?tab=comments',
        tag: 'comment',
      }
    case 'profile_comment_reply':
      return {
        title: 'Comment Reply',
        body: `${actorName} replied to a profile comment`,
        url: '/dashboard/profile?tab=comments',
        tag: 'comment-reply',
      }
    case 'profile_comment_like':
      return {
        title: 'Comment Liked',
        body: `${actorName} liked your comment`,
        url: '/dashboard/profile?tab=comments',
        tag: 'comment-like',
      }
    case 'user_post_comment_received': {
      const snippet = getString(metadata, 'snippet')
      const postId = getString(metadata, 'post_id')
      return {
        title: 'New Post Comment',
        body: snippet
          ? `${actorName}: ${snippet}`
          : `${actorName} commented on your post`,
        url: '/home',
        // Tag per post so multiple comments on the same post coalesce on
        // mobile rather than stacking N pushes for one post.
        tag: postId ? `post-comment-${postId}` : 'post-comment',
      }
    }

    // ── Messages ──
    case 'message_received': {
      const conversationId = getString(metadata, 'conversation_id')
      const snippet = getString(metadata, 'snippet')
      const count = typeof metadata?.message_count === 'number' ? metadata.message_count : 1
      return {
        title: 'New Message',
        body: count > 1
          ? `${actorName} sent ${count} new messages`
          : snippet
            ? `${actorName}: ${snippet}`
            : `${actorName} sent you a message`,
        url: conversationId ? `/messages/${conversationId}` : '/messages',
        tag: conversationId ? `msg-${conversationId}` : 'message',
      }
    }
    case 'conversation_started': {
      const conversationId = getString(metadata, 'conversation_id')
      return {
        title: 'New Conversation',
        body: `${actorName} started a conversation`,
        url: conversationId ? `/messages/${conversationId}` : '/messages',
        tag: conversationId ? `msg-${conversationId}` : 'conversation',
      }
    }

    // ── Opportunities ──
    case 'opportunity_published': {
      const title = getString(metadata, 'opportunity_title')
      const clubName = getString(metadata, 'club_name')
      return {
        title: 'New Opportunity',
        body: title
          ? `${clubName || 'A club'} published: ${title}`
          : 'A new opportunity was published',
        url: getString(metadata, 'opportunity_id')
          ? `/opportunities/${metadata.opportunity_id}`
          : '/opportunities',
        tag: 'opportunity',
      }
    }
    case 'vacancy_application_received': {
      const vacancyTitle = getString(metadata, 'vacancy_title')
      const applicantName = getString(metadata, 'applicant_name')
      const oppId = getString(metadata, 'opportunity_id')
      return {
        title: 'New Applicant',
        body: applicantName
          ? `${applicantName} applied for ${vacancyTitle || 'your opportunity'}`
          : `New applicant for ${vacancyTitle || 'your opportunity'}`,
        url: oppId
          ? `/dashboard/opportunities/${oppId}/applicants`
          : '/dashboard?tab=vacancies',
        tag: 'application',
      }
    }
    case 'vacancy_application_status': {
      const status = getString(metadata, 'status')
      const club = getString(metadata, 'club_name') ?? 'The club'
      const vacancyTitle = getString(metadata, 'vacancy_title')
      const opportunityId = getString(metadata, 'opportunity_id')
      // Prefer the structured position enum ('head_coach' -> 'Head Coach'); the
      // title split is a last resort and only when the title has a real
      // "Position — Club" separator (most titles are free text where the whole
      // string is NOT a position). Mirrors client config.ts applicationStatusCopy.
      const positionEnum = getString(metadata, 'position')
      const humanPos = positionEnum
        ? positionEnum.split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
        : null
      const titleParts = vacancyTitle ? vacancyTitle.split(/\s+[—–-]\s+/) : []
      const titleHead = titleParts.length >= 2 ? (titleParts[0]?.trim() || null) : null
      const position = humanPos ?? titleHead ?? 'the opportunity'
      // Human, player-facing copy — MIRRORS client config.ts applicationStatusCopy.
      let title: string
      let body: string
      switch (status) {
        case 'shortlisted':
          title = `${club} shortlisted you`
          body = `You're being considered for ${position}.`
          break
        case 'maybe':
          title = `${club} reviewed your application`
          body = `Your application for ${position} is under consideration.`
          break
        case 'rejected':
          title = `${club} updated your application`
          body = `You weren't selected for ${position} this time.`
          break
        default:
          title = `${club} updated your application`
          body = `Your application for ${position} was updated.`
      }
      return {
        title,
        body,
        // Deep-link to the specific opportunity (applicant's view), not
        // the listing page. Falls back to the listing if metadata is missing.
        url: opportunityId ? `/opportunities/${opportunityId}` : '/opportunities',
        tag: vacancyTitle ? `app-${vacancyTitle}` : 'application-status',
      }
    }

    // ── Milestones ──
    case 'profile_completed':
      return {
        title: 'Profile Complete',
        body: 'Great work! Keep it fresh so scouts can find you.',
        url: '/dashboard/profile',
        tag: 'profile-complete',
      }
    case 'account_verified':
      return {
        title: 'Account Verified',
        body: 'You now have full access to HOCKIA.',
        url: '/settings',
        tag: 'verified',
      }

    // ── System ──
    case 'system_announcement':
      return {
        title: getString(metadata, 'title') || 'HOCKIA Update',
        body: getString(metadata, 'summary') || 'You have a new update',
        url: '/home',
        tag: 'announcement',
      }

    // ── Fallback ──
    default:
      return {
        title: 'HOCKIA',
        body: 'You have a new notification',
        url: '/home',
      }
  }
}
