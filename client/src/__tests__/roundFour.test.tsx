import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Vacancy } from '@/lib/supabase'

/**
 * Round 4 follow-ups: Message the club from the desktop role preview, open
 * roles from hidden clubs, the exact AI sparkle, uploaded highlights in the
 * desktop counts, coach settings, the club's own role in the feed, the club
 * Hockia AI entry, the Pulse nudge, My applications chevrons, the passport
 * tile, the role-filled copy and repeat installs.
 */

// ── mocks ───────────────────────────────────────────────────────────────────
const tables: Record<string, unknown> = {}
const invoke = vi.fn()
const rpc = vi.fn()
const navigateSpy = vi.fn()
let authState: { user: { id: string } | null; profile: Record<string, unknown> | null } = { user: null, profile: null }
let profileVideos: { id: string; title: string; kind: 'highlight' | 'full_match' | 'reel'; visibility: string | null; durationSeconds: number | null }[] = []

vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateSpy }
})
vi.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    const result = () => Promise.resolve({ data: tables[table] ?? null, count: 0, error: null })
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'neq', 'or']) chain[m] = () => chain
    chain.maybeSingle = result
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej)
    return chain
  }
  return {
    supabase: {
      from: (t: string) => builder(t),
      rpc: (...a: unknown[]) => rpc(...a),
      functions: { invoke: (...a: unknown[]) => invoke(...a) },
    },
  }
})
vi.mock('@/lib/auth', () => ({
  useAuthStore: Object.assign(
    (sel?: (s: unknown) => unknown) => (sel ? sel(authState) : authState),
    { getState: () => authState },
  ),
}))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [], loading: false, getCountryById: () => undefined }) }))
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => undefined }))
vi.mock('@/hooks/useProfileVideos', () => ({
  useProfileVideos: () => ({ videos: profileVideos, links: [], loading: false, reload: () => {} }),
}))
vi.mock('@/hooks/useGalleryCount', () => ({
  useGalleryCount: () => ({ count: 0, error: null }),
  useClubMediaCount: () => ({ count: 0, error: null }),
}))
vi.mock('@/hooks/useWeeklyVisibility', () => ({
  useWeeklyVisibility: () => ({ loading: false, visibility: { views_7d: 0, views_prior_7d: 0, viewers_by_role: {} }, streakDays: 0 }),
}))
vi.mock('@/hooks/useFeedAuthorContext', () => ({ useAuthorContext: () => null }))
vi.mock('@/lib/homeInstrumentation', () => ({
  useImpressionOnce: () => ({ current: null }),
  recordModuleImpression: vi.fn(),
  trackModuleClick: vi.fn(),
}))
vi.mock('@/components/OpportunityDetailOverlay', () => ({ default: () => <div data-testid="detail-overlay" /> }))
vi.mock('@/components/index', () => ({
  Avatar: () => <div data-testid="avatar" />,
  StorageImage: () => <div data-testid="storage-image" />,
  AvatarMenu: () => null,
  NotificationBadge: () => null,
}))
vi.mock('@/hooks/useNavigation', () => ({
  useNavigation: () => ({
    user: authState.user,
    profile: authState.profile,
    isActive: () => false,
    handleNavigate: navigateSpy,
    toggleNotificationDrawer: vi.fn(),
    unreadCount: 0,
    opportunityCount: 0,
    notificationCount: 0,
  }),
}))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/hooks/useInboxSegmentDots', () => ({ useInboxSegmentDots: () => ({ messages: false, requests: false, activity: false }) }))

import OpportunityPreviewModal from '@/components/OpportunityPreviewModal'
import ApplicationTimeline from '@/components/ApplicationTimeline'
import MediaCard from '@/components/dashboard/bento/MediaCard'
import { OpportunityPostedCard } from '@/components/home/cards/OpportunityPostedCard'
import Header from '@/components/Header'
import { PlayerHero } from '@/components/home/pulse/PlayerHero'
import { KeyFactsGrid } from '@/components/profile/KeyFactsGrid'
import { buildPlayerKeyFacts } from '@/lib/keyFacts'
import { playerMediaCounts } from '@/lib/playerVideoChecklist'
import { feedbackMessageKind } from '@/lib/applicationStatus'
import type { OpportunityPostedFeedItem } from '@/types/homeFeed'

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8')

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  invoke.mockReset()
  rpc.mockReset()
  navigateSpy.mockReset()
  authState = { user: { id: 'player-1' }, profile: { id: 'player-1', role: 'player' } }
  profileVideos = []
})

