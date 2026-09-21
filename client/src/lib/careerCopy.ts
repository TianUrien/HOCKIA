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

export function isCurrentEntry(e: Dated): boolean {
  return e.startDate ? !e.endDate : /present|now|current/i.test(e.years ?? '')
}

export function careerSpan(e: Dated): string | null {
  const start = parts(e.startDate)
  const end = parts(e.endDate)
  if (!start) return e.years?.trim() || null
  const from = `${MONTH[start.m]} ${start.y}`
  if (!end) return `${from} – now`
  if (end.y === start.y) return end.m === start.m ? from : `${MONTH[start.m]} – ${MONTH[end.m]} ${end.y}`
  const seasons = end.y - start.y + 1
  if (seasons >= 4) return `${start.y} – ${end.y} · ${seasons} seasons`
  return `${from} – ${MONTH[end.m]} ${end.y}`
}
