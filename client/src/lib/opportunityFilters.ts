import type { Vacancy } from '@/lib/supabase'
import { isPaid, type PackageFilterKey } from '@/lib/opportunityCopy'

/** Filters sheet state (Figma Opportunities — Filters). */
export interface RoleFilters {
  type: 'all' | 'player' | 'coach'
  position: string
  gender: string
  package: PackageFilterKey[]
  /** "Only roles my passports qualify for" — hides EU-only roles from non-EU players. */
  eligibleOnly: boolean
}

export const EMPTY_ROLE_FILTERS: RoleFilters = { type: 'all', position: '', gender: '', package: [], eligibleOnly: false }

export function countActiveRoleFilters(f: RoleFilters): number {
  return (f.type !== 'all' ? 1 : 0) + (f.position ? 1 : 0) + (f.gender ? 1 : 0) + f.package.length + (f.eligibleOnly ? 1 : 0)
}

export function applyRoleFilters(list: Vacancy[], f: RoleFilters, viewerIsEuEligible: boolean): Vacancy[] {
  return list.filter((v) => {
    if (f.type !== 'all' && v.opportunity_type !== f.type) return false
    if (f.position && v.position !== f.position) return false
    if (f.gender && v.gender !== f.gender) return false
    if (f.package.length > 0) {
      const benefits = (v.benefits ?? []).map((b) => b.toLowerCase())
      for (const key of f.package) {
        if (key === 'paid' ? !isPaid(v) : !benefits.includes(key)) return false
      }
    }
    if (f.eligibleOnly && v.eu_passport_required && !viewerIsEuEligible) return false
    return true
  })
}
