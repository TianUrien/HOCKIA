import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { fetchMarketplace, type MarketItem } from '@/lib/marketplace'

/**
 * "Get ready for <Country>" (Figma 08 · Brands P6, MK4): once per destination
 * per member, right after applying to a club in another country, and only
 * when that country has at least one Moving abroad item. Remembered on this
 * device.
 */

interface GetReadyState {
  open: boolean
  clubName: string
  countryId: number | null
  countryName: string
  items: MarketItem[]
  show: (v: { clubName: string; countryId: number; countryName: string; items: MarketItem[] }) => void
  close: () => void
}

export const useGetReady = create<GetReadyState>((set) => ({
  open: false, clubName: '', countryId: null, countryName: '', items: [],
  show: (v) => set({ open: true, ...v }),
  close: () => set({ open: false }),
}))

const seenKey = (userId: string, countryId: number) => `hockia-get-ready:${userId}:${countryId}`

/** Country id for a role's country name (roles store the name, e.g. "Germany"). */
async function countryIdByName(name: string): Promise<{ id: number; name: string } | null> {
  const { data, error } = await supabase.from('countries').select('id, name, common_name')
  if (error || !data) return null
  const want = name.trim().toLowerCase()
  const c = data.find((x) => x.name.toLowerCase() === want || (x.common_name ?? '').toLowerCase() === want)
  return c ? { id: c.id, name: c.common_name || c.name } : null
}

/**
 * Called when the "Application sent" screen closes. Returns true when the
 * sheet opened (the caller then skips other one-time asks).
 */
export async function maybeShowGetReady(o: { userId: string; baseCountryId: number | null; roleCountry: string | null; clubName: string }): Promise<boolean> {
  try {
    if (!o.roleCountry?.trim()) return false
    const dest = await countryIdByName(o.roleCountry.trim())
    if (!dest || dest.id === o.baseCountryId) return false
    try { if (localStorage.getItem(seenKey(o.userId, dest.id))) return false } catch { /* private mode */ }
    const items = (await fetchMarketplace(dest.id)).filter((i) => i.need === 'moving_abroad')
    if (items.length === 0) return false
    try { localStorage.setItem(seenKey(o.userId, dest.id), String(Date.now())) } catch { /* private mode */ }
    useGetReady.getState().show({ clubName: o.clubName, countryId: dest.id, countryName: dest.name, items: items.slice(0, 2) })
    return true
  } catch (err) {
    logger.warn('[GetReady] skipped', err)
    return false
  }
}
