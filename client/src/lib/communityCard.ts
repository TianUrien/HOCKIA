/**
 * Community photo-first cards + preview (Figma "New Hockia 2 · Draft",
 * Community production handoff v1, section 19:191, spec 26:1020). Pure
 * helpers so the grid card, the club card and the preview read the same
 * words for the same member.
 */
import { brandCategoryLabel, coachSpecialtyLabel, positionLabel } from '@/lib/identity'

export type CommunityRole = 'player' | 'coach' | 'club' | 'brand' | 'umpire'

/** Fields the helpers read — a structural subset of the Community row. */
export interface CardMember {
  id: string
  full_name: string | null
  role: CommunityRole
  avatar_url: string | null
  position?: string | null
  secondary_position?: string | null
  playing_category?: string | null
  coaching_categories?: string[] | null
  coach_specialization?: string | null
  coach_specialization_custom?: string | null
  umpire_level?: string | null
  brand_category?: string | null
  brand_logo_url?: string | null
  current_club?: string | null
  base_location?: string | null
  base_country_id?: number | null
  nationality_country_id?: number | null
  nationality2_country_id?: number | null
  available_from?: string | null
  open_to_play?: boolean | null
  open_to_coach?: boolean | null
  year_founded?: number | null
}

/** The team a player plays in, as the card says it ("Men’s", "Women’s"). */
const TEAM_LABEL: Record<string, string> = {
  adult_men: 'Men’s',
  adult_women: 'Women’s',
  mixed: 'Mixed',
  girls: 'Girls',
  boys: 'Boys',
}

export function teamLabel(category: string | null | undefined): string | null {
  return category ? TEAM_LABEL[category] ?? null : null
}

/**
 * Card line 2: "Midfielder · Men’s", "Coach · Head coach",
 * "Umpire · FIH Level 2", "Brand · Equipment". Never empty.
 */
export function cardRoleLine(m: CardMember): string {
  switch (m.role) {
    case 'player': {
      const parts = [positionLabel(m.position) ?? 'Player', teamLabel(m.playing_category)].filter(Boolean)
      return parts.join(' · ')
    }
    case 'coach': {
      const spec = coachSpecialtyLabel(m.coach_specialization ?? null, m.coach_specialization_custom ?? null)
      return spec && spec !== 'Coach' ? `Coach · ${spec}` : 'Coach'
    }
    case 'umpire':
      return m.umpire_level?.trim() ? `Umpire · ${m.umpire_level.trim()}` : 'Umpire'
    case 'brand': {
      const cat = brandCategoryLabel(m.brand_category ?? null)
      return cat ? `Brand · ${cat}` : 'Brand'
    }
    default:
      return 'Club'
  }
}

/** The city part of a free-text location ("Buenos Aires, Argentina" → "Buenos Aires"). */
export function cityOf(location: string | null | undefined): string | null {
  const city = location?.split(',')[0]?.trim()
  return city ? city : null
}

/**
 * Card line 3: "22 · 🇦🇷 Buenos Aires". The age is the server age (hidden when
 * unknown); the flag is the country the member is based in; either half can
 * be missing. Null when there is nothing to say.
 */
