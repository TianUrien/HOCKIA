import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { emptyDraft } from '@/lib/postRole'
import { closedRoleLine, postAgainDraft, postAgainSeed } from '@/lib/postAgain'
import type { Vacancy } from '@/lib/supabase'

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8')

describe('Club speed CS3 · Post again', () => {
  it('copies the details and starts dates, deadline and cover fresh (phone)', () => {
    const d = postAgainDraft({ ...emptyDraft({ baseLocation: 'Rome', countryName: 'Italy' }), id: 'old', title: 'Left back', startDate: '2026-01-01', coverUrl: 'https://x/c.png', pay: 'paid' })
    expect(d.id).toBeNull()
    expect(d.startDate).toBeNull()
    expect(d.coverUrl).toBeNull()
    expect(d.title).toBe('Left back')
    expect(d.pay).toBe('paid')
  })
  it('seeds the desktop form as a new draft with no dates', () => {
    const v = postAgainSeed({ id: 'old', title: 'Left back', status: 'closed', start_date: '2026-01-01', application_deadline: '2026-02-01', published_at: '2025-12-01' } as unknown as Vacancy)
    expect(v).toMatchObject({ title: 'Left back', status: 'draft', start_date: null, application_deadline: null, published_at: null })
  })
  it('reads the closed line', () => {
    const day = () => '12 Sep'
    expect(closedRoleLine('2026-09-12', 'withdrawn', day)).toBe('Closed 12 Sep · not filled')
    expect(closedRoleLine('2026-09-12', 'filled', day)).toBe('Closed 12 Sep · filled')
    expect(closedRoleLine(null, null, day)).toBe('Closed')
  })
  it('is offered on the closed role sheet, the start sheet and desktop (desktop and coaches open the Post flow with postAgainId)', () => {
    expect(read('../components/club/RoleActions.tsx')).toContain('data-testid="role-actions-post-again"')
    expect(read('../components/club/PostRoleStartSheet.tsx')).toContain("go({ postAgainId: r.id }, 'post_again')")
    expect(read('../pages/OpportunitiesPage.tsx')).toContain("navigate('/dashboard/opportunities/new', { state: { postAgainId: role.id } })")
  })
})
