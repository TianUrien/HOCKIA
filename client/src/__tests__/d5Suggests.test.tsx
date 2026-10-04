/**
 * D5 · Hockia suggests (Figma "New-Hockia" D5.1 398:83, D5.2 398:291).
 * Pure reason-template selection first (lib/suggestionReasons.ts), then the
 * payload / refine parsers, then the screens with their data hooks mocked:
 * cards (rank, fit, reasons, never amber), the Tonal Invite + Muted star,
 * the footnote, the empty state, the refine states, and the entry row on
 * the club's role.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_REASON_LINES,
  monthYear,
  suggestionReasons,
  toEvidence,
  type SuggestionEvidence,
  type SuggestionRoleContext,
} from '@/lib/suggestionReasons'
import {
  SUGGESTS_EMPTY,
  SUGGESTS_FOOTNOTE,
  parseRefineResponse,
  parseRoleSuggestions,
  refineCaption,
  suggestsEntryDetail,
  suggestsIntro,
  type RoleSuggestion,
  type RoleSuggestionsPayload,
} from '@/lib/roleSuggestions'

const NOW = new Date('2026-10-04T12:00:00Z')

const ev = (p: Partial<SuggestionEvidence> = {}): SuggestionEvidence => ({
  position_match: 'primary', position: 'midfielder', secondary_position: null, playing_category: 'adult_men',
  eu_passport: false, available_from: null, full_matches: 0, highlights: 0, league_name: null,
  league_self_reported: false, active_30d: false, career_entries: 0, references: 0, ...p,
})
const roleCtx = (p: Partial<SuggestionRoleContext> = {}): SuggestionRoleContext => ({
  position: 'midfielder', gender: 'Men', eu_passport_required: false, start_date: null, ...p,
})
const texts = (lines: { text: string }[]) => lines.map((l) => l.text)

describe('reason templates (lib/suggestionReasons)', () => {
  it('position: primary "Plays <position>", secondary "<Position> is a second position"', () => {
    expect(texts(suggestionReasons(ev(), roleCtx(), NOW))[0]).toBe('Plays midfielder')
    expect(texts(suggestionReasons(ev({ position_match: 'secondary' }), roleCtx(), NOW))[0]).toBe('Midfielder is a second position')
  })

  it('never more than 4 lines; met first, then the one most decision-relevant missing fact', () => {
    const lines = suggestionReasons(ev({ full_matches: 2, highlights: 3, league_name: 'Serie A Elite', active_30d: true, career_entries: 4, references: 2 }), roleCtx({ eu_passport_required: true }), NOW)
    expect(lines).toHaveLength(MAX_REASON_LINES)
    expect(lines.slice(0, 3).every((l) => l.kind === 'met')).toBe(true)
    expect(lines[3]).toMatchObject({ kind: 'missing', text: 'No EU passport on the profile' })
  })

  it('passport is the missing line when the role requires an EU passport', () => {
    const lines = suggestionReasons(ev({ full_matches: 1 }), roleCtx({ eu_passport_required: true }), NOW)
    expect(lines.filter((l) => l.kind === 'missing').map((l) => l.text)).toEqual(['No EU passport on the profile'])
  })

  it('start date is the missing line when the role has a start date and the passport is fine', () => {
    const lines = suggestionReasons(ev({ eu_passport: true, full_matches: 1 }), roleCtx({ eu_passport_required: true, start_date: '2027-01-15' }), NOW)
    expect(texts(lines)).toContain('EU passport')
    expect(lines.at(-1)).toMatchObject({ kind: 'missing', text: 'No start date on the profile' })
  })

  it('no full match is the default missing line; counts are pluralised', () => {
    expect(suggestionReasons(ev(), roleCtx(), NOW).at(-1)).toMatchObject({ kind: 'missing', text: 'No full match on the profile' })
    expect(texts(suggestionReasons(ev({ full_matches: 1 }), roleCtx(), NOW))).toContain('1 full match on the profile')
    expect(texts(suggestionReasons(ev({ full_matches: 6 }), roleCtx(), NOW))).toContain('6 full matches on the profile')
    const many = suggestionReasons(ev({ full_matches: 1, references: 1, career_entries: 1, position_match: null }), roleCtx({ position: null }), NOW)
    expect(texts(many)).toEqual(expect.arrayContaining(['1 reference', '1 career entry']))
  })

  it('league (self-reported labelled), availability month, highlights, active this month', () => {
    const t = texts(suggestionReasons(ev({ league_name: 'Serie A1', league_self_reported: true, available_from: '2027-01-01', highlights: 2, full_matches: 1 }), roleCtx({ start_date: '2027-01-10' }), NOW))
    expect(t).toEqual(['Plays midfielder', 'Available from January 2027', '1 full match on the profile', 'Plays in Serie A1 (self-reported)'])
    expect(texts(suggestionReasons(ev({ available_from: '2026-09-01' }), roleCtx({ start_date: '2027-01-10' }), NOW))).toContain('Available now')
    expect(texts(suggestionReasons(ev({ active_30d: true }), roleCtx(), NOW))).toContain('Active this month')
    expect(texts(suggestionReasons(ev({ highlights: 1 }), roleCtx(), NOW))).toContain('Highlights on the profile')
  })

  it('copy is gender-neutral', () => {
    const all = texts(suggestionReasons(ev({ full_matches: 2, highlights: 1, league_name: 'X', active_30d: true, references: 2, career_entries: 3, eu_passport: true }), roleCtx({ eu_passport_required: true }), NOW)).join(' ')
    expect(all).not.toMatch(/\b(he|she|his|her|him)\b/i)
  })

  it('monthYear reads a date-only string without time-zone drift', () => {
    expect(monthYear('2027-01-01')).toBe('January 2027')
    expect(monthYear('nope')).toBeNull()
  })

  it('toEvidence: missing keys are honest absence, private keys are ignored', () => {
    const e = toEvidence({ full_matches: '3', eu_passport: 'yes', date_of_birth: '2000-01-01' })
    expect(e.full_matches).toBe(0)
    expect(e.eu_passport).toBe(false)
    expect(Object.keys(e)).not.toContain('date_of_birth')
  })
})

describe('copy + parsers', () => {
  it('intro counts the players shown; entry detail hides the count at 0', () => {
    expect(suggestsIntro('Midfielder', 5)).toBe('For Midfielder. Five players who fit and haven’t applied, ranked by fit, then by what they’ve shown.')
    expect(suggestsIntro('Midfielder', 1)).toMatch(/^For Midfielder\. One player who fits/)
    expect(suggestsEntryDetail(5)).toBe('5 players')
    expect(suggestsEntryDetail(1)).toBe('1 player')
    expect(suggestsEntryDetail(0)).toBe('None yet')
    expect(refineCaption(5)).toBe('From Hockia’s 5 suggestions for this role · only facts from their profiles')
  })

  it('parseRoleSuggestions: null for non-owners, at most 5, sorted by rank', () => {
    expect(parseRoleSuggestions(null)).toBeNull()
    const rows = Array.from({ length: 7 }, (_, i) => ({ rank: 7 - i, player_id: `p${7 - i}`, fit_state: 'green', evidence: {} }))
    const out = parseRoleSuggestions({ role: { id: 'r1', title: 'T', status: 'open' }, computed_at: null, suggestions: rows })!
    expect(out.suggestions.map((s) => s.player_id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
  })

  it('parseRefineResponse keeps only ids from the pool; cap and errors map to kinds', () => {
    const ok = parseRefineResponse({ success: true, kind: 'role_suggestions_refine', ai_message: 'Two match.', match_ids: ['b', 'x', 'a', 'b'], chips: ['Include forwards'] }, ['a', 'b'])
    expect(ok).toEqual({ kind: 'answer', message: 'Two match.', matchIds: ['b', 'a'], chips: ['Include forwards'] })
    expect(parseRefineResponse({ success: true, kind: 'cap_reached', ai_message: 'Limit' }, []).kind).toBe('cap_reached')
    expect(parseRefineResponse({ success: true, kind: 'soft_error' }, []).kind).toBe('error')
    expect(parseRefineResponse(null, []).kind).toBe('error')
  })
})

// ── Screens ──────────────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  payload: null as RoleSuggestionsPayload | null,
  loading: false,
  isPhone: true,
  viewerRole: 'club',
  inList: new Set<string>(),
  add: vi.fn(),
  remove: vi.fn(),
  turns: [] as { id: string; question: string; answer: unknown }[],
  pending: false,
  ask: vi.fn(),
  pill: null as string | null,
  limitReached: false,
}))

vi.mock('@/hooks/useRoleSuggestions', () => ({
  useRoleSuggestions: () => ({
    data: state.payload,
    suggestions: state.payload?.suggestions ?? [],
    loading: state.loading,
    error: false,
    refetch: vi.fn(),
  }),
}))
vi.mock('@/hooks/useSuggestRefine', () => ({
  useSuggestRefine: () => ({ turns: state.turns, pending: state.pending, ask: state.ask }),
}))
vi.mock('@/hooks/useScouting', () => ({
  useShortlistWrites: () => ({ list: null, inList: (id: string) => state.inList.has(id), add: state.add, remove: state.remove }),
}))
vi.mock('@/hooks/useInvites', () => ({
  useClubInviteStatuses: () => ({ pillFor: () => state.pill, loading: false, declinedFor: () => [] }),
  useInviteAllowance: () => ({ limit: 20, sent: state.limitReached ? 20 : 0, reached: state.limitReached }),
}))
vi.mock('@/hooks/useCountries', () => ({
  EU_COUNTRY_CODES: new Set(['IT']),
  useCountries: () => ({ countries: [{ id: 1, name: 'Argentina', code: 'AR', flag_emoji: '🇦🇷' }, { id: 2, name: 'Italy', code: 'IT', flag_emoji: '🇮🇹' }] }),
}))
vi.mock('@/lib/auth', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'club1' }, profile: { id: 'club1', role: state.viewerRole } }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } } }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => state.isPhone }))

import HockiaSuggestsScreen from '@/components/club/HockiaSuggestsScreen'
import SuggestRefineScreen from '@/components/club/SuggestRefineScreen'
import { HockiaSuggestsEntry } from '@/pages/ClubRecruitingRoutes'

function suggestion(p: Partial<RoleSuggestion> & { player_id: string }): RoleSuggestion {
  return {
    rank: 1, full_name: p.player_id, avatar_url: null, role: 'player', position: 'midfielder', secondary_position: 'defender',
    nationality_country_id: 1, nationality2_country_id: null, fit_state: 'green', evidence: ev({ full_matches: 2, league_name: 'Serie A Elite', active_30d: true }),
    ...p,
  }
}

function payload(n: number, roleOver: Partial<RoleSuggestionsPayload['role']> = {}): RoleSuggestionsPayload {
  const names = ['Facundo Diaz', 'Leandro Cardenas', 'Mattia Amorosini', 'Santiago Puglisi', 'Mitchell Eager']
  return {
    role: { id: 'r1', title: 'Midfielder · Men’s 1st player', status: 'open', opportunity_type: 'player', position: 'midfielder', gender: 'Men', eu_passport_required: false, start_date: null, ...roleOver },
    computed_at: '2026-10-04T03:30:00Z',
    suggestions: names.slice(0, n).map((name, i) => suggestion({
      player_id: `p${i + 1}`, rank: i + 1, full_name: name, fit_state: i < 3 ? 'green' : 'yellow',
      evidence: i === 2 ? ev({ eu_passport: true, position_match: 'primary' }) : ev({ full_matches: i + 1, league_name: 'Serie A Elite', active_30d: true }),
    })),
  }
}

const renderAt = (el: React.ReactNode, path = '/dashboard/opportunities/r1/suggested', state?: unknown) => render(
  <MemoryRouter initialEntries={[{ pathname: path, state }]}>
    <Routes>
      <Route path="/dashboard/opportunities/:opportunityId/suggested" element={el} />
      <Route path="/dashboard/opportunities/:opportunityId/suggested/ask" element={<div data-testid="ask-route">ask</div>} />
      <Route path="*" element={el} />
    </Routes>
  </MemoryRouter>,
)

const noAmber = (root: HTMLElement) => {
  expect(root.innerHTML).not.toMatch(/amber|warning/i)
}

beforeEach(() => {
  state.payload = payload(5)
  state.loading = false
  state.isPhone = true
  state.viewerRole = 'club'
  state.inList = new Set(['p2'])
  state.turns = []
  state.pending = false
  state.pill = null
  state.limitReached = false
  for (const f of [state.add, state.remove, state.ask]) f.mockReset()
})

describe('D5.1 · Hockia suggests', () => {
  it('renders five cards with rank, fit badge and up to 4 reason lines — never amber', () => {
    const { container } = renderAt(<HockiaSuggestsScreen roleId="r1" />)
    expect(screen.getByRole('heading', { name: 'Hockia suggests' })).toBeTruthy()
    expect(screen.getByTestId('suggests-intro').textContent).toBe('For Midfielder · Men’s 1st player. Five players who fit and haven’t applied, ranked by fit, then by what they’ve shown.')
    const cards = screen.getAllByTestId('suggestion-card')
    expect(cards).toHaveLength(5)
    expect(screen.getAllByTestId('suggestion-rank').map((r) => r.textContent)).toEqual(['1', '2', '3', '4', '5'])
    expect(screen.getAllByText('Strong fit')).toHaveLength(3)
    expect(screen.getAllByText('Possible fit')).toHaveLength(2)
    for (const card of cards) {
      const reasons = card.querySelectorAll('[data-testid="suggestion-reason"]')
      expect(reasons.length).toBeGreaterThan(0)
      expect(reasons.length).toBeLessThanOrEqual(4)
    }
    expect(screen.getAllByText('Player · Midfielder · Defender · 🇦🇷')).toHaveLength(5)
    expect(container.querySelectorAll('[data-kind="missing"] svg.text-ink-3').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('[data-kind="met"] svg.text-positive').length).toBeGreaterThan(0)
    noAmber(container)
  })

  it('each card has a Muted star (Shortlist) and a Tonal Invite — no Primary per card', () => {
    renderAt(<HockiaSuggestsScreen roleId="r1" />)
    const first = screen.getAllByTestId('suggestion-card')[0]
    const star = first.querySelector('[data-testid="suggestion-shortlist"]') as HTMLElement
    expect(star.getAttribute('data-variant')).toBe('muted')
    const invite = first.querySelector('[data-testid="invite-button"]') as HTMLElement
    expect(invite.textContent).toBe('Invite')
    expect(invite.className).toMatch(/bg-hockia-soft/)
    expect(invite.className).not.toMatch(/bg-hockia-primary\b/)
    fireEvent.click(star)
    expect(state.add).toHaveBeenCalledWith('p1')
    // Already on the role's shortlist → tonal, tapping removes.
    const second = screen.getAllByTestId('suggestion-card')[1].querySelector('[data-testid="suggestion-shortlist"]') as HTMLElement
    expect(second.getAttribute('data-variant')).toBe('tonal')
    fireEvent.click(second)
    expect(state.remove).toHaveBeenCalledWith('p2')
  })

  it('an invited player shows the grey Invited pill instead of Invite', () => {
    state.pill = 'invited'
    renderAt(<HockiaSuggestsScreen roleId="r1" />)
    expect(screen.getAllByTestId('invite-pill-invited')).toHaveLength(5)
    expect(screen.queryByTestId('invite-button')).toBeNull()
  })

  it('shows the composer and the footnote; sending opens D5.2 with the question', () => {
    renderAt(<HockiaSuggestsScreen roleId="r1" />)
    expect(screen.getByTestId('suggests-footnote').textContent).toBe(SUGGESTS_FOOTNOTE)
    const input = screen.getByTestId('suggests-composer-input') as HTMLInputElement
    expect(input.placeholder).toBe('Ask Hockia: EU passport, start in January…')
    fireEvent.change(input, { target: { value: 'EU passport' } })
    fireEvent.click(screen.getByTestId('suggests-composer-send'))
    expect(screen.getByTestId('ask-route')).toBeTruthy()
  })

  it('fewer than five is fine', () => {
    state.payload = payload(2)
    renderAt(<HockiaSuggestsScreen roleId="r1" />)
    expect(screen.getAllByTestId('suggestion-card')).toHaveLength(2)
    expect(screen.getByTestId('suggests-intro').textContent).toMatch(/Two players who fit/)
  })

  it('empty state: neutral card, no cards', () => {
    state.payload = payload(0)
    const { container } = renderAt(<HockiaSuggestsScreen roleId="r1" />)
    expect(screen.getByTestId('suggests-empty').textContent).toBe(SUGGESTS_EMPTY)
    expect(screen.queryByTestId('suggestion-card')).toBeNull()
    noAmber(container)
  })

  it('route: phones + recruiters only; desktop goes back to the role, players to Home', () => {
    state.isPhone = false
    renderAt(<HockiaSuggestsEntry />)
    expect(screen.queryByTestId('hockia-suggests-screen')).toBeNull()
  })
})

describe('D5.2 · refine', () => {
  it('first visit: caption, composer placeholder, no answer yet', () => {
    renderAt(<SuggestRefineScreen roleId="r1" />, '/x')
    expect(screen.getByText('Hockia AI')).toBeTruthy()
    expect(screen.getByTestId('refine-intro').textContent).toBe(refineCaption(5))
    expect((screen.getByTestId('refine-composer') as HTMLInputElement).placeholder).toBe('Ask about players for this role')
  })

  it('sends the question typed on D5.1 once', () => {
    renderAt(<SuggestRefineScreen roleId="r1" />, '/x', { question: 'EU passport, start in January' })
    expect(state.ask).toHaveBeenCalledTimes(1)
    expect(state.ask).toHaveBeenCalledWith('EU passport, start in January')
  })

  it('loading shows the question bubble and "Searching"', () => {
    state.turns = [{ id: 't1', question: 'Only EU passports', answer: null }]
    renderAt(<SuggestRefineScreen roleId="r1" />, '/x')
    expect(screen.getByTestId('ai-user-bubble').textContent).toBe('Only EU passports')
    expect(screen.getByTestId('ai-searching')).toBeTruthy()
  })

  it('answer: text, matched player rows with Invite (no message button), caption and chips', () => {
    state.turns = [{ id: 't1', question: 'Only EU passports', answer: { kind: 'answer', message: 'Mattia Amorosini holds an EU passport. No start date on the profile, so ask.', matchIds: ['p3', 'p1'], chips: ['Include forwards', 'Drag flickers only'] } }]
    const { container } = renderAt(<SuggestRefineScreen roleId="r1" />, '/x')
    expect(screen.getByTestId('refine-answer').textContent).toMatch(/Mattia Amorosini holds an EU passport/)
    const rows = screen.getAllByTestId('refine-match-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toMatch(/Mattia Amorosini/)
    expect(screen.getAllByTestId('invite-button')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /^Message/ })).toBeNull()
    expect(screen.getByTestId('refine-caption').textContent).toBe('From Hockia’s 5 suggestions for this role · only facts from their profiles')
    fireEvent.click(screen.getByRole('button', { name: 'Include forwards' }))
    expect(state.ask).toHaveBeenCalledWith('Include forwards')
    noAmber(container)
  })

  it('cap reached: the neutral cap card, no chips', () => {
    state.turns = [{ id: 't1', question: 'Q', answer: { kind: 'cap_reached', message: '', matchIds: [], chips: [] } }]
    const { container } = renderAt(<SuggestRefineScreen roleId="r1" />, '/x')
    const card = screen.getByTestId('ai-notice-card')
    expect(card.getAttribute('data-tone')).toBe('neutral')
    expect(card.textContent).toBe("You've reached today's limit — try again tomorrow.")
    expect(screen.queryByTestId('ai-chip')).toBeNull()
    noAmber(container)
  })

  it('error: the neutral error card with Try again', () => {
    state.turns = [{ id: 't1', question: 'Q', answer: { kind: 'error', message: '', matchIds: [], chips: [] } }]
    renderAt(<SuggestRefineScreen roleId="r1" />, '/x')
    expect(screen.getByTestId('ai-notice-card').getAttribute('data-tone')).toBe('neutral')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(state.ask).toHaveBeenCalledWith('Q')
  })
})
