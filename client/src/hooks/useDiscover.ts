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
  /** Phase 3e — hockey-category fields piped through the discover_profiles RPC. */
  playing_category: string | null
  coaching_categories: string[] | null
  umpiring_categories: string[] | null
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
  // Phase 4 MVP-A — per-row scouting shortlist fields. All optional: only
  // populated when the backend's compose_shortlist pass succeeds for this
  // row. Frontend renders a fit-card when present; falls back to the legacy
  // flat row when absent.
  fit_level?: 'strong_match' | 'possible_match' | 'needs_more_info'
  fit_reasons?: string[]
  missing_data?: string[]
  next_action?: string
  // Phase 3 — rule-based Journey highlights (national-team selection, club
  // experience, references, stated achievements). Up to 4, shown in the
  // result card's expanded drawer. Absent when the profile has no Journey.
  highlights?: string[]
  // Phase 4 MVP-B — World directory club row. When result_type is
  // 'world_club', the row represents an entry from the World directory
  // (a global field-hockey club registry) rather than a claimed HOCKIA
  // profile. result_type defaults to 'profile' when absent. Claimed
  // world_clubs link to a profile via claimed_profile_id; unclaimed ones
  // navigate to the country directory page.
  result_type?: 'profile' | 'world_club'
  claimed?: boolean
  claimed_profile_id?: string | null
  league_name?: string | null
  province_name?: string | null
  country_code?: string | null
}

export interface ParsedFilters {
  roles?: string[]
  positions?: string[]
  /** @deprecated Phase 3e — superseded by target_category. The backend
   * accepts both for one cycle so a stale frontend keeps working. */
  gender?: string
  /** Phase 3e — hockey-category filter. One of adult_women, adult_men,
   * girls, boys, mixed. */
  target_category?: string
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
  | 'recommendation'        // Phase 5 — owner recruitment recommendations

export interface AppliedSearch {
  entity: 'clubs' | 'players' | 'coaches' | 'brands' | 'umpires' | null
  /** Phase 3e — primary category label. Optional so old responses without
   * the field still type-check (the chip falls back to gender_label). */
  category_label?: string | null
  /** @deprecated Phase 3e — superseded by category_label but kept on the
   * wire for one cycle for back-compat. */
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

/** Platform-help CTA — an explicit in-app destination the assistant
 *  resolved from the HOCKIA feature map. Rendered as a navigation button
 *  by CannedRedirectCard. */
export interface DiscoverCta {
  label: string
  route: string
}

/**
 * Phase 5 — one recommended applicant from the owner's own pipeline. The
 * bullets are rule-based on the backend; every line is traceable to a
 * specific data point on the applicant's profile.
 */
export interface RecommendationRow {
  applicant_id: string
  applicant_name: string | null
  applicant_role: string
  applicant_avatar_url: string | null
  opening_id: string
  opening_title: string
  opening_position: string
  /** DB triage value: pending | shortlisted | maybe. Never 'rejected' here
   *  — the ranker excludes those. */
  triage: 'pending' | 'shortlisted' | 'maybe'
  /** User-facing label shown on the Applicants screen
   *  (Unsorted / Good fit / Maybe). */
  triage_label: string
  fit_level: 'strong_match' | 'possible_match' | 'needs_more_info'
  bullets: string[]
  /** Path to the applicant's public profile — wired to the "Review
   *  applicant" CTA. */
  navigate_to: string
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
  /** Platform-help — explicit navigation CTA (canned_redirect responses). */
  cta?: DiscoverCta | null
  /** Compound multi-role search ("2 players and 1 coach") — the UI uses
   *  this to skip the collapse-to-3, so the headline count matches what's
   *  visible. */
  is_compound?: boolean
  /** Phase 5 — recommendation cards for the recruitment intent. */
  recommendations?: RecommendationRow[]
  /** Phase 5 — single-line nudge about other openings worth visiting. */
  secondary_note?: string | null
}

// ── Chat message types ──────────────────────────────────────────────────

export interface DiscoverChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  results?: DiscoverResult[]
  parsed_filters?: ParsedFilters | null
  total?: number
  /** Phase 1b — backend has further results past what's currently loaded. */
  has_more?: boolean
  /** Phase 1b — the query that produced this results message; "Show more"
   *  replays it with an offset to page in the next distinct batch. */
  search_query?: string
  /** Phase 1b — a "Show more" fetch is currently in flight for this message. */
  loading_more?: boolean
  /** Compound multi-role search — frontend suppresses the collapse-to-3
   *  so every requested role is visible. */
  is_compound?: boolean
  /** Phase 5 — recommendation cards for an owner-recruitment response. */
  recommendations?: RecommendationRow[]
  /** Phase 5 — optional nudge below the cards ("you also have N pending
   *  applicants on your Midfielder opening — want me to surface those?"). */
  secondary_note?: string | null
  timestamp: number
  status: 'sending' | 'complete' | 'error'
  error?: string

