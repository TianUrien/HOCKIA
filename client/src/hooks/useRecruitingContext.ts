/**
 * useRecruitingContext — owner-scoped CRUD for the recruiting_context
 * table, backed by a shared zustand store.
 *
 * Sprint 2 of the recruitment intelligence layer. Lets clubs (and
 * eventually coaches) explicitly anchor their Fit / carousel filter /
 * grid sort to a target without changing their profile. Solves the
 * Mixed-club case from Sprint 1.
 *
 * Architecture:
 *   The store is shared across all consumers, so 20 ClubFitChip
 *   mounts trigger ONE fetch, not 20. The store auto-fetches on the
 *   first hook call (or when viewer changes) and re-fetches after
 *   any mutation.
 *
 *   Mutations go through Postgres RPCs (set_active_recruiting_context,
 *   create_active_recruiting_context). The RPCs do the deactivate-old
 *   + activate-new swap inside a single transaction, so partial
 *   failure and multi-tab races can't leave the owner with zero
 *   active contexts (which would silently break Fit + carousel
 *   filtering).
 *
 * Visibility:
 *   - Only clubs + coaches see / use this. The store skips the
 *     network fetch entirely for other roles so a player browsing
 *     `/community` doesn't issue a wasted SELECT per render.
 *
 * RLS contract (read this if changing the hook):
 *   - The hook reads `owner_id` from `useAuthStore().profile.id`,
 *     but the RPCs and RLS policies key off `auth.uid()`. These
 *     match because HOCKIA's `profiles.id` IS the auth.users.id
 *     (set at auth.ts when the profile is created). If a future
 *     migration ever decouples them, every recruiting_context
 *     write will silently 403.
 */

import { useEffect } from 'react'
import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import type { Database } from '@/lib/database.types'

export type RecruitingContextRow = Database['public']['Tables']['recruiting_context']['Row']
export type RecruitingContextType = 'club' | 'opportunity' | 'custom'
export type RecruitingTargetCategory = 'Men' | 'Women' | 'Mixed'

export interface CreateContextInput {
  type?: RecruitingContextType
  target_category: RecruitingTargetCategory | null
  competition_id?: number | null
  region?: string | null
  opportunity_id?: string | null
  label?: string | null
}

export interface UpdateContextInput {
  target_category?: RecruitingTargetCategory | null
  competition_id?: number | null
  region?: string | null
  label?: string | null
}

export interface ActivateOpportunityContextInput {
  opportunityId: string
  target: RecruitingTargetCategory | null
  region: string | null
  label: string | null
}

export interface UseRecruitingContextResult {
  active: RecruitingContextRow | null
  available: RecruitingContextRow[]
  loading: boolean
  error: string | null
  /** Switch the active context via atomic RPC. */
  activate: (id: string) => Promise<void>
  /** Insert a new context and make it active, via atomic RPC. */
  create: (input: CreateContextInput) => Promise<RecruitingContextRow | null>
  /** Find-or-create + activate a context scoped to an opportunity.
   *  Idempotent; safe to call on every render of an opportunity-owner
   *  surface. Server-side ownership check guards against orphaned rows. */
  activateForOpportunity: (input: ActivateOpportunityContextInput) => Promise<RecruitingContextRow | null>
  /** Update fields on a context (does not change activation state).
   *  Only fields explicitly present in `input` are patched. */
  update: (id: string, input: UpdateContextInput) => Promise<void>
  /** Delete a context. If it's the active one, no other becomes active —
   *  caller decides what to do next (re-seed, etc). */
  remove: (id: string) => Promise<void>
  /** Deactivate the currently active context (no row deleted). The
   *  owner is left with zero active contexts — Community / Fit /
   *  carousel revert to "no scope applied". This is the user-facing
   *  "Clear" action: opt-out without losing the saved row. */
  clearActive: () => Promise<void>
  /** Manual refetch — used after external changes (e.g., another tab). */
  refresh: () => Promise<void>
  /** Clear the last error (call after toast dismissal). */
  clearError: () => void
}

interface RecruitingContextStoreState {
  ownerId: string | null
  /** Viewer's role; gates whether the store ever issues a fetch.
   *  null means "viewer not loaded / no role yet"; non-recruiter
   *  roles also stay null after eligibility check fails. */
  eligibleRole: 'club' | 'coach' | null
  rows: RecruitingContextRow[]
  loading: boolean
  error: string | null
  /** Set on the first fetch attempt for a given owner so consumers
   *  can avoid re-triggering it from every mount. */
  fetchedForOwner: string | null
  setViewer: (ownerId: string | null, role: string | null | undefined) => void
  /** Idempotent fetch trigger — safe to call from multiple effects in
   *  the same render commit; only the first wins. */
  ensureFetched: () => Promise<void>
  refresh: () => Promise<void>
  activate: (id: string) => Promise<void>
  clearActive: () => Promise<void>
  create: (input: CreateContextInput) => Promise<RecruitingContextRow | null>
  activateForOpportunity: (input: ActivateOpportunityContextInput) => Promise<RecruitingContextRow | null>
  update: (id: string, input: UpdateContextInput) => Promise<void>
  remove: (id: string) => Promise<void>
  clearError: () => void
}

