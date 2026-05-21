/**
 * HOCKIA feature knowledge base — the source of truth for Discovery AI's
 * "how do I use HOCKIA" answers (the `platform_help` intent).
 *
 * Each entry describes one feature: a short summary, the canonical in-app
 * route, and which roles can perform it. answerPlatformHelp() renders this
 * map into the LLM prompt; the LLM picks one `feature_key`, and the backend
 * maps that key → a role-checked CTA via resolveFeatureCta().
 *
 * Keep this boring and accurate — it is read verbatim by the model.
 */

export type HockiaRole = 'player' | 'coach' | 'club' | 'brand' | 'umpire'

export interface HockiaFeature {
  key: string
  /** Human label — also the default CTA button text. */
  label: string
  /** One or two sentences: what it is + where it lives. */
  summary: string
  /** Canonical in-app route the CTA navigates to. */
  route: string
  /** Roles that can perform/access this. Empty array = available to everyone. */
  roles: HockiaRole[]
}

export const HOCKIA_FEATURES: HockiaFeature[] = [
  {
    key: 'create_opportunity',
    label: 'Create opportunity',
    summary:
      'Clubs and recruiting coaches publish player or coaching openings from the Opportunities section of their dashboard, using the "Create opportunity" button.',
    route: '/dashboard/profile/opportunities',
    roles: ['club', 'coach'],
  },
  {
    key: 'manage_opportunities',
    label: 'My posted opportunities',
    summary:
      'Review, edit, close or reopen the opportunities you have published — and see how many applications each has — in the Opportunities section of your dashboard.',
    route: '/dashboard/profile/opportunities',
    roles: ['club', 'coach'],
  },
  {
    key: 'view_applicants',
    label: 'My posted opportunities',
    summary:
      'Every opportunity you posted lists its applicants. Open the opportunity from the Opportunities section of your dashboard to review candidates.',
    route: '/dashboard/profile/opportunities',
    roles: ['club', 'coach'],
  },
  {
    key: 'browse_opportunities',
    label: 'Browse opportunities',
    summary:
      'The Opportunities page lists every open role across HOCKIA, newest first, with filters for country, role, category and position.',
    route: '/opportunities',
    roles: [],
  },
  {
    key: 'apply_to_opportunity',
    label: 'Browse opportunities',
    summary:
      'Players and coaches apply from the Opportunities page — open a role and use "Apply Now". Clubs and brands publish roles rather than apply to them.',
    route: '/opportunities',
    roles: ['player', 'coach'],
  },
  {
    key: 'my_applications',
    label: 'My applications',
    summary:
      'See the opportunities you have applied to, and their status, on the Opportunities page filtered to your own applications.',
    route: '/opportunities?applied=mine',
    roles: ['player', 'coach'],
  },
  {
    key: 'create_post',
    label: 'Go to Home feed',
    summary:
      'Posts are short updates shared to the HOCKIA community feed. Create one with the post composer at the top of the Home feed; it appears on your profile and in the feed.',
    route: '/home',
    roles: [],
  },
  {
    key: 'comments',
    label: 'My Network',
    summary:
      'Comments are left on profiles. Read and manage the comments on your own profile from the My Network area of your dashboard.',
    route: '/dashboard/profile/comments',
    roles: [],
  },
  {
    key: 'friends',
    label: 'My Network',
    summary:
      'Connections link you to other HOCKIA members. Manage connection requests and your existing connections in the My Network area of your dashboard.',
    route: '/dashboard/profile/friends',
    roles: [],
  },
  {
    key: 'references',
    label: 'References',
    summary:
      'References are endorsements from people you have worked with — a trust signal for players and coaches. Request and manage them in the References area of your dashboard.',
    route: '/dashboard/profile/references',
    roles: ['player', 'coach'],
  },
  {
    key: 'my_network',
    label: 'My Network',
    summary:
      'My Network is your social hub — connections, comments and posts on your own profile (plus references for players and coaches) — inside your dashboard.',
    // Routes to the Connections section: it is a valid dashboard section
    // for every role (the unified "community" section does not exist on the
    // club dashboard, so it cannot be the shared destination).
    route: '/dashboard/profile/friends',
    roles: [],
  },
  {
    key: 'journey',
    label: 'My Journey',
    summary:
      'Journey is your career timeline — clubs, roles and milestones over time. Add and edit entries from the Journey section of your dashboard.',
    route: '/dashboard/profile/journey',
    roles: ['player', 'coach'],
  },
  {
    key: 'media',
    label: 'My Media',
    summary:
      'Media is your photo gallery and highlight video. Upload and manage them from the Media section of your dashboard.',
    route: '/dashboard/profile/media',
    roles: [],
  },
  {
    key: 'edit_profile',
    label: 'My dashboard',
    summary:
      'Edit your profile — name, bio, location and role-specific fields — from your dashboard using the Edit button.',
    route: '/dashboard/profile',
    roles: [],
  },
  {
    key: 'profile_completeness',
    label: 'My dashboard',
    summary:
      'Your dashboard shows a profile-completion score with a checklist of what to add next so you are more discoverable.',
    route: '/dashboard/profile',
    roles: [],
  },
  {
    key: 'discover',
    label: 'Discover',
    summary:
      'Discover is HOCKIA\'s AI search — ask in natural language to find players, coaches, clubs and brands.',
    route: '/discover',
    roles: [],
  },
  {
    key: 'community',
    label: 'Community',
    summary:
      'Community is the HOCKIA member directory and Q&A — browse members and ask or answer questions.',
    route: '/community',
    roles: [],
  },
]

const FEATURE_BY_KEY = new Map(HOCKIA_FEATURES.map(f => [f.key, f]))

/** Render the feature map as plain text for the LLM prompt. */
export function renderFeatureKnowledge(): string {
  const lines = HOCKIA_FEATURES.map(f => {
    const who = f.roles.length === 0 ? 'all roles' : f.roles.join(', ')
    return `- ${f.key} — ${f.summary} (Available to: ${who}.)`
  })
  return `HOCKIA FEATURE MAP (source of truth — do not invent features):\n${lines.join('\n')}`
}

/**
 * Resolve a feature key + the user's role into a CTA. Returns null when the
 * feature is gated to roles the user does not have — the assistant's text
 * still explains what they CAN do, it just won't show a misleading button.
 */
export function resolveFeatureCta(
  featureKey: string | null | undefined,
  role: string | null,
): { label: string; route: string } | null {
  if (!featureKey) return null
  const feature = FEATURE_BY_KEY.get(featureKey)
  if (!feature) return null
  if (feature.roles.length > 0 && (!role || !feature.roles.includes(role as HockiaRole))) {
    return null
  }
  return { label: feature.label, route: feature.route }
}
