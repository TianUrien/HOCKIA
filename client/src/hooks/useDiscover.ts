import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export interface DiscoverResult {
  id: string
  full_name: string | null
  username: string | null
  avatar_url: string | null
  role: string
  position: string | null
  secondary_position: string | null
  gender: string | null
  age: number | null
  nationality_country_id: number | null
  nationality2_country_id: number | null
  nationality_name: string | null
  nationality2_name: string | null
  flag_emoji: string | null
  flag_emoji2: string | null
  base_location: string | null
  base_country_name: string | null
  current_club: string | null
  current_world_club_id: string | null
  open_to_play: boolean
  open_to_coach: boolean
  open_to_opportunities: boolean
  accepted_reference_count: number
  career_entry_count: number
  accepted_friend_count: number
  last_active_at: string | null
}

export interface ParsedFilters {
  roles?: string[]
  positions?: string[]
  gender?: string
  min_age?: number
  max_age?: number
  eu_passport?: boolean
  nationalities?: string[]
  locations?: string[]
  availability?: string
  min_references?: number
  min_career_entries?: number
  leagues?: string[]
  countries?: string[]
  text_query?: string
  sort_by?: string
  summary?: string
}

export interface DiscoverResponse {
  success: boolean
  data: DiscoverResult[]
  total: number
  has_more: boolean
  parsed_filters: ParsedFilters | null
  summary: string | null
  ai_message: string
  error?: string
}

// ── Chat message types ──────────────────────────────────────────────────

export interface DiscoverChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  results?: DiscoverResult[]
  parsed_filters?: ParsedFilters | null
  total?: number
  timestamp: number
  status: 'sending' | 'complete' | 'error'
  error?: string
}

interface HistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

// ── Zustand store — persists across navigation ──────────────────────────

interface DiscoverChatStore {
  messages: DiscoverChatMessage[]
  isPending: boolean
  sendMessage: (query: string) => Promise<void>
  clearChat: () => void
}

export const useDiscoverChat = create<DiscoverChatStore>((set, get) => ({
  messages: [],
  isPending: false,

  sendMessage: async (query: string) => {
    const trimmed = query.trim()
    if (!trimmed || get().isPending) return

    const userMsg: DiscoverChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
      status: 'complete',
    }

    const assistantId = crypto.randomUUID()
    const assistantPlaceholder: DiscoverChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      status: 'sending',
    }

    set(s => ({
      messages: [...s.messages, userMsg, assistantPlaceholder],
      isPending: true,
    }))

    // Build history from completed messages (last 10 turns)
    const history: HistoryTurn[] = get()
      .messages.filter(m => m.status === 'complete')
      .map(m => ({ role: m.role, content: m.content }))
      .slice(-10)

    try {
      const { data, error } = await supabase.functions.invoke('nl-search', {
        body: { query: trimmed, history },
      })

      if (error) {
        let serverMessage = ''
        if (error.context && typeof error.context.json === 'function') {
          try {
            const body = await error.context.json()
            serverMessage = body?.error || ''
          } catch { /* response body not parseable */ }
        }
        throw new Error(serverMessage || error.message || 'Search failed')
      }

      const result = data as DiscoverResponse
      if (!result.success) {
        throw new Error(result.error || 'Search failed')
      }

      set(s => ({
        messages: s.messages.map(m =>
          m.id === assistantId
            ? {
                ...m,
                content: result.ai_message,
                results: result.data,
                parsed_filters: result.parsed_filters,
                total: result.total,
                status: 'complete' as const,
              }
            : m
        ),
      }))
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      logger.error('[useDiscoverChat] Error:', errMsg)
      set(s => ({
        messages: s.messages.map(m =>
          m.id === assistantId
            ? {
                ...m,
                content: errMsg || 'Something went wrong. Please try again.',
                status: 'error' as const,
                error: errMsg,
              }
            : m
        ),
      }))
    } finally {
      set({ isPending: false })
    }
  },

  clearChat: () => set({ messages: [], isPending: false }),
}))
