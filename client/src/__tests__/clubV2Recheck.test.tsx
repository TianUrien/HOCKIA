/**
 * Club v2 QA re-check (leaves 9/10): "waiting for a first reply", named
 * saved contexts, closed roles leaving "Ranked for", back to Settings,
 * one contact email copy, Cancel on edit sheets, sentence-case coach roles.
 */
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── supabase: a chainable fake whose result depends on the table ─────────
const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  calls: [] as Array<{ table: string; op: string; args: unknown[] }>,
}))
vi.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    const result = () => Promise.resolve({ data: db.tables[table] ?? [], error: null })
    const b: Record<string, unknown> = {}
    for (const op of ['select', 'eq', 'in', 'neq', 'is', 'order', 'limit', 'update']) {
      b[op] = (...args: unknown[]) => { db.calls.push({ table, op, args }); return b }
    }
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => result().then(res, rej)
    return b
  }
  return { supabase: { from: (t: string) => builder(t), rpc: vi.fn(async () => ({ data: [], error: null })) } }
})
vi.mock('@/lib/auth', () => ({
  useAuthStore: Object.assign(() => ({ profile: null }), { getState: () => ({ profile: null }) }),
}))

import { isWaitingForFirstReply, roleDetailOf, useClubInboxMeta } from '@/hooks/useClubInbox'
import { inboxWaitingNotice } from '@/lib/clubInbox'
import { contextPillLabel, playerContexts, type ContextLike } from '@/lib/findPlayers'
import { effectiveContextRow, isStaleRoleContext, useRecruitingContextStore, type RecruitingContextRow } from '@/hooks/useRecruitingContext'
import { RankedForSheet } from '@/components/club/RankedForSheet'
import { coachSpecialtyLabel } from '@/lib/identity'
import { squadRoleLine } from '@/lib/clubSquad'
import { CONTACT_EMAIL_SWITCH_HELP, CONTACT_EMAIL_SWITCH_LABEL, contactEmailSubtitle } from '@/lib/clubSettingsCopy'
import { contactRowValue } from '@/lib/clubEdit'
import settingsSource from '@/components/settings/SettingsMobile.tsx?raw'
import dashboardSource from '@/pages/ClubDashboard.tsx?raw'
import roleActionsSource from '@/components/club/RoleActions.tsx?raw'
import opportunitiesTabSource from '@/components/OpportunitiesTab.tsx?raw'

beforeEach(() => {
  db.tables = {}
  db.calls = []
})

