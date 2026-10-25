import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { DiscoverChatMessage } from '@/hooks/useDiscover'

/**
 * Hockia AI chat history (handoff C2, Figma 180:344). One private row per
 * conversation in `hockia_ai_chats`, kept 90 days from the last message and
 * deletable one by one or all at once (ruling 2026-10-18). Actions done from
 * the sheet (application sent, profile filled) are rows of their own that
 * open an in-app link.
 */

export type AiChatKind = 'search' | 'question' | 'role' | 'apply' | 'profile'

export interface AiChatRow {
  id: string
  kind: AiChatKind
  title: string
  summary: string | null
  link: string | null
  updated_at: string
}

export interface AiChatGroup { label: 'Today' | 'This week' | 'Earlier'; rows: AiChatRow[] }

export const CHAT_RETENTION_DAYS = 90
/** Newest messages kept per chat (the table caps the size too). */
export const MAX_SAVED_MESSAGES = 40
const TITLE_MAX = 80
const SUMMARY_MAX = 60
const DAY_MS = 86_400_000

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

const ENTITY_NOUN: Record<string, [string, string]> = {
  players: ['player', 'players'],
  coaches: ['coach', 'coaches'],
  clubs: ['club', 'clubs'],
  brands: ['brand', 'brands'],
  umpires: ['umpire', 'umpires'],
}

/** The row's title: the first question asked. */
export function chatTitle(messages: DiscoverChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user' && m.content.trim())
  return first ? clip(first.content, TITLE_MAX) : 'Chat'
}

/** The row's second line: what happened last ("3 roles found", "Nothing found"). */
export function chatSummary(messages: DiscoverChatMessage[]): string | null {
  const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.status === 'complete')
  if (!last) return null
  switch (last.kind) {
    case 'results': {
      const n = last.total ?? last.results?.length ?? 0
      const [one, many] = ENTITY_NOUN[last.applied?.entity ?? ''] ?? ['result', 'results']
      return `${n} ${n === 1 ? one : many} found`
    }
    case 'opportunity_results': {
      const n = last.open_roles_total ?? last.opportunities?.length ?? 0
      return `${n} ${n === 1 ? 'opportunity' : 'opportunities'} found`
    }
    case 'no_results':
      return 'Nothing found'
    case 'recommendation': {
      const n = last.recommendations?.length ?? 0
      return `${n} ${n === 1 ? 'applicant' : 'applicants'} to look at`
    }
    case 'cap_reached':
      return 'Daily limit reached'
    default: {
      // First line, then its first sentence; "…a lot:" before a list reads "…a lot".
      const line = last.content.trim().split(/\n/)[0] ?? ''
      const sentence = (line.split(/(?<=[.!?])\s/)[0] ?? '').replace(/[:;,\s]+$/, '')
      return sentence ? clip(sentence, SUMMARY_MAX) : null
    }
  }
}

const SEARCH_KINDS = new Set(['results', 'opportunity_results', 'no_results', 'recommendation'])

export function chatKind(messages: DiscoverChatMessage[], aboutRole: boolean): AiChatKind {
  if (aboutRole) return 'role'
  return messages.some((m) => m.role === 'assistant' && m.kind && SEARCH_KINDS.has(m.kind)) ? 'search' : 'question'
}

/** What is stored: finished messages only, the newest MAX_SAVED_MESSAGES, no UI flags. */
export function forStorage(messages: DiscoverChatMessage[]): DiscoverChatMessage[] {
  return messages
    .filter((m) => m.status === 'complete')
    .slice(-MAX_SAVED_MESSAGES)
    .map((m) => {
      const copy = { ...m }
      delete copy.loading_more
      return copy
    })
}

