import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const invoke = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) }, from: vi.fn() },
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
}))

import { BULK_DECLINE_REASONS, CLUB_NOTE_MAX, bulkDecisionToast, declineGreeting, declineNoteBody, namesLine, personalDeclineNote } from '@/lib/declineNotes'
import { tellWaitingApplicants } from '@/lib/roleWaiting'
import { closeRoleToldToast } from '@/lib/roleLifecycle'
import { holdDecision } from '@/lib/pendingDecisions'
import { useUndoToast } from '@/lib/undoToast'
import { UndoToast } from '@/components/club/UndoToast'

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8')

describe('Club speed · fixed decline notes (ruling 2026-10-17: no AI draft)', () => {
  it('builds the note from the reason and the role title, with each player’s own first name', () => {
    const body = declineNoteBody('different_level', 'Goalkeeper, women’s 1st team')
    expect(body).toBe('thank you for applying to Goalkeeper, women’s 1st team. We’re looking for a different level for this role, so we won’t move forward this time. We’d be glad to see you apply to our next roles.')
    expect(personalDeclineNote('Ana', body)).toBe(`Hi Ana, ${body}`)
    expect(personalDeclineNote('Mia', body).startsWith('Hi Mia, thank you')).toBe(true)
  })
  it('greets without a name when the profile has none, and closes say the role closed', () => {
    expect(declineGreeting(null)).toBe('Hello,')
    expect(declineNoteBody('role_closed', 'Left back')).toContain('We’ve closed this role, so we won’t move forward')
    expect(declineNoteBody('unknown_code', 'Left back')).toContain('We’ve decided to go another way')
  })
  it('keeps every personal note within the server cap', () => {
    expect(personalDeclineNote('Anastasia', 'x'.repeat(700)).length).toBe(CLUB_NOTE_MAX)
  })
  it('offers the six Figma reasons, all valid server codes', () => {
    expect(BULK_DECLINE_REASONS.map((r) => r.label)).toEqual(['Position filled', 'Different level', 'Timing', 'Location', 'Eligibility', 'Other'])
  })
  it('names up to three people, then a count', () => {
    expect(namesLine(['Ana Costa', 'Mia Keller'])).toBe('Ana Costa, Mia Keller')
    expect(namesLine(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 more')
    expect(bulkDecisionToast(2, 'rejected')).toBe('2 applicants declined')
    expect(bulkDecisionToast(1, 'maybe')).toBe('1 applicant marked maybe')
  })
  it('never calls a model: the bulk sheet and the close sheet use the template only', () => {
    expect(read('../components/club/BulkDeclineSheet.tsx')).not.toContain("mode: 'draft'")
    expect(read('../components/club/RoleActions.tsx')).not.toContain("mode: 'draft'")
  })
})

describe('Club speed CS6 · tell everyone still waiting', () => {
  beforeEach(() => invoke.mockReset())
  it('declines each waiting application with its own note and counts failures', async () => {
    invoke.mockImplementation(async (_fn: string, opts?: { body: { application_id: string } }) =>
      opts?.body.application_id === 'bad' ? { data: null, error: new Error('x') } : { data: { ok: true }, error: null })
    const res = await tellWaitingApplicants(
      [{ applicationId: 'a1', firstName: 'Ana' }, { applicationId: 'bad', firstName: null }, { applicationId: 'a3', firstName: 'Mia' }],
      'other',
      (first) => personalDeclineNote(first, 'body'),
    )
    expect(res).toEqual({ told: 2, failed: 1 })
    const sent = invoke.mock.calls.map((c) => (c[1] as { body: { application_id: string; message: string; mode: string } }).body)
    expect(sent.every((b) => b.mode === 'decline')).toBe(true)
    expect(sent.find((b) => b.application_id === 'a1')?.message).toBe('Hi Ana, body')
    expect(sent.find((b) => b.application_id === 'bad')?.message).toBe('Hello, body')
  })
  it('toasts what happened', () => {
    expect(closeRoleToldToast(3, 0)).toBe('Role closed. 3 players told.')
    expect(closeRoleToldToast(1, 1)).toBe('Role closed. 1 player told; couldn’t tell 1.')
    expect(closeRoleToldToast(0, 2)).toBe('Role closed. Couldn’t tell 2 players.')
  })
})

describe('Club speed CS4/CS5 · one Undo for several decisions', () => {
  it('drops every decision still held and restores only those', () => {
    holdDecision({ kind: 'decline', applicationId: 'x1', reason: 'other', message: 'Hi A, b' })
    holdDecision({ kind: 'decline', applicationId: 'x2', reason: 'other', message: 'Hi B, b' })
    const onUndo = vi.fn()
    useUndoToast.getState().show({ applicationId: 'x1', applicationIds: ['x1', 'x2', 'gone'], text: '2 applicants declined', onUndo })
    render(<UndoToast />)
    expect(screen.getByText('2 applicants declined')).toBeTruthy()
    fireEvent.click(screen.getByText('Undo'))
    expect(onUndo).toHaveBeenCalledWith(['x1', 'x2'])
    expect(useUndoToast.getState().toast).toBeNull()
  })
})

describe('Club speed CS7 · phone review moves on', () => {
  it('opens the next applicant To review after a decision, and counts N of M', () => {
    const src = read('../components/club/ApplicantReviewScreen.tsx')
    expect(src).toContain('else advance(prev)')
    expect(src).toContain('{run + 1} of {reviewTotal} to review')
    expect(src).toContain('<UndoToast aboveBar />')
    expect(read('../pages/ClubRecruitingRoutes.tsx')).toContain('<ApplicantReviewScreen key={applicationId}')
  })
})

describe('Club speed on desktop', () => {
  it('the desktop applicants page selects several and declines with the shared sheet', () => {
    const src = read('../components/club/ApplicantsDesktop.tsx')
    expect(src).toContain('data-testid="selection-pane"')
    expect(src).toContain('<BulkDeclineSheet')
    expect(src).toContain('if (selecting) return')
    expect(src).toContain("onPostAgain={() => navigate(home.path, { state: { postAgainRoleId: role.id } })}")
  })
  it('the dashboard Opportunities tab closes with the shared sheet', () => {
    expect(read('../components/OpportunitiesTab.tsx')).toContain('<CloseRoleSheet')
    expect(read('../pages/OpportunitiesPage.tsx')).toContain('postAgainRoleId')
  })
})