// ── 1. Waiting for a first reply ─────────────────────────────────────────
describe('waiting for a first reply', () => {
  it('needs an open application the club has not answered since', () => {
    expect(isWaitingForFirstReply(null, null)).toBe(false)
    expect(isWaitingForFirstReply(undefined, '2026-06-12T06:19:12Z')).toBe(false)
    expect(isWaitingForFirstReply('2026-09-27T14:50:42Z', null)).toBe(true)
    // Club wrote in June, the person applied again in September.
    expect(isWaitingForFirstReply('2026-09-27T14:50:42Z', '2026-06-12T06:19:12Z')).toBe(true)
    expect(isWaitingForFirstReply('2026-09-27T14:50:42Z', '2026-09-28T09:00:00Z')).toBe(false)
  })

  it('staging shape: the player with a pending application counts; the coach whose applications closed does not', async () => {
    const rows = [
      { conversation_id: 'conv-player', other_participant_id: 'player', last_message_sender_id: 'player' },
      { conversation_id: 'conv-coach', other_participant_id: 'coach', last_message_sender_id: null },
      { conversation_id: 'conv-answered', other_participant_id: 'answered', last_message_sender_id: 'answered' },
    ]
    db.tables = {
      profiles: [
        { id: 'player', role: 'player', position: 'midfielder' },
        { id: 'coach', role: 'coach', coach_specialization: 'head_coach' },
        { id: 'answered', role: 'player', position: 'forward' },
      ],
      opportunity_applications: [
        { applicant_id: 'player', status: 'pending', applied_at: '2026-09-27T14:50:42Z' },
        { applicant_id: 'player', status: 'maybe', applied_at: '2026-05-23T01:09:47Z' },
        { applicant_id: 'player', status: 'rejected', applied_at: '2026-09-27T17:07:43Z' },
        { applicant_id: 'coach', status: 'no_response', applied_at: '2026-07-15T00:00:00Z' },
        { applicant_id: 'answered', status: 'shortlisted', applied_at: '2026-09-20T00:00:00Z' },
      ],
      messages: [
        { conversation_id: 'conv-answered', sent_at: '2026-09-21T00:00:00Z' },
        { conversation_id: 'conv-player', sent_at: '2026-06-12T06:19:12Z' },
      ],
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useClubInboxMeta('club', rows, true), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    const meta = result.current.data!
    expect(meta.get('conv-player')).toMatchObject({ waiting: true, applied: true, detail: 'Midfielder' })
    expect(meta.get('conv-coach')).toMatchObject({ waiting: false, applied: true, detail: 'Head coach' })
    expect(meta.get('conv-answered')?.waiting).toBe(false)
    expect(inboxWaitingNotice([...meta.values()])?.title).toBe('1 person waiting for a first reply')
    // Only conversations with an open application are checked for club messages;
    // deleted messages never count.
    const msgIn = db.calls.find((c) => c.table === 'messages' && c.op === 'in')
    expect(msgIn?.args[1]).toEqual(['conv-player', 'conv-answered'])
    expect(db.calls.some((c) => c.table === 'messages' && c.op === 'is' && c.args[0] === 'deleted_at')).toBe(true)
  })
})

// ── 2. Named saved contexts ──────────────────────────────────────────────
const ctx = (p: Partial<ContextLike>): ContextLike => ({ id: 'c', type: 'custom', label: null, target_category: 'Men', target_position: 'midfielder', target_role: 'player', opportunity_id: null, ...p })

describe('saved context names', () => {
  it('a saved context shows its name; unnamed ones and role contexts keep Position · Team', () => {
    expect(contextPillLabel(ctx({ label: '[QA] Scout R8' }))).toBe('[QA] Scout R8')
    expect(contextPillLabel(ctx({ label: '  ' }))).toBe('Midfielder · Men\'s')
    expect(contextPillLabel(ctx({ label: null }))).toBe('Midfielder · Men\'s')
    expect(contextPillLabel(ctx({ type: 'opportunity', opportunity_id: 'r', label: '[QA] Midfielder R8' }))).toBe('Midfielder · Men\'s')
  })
  it('the Recruiting for sheet lists the saved context by its name', () => {
    render(<RankedForSheet open contexts={[ctx({ id: 's1', label: '[QA] Scout R8' })]} activeId="s1" roles={new Map()} onPick={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('radio', { name: /\[QA\] Scout R8/ }).getAttribute('aria-checked')).toBe('true')
  })
})

// ── 3. Closed roles leave "Ranked for" ───────────────────────────────────
const row = (p: Partial<RecruitingContextRow>): RecruitingContextRow => ({
  id: 'r', owner_id: 'club', type: 'opportunity', is_active: false, label: null, target_category: 'Men', target_role: 'player',
  target_position: 'midfielder', opportunity_id: 'o', opportunity_status: 'open', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  ...p,
} as RecruitingContextRow)

describe('closed roles', () => {
  const r8 = row({ id: 'ctx-r8', opportunity_id: 'r8', is_active: true, opportunity_status: 'closed', updated_at: '2026-09-30T00:00:00Z' })
  const older = row({ id: 'ctx-open', opportunity_id: 'o1', updated_at: '2026-09-10T00:00:00Z' })

  it('a stored context on a closed role is no context: most recent open role of that kind, else none', () => {
    expect(isStaleRoleContext(r8)).toBe(true)
    expect(isStaleRoleContext(row({ opportunity_status: undefined }))).toBe(false)
    expect(isStaleRoleContext(row({ type: 'custom', opportunity_status: null }))).toBe(false)
    expect(effectiveContextRow([r8, older], 'player')?.id).toBe('ctx-open')
    expect(effectiveContextRow([r8], 'player')).toBeNull()
    expect(effectiveContextRow([r8, older], null)?.id).toBe('ctx-open')
  })

  it('the sheet never lists (or ticks) a closed role under Your open roles', () => {
    const active = effectiveContextRow([r8, older], 'player')
    const listed = playerContexts([r8, older], new Set(['o1']), active?.id ?? null)
    render(<RankedForSheet open contexts={listed} activeId={active?.id ?? null} roles={new Map([['o1', { title: 'Open role', toReview: 0 }], ['r8', { title: '[QA] Midfielder R8', toReview: 0 }]])} onPick={() => {}} onClose={() => {}} />)
    expect(screen.queryByText(/\[QA\] Midfielder R8/)).toBeNull()
    expect(screen.getByRole('radio', { name: /Open role/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('closing a role through the store drops it as the active context', async () => {
    useRecruitingContextStore.setState({ ownerId: 'club', eligibleRole: 'club', rows: [{ ...r8, opportunity_status: 'open' }, older], loading: false, fetchedForOwner: 'club' })
    db.tables.recruiting_context = [{ ...older }]
    await act(async () => { await useRecruitingContextStore.getState().roleStatusChanged('r8', 'closed') })
    const deactivate = db.calls.filter((c) => c.table === 'recruiting_context' && c.op === 'update')
    expect(deactivate).toHaveLength(1)
    expect(deactivate[0].args[0]).toEqual({ is_active: false })
    expect(db.calls.some((c) => c.table === 'recruiting_context' && c.op === 'eq' && c.args[0] === 'id' && c.args[1] === 'ctx-r8')).toBe(true)
    expect(useRecruitingContextStore.getState().rows.find((r) => r.is_active)).toBeUndefined()
  })

  it('both close paths tell the store', () => {
    expect(roleActionsSource).toContain("roleStatusChanged(role.id, 'closed')")
    expect(roleActionsSource).toContain("roleStatusChanged(role.id, 'open')")
    expect(opportunitiesTabSource).toContain("roleStatusChanged(vacancyId, 'closed')")
  })
})

// ── 4. Back to Settings ──────────────────────────────────────────────────
describe('opened from Settings', () => {
  it('Settings opens Edit profile, Club & league and Squad with ?from=settings', () => {
    expect(settingsSource).toContain('`${CLUB_EDIT_PATH}?from=settings`')
    expect(settingsSource).toContain("'/dashboard/profile/members?from=settings'")
    expect(settingsSource).toContain("'/dashboard/profile?tab=league&from=settings'")
  })
  it('the club leaves name Settings and return there', () => {
    expect(dashboardSource).toContain("fromSettings ? 'Settings'")
    expect(dashboardSource).toContain("navigate('/settings')")
    expect(dashboardSource).toContain('<SquadScreen profile={profile} parent={leafParent} onBack={leafBack} />')
  })
})

// ── 5. Contact email copy ────────────────────────────────────────────────
describe('contact email copy', () => {
  it('one label, one help line, one subtitle rule', () => {
    expect(CONTACT_EMAIL_SWITCH_LABEL).toBe('Show on your profile')
    expect(CONTACT_EMAIL_SWITCH_HELP).toBe('Off: players message you on Hockia.')
    expect(contactEmailSubtitle('a@b.co', false)).toBe('Private · a@b.co')
    expect(contactEmailSubtitle('a@b.co', true)).toBe('Shown on your profile')
    expect(contactRowValue('a@b.co', false)).toBe('Private · a@b.co')
    expect(contactRowValue('a@b.co', true)).toBe('Shown on your profile')
    expect(contactRowValue('', true)).toBeNull()
  })
})

// ── 7. Sentence-case coach roles ─────────────────────────────────────────
describe('coach specialties', () => {
  it('sentence case everywhere; custom title for "other"', () => {
    expect(coachSpecialtyLabel('head_coach')).toBe('Head coach')
    expect(coachSpecialtyLabel('assistant_coach')).toBe('Assistant coach')
    expect(coachSpecialtyLabel('strength_conditioning')).toBe('Strength & conditioning')
    expect(coachSpecialtyLabel('other', 'Video lead')).toBe('Video lead')
    expect(coachSpecialtyLabel('other', null)).toBe('Coach')
    expect(coachSpecialtyLabel(null)).toBeNull()
  })
  it('Inbox rows and Squad lines use it', () => {
    expect(roleDetailOf({ id: 'x', role: 'coach', position: null, coach_specialization: 'head_coach', coach_specialization_custom: null, mens_league_division: null, womens_league_division: null, umpire_level: null })).toBe('Head coach')
    expect(squadRoleLine({ role: 'coach', position: null, secondary_position: null, coach_specialization: 'goalkeeper_coach', coach_specialization_custom: null })).toBe('Coach · Goalkeeper coach')
  })
})

// ── 6. Cancel on the Settings contact email sheet ────────────────────────
describe('edit sheets', () => {
  it('the shared actions render Cancel next to Save', async () => {
    const { SheetActions } = await import('@/components/settings/settingsUi')
    const onCancel = vi.fn()
    const onSave = vi.fn()
    render(<SheetActions onCancel={onCancel} onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })
})
