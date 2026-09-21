/**
 * Feed author context — "Old Lions · Santiago del Estero" under every name.
 *
 * Founder ruling (UI redesign 2026-09-19): every feed card shows the
 * author's current club and city under their name. The feed RPC does not
 * carry those, and this redesign is UI-only, so they come from ONE batched
 * read per feed page against columns members can already SELECT on
 * `profiles` (current_club, base_city, base_location — column-level grants
 * + the "onboarded profiles" policy). Results are memoised for the session
 * so scrolling never re-asks for an author it has seen.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export interface AuthorContext {
  club: string | null
  city: string | null
}

const cache = new Map<string, AuthorContext>()
const inFlight = new Map<string, Promise<void>>()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function cityOf(row: { base_city: string | null; base_location: string | null }): string | null {
  if (row.base_city?.trim()) return row.base_city.trim()
  // base_location is free text ("Buenos Aires, Argentina") — keep the city half.
  const loc = row.base_location?.trim()
  return loc ? loc.split(',')[0].trim() || null : null
}

async function fetchMissing(ids: string[]): Promise<void> {
  const missing = ids.filter((id) => UUID_RE.test(id) && !cache.has(id) && !inFlight.has(id))
  if (missing.length === 0) return
  const p = (async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, current_club, base_city, base_location')
        .in('id', missing)
      if (error) throw error
      for (const row of data ?? []) {
        cache.set(row.id, { club: row.current_club?.trim() || null, city: cityOf(row) })
      }
      // Hidden / not-yet-onboarded authors return no row: remember the miss.
      for (const id of missing) if (!cache.has(id)) cache.set(id, { club: null, city: null })
    } catch (err) {
      logger.warn('[feedAuthorContext] lookup failed', err)
    } finally {
      for (const id of missing) inFlight.delete(id)
    }
  })()
  for (const id of missing) inFlight.set(id, p)
  await p
}

/** Load club/city for a set of author ids; returns a lookup that updates as data lands. */
export function useFeedAuthorContext(authorIds: string[]): (id: string | null | undefined) => AuthorContext | null {
  const key = useMemo(() => Array.from(new Set(authorIds)).sort().join(','), [authorIds])
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!key) return
    let cancelled = false
    void fetchMissing(key.split(',')).then(() => { if (!cancelled) setVersion((v) => v + 1) })
    return () => { cancelled = true }
  }, [key])

  return useMemo(
    () => (id) => (id ? cache.get(id) ?? null : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  )
}

export const FeedAuthorContext = createContext<(id: string | null | undefined) => AuthorContext | null>(() => null)

export function useAuthorContext(id: string | null | undefined): AuthorContext | null {
  return useContext(FeedAuthorContext)(id)
}

/** "Old Lions · Santiago del Estero" — whichever halves exist. */
export function formatAuthorContext(ctx: AuthorContext | null, role?: string | null): string | null {
  if (!ctx) return null
  // A club IS the club — show only where it is.
  const parts = role === 'club' ? [ctx.city] : [ctx.club, ctx.city]
  const s = parts.filter(Boolean).join(' · ')
  return s || null
}

/** Test-only. */
export function __resetFeedAuthorCache(): void {
  cache.clear()
  inFlight.clear()
}