// ── 1. Message the club from the desktop preview ────────────────────────────
const closedVacancy = {
  id: 'opp-1', club_id: 'club-1', title: '[QA] Midfielder', opportunity_type: 'player', position: 'midfielder',
  gender: 'Women', status: 'closed', priority: 'medium', location_city: 'Amsterdam', location_country: 'Netherlands',
  created_at: '2026-09-01T00:00:00Z', application_deadline: null, start_date: null, duration_text: null, benefits: [],
  custom_benefits: [], specialist_skills_wanted: [], requirements: [], description: null, compensation: null,
  eu_passport_required: false,
} as unknown as Vacancy

describe('desktop role preview: Message the club', () => {
  it('an applicant on a closed role gets Message the club, which opens the message flow', () => {
    const onClose = vi.fn()
    render(
      <MemoryRouter initialEntries={['/opportunities']}>
        <OpportunityPreviewModal
          vacancy={closedVacancy}
          clubInfo={{ id: 'club-1', full_name: 'QA Club', avatar_url: null, role: 'club', current_club: null, womens_league_division: null, mens_league_division: null }}
          worldClub={null}
          hasApplied
          applicationStatus="filled"
          onClose={onClose}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByTestId('closed-message-club'))
    expect(onClose).toHaveBeenCalled()
    expect(navigateSpy).toHaveBeenCalledWith('/messages?new=club-1', { state: { from: '/opportunities' } })
  })

  it('the club profile Opportunities tab wires Message the club too (never for the publisher)', () => {
    const src = read('../components/OpportunitiesTab.tsx')
    expect(src).toMatch(/onMessage=\{\s*\/\/[^\n]*\n\s*user && detailVacancy\.club_id !== user\.id/)
    expect(src).toContain('navigate(`/messages?new=${clubId}`')
  })
})

// ── 2. Open roles follow the closed-role publisher rules ────────────────────
describe('open roles: hidden club + blocked pair (migration)', () => {
  const sql = read('../../../supabase/migrations/20260929100000_open_roles_hidden_club_fence.sql')
  it('replaces the open-roles read policy with the fenced one, open rows only', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Public can view open opportunities"/)
    expect(sql).toMatch(/CREATE POLICY "Public can view open opportunities"[\s\S]*FOR SELECT[\s\S]*status = 'open'::public\.opportunity_status[\s\S]*viewer_can_view_open_opportunity\(club_id\)/)
    expect(sql).not.toMatch(/'draft'|'closed'::/)
  })
  it('hides hidden publishers for everyone and blocked pairs for signed-in viewers', () => {
    expect(sql).toMatch(/profile_is_hidden\(p\.is_blocked, p\.frozen_minor_at\)/)
    expect(sql).toMatch(/auth\.uid\(\) IS NULL\s+OR NOT public\.is_blocked_pair\(auth\.uid\(\), p_club_id\)/)
  })
  it('grants the helper explicitly (anon + authenticated, not PUBLIC)', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.viewer_can_view_open_opportunity\(uuid\) FROM PUBLIC/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.viewer_can_view_open_opportunity\(uuid\) TO anon/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.viewer_can_view_open_opportunity\(uuid\) TO authenticated/)
  })
  it('ships a rollback that restores the plain policy', () => {
    const down = read('../../../supabase/rollbacks/20260929100000_open_roles_hidden_club_fence.down.sql')
    expect(down).toMatch(/USING \(status = 'open'::public\.opportunity_status\)/)
    expect(down).toMatch(/DROP FUNCTION IF EXISTS public\.viewer_can_view_open_opportunity\(uuid\)/)
  })
})

