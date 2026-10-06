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
  /** Quick chip "No EU passport needed": roles with eu_passport_required = false. */
  noEuPassport?: boolean
}

export const EMPTY_ROLE_FILTERS: RoleFilters = { type: 'all', position: '', gender: '', package: [], eligibleOnly: false }

export function countActiveRoleFilters(f: RoleFilters): number {
  return (f.type !== 'all' ? 1 : 0) + (f.position ? 1 : 0) + (f.gender ? 1 : 0) + f.package.length + (f.eligibleOnly ? 1 : 0) + (f.noEuPassport ? 1 : 0)
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
    if (f.noEuPassport && v.eu_passport_required) return false
    return true
  })
}

/**
 * Quick chips over the phone list (Figma 313:1417). Each maps onto the same
 * RoleFilters the sheet edits; "All" is selected while none of them is on.
 */
export type QuickChipKey = 'all' | 'women' | 'men' | 'paid' | 'housing' | 'flights' | 'no-eu-passport'
export const QUICK_CHIPS: { key: QuickChipKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'women', label: "Women's" },
  { key: 'men', label: "Men's" },
  { key: 'paid', label: 'Paid' },
  { key: 'housing', label: 'Housing' },
  { key: 'flights', label: 'Flights' },
  { key: 'no-eu-passport', label: 'No EU passport needed' },
]
const CHIP_PACKAGE: Partial<Record<QuickChipKey, PackageFilterKey>> = { paid: 'paid', housing: 'housing', flights: 'flights' }

export function isQuickChipOn(f: RoleFilters, key: QuickChipKey): boolean {
  switch (key) {
    case 'all': return !QUICK_CHIPS.some((c) => c.key !== 'all' && isQuickChipOn(f, c.key))
    case 'women': return f.gender === 'Women'
    case 'men': return f.gender === 'Men'
    case 'no-eu-passport': return f.noEuPassport === true
    default: return f.package.includes(CHIP_PACKAGE[key] as PackageFilterKey)
  }
}

export function toggleQuickChip(f: RoleFilters, key: QuickChipKey): RoleFilters {
  switch (key) {
    case 'all': {
      const chipPackages = Object.values(CHIP_PACKAGE)
      return { ...f, gender: f.gender === 'Women' || f.gender === 'Men' ? '' : f.gender, package: f.package.filter((p) => !chipPackages.includes(p)), noEuPassport: false }
    }
    case 'women': return { ...f, gender: f.gender === 'Women' ? '' : 'Women' }
    case 'men': return { ...f, gender: f.gender === 'Men' ? '' : 'Men' }
    case 'no-eu-passport': return { ...f, noEuPassport: !f.noEuPassport }
    default: {
      const pkg = CHIP_PACKAGE[key] as PackageFilterKey
      return { ...f, package: f.package.includes(pkg) ? f.package.filter((p) => p !== pkg) : [...f.package, pkg] }
    }
  }
}
