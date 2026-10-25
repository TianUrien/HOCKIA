/**
 * Design audit 2026-10-21, B6: one Primary per screen on desktop. Club
 * Opportunities: while a reply is owed the Primary is "Review N applicants"
 * and Post a role is Tonal. Home: New post is Tonal beside the Next step
 * card. Inbox: New message is an icon button; the only solid one is the
 * empty-state action.
 */
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/lib/auth', () => ({ useAuthStore: (sel?: (s: unknown) => unknown) => { const s = { user: { id: 'club-1' }, profile: { id: 'club-1', role: 'club' } }; return sel ? sel(s) : s } }))
vi.mock('@/hooks/useOwnerCrest', () => ({ useOwnerCrest: () => ({ crestUrl: null, palette: null, clubName: 'Club' }) }))
vi.mock('@/hooks/useScouting', () => ({ useScoutingContext: () => ({ ctx: null, roleTitle: null }), useRoleShortlist: () => ({ loading: false, rows: [] }) }))
vi.mock('@/hooks/useRecruitingContext', () => ({ useRecruitingViewKind: vi.fn() }))
vi.mock('@/hooks/useYourReplies', () => ({ useYourReplies: () => null }))
vi.mock('@/components/club/RoleActions', () => ({ RoleActions: () => null }))
vi.mock('@/components/club/PostRoleStartSheet', () => ({ PostRoleStartSheet: () => null }))

import { RecruiterRoles } from '@/components/club/ClubOpportunitiesScreen'
import type { ClubRolesData } from '@/hooks/useClubRoles'

const role = (id: string, toReview: number) => ({
  id, status: 'open', title: 'Midfielder', opportunity_type: 'player', position: 'midfielder', gender: 'Men', playing_category: 'adult_men',
  created_at: '2026-10-01T00:00:00Z', published_at: '2026-10-01T00:00:00Z', application_deadline: null, location_city: 'Madrid', cover_url: null,
  pipeline: { toReview, shortlisted: 0, declined: 0, closed: 0, total: toReview },
  pendingAppliedAt: toReview > 0 ? ['2026-10-20T10:00:00Z'] : [],
})

function renderRoles(open: ReturnType<typeof role>[]) {
  const data = { loading: false, open, closed: [], expiryDays: 14, refresh: vi.fn() } as unknown as ClubRolesData
  return render(<MemoryRouter><RecruiterRoles data={data} onPostRole={vi.fn()} layout="desktop" /></MemoryRouter>)
}

describe('club Opportunities on desktop: one Primary', () => {
  it('a reply owed: "Review 2 applicants" is the Primary, Post an opportunity is Tonal', () => {
    renderRoles([role('r1', 2)])
    const post = screen.getByTestId('desktop-post-role')
    expect(post).toHaveAttribute('data-emphasis', 'tonal')
    expect(post.className).toContain('bg-brand-soft')
    expect(post.className).not.toContain('bg-brand-primary ')
    const review = screen.getByTestId('role-review-button')
    expect(review).toHaveTextContent('Review 2 applicants')
    expect(review.className).toContain('bg-brand-primary')
  })

  it('nothing owed: Post an opportunity is the Primary', () => {
    renderRoles([role('r1', 0)])
    expect(screen.getByTestId('desktop-post-role')).toHaveAttribute('data-emphasis', 'primary')
    expect(screen.getByTestId('role-review-button').className).not.toContain('bg-brand-primary')
  })
})

describe('Home and Inbox on desktop', () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8')

  it('Home: New post is Tonal; the Next step card keeps the Primary', () => {
    const home = read('pages/HomePage.tsx')
    const button = home.slice(home.indexOf('data-testid="home-new-post"') - 400, home.indexOf('data-testid="home-new-post"'))
    expect(button).toContain('bg-brand-soft')
    expect(button).not.toContain('bg-hockia-primary')
  })

  it('Inbox: New message is an icon button, no gradient "+ New" Primary', () => {
    const messages = read('pages/MessagesPage.tsx')
    expect(messages).toContain('<IconButton label="New message"')
    expect(messages).not.toMatch(/from-hockia-primary to-hockia-secondary[^\n]*\n[^\n]*aria-label="New message"/)
    expect(messages).not.toMatch(/>\s*New\s*</)
  })
})