function isEligibleRole(role: string | null | undefined): role is 'club' | 'coach' {
  return role === 'club' || role === 'coach'
}

/** Monotonic fetch token. Every doFetch call increments this and
 *  captures the value; when the network response lands, the handler
 *  compares against the latest value and discards itself if a newer
 *  fetch has been issued in the meantime. Prevents a stale
 *  ensureFetched response from overwriting a post-mutation refresh()
 *  that landed first (concurrent fetches racing back to the client).
 */
let latestFetchToken = 0

/** Shared fetch implementation used by both ensureFetched (first-mount)
 *  and refresh (forced). Writes results into the store via the
 *  injected setter so caller-specific state (loading, fetchedForOwner)
 *  is decoupled from the network call itself. Stale responses
 *  (token !== latestFetchToken) are discarded silently. */
async function doFetch(
  ownerId: string,
  set: (partial: Partial<RecruitingContextStoreState>) => void,
): Promise<void> {
  const myToken = ++latestFetchToken
  const { data, error: fetchError } = await supabase
    .from('recruiting_context')
    .select('*')
    .eq('owner_id', ownerId)
    .order('is_active', { ascending: false })
    .order('created_at', { ascending: false })
  if (myToken !== latestFetchToken) return
  if (fetchError) {
    reportSupabaseError('useRecruitingContext.fetch', fetchError)
    set({ error: 'Could not load recruiting contexts', loading: false })
    return
  }
  set({ rows: (data ?? []) as RecruitingContextRow[], loading: false })
}

/** Exported for unit tests. Production code should use the
 *  `useRecruitingContext()` / `useActiveRecruitingTarget()` hooks
 *  below — direct store access bypasses the auth-store sync. */
