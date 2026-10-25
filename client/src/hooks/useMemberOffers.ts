import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/lib/auth'
import { fetchOfferDetail, fetchOffersForMe, trackImpressionOnce, type OfferSurface } from '@/lib/memberOffers'

/** A random id for one visit of a surface (one mount): the Home card and the
 *  impressions are fixed for the visit; pull-to-refresh doesn't change them. */
export function useVisitId(): string {
  const [id] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random())))
  return id
}

/** Offers for the signed-in member, best first (server-side eligibility). */
export function useOffersForMe(limit: number, opts: { enabled?: boolean; visitId?: string } = {}) {
  const user = useAuthStore((s) => s.user)
  const role = useAuthStore((s) => s.profile?.role ?? null)
  // Brands never get offers from other brands (Phase 2 targets player, coach, club, umpire).
  const enabled = (opts.enabled ?? true) && Boolean(user) && role !== null && role !== 'brand'
  return useQuery({
    queryKey: ['member-offers', user?.id ?? 'anon', limit, opts.visitId ?? 'shared'],
    queryFn: () => fetchOffersForMe(limit),
    enabled,
    // Fixed for the visit: never refetched behind the member's back.
    staleTime: opts.visitId ? Infinity : 60_000,
    retry: false,
  })
}

export function useOfferDetail(offerId: string | undefined) {
  return useQuery({
    queryKey: ['member-offer', offerId],
    queryFn: () => fetchOfferDetail(offerId as string),
    enabled: Boolean(offerId),
    staleTime: 60_000,
    retry: false,
  })
}

/**
 * Impression = the card at least 50 % visible for 1 s (founder default
 * 2026-10-25), once per offer per visit. Returns a ref for the card.
 */
export function useOfferImpression<T extends HTMLElement>(offerId: string | null, surface: OfferSurface, visitId: string) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !offerId || typeof IntersectionObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | null = null
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          if (!timer) timer = setTimeout(() => { trackImpressionOnce(visitId, offerId, surface); io.disconnect() }, 1000)
        } else if (timer) {
          clearTimeout(timer)
          timer = null
        }
      },
      { threshold: [0, 0.5, 1] },
    )
    io.observe(el)
    return () => { io.disconnect(); if (timer) clearTimeout(timer) }
  }, [offerId, surface, visitId])
  return ref
}
