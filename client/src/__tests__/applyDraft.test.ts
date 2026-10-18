import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const insert = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ insert: (row: unknown) => insert(row) }) }, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn() }))
vi.mock('@/lib/analytics', () => ({ trackApplicationSubmit: vi.fn() }))
vi.mock('@/lib/sentryHelpers', () => ({ reportSupabaseError: vi.fn() }))

import { submitApplication } from '@/lib/submitApplication'

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8')
const role = { id: 'r1', club_id: 'club', position: 'midfielder', opportunity_type: 'player' } as never

describe('Hockia AI · Prepare my application', () => {
  beforeEach(() => insert.mockReset())
  it('sends the same insert as the Apply sheet, with the edited note', async () => {
    insert.mockResolvedValue({ error: null })
    expect(await submitApplication(role, 'me', '  Hi club  ', { source: 'hockia_ai' })).toEqual({ ok: true, already: false })
    expect(insert).toHaveBeenCalledWith({ opportunity_id: 'r1', applicant_id: 'me', status: 'pending', metadata: { message: 'Hi club' } })
  })
  it('treats a duplicate as already applied and shows the eligibility message', async () => {
    insert.mockResolvedValue({ error: { code: '23505' } })
    expect(await submitApplication(role, 'me', '')).toEqual({ ok: true, already: true })
    insert.mockResolvedValue({ error: { code: 'P0001', message: 'This opportunity is for women’s teams.' } })
    expect(await submitApplication(role, 'me', '')).toEqual({ ok: false, message: 'This opportunity is for women’s teams.' })
    expect(await submitApplication({ ...role as object, club_id: 'me' } as never, 'me', '')).toMatchObject({ ok: false })
  })
  it('nothing is sent before Send application; the Apply sheet uses the same helper', () => {
    const flow = read('../components/hockiaAi/ApplyFlow.tsx')
    expect(flow.indexOf('submitApplication(')).toBeGreaterThan(flow.indexOf('const send = async'))
    expect(flow).toContain('checkOpportunityEligibility(vacancy, profile, countries)')
    expect(read('../components/ApplyToOpportunityModal.tsx')).toContain("submitApplication(vacancy, user.id, message, { viewerRole: profile?.role ?? null, source: 'apply_sheet' })")
    expect(read('../components/hockiaAi/HockiaAiSheet.tsx')).toContain('RoleApplyActionContext.Provider value={canBuild ?')
  })
})