  // Phase 1A — set on assistant messages when the backend supplied them.
  kind?: ResponseKind
  applied?: AppliedSearch | null
  suggested_actions?: SuggestedAction[]
  clarifying_options?: ClarifyingOption[]
  cta?: DiscoverCta | null
}

interface HistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Collect IDs of every profile the user has already seen in this
 * conversation. Passed to nl-search as `excluded_ids` so a follow-up
 * search ("show me different players") returns genuinely new faces
 * instead of re-surfacing the first answer. Capped at 30 to keep the
 * request body small.
 */
function collectShownProfileIds(messages: DiscoverChatMessage[]): string[] {
  const ids = new Set<string>()
  for (const m of messages) {
    if (m.role !== 'assistant' || m.kind !== 'results' || !m.results) continue
    for (const r of m.results) {
      if (typeof r.id === 'string') ids.add(r.id)
    }
  }
  return Array.from(ids).slice(-30)
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
  /**
   * Phase 1b — "Show more": append the next distinct batch of results to an
   * existing results message via offset pagination. Does not touch the
   * global `isPending` flag — it drives a per-message `loading_more` state
   * so the composer and the main thread stay interactive.
   */
  loadMore: (messageId: string) => Promise<void>
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
      const excludedIds = collectShownProfileIds(get().messages)
      const { data, error } = await supabase.functions.invoke('nl-search', {
        body: { query: trimmed, history, recovery_context: recoveryContext, excluded_ids: excludedIds },
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
                has_more: result.has_more,
                search_query: trimmed,
                is_compound: result.is_compound,
                recommendations: result.recommendations,
                secondary_note: result.secondary_note,
                status: 'complete' as const,
                // Phase 1A — persist the structured envelope so the dispatcher
                // can render the right component. All optional; old rows
                // (no kind on response) fall through to text rendering.
                kind: result.kind,
                applied: result.applied,
                suggested_actions: result.suggested_actions,
                clarifying_options: result.clarifying_options,
                cta: result.cta,
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

  loadMore: async (messageId: string) => {
    if (get().isPending) return
    const msg = get().messages.find(m => m.id === messageId)
    if (!msg || msg.role !== 'assistant' || !msg.search_query || msg.loading_more) return

    // Offset = how many results are already loaded. nl-search pages past
    // them and returns a default-sized batch.
    const offset = (msg.results ?? []).length

    set(s => ({
      messages: s.messages.map(m =>
        m.id === messageId ? { ...m, loading_more: true } : m,
      ),
    }))

    const history: HistoryTurn[] = get()
      .messages.filter(m => m.status === 'complete')
      .map(m => ({ role: m.role, content: m.content }))
      .slice(-10)
    const userRole = useAuthStore.getState().profile?.role ?? null

    const excludedIds = collectShownProfileIds(get().messages)
    try {
      const { data, error } = await supabase.functions.invoke('nl-search', {
        body: {
          query: msg.search_query,
          history,
          recovery_context: { user_role: userRole },
          offset,
          excluded_ids: excludedIds,
        },
      })
      if (error) throw new Error(error.message || 'Failed to load more results')

      const result = data as DiscoverResponse
      if (!result.success) throw new Error(result.error || 'Failed to load more results')

      set(s => ({
        messages: s.messages.map(m => {
          if (m.id !== messageId) return m
          // A load-more re-parse should return another results page. If it
          // drifted (no_results / soft_error), keep the message intact and
          // just stop offering more.
          if (result.kind && result.kind !== 'results') {
            return { ...m, has_more: false, loading_more: false }
          }
          // De-dupe by id — a re-parse drift must never surface a repeat.
          const seen = new Set((m.results ?? []).map(r => r.id))
          const fresh = (result.data ?? []).filter(r => !seen.has(r.id))
          return {
            ...m,
            // Refresh the headline so its count keeps pace with the now-
            // larger list ("I found 7 players" after expanding from 5).
            content: result.ai_message || m.content,
            results: [...(m.results ?? []), ...fresh],
            total: result.total,
            has_more: result.has_more,
            loading_more: false,
          }
        }),
      }))
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      logger.error('[useDiscoverChat] loadMore error:', errMsg)
      reportSupabaseError('discovery', err, { query: msg.search_query })
      set(s => ({
        messages: s.messages.map(m =>
          m.id === messageId ? { ...m, loading_more: false } : m,
        ),
      }))
    }
  },

  clearChat: () => set({ messages: [], isPending: false }),
}))