// ── 3. The sparkle marks AI words only ──────────────────────────────────────
describe('application feedback: exact AI sparkle', () => {
  it('feedbackMessageKind: only "ai" is AI; no source is plain', () => {
    expect(feedbackMessageKind('ai')).toBe('ai')
    expect(feedbackMessageKind('club')).toBe('club')
    expect(feedbackMessageKind('fallback')).toBe('plain')
    expect(feedbackMessageKind(undefined)).toBe('plain')
  })

  const history = [{ id: 'h1', new_status: 'rejected', reason: null, created_at: '2026-09-10T00:00:00Z' }]
  const seed = () => {
    tables.opportunity_applications = { id: 'app-1', status: 'rejected', applied_at: '2026-09-03T00:00:00Z', ai_feedback: null }
    tables.application_status_history = history
    tables.application_views = []
  }

  it('a fallback message shows without the sparkle', async () => {
    seed()
    invoke.mockResolvedValue({ data: { message: 'Deterministic words.', source: 'fallback' }, error: null })
    render(<ApplicationTimeline opportunityId="opp-1" />)
    await waitFor(() => expect(screen.getByTestId('timeline-message').textContent).toContain('Deterministic words.'))
    expect(screen.queryByTestId('timeline-ai-sparkle')).toBeNull()
  })

  it('an AI message keeps the sparkle', async () => {
    seed()
    invoke.mockResolvedValue({ data: { message: 'AI words.', source: 'ai' }, error: null })
    render(<ApplicationTimeline opportunityId="opp-1" />)
    await waitFor(() => expect(screen.getByTestId('timeline-message').textContent).toContain('AI words.'))
    expect(screen.getByTestId('timeline-ai-sparkle')).toBeTruthy()
  })

  it('a club note returned by the function reads as the club’s note', async () => {
    seed()
    invoke.mockResolvedValue({ data: { message: 'From us.', source: 'club' }, error: null })
    render(<ApplicationTimeline opportunityId="opp-1" />)
    const note = await screen.findByTestId('timeline-club-note')
    expect(note.textContent).toContain('From us.')
    expect(screen.queryByTestId('timeline-ai-sparkle')).toBeNull()
  })

  it('the edge function returns source on every read response', () => {
    const src = read('../../../supabase/functions/application-feedback/index.ts')
    expect(src).toContain('cached: false, source: null }')
    expect(src).toContain('cached: true, source: cache.source }')
    expect(src).toContain('{ message, status, cached: false, source }')
  })
})

// ── 4. Uploaded highlights count ────────────────────────────────────────────
describe('desktop media counts include uploaded videos', () => {
  it('playerMediaCounts adds uploads to the legacy link and linked games', () => {
    expect(playerMediaCounts({ highlight_video_url: null, full_game_video_count: 0 }, [])).toEqual({ highlights: 0, fullMatches: 0 })
    expect(playerMediaCounts({ highlight_video_url: 'https://youtu.be/x', full_game_video_count: 1 }, [{ kind: 'highlight' }, { kind: 'highlight' }, { kind: 'full_match' }, { kind: 'reel' }]))
      .toEqual({ highlights: 3, fullMatches: 2 })
  })

  it('the bento Media card shows uploaded highlights with no legacy link', () => {
    profileVideos = [
      { id: 'v1', title: 'A', kind: 'highlight', visibility: 'public', durationSeconds: 30 },
      { id: 'v2', title: 'B', kind: 'highlight', visibility: 'public', durationSeconds: 30 },
    ]
    render(<MediaCard profile={{ id: 'player-1', highlight_video_url: null, full_game_video_count: 0 }} readOnly={false} onManageMedia={() => {}} />)
    const tile = screen.getByText('Highlights').parentElement as HTMLElement
    expect(tile.textContent).toContain('2')
  })

  it('the scouting card media line reads the same counts', () => {
    const src = read('../components/profile/ScoutingCard.tsx')
    expect(src).toContain('playerMediaCounts(profile, profileVideos)')
    expect(src).toContain("`${highlightCount} highlight${highlightCount === 1 ? '' : 's'}`")
  })
})