export function cardPlaceLine(age: number | null | undefined, flag: string | null | undefined, location: string | null | undefined): string | null {
  const place = [flag || null, cityOf(location)].filter(Boolean).join(' ')
  const parts = [typeof age === 'number' ? String(age) : null, place || null].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** Up to two initials for the no-photo monogram. */
export function initialsOf(name: string | null | undefined): string {
  // Words that carry a letter, first letter of each ("[QA] Safe Area" → QA,
  // "QA Test Club 03" → QC): brackets and numbers never become initials.
  const words = (name ?? '').split(/\s+/).map((w) => w.match(/\p{L}/u)?.[0]).filter((c): c is string => Boolean(c))
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words.slice(0, 1)
  return letters.join('').toUpperCase() || '?'
}

/**
 * No-photo background per role (Figma Card / Member photo, Kind=No photo):
 * the role colour, lighter top-left to darker bottom-right. Players blue,
 * coaches teal, umpires grey; brands use the brand role ink.
 */
const ROLE_GRADIENT: Record<CommunityRole, [string, string]> = {
  player: ['rgb(59, 111, 224)', 'rgb(22, 53, 122)'],
  coach: ['rgb(20, 137, 127)', 'rgb(10, 61, 57)'],
  umpire: ['rgb(91, 91, 107)', 'rgb(37, 37, 46)'],
  brand: ['rgb(190, 18, 60)', 'rgb(95, 9, 30)'],
  club: ['rgb(108, 43, 217)', 'rgb(52, 18, 120)'],
}

export function roleGradient(role: CommunityRole): string {
  const [from, to] = ROLE_GRADIENT[role] ?? ROLE_GRADIENT.player
  return `linear-gradient(127deg, ${from} 0%, ${to} 71.4%)`
}

/** The preview's no-photo area uses the same colours on the taller frame. */
export function rolePreviewGradient(role: CommunityRole): string {
  const [from, to] = ROLE_GRADIENT[role] ?? ROLE_GRADIENT.player
  return `linear-gradient(180deg, rgba(15, 15, 20, 0) 55%, rgba(15, 15, 20, 0.7) 100%), linear-gradient(135deg, ${from} 14%, ${to} 86%)`
}

/**
 * Club card variant (Figma Card / Club wide 12:41): a cover photo wins; else
 * the crest on its colour ("Cover=Crest"); else the brand gradient with a
 * monogram ("Cover=None").
 */
export type ClubCover = 'photo' | 'crest' | 'none'

export function clubCover(coverUrl: string | null | undefined, crestUrl: string | null | undefined): ClubCover {
  if (coverUrl) return 'photo'
  if (crestUrl) return 'crest'
  return 'none'
}

/** Brand gradient for Cover=None, and the stand-in for a crest without a stored colour. */
export const CLUB_BRAND_GRADIENT = 'linear-gradient(152deg, rgb(108, 43, 217) 7%, rgb(52, 18, 120) 79%)'

/** "rgb(r, g, b)" → the Cover=Crest gradient (crest colour, darkened towards the bottom right). */
export function crestGradient(hex: string | null | undefined): string {
  const rgb = parseHex(hex)
  if (!rgb) return CLUB_BRAND_GRADIENT
  const dark = rgb.map((v) => Math.round(v * 0.38))
  return `linear-gradient(180deg, rgba(0, 0, 0, 0) 50%, rgba(0, 0, 0, 0.35) 100%), linear-gradient(152deg, rgb(${rgb.join(', ')}) 7%, rgb(${dark.join(', ')}) 79%)`
}

function parseHex(hex: string | null | undefined): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex?.trim() ?? '')
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Club card meta: "Recruiting · Defender, Forward" while the club has an
 * open role (no counts — players never see counts), else
 * "Serie A Elite · 🇮🇹 Rome, Italy" (league · flag place).
 */
export function clubMetaLine(opts: {
  recruiting: boolean
  positions: string[]
  league: string | null
  flag: string | null
  location: string | null
}): string {
  if (opts.recruiting) {
    const roles = opts.positions.map((p) => (p === 'coach' ? 'Coach' : positionLabel(p) ?? p)).filter(Boolean)
    const unique = [...new Set(roles)]
    return unique.length > 0 ? `Recruiting · ${unique.join(', ')}` : 'Recruiting'
  }
  const place = [opts.flag, opts.location?.trim() || null].filter(Boolean).join(' ')
  return [opts.league, place || null].filter(Boolean).join(' · ') || 'Club'
}

/**
 * "Available" fact (players and coaches, visible to everyone — founder ruling
 * 2026-10-11): "Now" when open and no later date, "From Jan" for a future
 * date in the next twelve months, "From Jan 2028" beyond that; null when
 * the member hasn't said they're open.
 */
export function availableLabel(m: CardMember, now = new Date()): string | null {
  const open = m.role === 'coach' ? m.open_to_coach : m.open_to_play
  if (!open) return null
  const from = m.available_from ? new Date(m.available_from) : null
  if (!from || Number.isNaN(from.getTime()) || from <= now) return 'Now'
  const month = from.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
  const withinYear = from.getTime() - now.getTime() < 330 * 24 * 3600 * 1000
  return withinYear ? `From ${month}` : `From ${month} ${from.getUTCFullYear()}`
}

/** "Friends since Sep 2026". */
export function friendsSinceLabel(acceptedAt: string | null | undefined): string | null {
  if (!acceptedAt) return null
  const d = new Date(acceptedAt)
  if (Number.isNaN(d.getTime())) return null
  return `Friends since ${d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`
}

/** "3 friends in common" / "1 friend in common". */
export function inCommonCountLabel(n: number): string | null {
  if (n <= 0) return null
  return n === 1 ? '1 friend in common' : `${n} friends in common`
}

/** "3 of your friends play here" / "1 of your friends plays here". */
export function friendsHereLabel(n: number): string | null {
  if (n <= 0) return null
  return n === 1 ? '1 of your friends plays here' : `${n} of your friends play here`
}
