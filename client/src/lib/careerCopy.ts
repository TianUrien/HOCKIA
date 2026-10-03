/**
 * Career timeline copy (Figma Career — own / public, Profile › Career):
 *   "Jul 2025 – now" · "Jan – May 2025" · "2007 – 2024 · 18 seasons"
 * Legacy rows carry only a free-text `years` ("2020 - 2022") and no dates;
 * those are shown as written and are current only when the text says so.
 */
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

type Dated = { startDate: string | null; endDate: string | null; years: string | null }

function parts(iso: string | null): { m: number; y: number } | null {
  if (!iso) return null
  const match = /^(\d{4})-(\d{2})/.exec(iso)
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]) - 1 }
}

/** A YYYY-MM-DD start that is after today (local calendar day). */
export function startsLater(startDate: string | null, now = new Date()): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startDate ?? '')
  if (!m) return false
  const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return start.getTime() > today.getTime()
}

/**
 * Current = started and not ended. A signing confirmed before its start
 * date (founder ruling 2 Oct: "From Nov 2026" until then) is not current
 * yet: the "Now" badge switches on the start date, not at confirmation.
 */
export function isCurrentEntry(e: Dated, now = new Date()): boolean {
  return e.startDate ? !e.endDate && !startsLater(e.startDate, now) : /present|now|current/i.test(e.years ?? '')
}

export function careerSpan(e: Dated, now = new Date()): string | null {
  const start = parts(e.startDate)
  const end = parts(e.endDate)
  if (!start) return e.years?.trim() || null
  const from = `${MONTH[start.m]} ${start.y}`
  if (!end && startsLater(e.startDate, now)) return `From ${from}`
  if (!end) return `${from} – now`
  if (end.y === start.y) return end.m === start.m ? from : `${MONTH[start.m]} – ${MONTH[end.m]} ${end.y}`
  const seasons = end.y - start.y + 1
  if (seasons >= 4) return `${start.y} – ${end.y} · ${seasons} seasons`
  return `${from} – ${MONTH[end.m]} ${end.y}`
}

/**
 * The flag beside a career entry's place: the entry's own country
 * (career_history.location_country — for a signing, the role's country, the
 * one the club's pages show) before the linked world club's country, which
 * can disagree with the club profile (QA 2 Oct: an Australian flag beside
 * "Manchester"). Name or common name, case-insensitive; null when unknown.
 */
export function flagForCountryName(
  countries: ReadonlyArray<{ name: string; common_name: string | null; flag_emoji: string | null }>,
  name: string | null | undefined,
): string | null {
  const key = name?.trim().toLowerCase()
  if (!key) return null
  const hit = countries.find((c) => c.name.toLowerCase() === key || c.common_name?.toLowerCase() === key)
  return hit?.flag_emoji ?? null
}
