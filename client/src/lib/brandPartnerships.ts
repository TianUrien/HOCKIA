import { supabase } from '@/lib/supabase'

/**
 * Brand partnerships (Figma 08 · Brands P4; built 2026-11-07). A player opts in
 * to being found by brands; brands see candidates in the places they sell.
 * Instagram followers are declared by the player and always shown as such.
 */
export interface MyPartnership { open: boolean; open_to_other_brands: boolean; instagram_handle: string | null; instagram_followers: number | null }
export interface AmbassadorCandidate {
  profile_id: string
  full_name: string | null
  avatar_url: string | null
  player_position: string | null
  playing_category: string | null
  base_country_id: number | null
  base_city: string | null
  instagram_handle: string | null
  instagram_followers: number | null
  invited: boolean
}

export const HANDLE_RE = /^@?[A-Za-z0-9._]{1,30}$/

export async function fetchMyPartnership(): Promise<MyPartnership> {
  const { data, error } = await supabase.rpc('get_my_brand_partnership')
  if (error) throw error
  return data as unknown as MyPartnership
}

export async function saveMyPartnership(p: MyPartnership): Promise<MyPartnership> {
  const { data, error } = await supabase.rpc('set_my_brand_partnership', {
    p_open: p.open,
    p_open_to_other_brands: p.open_to_other_brands,
    p_instagram_handle: (p.instagram_handle ?? '').trim().replace(/^@/, '') || undefined,
    p_instagram_followers: p.instagram_followers ?? undefined,
  })
  if (error) throw error
  return data as unknown as MyPartnership
}

export async function fetchCandidates(countryId: number | null): Promise<AmbassadorCandidate[]> {
  const { data, error } = await supabase.rpc('get_ambassador_candidates', { p_country_id: countryId ?? undefined })
  if (error) throw error
  return (data ?? []) as AmbassadorCandidate[]
}

/** "12.4k followers (declared)" — never presented as verified. */
export function followersLabel(n: number | null | undefined): string | null {
  if (n == null) return null
  const v = n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n)
  return `${v.replace('.0', '')} followers (declared)`
}

/** The Instagram handle from the profile's social links, for the opt-in form. */
export function handleFromSocial(links: unknown): string | null {
  const ig = (links as Record<string, string> | null)?.instagram
  if (!ig) return null
  const m = ig.match(/instagram\.com\/([A-Za-z0-9._]{1,30})/i) ?? ig.match(/^@?([A-Za-z0-9._]{1,30})$/)
  return m ? m[1] : null
}