export const useRecruitingContextStore = create<RecruitingContextStoreState>((set, get) => ({
  ownerId: null,
  eligibleRole: null,
  rows: [],
  // Start in `loading: true` so the very first render (before the
  // ensureFetched effect runs) doesn't flash the empty-state chip
  // for clubs that DO have an auto-seeded context.
  loading: true,
  error: null,
  fetchedForOwner: null,

  setViewer: (ownerId, role) => {
    const eligibleRole = isEligibleRole(role) ? role : null
    const current = get()
    if (current.ownerId === ownerId && current.eligibleRole === eligibleRole) return
    set({
      ownerId,
      eligibleRole,
      rows: [],
      error: null,
      fetchedForOwner: null,
      // Non-eligible viewers will never trigger a fetch, so flip
      // loading off immediately to unblock UI that gates on it.
      loading: Boolean(ownerId && eligibleRole),
    })
  },

  ensureFetched: async () => {
    const { ownerId, eligibleRole, fetchedForOwner } = get()
    if (!ownerId || !eligibleRole) return
    // The synchronous claim below is what makes double-mount safe.
    // If a concurrent caller in the same render commit already
    // claimed (fetchedForOwner === ownerId), bail — the in-flight
    // fetch will populate rows.
    if (fetchedForOwner === ownerId) return
    set({ fetchedForOwner: ownerId, loading: true, error: null })
    await doFetch(ownerId, set)
  },

  refresh: async () => {
    // Force re-fetch (mutation aftermath, manual user refresh,
    // cross-tab sync). Bypasses the ensureFetched guard.
    const { ownerId, eligibleRole } = get()
    if (!ownerId || !eligibleRole) {
      set({ rows: [], loading: false, fetchedForOwner: null })
      return
    }
    set({ loading: true, error: null, fetchedForOwner: ownerId })
    await doFetch(ownerId, set)
  },

  activate: async (id) => {
    const { ownerId, eligibleRole, refresh } = get()
    if (!ownerId || !eligibleRole) return
    // Atomic RPC — deactivate-others + activate-target in one txn.
    // Failure rolls back the deactivate, so the owner is never left
    // with zero active contexts.
    const { error: rpcError } = await supabase.rpc('set_active_recruiting_context', {
      p_id: id,
    })
    if (rpcError) {
      reportSupabaseError('useRecruitingContext.activate', rpcError)
      set({ error: 'Could not switch context' })
      return
    }
    await refresh()
  },

  clearActive: async () => {
    const { ownerId, eligibleRole, refresh } = get()
    if (!ownerId || !eligibleRole) return
    // Plain UPDATE flipping is_active=false. Safe under multi-tab:
    // we only deactivate; the partial unique index allows zero
    // actives. No RPC needed because we never create or activate.
    const { error: updateError } = await supabase
      .from('recruiting_context')
      .update({ is_active: false })
      .eq('owner_id', ownerId)
      .eq('is_active', true)
    if (updateError) {
      reportSupabaseError('useRecruitingContext.clearActive', updateError)
      set({ error: 'Could not clear recruiting context' })
      return
    }
    // Optimistic local flip so the chip + sheet update immediately,
    // even if the trailing refresh() fails (e.g., transient network).
    // The server is authoritative and refresh will reconcile when it
    // succeeds; this just guarantees UI doesn't lag the user's tap.
    set((s) => ({
      rows: s.rows.map((r) => (r.is_active ? { ...r, is_active: false } : r)),
    }))
    await refresh()
  },

  create: async (input) => {
    const { ownerId, eligibleRole, refresh } = get()
    if (!ownerId || !eligibleRole) return null
    // Atomic RPC — deactivate existing actives + insert new active
    // row in one txn. Multi-tab races resolve to "last writer wins"
    // with no zero-actives state.
    const { data, error: rpcError } = await supabase.rpc(
      'create_active_recruiting_context',
      {
        p_type: input.type ?? 'custom',
        p_target_category: input.target_category as string,
        p_competition_id: (input.competition_id ?? null) as number,
        p_region: (input.region ?? null) as string,
        p_opportunity_id: (input.opportunity_id ?? null) as string,
        p_label: (input.label ?? null) as string,
      },
    )
    if (rpcError) {
      reportSupabaseError('useRecruitingContext.create', rpcError)
      set({ error: 'Could not save context' })
      return null
    }
    await refresh()
    return (data as RecruitingContextRow) ?? null
  },

  activateForOpportunity: async ({ opportunityId, target, region, label }) => {
    const { ownerId, eligibleRole, refresh } = get()
    if (!ownerId || !eligibleRole) return null
    // Atomic find-or-create + activate RPC. The server enforces
    // ownership of the opportunity and dedupes via the partial
    // unique index on (owner_id, opportunity_id).
    const { data, error: rpcError } = await supabase.rpc(
      'activate_opportunity_recruiting_context',
      {
        p_opportunity_id: opportunityId,
        p_target_category: target as string,
        p_region: (region ?? null) as string,
        p_label: (label ?? null) as string,
      },
    )
    if (rpcError) {
      reportSupabaseError('useRecruitingContext.activateForOpportunity', rpcError)
      set({ error: 'Could not scope to this opportunity' })
      return null
    }
    await refresh()
    return (data as RecruitingContextRow) ?? null
  },

  update: async (id, input) => {
    const { ownerId, eligibleRole, refresh } = get()
    if (!ownerId || !eligibleRole) return
    // Strip undefined keys so we never accidentally clobber columns
    // the caller didn't mean to touch. Null is preserved — callers
    // use null to explicitly clear a field.
    const patch: Record<string, unknown> = {}
    if ('target_category' in input) patch.target_category = input.target_category
    if ('competition_id' in input) patch.competition_id = input.competition_id
    if ('region' in input) patch.region = input.region
    if ('label' in input) patch.label = input.label
    if (Object.keys(patch).length === 0) return

    const { error: updateError } = await supabase
      .from('recruiting_context')
      .update(patch)
      .eq('owner_id', ownerId)
      .eq('id', id)
    if (updateError) {
      reportSupabaseError('useRecruitingContext.update', updateError)
      set({ error: 'Could not update context' })
      return
    }
    await refresh()
  },

  remove: async (id) => {
    const { ownerId, eligibleRole, refresh } = get()
    if (!ownerId || !eligibleRole) return
    const { error: deleteError } = await supabase
      .from('recruiting_context')
      .delete()
      .eq('owner_id', ownerId)
      .eq('id', id)
    if (deleteError) {
      reportSupabaseError('useRecruitingContext.remove', deleteError)
      set({ error: 'Could not delete context' })
      return
    }
    await refresh()
  },

  clearError: () => set({ error: null }),
}))

/**
 * Hook wrapper around the shared store. Keeps the store's viewer in
 * sync with the auth store and triggers the first fetch on mount.
 * Safe to call from many components — only the first call per owner
 * actually issues a network request.
 */