// ── 5. Coach bits ───────────────────────────────────────────────────────────
describe('coach profile + settings', () => {
  it('coach Settings toggles open_to_coach under "Open to coach"', () => {
    const src = read('../components/settings/SettingsMobile.tsx')
    expect(src).toContain('<SettingsRow title="Open to coach"')
    expect(src).toContain("toggle('open_to_coach', false)")
  })
  it('the coach’s own profile has no recruiting-context chip and no second share/settings row', () => {
    const src = read('../pages/CoachDashboard.tsx')
    expect(src).not.toContain('<ContextSwitcher')
    expect(src).not.toContain('<ProfileTopBar')
  })
  it('the club’s own profile has no recruiting-context chip either (it stays on Community / Saved)', () => {
    expect(read('../pages/ClubDashboard.tsx')).not.toContain('<ContextSwitcher')
    expect(read('../pages/CommunityPage.tsx')).toContain('<ContextSwitcher')
    expect(read('../pages/SavedCandidatesPage.tsx')).toContain('<ContextSwitcher')
  })
})

// ── 6. Club screens ─────────────────────────────────────────────────────────
const feedItem = {
  feed_item_id: 'f1', item_type: 'opportunity_posted', created_at: '2026-09-20T00:00:00Z', opportunity_id: 'opp-9',
  title: 'Women’s 1st team midfielder', position: 'midfielder', gender: 'Women', location_city: 'Dublin', location_country: 'Ireland',
  club_id: 'club-1', club_name: 'QA Club', club_logo: null, publisher_role: 'club',
} as unknown as OpportunityPostedFeedItem

