/**
 * Maps notification kind + metadata to a push notification payload.
 * Mirrors the client-side config at client/src/components/notifications/config.ts.
 */

export interface PushPayload {
  title: string
  body: string
  url: string
  tag?: string
  /** OS app-icon badge count (recipient's unread total). Falls back to 1. */
  badge?: number
}

// deno-lint-ignore no-explicit-any
type Metadata = Record<string, any>

function getString(metadata: Metadata, key: string): string | null {
  const value = metadata?.[key]
  return typeof value === 'string' ? value : null
}

/** The team words the client's generated headline starts with (lib/opportunityCopy genderPill). */
const TEAM_PREFIX = /^(?:men[’']s|women[’']s|boys|girls|mixed)\s+/i

/**
 * A role posted without a typed title is stored under the client's generated
 * headline — "<Team> <position>" ("Men's midfielder", "Women's head coach")
 * or the bare position (client lib/postRole defaultTitle). Recognised by
 * shape against the structured position so the push can name the position
 * instead (founder: the position, not the generated headline).
 */
export function isGeneratedHeadline(title: string, humanPosition: string | null): boolean {
  if (!humanPosition) return false
  const rest = title.trim().replace(TEAM_PREFIX, '').trim().toLowerCase()
  return rest === humanPosition.trim().toLowerCase()
}

/**
 * Per-type preference column for each notification kind, matching what the
 * settings screens promise (client components/settings/SettingsMobile.tsx and
 * pages/SettingsPage.tsx) and the columns the matching emails respect.
 * Kinds not listed are governed by notify_push (the master switch) alone.
 */
export type PushPreferenceColumn =
  | 'notify_messages'
  | 'notify_applications'
  | 'notify_opportunities'
  | 'notify_friends'
  | 'notify_references'
  | 'notify_profile_views'

const PREFERENCE_BY_KIND: Record<string, PushPreferenceColumn> = {
  message_received: 'notify_messages',
  conversation_started: 'notify_messages',
  vacancy_application_status: 'notify_applications',
  vacancy_application_received: 'notify_applications',
  applications_expired: 'notify_applications',
  opportunity_published: 'notify_opportunities',
  friend_request_received: 'notify_friends',
  friend_request_accepted: 'notify_friends',
  reference_request_received: 'notify_references',
  reference_request_accepted: 'notify_references',
  reference_request_rejected: 'notify_references',
  reference_updated: 'notify_references',
  profile_viewed: 'notify_profile_views',
}

export const PUSH_PREFERENCE_COLUMNS: PushPreferenceColumn[] = [
  'notify_messages', 'notify_applications', 'notify_opportunities',
  'notify_friends', 'notify_references', 'notify_profile_views',
]

export function pushPreferenceColumn(kind: string): PushPreferenceColumn | null {
  return PREFERENCE_BY_KIND[kind] ?? null
}

/**
 * Whether this kind may be pushed to a member with these settings.
 * notify_push is the master switch (off → nothing); a per-type column that is
 * explicitly false blocks its kinds. NULL/missing counts as on (the columns
 * default to true, and the settings screens read them with `?? true`).
 */
export function pushAllowed(kind: string, prefs: Partial<Record<'notify_push' | PushPreferenceColumn, boolean | null>>): boolean {
  if (!prefs.notify_push) return false
  const column = pushPreferenceColumn(kind)
  return column ? prefs[column] !== false : true
}

/** An in-app relative path ("/x"), never a protocol-relative "//host" or absolute URL. */
export function safeInternalPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null
  return value
}

/**
 * Whether a database-webhook event on profile_notifications should push.
 * INSERT → yes. UPDATE → only when created_at changed, which is what
 * enqueue_notification's upsert does when the same source fires again;
 * read/seen/cleared updates leave created_at alone. Anything else → no.
 * A bare record (no webhook envelope) is treated as an INSERT.
 */
// deno-lint-ignore no-explicit-any
export function shouldPushWebhookEvent(payload: any): boolean {
  if (!payload || typeof payload !== 'object') return false
  const type = payload.type
  if (type === undefined) return true
  if (type === 'INSERT') return true
  if (type === 'UPDATE') {
    const before = payload.old_record?.created_at
    const after = payload.record?.created_at
    return typeof before === 'string' && typeof after === 'string' && before !== after
  }
  return false
}

// Mirrors client components/notifications/config.ts referencesRoute.
const REFERENCES_ROUTE = '/dashboard/profile?tab=references'