export function useRecruitingContext(): UseRecruitingContextResult {
  const { profile: viewer } = useAuthStore()
  const viewerId = viewer?.id ?? null
  const viewerRole = viewer?.role ?? null

  const rows = useRecruitingContextStore((s) => s.rows)
  const loading = useRecruitingContextStore((s) => s.loading)
  const error = useRecruitingContextStore((s) => s.error)
  const setViewer = useRecruitingContextStore((s) => s.setViewer)
  const ensureFetched = useRecruitingContextStore((s) => s.ensureFetched)
  const refresh = useRecruitingContextStore((s) => s.refresh)
  const activate = useRecruitingContextStore((s) => s.activate)
  const clearActive = useRecruitingContextStore((s) => s.clearActive)
  const createCtx = useRecruitingContextStore((s) => s.create)
  const activateForOpportunity = useRecruitingContextStore((s) => s.activateForOpportunity)
  const update = useRecruitingContextStore((s) => s.update)
  const remove = useRecruitingContextStore((s) => s.remove)
  const clearError = useRecruitingContextStore((s) => s.clearError)

  useEffect(() => {
    setViewer(viewerId, viewerRole)
  }, [viewerId, viewerRole, setViewer])

  useEffect(() => {
    void ensureFetched()
  }, [viewerId, viewerRole, ensureFetched])

  const active = rows.find((r) => r.is_active) ?? null

  return {
    active,
    available: rows,
    loading,
    error,
    activate,
    clearActive,
    create: createCtx,
    activateForOpportunity,
    update,
    remove,
    refresh,
    clearError,
  }
}

/**
 * Map an `opportunity_gender` enum value to the recruiting_context
 * target_category. Girls/Boys collapse into Women/Men respectively
 * because the Fit math's target=Women already accepts girls players
 * (and Men accepts boys). Mixed and the adult categories pass through.
 * Returns null on unknown / null input so the caller can keep the
 * context's target empty rather than guessing a wrong scope.
 */
export function opportunityGenderToTarget(
  gender: string | null | undefined,
): RecruitingTargetCategory | null {
  switch (gender) {
    case 'Men':
    case 'Boys':
      return 'Men'
    case 'Women':
    case 'Girls':
      return 'Women'
    case 'Mixed':
      return 'Mixed'
    default:
      return null
  }
}

/**
 * Lightweight selector — returns just the active target category,
 * or null when not set / not yet loaded. Used by useClubFit so the
 * Fit math can honor an explicit ContextSwitcher override without
 * pulling the full hook (which subscribes to the entire rows list
 * and would re-render every chip on any list mutation).
 *
 * Like useRecruitingContext, this triggers ensureFetched — but the
 * store's idempotent guard means concurrent calls from many
 * ClubFitChip mounts produce ONE network request, not N.
 */
export function useActiveRecruitingTarget(): RecruitingTargetCategory | null {
  const { profile: viewer } = useAuthStore()
  const viewerId = viewer?.id ?? null
  const viewerRole = viewer?.role ?? null

  const setViewer = useRecruitingContextStore((s) => s.setViewer)
  const ensureFetched = useRecruitingContextStore((s) => s.ensureFetched)
  const target = useRecruitingContextStore((s) => {
    const row = s.rows.find((r) => r.is_active)
    return (row?.target_category ?? null) as RecruitingTargetCategory | null
  })

  useEffect(() => {
    setViewer(viewerId, viewerRole)
  }, [viewerId, viewerRole, setViewer])

  useEffect(() => {
    void ensureFetched()
  }, [viewerId, viewerRole, ensureFetched])

  return target
}

/**
 * Companion to useActiveRecruitingTarget — returns the active
 * context's sought ROLE ('player' | 'coach' | … | null), derived
 * server-side from the linked opportunity's opportunity_type
 * (migration 20260529180000). NULL for club / custom contexts,
 * which are treated as player-seeking by consumers.
 *
 * Used by useClubFit to gate fit labels: Club Fit only does
 * player-fit math, so a coach-seeking context must produce NO fit
 * chip (rather than mislabel players as "Possible fit" for a coach
 * opportunity — the trust bug this fixes).
 *
 * Same shared-store subscription as useActiveRecruitingTarget, so it
 * adds no extra network fetch.
 */
export function useActiveRecruitingTargetRole(): string | null {
  const { profile: viewer } = useAuthStore()
  const viewerId = viewer?.id ?? null
  const viewerRole = viewer?.role ?? null

  const setViewer = useRecruitingContextStore((s) => s.setViewer)
  const ensureFetched = useRecruitingContextStore((s) => s.ensureFetched)
  const role = useRecruitingContextStore((s) => {
    const row = s.rows.find((r) => r.is_active)
    return (row?.target_role ?? null) as string | null
  })

  useEffect(() => {
    setViewer(viewerId, viewerRole)
  }, [viewerId, viewerRole, setViewer])

  useEffect(() => {
    void ensureFetched()
  }, [viewerId, viewerRole, ensureFetched])

  return role
}
