import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * Role outcome (founder ruling 2026-11-21, docs/product/proposals/
 * recruiter-satisfaction.md, phase 2): the recruiter says what happened to a
 * role, when closing it or after it closed on its own. Private answer, once
 * per role, one question per app session.
 */
const h = vi.hoisted(() => ({
  answered: [] as string[],
  answersFail: false,
  applicants: [] as { id: string; applicant: { full_name: string | null } | null }[],
  upserts: [] as Record<string, unknown>[],
  events: [] as { name: string; id?: string; props?: Record<string, unknown> }[],
}))

vi.mock('@/lib/supabase', () => {
  const chain = (rows: unknown, error: unknown = null) => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'neq', 'order', 'in', 'update']) q[m] = () => q
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error }).then(resolve)
    return q
  }
  return {
    supabase: {
      from: (table: string) => {
        if (table === 'role_outcome_answers') {
          return {
            ...chain(h.answersFail ? null : h.answered.map((id) => ({ opportunity_id: id })), h.answersFail ? { message: 'boom' } : null),
            upsert: (row: Record<string, unknown>) => { h.upserts.push(row); return Promise.resolve({ error: null }) },
          }
        }
        return chain(h.applicants)
      },
    },
  }
})
vi.mock('@/lib/roleWaiting', () => ({
  fetchTellableApplicants: () => Promise.resolve([]),
  countWaitingApplicants: () => Promise.resolve(0),
  tellWaitingApplicants: () => Promise.resolve({ told: 0, failed: 0 }),
}))
vi.mock('@/hooks/useRecruitingContext', () => ({
  useRecruitingContextStore: { getState: () => ({ roleStatusChanged: () => Promise.resolve() }) },
}))
vi.mock('@/components/FeedbackModal', () => ({ default: ({ open }: { open: boolean }) => (open ? <div data-testid="feedback-modal" /> : null) }))
vi.mock('@/lib/trackDbEvent', () => ({
  trackDbEvent: (name: string, _type?: string, id?: string, props?: Record<string, unknown>) => { h.events.push({ name, id, props }) },
}))

import { closeOutcome, nextRoleToAsk } from '@/lib/roleOutcome'
import { RoleOutcomePrompt } from '@/components/club/RoleOutcomePrompt'
import { CloseRoleSheet } from '@/components/club/CloseRoleSheet'
import { ReportProblemLink } from '@/components/ReportProblemLink'

const role = (id: string, closed_reason: string | null, closed_at: string) => ({ id, title: `Role ${id}`, position: null, opportunity_type: 'coach', closed_reason, closed_at })

beforeEach(() => {
  h.answered = []; h.answersFail = false; h.applicants = []; h.upserts = []; h.events = []
  window.sessionStorage.clear()
})

describe('which role is asked about', () => {
  it('only roles that closed on their own, unanswered, most recently closed first', () => {
    const closed = [role('a', 'expired', '2026-09-01'), role('b', 'filled', '2026-11-01'), role('c', 'expired', '2026-10-01'), role('d', 'expired', '2026-11-10')]
    expect(nextRoleToAsk(closed, new Set())?.id).toBe('d')
    expect(nextRoleToAsk(closed, new Set(['d']))?.id).toBe('c')
    expect(nextRoleToAsk(closed, new Set(['a', 'c', 'd']))).toBeNull()
    expect(nextRoleToAsk([role('b', 'filled', '2026-11-01'), role('e', 'withdrawn', '2026-11-02')], new Set())).toBeNull()
  })

  it('a manual close maps to an answer: Not filled = stopped looking, Filled asks with whom', () => {
    expect(closeOutcome('withdrawn', null)).toBe('stopped_looking')
    expect(closeOutcome('withdrawn', 'hockia')).toBe('stopped_looking')
    expect(closeOutcome('filled', 'hockia')).toBe('filled_hockia')
    expect(closeOutcome('filled', 'elsewhere')).toBe('filled_elsewhere')
    expect(closeOutcome('filled', null)).toBe('skipped')
  })
})

