/**
 * Profile v2 rules (Figma t24oVt… page 04, spec 132:1000; founder rulings
 * 11 Oct 2026) — pure helpers shared by every role's profile.
 */

export interface CompletenessPart {
  key: string
  weight: number
  done: boolean
  bonus?: boolean
}

/** The photo / crest / logo part — a new profile's first step, whatever the weights. */
const FIRST_KEYS = new Set(['photo', 'crest', 'logo'])

/**
 * The ONE next step on the own profile (ruling 11 Oct): the photo / crest /
 * logo first while it's missing; otherwise the highest-weight missing part
 * (bonus parts never count as "missing").
 */
export function nextStepPart(parts: CompletenessPart[] | null | undefined): CompletenessPart | null {
  const missing = (parts ?? []).filter((p) => !p.done && !p.bonus)
  if (missing.length === 0) return null
  const first = missing.find((p) => FIRST_KEYS.has(p.key))
  if (first) return first
  return [...missing].sort((a, b) => b.weight - a.weight)[0]
}

export type NextStepAction =
  | { kind: 'edit'; field?: string }
  | { kind: 'leaf'; section: string }
  | { kind: 'route'; to: string }

/** Copy + where the CTA goes, per part key. */
export const NEXT_STEP_COPY: Record<string, { title: string; subtitle: string; cta: string; action: NextStepAction }> = {
  photo: { title: 'Add a profile photo', subtitle: 'Clubs look at photos first', cta: 'Add', action: { kind: 'leaf', section: 'media' } },
  crest: { title: 'Add your club crest', subtitle: 'Players look for it first', cta: 'Add', action: { kind: 'edit' } },
  logo: { title: 'Add your logo', subtitle: 'Athletes recognise brands by it', cta: 'Add', action: { kind: 'edit' } },
  position: { title: 'Add your position', subtitle: 'Clubs search by position', cta: 'Add', action: { kind: 'edit', field: 'position' } },
  current_club: { title: 'Add your current club', subtitle: 'Shown as “Plays at”', cta: 'Add', action: { kind: 'edit', field: 'club' } },
  league: { title: 'Add your league', subtitle: 'Clubs read the level first', cta: 'Add', action: { kind: 'edit', field: 'club' } },
  passport: { title: 'Add your passport', subtitle: 'Clubs check eligibility', cta: 'Add', action: { kind: 'leaf', section: 'passports' } },
  base_location: { title: 'Add where you’re based', subtitle: 'Clubs near you find you', cta: 'Add', action: { kind: 'edit', field: 'base' } },
  video: { title: 'Add a highlight video', subtitle: 'Show clubs how you play', cta: 'Add', action: { kind: 'leaf', section: 'media' } },
  open_to_play: { title: 'Set Open to play', subtitle: 'Clubs filter by it', cta: 'Set', action: { kind: 'leaf', section: 'open-to-play' } },
  availability: { title: 'Add when you’re available', subtitle: 'Clubs plan seasons ahead', cta: 'Add', action: { kind: 'leaf', section: 'open-to-play' } },
  bio: { title: 'Write a short bio', subtitle: 'Three lines about you', cta: 'Write', action: { kind: 'edit', field: 'about' } },
  career: { title: 'Add your first club', subtitle: 'Your career at a glance', cta: 'Add', action: { kind: 'leaf', section: 'journey' } },
  references: { title: 'Ask for a reference', subtitle: 'Friends on Hockia can write one', cta: 'Ask', action: { kind: 'leaf', section: 'references' } },
  work_permit: { title: 'Add a work permit', subtitle: 'Opens more countries', cta: 'Add', action: { kind: 'leaf', section: 'passports' } },
  nationality_base: { title: 'Add nationality and base', subtitle: 'Clubs check eligibility', cta: 'Add', action: { kind: 'edit' } },
  specialization: { title: 'Add your specialization', subtitle: 'Clubs search by it', cta: 'Add', action: { kind: 'edit' } },
  gallery: { title: 'Add photos', subtitle: 'A few action shots', cta: 'Add', action: { kind: 'leaf', section: 'media' } },
  friends: { title: 'Add your first friend', subtitle: 'Friends can write references', cta: 'Find', action: { kind: 'route', to: '/community' } },
  open_to_coach: { title: 'Set Open to coach', subtitle: 'Clubs filter by it', cta: 'Set', action: { kind: 'edit' } },
  level: { title: 'Add your umpire level', subtitle: 'Clubs and leagues look for it', cta: 'Add', action: { kind: 'edit' } },
  federation: { title: 'Add your federation', subtitle: 'Shown on your profile', cta: 'Add', action: { kind: 'edit' } },
  available: { title: 'Set Available for appointments', subtitle: 'Leagues filter by it', cta: 'Set', action: { kind: 'edit' } },
  appointments: { title: 'Add your first appointment', subtitle: 'Your officiating record', cta: 'Add', action: { kind: 'edit' } },
  country: { title: 'Add your country', subtitle: 'Shown on your profile', cta: 'Add', action: { kind: 'edit' } },
  year_founded: { title: 'Add the year founded', subtitle: 'Shown in About', cta: 'Add', action: { kind: 'edit' } },
  contact: { title: 'Add a website or email', subtitle: 'So players can reach you', cta: 'Add', action: { kind: 'edit' } },
  media: { title: 'Add club photos', subtitle: 'Players look at the club first', cta: 'Add', action: { kind: 'leaf', section: 'media' } },
  posts: { title: 'Write your first post', subtitle: 'Share club news', cta: 'Post', action: { kind: 'route', to: '/home' } },
  links: { title: 'Add your website or Instagram', subtitle: 'Where athletes find you', cta: 'Add', action: { kind: 'edit' } },
  ambassadors: { title: 'Invite your first athlete', subtitle: 'Ambassadors show on your profile', cta: 'Invite', action: { kind: 'route', to: '/dashboard/profile?tab=ambassadors' } },
}

/** Instagram handle from social_links (URL or bare handle), without the @. */
export function instagramHandle(links: unknown): string | null {
  const raw = (links && typeof links === 'object' ? (links as Record<string, unknown>).instagram : null)
  if (typeof raw !== 'string' || !raw.trim()) return null
  const v = raw.trim()
  const m = /instagram\.com\/([A-Za-z0-9._]+)/i.exec(v)
  const handle = (m ? m[1] : v).replace(/^@/, '').replace(/\/+$/, '')
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? handle : null
}

/** Sponsor match (ruling 11 Oct): case- and space-insensitive equality. */
export function sameBrandName(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/\s+/g, '')
  return Boolean(n(a)) && n(a) === n(b)
}

/** "12 profile views" style label with the right plural. */
/** Self-declared sponsor as typed; " player" only when the text doesn't already say player / athlete. */
export function sponsorLabel(text: string): string {
  const t = text.trim()
  return /\b(player|athlete)$/i.test(t) ? t : `${t} player`
}

/** Open-role status line (PR6): "Closes today" / "Closes in N days" (≤ 30), else "New" (≤ 7 days old). */
export function roleStatusLine(deadline: string | null | undefined, createdAt: string | null | undefined, now = new Date()): string | null {
  const day = 86_400_000
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  if (deadline) {
    const d = new Date(`${deadline.slice(0, 10)}T00:00:00Z`).getTime()
    const left = Math.round((d - today) / day)
    if (left === 0) return 'Closes today'
    if (left > 0 && left <= 30) return left === 1 ? 'Closes tomorrow' : `Closes in ${left} days`
  }
  if (createdAt && now.getTime() - new Date(createdAt).getTime() <= 7 * day) return 'New'
  return null
}

export function countLabel(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}