/** Today (same local day) · This week (last 7 days) · Earlier. Newest first inside each. */
export function groupChats(rows: AiChatRow[], now = new Date()): AiChatGroup[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const groups: AiChatGroup[] = [
    { label: 'Today', rows: [] },
    { label: 'This week', rows: [] },
    { label: 'Earlier', rows: [] },
  ]
  const sorted = [...rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  for (const r of sorted) {
    const t = new Date(r.updated_at).getTime()
    groups[t >= startOfToday ? 0 : t >= startOfToday - 6 * DAY_MS ? 1 : 2].rows.push(r)
  }
  return groups.filter((g) => g.rows.length > 0)
}

export function matchesChatSearch(row: AiChatRow, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return `${row.title} ${row.summary ?? ''}`.toLowerCase().includes(needle)
}

/** "Added career + video" for the profile-builder row. */
export function profileSavedSummary(parts: { career: number; videos: number; photos: number; passports: number; socials: number; position: boolean; dob: boolean }): string {
  const named = [
    parts.career > 0 && 'career',
    parts.videos > 0 && 'video',
    parts.photos > 0 && (parts.photos === 1 ? 'photo' : 'photos'),
    parts.passports > 0 && (parts.passports === 1 ? 'passport' : 'passports'),
    parts.position && 'position',
    parts.socials > 0 && 'links',
    parts.dob && 'date of birth',
  ].filter(Boolean) as string[]
  if (!named.length) return 'Profile updated'
  return `Added ${named.slice(0, 3).join(' + ')}${named.length > 3 ? ' + more' : ''}`
}

// ── Storage ────────────────────────────────────────────────────────────────

const LIST_COLUMNS = 'id, kind, title, summary, link, updated_at'

export async function listChats(): Promise<AiChatRow[]> {
  const since = new Date(Date.now() - CHAT_RETENTION_DAYS * DAY_MS).toISOString()
  const { data, error } = await supabase
    .from('hockia_ai_chats')
    .select(LIST_COLUMNS)
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return (data ?? []) as AiChatRow[]
}

/**
 * A saved conversation, ready to show again. People cards are re-checked:
 * anyone whose profile is now hidden (blocked, frozen minor) or gone drops
 * out — profiles RLS only returns visible ones.
 */
export async function loadChat(id: string): Promise<DiscoverChatMessage[]> {
  const { data, error } = await supabase.from('hockia_ai_chats').select('messages').eq('id', id).maybeSingle()
  if (error) throw error
  const messages = (Array.isArray(data?.messages) ? data.messages : []) as unknown as DiscoverChatMessage[]
  const ids = new Set<string>()
  for (const m of messages) {
    for (const r of m.results ?? []) if (r.result_type !== 'world_club' && r.id) ids.add(r.id)
    for (const r of m.recommendations ?? []) if (r.applicant_id) ids.add(r.applicant_id)
  }
  if (!ids.size) return messages
  const { data: visible, error: vErr } = await supabase.from('profiles').select('id').in('id', [...ids])
  if (vErr) throw vErr
  const ok = new Set((visible ?? []).map((p) => p.id))
  return messages.map((m) => ({
    ...m,
    loading_more: false,
    ...(m.results ? { results: m.results.filter((r) => r.result_type === 'world_club' || ok.has(r.id)) } : {}),
    ...(m.recommendations ? { recommendations: m.recommendations.filter((r) => ok.has(r.applicant_id)) } : {}),
  }))
}

export interface ChatSave { kind: AiChatKind; title: string; summary: string | null; link?: string | null; messages: DiscoverChatMessage[] }

/** Insert (no id) or update a chat; returns its id. An id that no longer exists (deleted elsewhere) starts a new row. */
export async function saveChat(id: string | null, save: ChatSave): Promise<string> {
  const row = {
    kind: save.kind,
    title: clip(save.title, 160) || 'Chat',
    summary: save.summary ? clip(save.summary, 160) : null,
    link: save.link ?? null,
    messages: save.messages as unknown as never,
  }
  if (id) {
    const { data, error } = await supabase.from('hockia_ai_chats').update(row).eq('id', id).select('id')
    if (error) throw error
    if (data && data.length > 0) return id
  }
  const { data, error } = await supabase.from('hockia_ai_chats').insert(row).select('id').single()
  if (error) throw error
  return data.id
}

/** A row for something done from the sheet (application sent, profile filled). Never throws. */
export async function recordAiAction(action: { kind: 'apply' | 'profile'; title: string; summary: string; link: string }): Promise<void> {
  try {
    await saveChat(null, { ...action, messages: [] })
  } catch (err) {
    logger.warn('[aiChats] could not record the action', err)
  }
}

export async function deleteChat(id: string): Promise<void> {
  const { error } = await supabase.from('hockia_ai_chats').delete().eq('id', id)
  if (error) throw error
}

export async function deleteAllChats(userId: string): Promise<void> {
  const { error } = await supabase.from('hockia_ai_chats').delete().eq('user_id', userId)
  if (error) throw error
}
