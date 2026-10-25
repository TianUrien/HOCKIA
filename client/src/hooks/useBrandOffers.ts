import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import {
  duplicateOffer,
  fetchAdminOffers,
  fetchMyOffers,
  takeDownOffer,
  saveOffer,
  setOfferState,
  type AdminOfferTab,
  type OfferAction,
  type OfferFields,
} from '@/lib/brandOffers'

const MY_OFFERS = ['brand-offers', 'mine'] as const
const ADMIN_OFFERS = ['brand-offers', 'admin'] as const

/** The signed-in brand's offers with their distinct-member counts (Phase 1). */
export function useMyBrandOffers(enabled = true) {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: MY_OFFERS, queryFn: fetchMyOffers, enabled, staleTime: 30_000 })
  const invalidate = () => qc.invalidateQueries({ queryKey: MY_OFFERS })

  const save = useMutation({
    mutationFn: (v: { id: string | null; fields: OfferFields; submit: boolean }) => saveOffer(v.id, v.fields, v.submit),
    onSettled: invalidate,
  })
  const setState = useMutation({
    mutationFn: (v: { id: string; action: OfferAction }) => setOfferState(v.id, v.action),
    onSettled: invalidate,
  })
  const duplicate = useMutation({ mutationFn: (id: string) => duplicateOffer(id), onSettled: invalidate })

  return { ...query, offers: query.data ?? [], save, setState, duplicate }
}

/** Admin moderation: live offers or the ones taken down, one tab at a time. */
export function useAdminBrandOffers(tab: AdminOfferTab) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: [...ADMIN_OFFERS, tab], queryFn: () => fetchAdminOffers(tab), staleTime: 15_000 })
  const takeDown = useMutation({
    mutationFn: (v: { id: string; reason: string }) => takeDownOffer(v.id, v.reason),
    onSettled: () => qc.invalidateQueries({ queryKey: ADMIN_OFFERS }),
  })
  return { ...list, offers: list.data ?? [], takeDown }
}

/** Counts for the admin tabs. */
export function useAdminBrandOfferCounts() {
  const tabs: AdminOfferTab[] = ['live', 'not_approved']
  const q = useQuery({
    queryKey: [...ADMIN_OFFERS, 'counts'],
    queryFn: async () => {
      const lists = await Promise.all(tabs.map((t) => fetchAdminOffers(t)))
      return { live: lists[0].length, not_approved: lists[1].length } as Record<AdminOfferTab, number>
    },
    staleTime: 30_000,
  })
  return q.data ?? { live: 0, not_approved: 0 }
}

export interface OfferTotals { shown: number; opened: number; contacted: number }

/** Last-30-days totals across the brand's offers (distinct members; B0b tiles).
 *  null when unknown: the card then shows no tiles rather than a guess. */
export function useMyBrandOfferTotals(enabled: boolean): OfferTotals | null {
  const q = useQuery({
    queryKey: ['brand-offers', 'totals', 30],
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<OfferTotals | null> => {
      const { data, error } = await supabase.rpc('get_my_brand_offer_totals', { p_days: 30 })
      if (error) {
        logger.warn('[useMyBrandOfferTotals] unavailable', error)
        return null
      }
      const row = (Array.isArray(data) ? data[0] : data) as OfferTotals | undefined
      return row ? { shown: row.shown ?? 0, opened: row.opened ?? 0, contacted: row.contacted ?? 0 } : null
    },
  })
  return q.data ?? null
}