describe('club screens', () => {
  it('the feed shows View role (not Apply) on the club’s own role', () => {
    authState = { user: { id: 'club-1' }, profile: { id: 'club-1', role: 'club' } }
    render(<MemoryRouter><OpportunityPostedCard item={feedItem} /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View role' }))
    expect(screen.getByTestId('detail-overlay')).toBeTruthy()
  })

  it('a player gets Apply on a player role', () => {
    render(<MemoryRouter><OpportunityPostedCard item={feedItem} /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'View role' })).toBeNull()
  })

  it('a coach gets Apply on a coach role, View role on a player role', () => {
    authState = { user: { id: 'coach-1' }, profile: { id: 'coach-1', role: 'coach' } }
    const { unmount } = render(<MemoryRouter><OpportunityPostedCard item={{ ...feedItem, opportunity_type: 'coach' }} /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy()
    unmount()
    render(<MemoryRouter><OpportunityPostedCard item={{ ...feedItem, opportunity_type: 'player' }} /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    expect(screen.getByRole('button', { name: 'View role' })).toBeTruthy()
  })

  it('other clubs, brands and umpires get View role, and a player gets View role on a coach role', () => {
    for (const role of ['club', 'brand', 'umpire']) {
      authState = { user: { id: `${role}-9` }, profile: { id: `${role}-9`, role } }
      const { unmount } = render(<MemoryRouter><OpportunityPostedCard item={feedItem} /></MemoryRouter>)
      expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
      expect(screen.getByRole('button', { name: 'View role' })).toBeTruthy()
      unmount()
    }
    authState = { user: { id: 'player-1' }, profile: { id: 'player-1', role: 'player' } }
    render(<MemoryRouter><OpportunityPostedCard item={{ ...feedItem, opportunity_type: 'coach' }} /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
  })

  it('the club phone header has a Hockia AI (sparkles) button to /discover; players do not', () => {
    authState = { user: { id: 'club-1' }, profile: { id: 'club-1', role: 'club' } }
    const { unmount } = render(<MemoryRouter><Header /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('header-hockia-ai'))
    expect(navigateSpy).toHaveBeenCalledWith('/discover')
    unmount()
    authState = { user: { id: 'player-1' }, profile: { id: 'player-1', role: 'player' } }
    render(<MemoryRouter><Header /></MemoryRouter>)
    expect(screen.queryByTestId('header-hockia-ai')).toBeNull()
  })

  it('the members count comes from the same server search as the list', () => {
    const src = read('../components/community/PeopleListView.tsx')
    expect(src).toMatch(/supabase\.rpc\('community_search_members', \{\s*p_role: roleFilter \?\? undefined,\s*p_limit: 0,/)
  })

  it('role toasts: close, reopen, and "Changes saved." after an edit', () => {
    // Round 5: the reopen copy is shared with desktop; the filled toast knows how many were waiting.
    expect(read('../components/club/RoleActions.tsx')).toContain("addToast(REOPEN_ROLE_TOAST, 'success')")
    expect(read('../lib/roleLifecycle.ts')).toContain("export const REOPEN_ROLE_TOAST = 'Role reopened.'")
    expect(read('../components/club/RoleActions.tsx')).toContain("addToast(closeRoleToast(outcome, waiting), 'success')")
    expect(read('../components/club/PostRoleScreen.tsx')).toContain("addToast('Changes saved.', 'success')")
  })
})

// ── 7. Player bits ──────────────────────────────────────────────────────────
describe('player bits', () => {
  it('Pulse: no "Mark yourself open to play" once the player is open to play', () => {
    authState = { user: { id: 'player-1' }, profile: { id: 'player-1', role: 'player', open_to_play: true } }
    render(<MemoryRouter><PlayerHero /></MemoryRouter>)
    expect(screen.getByTestId('player-hero-empty-sub').textContent).not.toMatch(/open to play/i)
  })

  it('Pulse: the nudge stays for a player who is not open yet', () => {
    authState = { user: { id: 'player-1' }, profile: { id: 'player-1', role: 'player', open_to_play: false } }
    render(<MemoryRouter><PlayerHero /></MemoryRouter>)
    expect(screen.getByTestId('player-hero-empty-sub').textContent).toMatch(/Mark yourself open to play/)
  })

  it('My applications: rows after the first are widened back so chevrons line up', () => {
    const src = read('../pages/MyApplicationsPage.tsx')
    expect(src).toContain('[&>li+li>button]:-ml-[84px] [&>li+li>button]:w-[calc(100%+84px)]')
  })

  it('passport tile: one line per passport and an EU tag', () => {
    const facts = buildPlayerKeyFacts({
      position: 'midfielder', secondaryPosition: null, currentClubName: null, league: null,
      availableFrom: null, availabilityDuration: null,
      passports: [{ name: 'Argentina', flag: '🇦🇷', isEu: false }, { name: 'Italy', flag: '🇮🇹', isEu: true }],
      permits: [{ countryName: 'United Kingdom', flag: '🇬🇧', type: 'visa', validFrom: null, expiresOn: null }],
      fullMatchCount: 0, highlightCount: 0, age: 24,
    }, { viewer: 'recruiter' })
    const passport = facts.filter((f) => f.id === 'passport')
    render(<KeyFactsGrid facts={passport} />)
    const lines = screen.getAllByTestId('passport-line').map((n) => n.textContent)
    expect(lines).toEqual(['🇦🇷 Argentina', '🇮🇹 Italy'])
    expect(screen.getByTestId('passport-eu-tag').textContent).toBe('EU passport')
  })
})

// ── 8. Role filled copy + league by team ────────────────────────────────────
describe('wording', () => {
  it('push mirrors the client: the role title names the filled role', () => {
    const src = read('../../../supabase/functions/send-push/push-payload.ts')
    // Round 9: a generated headline ("Men's midfielder") yields the bare position; a typed title still names the role.
    expect(src).toContain("body = `${typedTitle ?? humanPos ?? 'The role'} has been filled.")
  })
  it('role-description-draft picks the league from the role team via leagueForTeam', () => {
    const src = read('../../../supabase/functions/role-description-draft/index.ts')
    expect(src).toContain('leagueForTeam(answers.team, p.mens_league_division, p.womens_league_division)')
  })
})

// ── 9. Repeat installs ──────────────────────────────────────────────────────
describe('pwa installs', () => {
  it('a repeat install is a no-op (ignore duplicates on the unique key)', () => {
    const src = read('../components/InstallPrompt.tsx')
    expect(src).toContain("{ onConflict: 'profile_id,platform', ignoreDuplicates: true }")
  })
})