describe('the question after a role closed on its own', () => {
  const closed = [role('old', 'expired', '2026-09-01'), role('new', 'expired', '2026-11-10')]

  it('asks about one role, saves the answer and does not chain into the next', async () => {
    render(<RoleOutcomePrompt recruiterId="club-1" closed={closed} />)
    expect(await screen.findByTestId('role-outcome-prompt')).toHaveTextContent('Role new')
    expect(h.events.filter((e) => e.name === 'role_outcome_asked')).toEqual([{ name: 'role_outcome_asked', id: 'new', props: { via: 'expiry' } }])
    fireEvent.click(screen.getByTestId('role-outcome-still_looking'))
    await waitFor(() => expect(screen.queryByTestId('role-outcome-prompt')).not.toBeInTheDocument())
    expect(h.upserts).toHaveLength(1)
    expect(h.upserts[0]).toMatchObject({ opportunity_id: 'new', recruiter_id: 'club-1', outcome: 'still_looking', asked_via: 'expiry', hired_application_id: null })
    expect(h.events.find((e) => e.name === 'role_outcome_answered')?.props).toEqual({ via: 'expiry', outcome: 'still_looking', named_person: false })
  })

  it('"Someone from Hockia" can name the applicant; the event never carries who', async () => {
    h.applicants = [{ id: 'app-2', applicant: { full_name: 'Zoe Example' } }, { id: 'app-1', applicant: { full_name: 'Ana Example' } }, { id: 'app-3', applicant: null }]
    render(<RoleOutcomePrompt recruiterId="club-1" closed={closed} />)
    await screen.findByTestId('role-outcome-prompt')
    // Tapped at once, before the applicants have loaded: the step still appears.
    fireEvent.click(screen.getByTestId('role-outcome-filled_hockia'))
    const who = await screen.findByTestId('role-outcome-who')
    // Hidden applicants (no profile row) are not offered; names are sorted.
    expect(Array.from(who.querySelectorAll('option')).map((o) => o.textContent)).toEqual(['Prefer not to say', 'Ana Example', 'Zoe Example'])
    fireEvent.change(who, { target: { value: 'app-1' } })
    fireEvent.click(screen.getByTestId('role-outcome-save'))
    await waitFor(() => expect(h.upserts).toHaveLength(1))
    expect(h.upserts[0]).toMatchObject({ outcome: 'filled_hockia', hired_application_id: 'app-1' })
    expect(JSON.stringify(h.events)).not.toContain('app-1')
    expect(h.events.find((e) => e.name === 'role_outcome_answered')?.props).toMatchObject({ named_person: true })
  })

  it('"Not now" is recorded as skipped, so the role is not asked about again', async () => {
    render(<RoleOutcomePrompt recruiterId="club-1" closed={closed} />)
    await screen.findByTestId('role-outcome-prompt')
    fireEvent.click(screen.getByTestId('role-outcome-skip'))
    await waitFor(() => expect(h.upserts).toHaveLength(1))
    expect(h.upserts[0]).toMatchObject({ opportunity_id: 'new', outcome: 'skipped' })
  })

  it('one question per app session', async () => {
    const first = render(<RoleOutcomePrompt recruiterId="club-1" closed={closed} />)
    await screen.findByTestId('role-outcome-prompt')
    fireEvent.click(screen.getByTestId('role-outcome-stopped_looking'))
    await waitFor(() => expect(screen.queryByTestId('role-outcome-prompt')).not.toBeInTheDocument())
    first.unmount()
    h.answered = ['new']
    render(<RoleOutcomePrompt recruiterId="club-1" closed={closed} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('role-outcome-prompt')).not.toBeInTheDocument()
  })

  it('shows nothing when every expired role is answered, or when the answers cannot be read', async () => {
    h.answered = ['old', 'new']
    const a = render(<RoleOutcomePrompt recruiterId="club-1" closed={closed} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('role-outcome-prompt')).not.toBeInTheDocument()
    a.unmount()
    h.answered = []; h.answersFail = true
    render(<RoleOutcomePrompt recruiterId="club-1" closed={closed} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('role-outcome-prompt')).not.toBeInTheDocument()
  })
})

describe('closing a role by hand', () => {
  const target = { id: 'r1', club_id: 'club-1', title: 'Head coach', position: null, opportunity_type: 'coach' }

  it('Filled asks with whom and records the private answer with the close', async () => {
    h.applicants = [{ id: 'app-9', applicant: { full_name: 'Ana Example' } }]
    const onClosed = vi.fn()
    render(<CloseRoleSheet open role={target} onCancel={() => {}} onClosed={onClosed} />)
    expect(screen.queryByTestId('close-role-filled-with')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('close-role-filled'))
    expect(screen.getByTestId('close-role-filled-with')).toHaveTextContent('Only you and Hockia see this answer')
    fireEvent.click(screen.getByTestId('close-role-filled-hockia'))
    fireEvent.change(await screen.findByTestId('close-role-who'), { target: { value: 'app-9' } })
    fireEvent.click(screen.getByTestId('close-role-confirm'))
    await waitFor(() => expect(onClosed).toHaveBeenCalledWith('filled'))
    await waitFor(() => expect(h.upserts).toHaveLength(1))
    expect(h.upserts[0]).toMatchObject({ opportunity_id: 'r1', recruiter_id: 'club-1', outcome: 'filled_hockia', asked_via: 'close', hired_application_id: 'app-9' })
  })

  it('Not filled never asks with whom and records that they stopped looking', async () => {
    const onClosed = vi.fn()
    render(<CloseRoleSheet open role={target} onCancel={() => {}} onClosed={onClosed} />)
    fireEvent.click(screen.getByTestId('close-role-withdrawn'))
    expect(screen.queryByTestId('close-role-filled-with')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('close-role-confirm'))
    await waitFor(() => expect(h.upserts).toHaveLength(1))
    expect(h.upserts[0]).toMatchObject({ outcome: 'stopped_looking', hired_application_id: null })
  })

  it('Filled without saying with whom still closes, and the answer is recorded as skipped', async () => {
    const onClosed = vi.fn()
    render(<CloseRoleSheet open role={target} onCancel={() => {}} onClosed={onClosed} />)
    fireEvent.click(screen.getByTestId('close-role-filled'))
    fireEvent.click(screen.getByTestId('close-role-confirm'))
    await waitFor(() => expect(onClosed).toHaveBeenCalledWith('filled'))
    await waitFor(() => expect(h.upserts[0]).toMatchObject({ outcome: 'skipped' }))
  })
})

describe('Report a problem on recruiting screens', () => {
  it('opens the feedback form and records which screen it was opened from', async () => {
    render(<ReportProblemLink surface="applicants" />)
    expect(screen.queryByTestId('feedback-modal')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('report-problem-link'))
    expect(await screen.findByTestId('feedback-modal')).toBeInTheDocument()
    expect(h.events).toContainEqual({ name: 'report_problem_open', id: undefined, props: { surface: 'applicants' } })
  })
})
