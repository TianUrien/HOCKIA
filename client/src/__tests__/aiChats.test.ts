import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import {
  MAX_SAVED_MESSAGES, chatKind, chatSummary, chatTitle, forStorage, groupChats, matchesChatSearch, profileSavedSummary,
  type AiChatRow,
} from '@/lib/aiChats'
import type { DiscoverChatMessage } from '@/hooks/useDiscover'

const msg = (p: Partial<DiscoverChatMessage>): DiscoverChatMessage => ({
  id: Math.random().toString(36), role: 'assistant', content: '', timestamp: 0, status: 'complete', ...p,
})
const row = (p: Partial<AiChatRow>): AiChatRow => ({ id: 'x', kind: 'search', title: 'T', summary: null, link: null, updated_at: '2026-10-18T10:00:00Z', ...p })

describe('chat history rows', () => {
  it('titles a chat with its first question, clipped', () => {
    expect(chatTitle([msg({ role: 'user', content: '  Defender   roles in Europe ' }), msg({ content: 'x' })])).toBe('Defender roles in Europe')
    expect(chatTitle([msg({ role: 'user', content: 'a'.repeat(200) })])).toHaveLength(80)
    expect(chatTitle([])).toBe('Chat')
  })

  it('says what happened last', () => {
    expect(chatSummary([msg({ kind: 'opportunity_results', open_roles_total: 3 })])).toBe('3 roles found')
    expect(chatSummary([msg({ kind: 'opportunity_results', opportunities: [{} as never] })])).toBe('1 role found')
    expect(chatSummary([msg({ kind: 'results', total: 7, applied: { entity: 'players', gender_label: null, location_label: null, role_summary: '' } })])).toBe('7 players found')
    expect(chatSummary([msg({ kind: 'results', total: 1, applied: { entity: 'coaches', gender_label: null, location_label: null, role_summary: '' } })])).toBe('1 coach found')
    expect(chatSummary([msg({ kind: 'no_results' })])).toBe('Nothing found')
    expect(chatSummary([msg({ kind: 'text', content: 'Rules say no. More detail here.' })])).toBe('Rules say no.')
    expect(chatSummary([msg({ kind: 'text', content: 'A few quick wins:\n\n1. Photo. 2. Bio.' })])).toBe('A few quick wins')
    expect(chatSummary([msg({ role: 'user', content: 'hi' })])).toBeNull()
  })

  it('kinds: role when about a role, search when anything was searched, else question', () => {
    expect(chatKind([msg({ kind: 'text' })], true)).toBe('role')
    expect(chatKind([msg({ kind: 'text' }), msg({ kind: 'no_results' })], false)).toBe('search')
    expect(chatKind([msg({ kind: 'text' })], false)).toBe('question')
  })

  it('stores finished messages only, newest first cap, without UI flags', () => {
    const many = Array.from({ length: MAX_SAVED_MESSAGES + 5 }, (_, i) => msg({ content: String(i), loading_more: true }))
    const stored = forStorage([...many, msg({ status: 'sending' }), msg({ status: 'error' })])
    expect(stored).toHaveLength(MAX_SAVED_MESSAGES)
    expect(stored[0].content).toBe('5')
    expect(stored.every((m) => !('loading_more' in m))).toBe(true)
  })

  it('groups Today / This week / Earlier, newest first', () => {
    const now = new Date(2026, 9, 18, 15, 0)
    const at = (d: number, h = 9) => new Date(2026, 9, d, h).toISOString()
    const groups = groupChats([
      row({ id: 'old', updated_at: at(1) }),
      row({ id: 'today-early', updated_at: at(18, 8) }),
      row({ id: 'week', updated_at: at(13) }),
      row({ id: 'today-late', updated_at: at(18, 14) }),
      row({ id: 'edge', updated_at: at(11) }),
    ], now)
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ['Today', ['today-late', 'today-early']],
      ['This week', ['week']],
      ['Earlier', ['edge', 'old']],
    ])
    expect(groupChats([], now)).toEqual([])
  })

  it('searches titles and summaries', () => {
    expect(matchesChatSearch(row({ title: 'Life in Rome', summary: 'Lazio Hockey' }), 'lazio')).toBe(true)
    expect(matchesChatSearch(row({ title: 'Life in Rome' }), 'madrid')).toBe(false)
    expect(matchesChatSearch(row({}), '  ')).toBe(true)
  })

  it('names what the profile builder added', () => {
    const none = { career: 0, videos: 0, photos: 0, passports: 0, socials: 0, position: false, dob: false }
    expect(profileSavedSummary({ ...none, career: 2, videos: 1 })).toBe('Added career + video')
    expect(profileSavedSummary({ ...none, career: 1, videos: 1, photos: 2, passports: 1 })).toBe('Added career + video + photos + more')
    expect(profileSavedSummary(none)).toBe('Profile updated')
  })
})