export function buildPushPayload(
  kind: string,
  metadata: Metadata,
  actorName: string,
  actorId: string | null = null,
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
        url: REFERENCES_ROUTE,
        tag: 'reference-request',
      }
    case 'reference_request_accepted':
      return {
        title: 'Reference Accepted',
        body: `${actorName} accepted your reference request`,
        // Reference responses live on the dedicated References tab
        // (config.ts referenceAcceptedRoute).
        url: `${REFERENCES_ROUTE}&section=accepted`,
        tag: 'reference-accepted',
      }
    case 'reference_updated':
      return {
        title: 'Reference Updated',
        body: `${actorName} updated their reference`,
        url: REFERENCES_ROUTE,
        tag: 'reference-updated',
      }
    case 'reference_request_rejected':
      return {
        title: 'Reference Update',
        body: `${actorName} declined your reference request`,
        url: REFERENCES_ROUTE,
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

    // ── Club membership (mirrors config.ts) ──
    case 'club_invitation_received':
      return {
        title: 'Club Invite',
        body: `${actorName} invited you to join their club`,
        // The inviting club's profile, so the invitee can see who it is.
        url: actorId ? `/clubs/id/${encodeURIComponent(actorId)}` : '/home',
        tag: 'club-invite',
      }
    case 'club_invitation_accepted':
      return {
        title: 'Club Update',
        body: `${actorName} joined your club`,
        url: '/dashboard/profile',
        tag: 'club-joined',
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
      // Producer emits 'opportunity_title' (not 'vacancy_title'), and the
      // applicant's name arrives as the notification ACTOR — there is no
      // applicant_name metadata key. Reading the wrong keys made every
      // applicant push read "New applicant for your opportunity".
      const vacancyTitle = getString(metadata, 'opportunity_title')
      const oppId = getString(metadata, 'opportunity_id')
      return {
        title: 'New Applicant',
        body: `${actorName} applied for ${vacancyTitle || 'your opportunity'}`,
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
      // Shortlisted names the role by its title (QA 2 Oct: "considered for
      // Midfielder" named no role), falling back to the position. A role
      // posted without a typed title is stored under its generated headline
      // ("Men's midfielder" — client lib/postRole defaultTitle); the founder
      // wants the bare position there (QA round 7 re-check, item 18).
      const typedTitle = vacancyTitle && !isGeneratedHeadline(vacancyTitle, humanPos) ? vacancyTitle.trim() : null
      const role = typedTitle || position
      // Human, player-facing copy — MIRRORS client config.ts applicationStatusCopy.
      let title: string
      let body: string
      switch (status) {
        case 'shortlisted':
          title = `${club} shortlisted you`
          body = `You're being considered for ${role}.`
          break
        case 'maybe':
          title = `${club} replied to your application`
          body = `Open your application for ${position} to see the update.`
          break
        case 'rejected':
          title = `${club} updated your application`
          body = `You weren't selected for ${position} this time.`
          break
        case 'filled':
          // Founder copy 2026-09-26; names the role by its title; mirrors client config.ts.
          title = `${club} filled the role`
          body = `${typedTitle ?? humanPos ?? 'The role'} has been filled. Thanks for applying — new roles are open.`
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

    // ── Invite / offer / signing steps (server writes title + summary) ──
    case 'recruiting_update': {
      const targetUrl = getString(metadata, 'target_url')
      const event = getString(metadata, 'event')
      return {
        title: getString(metadata, 'title') || 'Recruiting update',
        body: getString(metadata, 'summary') || 'Open HOCKIA to see what changed.',
        url: safeInternalPath(targetUrl) ?? '/messages',
        tag: event ? `recruiting-${event}` : 'recruiting',
      }
    }

    // ── Application auto-expiry (per-player aggregate from the daily sweep) ──
    case 'applications_expired': {
      const count = typeof metadata?.count === 'number' ? metadata.count : 1
      return {
        title: 'Application update',
        // Neutral about the club (teams often answer off-platform).
        body: count === 1
          ? 'An application is no longer active on HOCKIA. Fresh opportunities are open.'
          : `${count} applications are no longer active on HOCKIA. Fresh opportunities are open.`,
        url: '/opportunities',
        // one per sweep day; replace any prior unread expiry push
        tag: 'applications-expired',
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
      // The safety notice about a removed account opens the notification list,
      // where the full text is; its conversation is no longer listed.
      if (getString(metadata, 'notice') === 'removed_account') {
        return {
          title: getString(metadata, 'title') || 'A message about your safety',
          body: getString(metadata, 'summary') || 'Open HOCKIA to read it.',
          url: '/notifications',
          tag: 'safety-notice',
        }
      }
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
