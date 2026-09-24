import { formatDurationText } from '@/lib/opportunityCopy'
import type { ClubOpenRole } from '@/hooks/useClubProfileScrollData'

/**
 * Copy rules for the phone Club profile (Figma 04 Club › Club profile —
 * own / public): the league fact row and the open-role card's second line.
 */
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function monthDay(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : `${MONTH[d.getMonth()]} ${d.getDate()}`
}

/** "Leinster Division 1A · men & women" / "Premier Division · men, Serie A1 · women". */
export function clubLeagueLine(men: string | null | undefined, women: string | null | undefined): string | null {
  const m = men?.trim() || null
  const w = women?.trim() || null
  if (m && w) return m.toLowerCase() === w.toLowerCase() ? `${m} · men & women` : `${m} · men, ${w} · women`
  if (m) return `${m} · men`
  if (w) return `${w} · women`
  return null
}

/** "Open role · from Sep 1 · 7 months" — the public card's second line. */
export function openRoleLine(role: Pick<ClubOpenRole, 'startDate' | 'durationText'>): string {
  const from = monthDay(role.startDate)
  return ['Open role', from ? `from ${from}` : null, formatDurationText(role.durationText)].filter(Boolean).join(' · ')
}

