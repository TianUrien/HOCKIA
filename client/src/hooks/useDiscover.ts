import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { useAuthStore } from '@/lib/auth'

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
  coach_specialization: string | null
  coach_specialization_custom: string | null
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
  coach_specializations?: string[]
  text_query?: string
  sort_by?: string
  summary?: string
}

// ── Phase 1A response envelope (shipped with PR-1 backend) ──────────────

export type ResponseKind =
  | 'text'                  // generic chat reply — knowledge / greeting / self-advice
  | 'results'               // search returned matches
  | 'no_results'            // search ran, returned zero
  | 'soft_error'            // transient failure — calm UI (wired in PR-3)
  | 'clarifying_question'   // medium-confidence intent (wired in PR-4)
  | 'canned_redirect'       // opportunity / product redirects

export interface AppliedSearch {
  entity: 'clubs' | 'players' | 'coaches' | 'brands' | 'umpires' | null
  gender_label: string | null
  location_label: string | null
  age?: { min?: number; max?: number }
  /** Human-readable summary the UI drops verbatim into copy. */
  role_summary: string
}

export type SuggestedActionIntent =
  | { type: 'free_text'; query: string }
  | { type: 'retry' }
  | { type: 'clear' }

export interface SuggestedAction {
  label: string
  intent: SuggestedActionIntent
}

export interface ClarifyingOption {
  label: string
  routed_query: string
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

  // Phase 1A (PR-1 backend / PR-2 frontend) — all optional, additive.
  kind?: ResponseKind
  applied?: AppliedSearch | null
  suggested_actions?: SuggestedAction[]
  clarifying_options?: ClarifyingOption[]
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

  // Phase 1A — set on assistant messages when the backend supplied them.
  kind?: ResponseKind
  applied?: AppliedSearch | null
  suggested_actions?: SuggestedAction[]
  clarifying_options?: ClarifyingOption[]
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
  /**
   * Phase 1A — submit a structured action (chip tap). Free-text intents
   * become a new user message + LLM round-trip. `retry` resubmits the most
   * recent user query. `clear` empties the chat.
   */
  submitAction: (intent: SuggestedActionIntent) => void
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

    // PR-3/PR-4 — recovery_context.
    //
    // user_role is ALWAYS included so the backend's clarifying-question
    // detector (PR-4) can pick a role-aware option set on the very first
    // turn (no prior failure required). Without this, vague queries from
    // a logged-in player get the generic "Clubs/Players/Coaches/Opportunities"
    // option set instead of the player-tailored one.
    //
    // last_kind / last_applied are only populated when the previous
    // assistant turn was a no_results or soft_error — that's what gates
    // the recovery short-circuit (LLM bypass).
    const userRole = useAuthStore.getState().profile?.role ?? null
    const lastAssistant = [...get().messages].reverse().find(m => m.role === 'assistant' && m.status === 'complete')
    const recoveryContext: {
      user_role: string | null
      last_kind?: ResponseKind
      last_applied?: AppliedSearch | null
    } = { user_role: userRole }
    if (lastAssistant?.kind === 'no_results' || lastAssistant?.kind === 'soft_error') {
      recoveryContext.last_kind = lastAssistant.kind
      recoveryContext.last_applied = lastAssistant.applied ?? null
    }

    try {
      const { data, error } = await supabase.functions.invoke('nl-search', {
        body: { query: trimmed, history, recovery_context: recoveryContext },
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
                // Phase 1A — persist the structured envelope so the dispatcher
                // can render the right component. All optional; old rows
                // (no kind on response) fall through to text rendering.
                kind: result.kind,
                applied: result.applied,
                suggested_actions: result.suggested_actions,
                clarifying_options: result.clarifying_options,
              }
            : m
        ),
      }))
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      logger.error('[useDiscoverChat] Error:', errMsg)
      reportSupabaseError('discovery', err, { query: trimmed })
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

  submitAction: (intent: SuggestedActionIntent) => {
    // Discriminated-union switch with an explicit unknown-type warning so a
    // future intent type added to the backend catalog before the frontend
    // ships an update doesn't disappear silently. Default branch logs to
    // Sentry-feeding logger so we see it in dashboards.
    switch (intent.type) {
      case 'free_text':
        get().sendMessage(intent.query)
        return
      case 'retry': {
        const lastUserMsg = [...get().messages].reverse().find(m => m.role === 'user')
        if (lastUserMsg) get().sendMessage(lastUserMsg.content)
        return
      }
      case 'clear':
        get().clearChat()
        return
      default: {
        const exhaustive: never = intent
        logger.warn('[useDiscoverChat] unknown action intent — chip will no-op', { intent: exhaustive })
        return
      }
    }
  },

  clearChat: () => set({ messages: [], isPending: false }),
}))
