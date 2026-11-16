/**
 * Profile v2 rules (Figma t24oVt… page 04, spec 132:1000; founder rulings
 * 11 Oct 2026) — pure helpers shared by every role's profile.
 */

import { closesLabel } from '@/lib/opportunityCopy'
import { withLazyText } from '@/lib/opportunityLazyText'
import { tProfile } from '@/i18n/ns/profile'

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

/** Copy + where the CTA goes, per part key. The text is read in the interface language on every access. */
function step(key: string, action: NextStepAction): { title: string; subtitle: string; cta: string; action: NextStepAction } {
  return withLazyText({ action }, {
    title: () => tProfile(`profileV2.nextStep.${key}Title` as never) as string,
    subtitle: () => tProfile(`profileV2.nextStep.${key}Subtitle` as never) as string,
    cta: () => tProfile(`profileV2.nextStep.${key}Cta` as never) as string,
  })
}

export const NEXT_STEP_COPY: Record<string, { title: string; subtitle: string; cta: string; action: NextStepAction }> = {
  photo: step('photo', { kind: 'leaf', section: 'media' }),
  crest: step('crest', { kind: 'edit' }),
  logo: step('logo', { kind: 'edit' }),
  position: step('position', { kind: 'edit', field: 'position' }),
  current_club: step('currentClub', { kind: 'edit', field: 'club' }),
  league: step('league', { kind: 'edit', field: 'club' }),
  passport: step('passport', { kind: 'leaf', section: 'passports' }),
  base_location: step('baseLocation', { kind: 'edit', field: 'base' }),
  video: step('video', { kind: 'leaf', section: 'media' }),
  open_to_play: step('openToPlay', { kind: 'leaf', section: 'open-to-play' }),
  availability: step('availability', { kind: 'leaf', section: 'open-to-play' }),
  bio: step('bio', { kind: 'edit', field: 'about' }),
  career: step('career', { kind: 'leaf', section: 'journey' }),
  references: step('references', { kind: 'leaf', section: 'references' }),
  work_permit: step('workPermit', { kind: 'leaf', section: 'passports' }),
  nationality_base: step('nationalityBase', { kind: 'edit' }),
  specialization: step('specialization', { kind: 'edit' }),
  gallery: step('gallery', { kind: 'leaf', section: 'media' }),
  friends: step('friends', { kind: 'route', to: '/community' }),
  open_to_coach: step('openToCoach', { kind: 'edit' }),
  level: step('level', { kind: 'edit' }),
  federation: step('federation', { kind: 'edit' }),
  available: step('available', { kind: 'edit' }),
  appointments: step('appointments', { kind: 'edit' }),
  country: step('country', { kind: 'edit' }),
  year_founded: step('yearFounded', { kind: 'edit' }),
  contact: step('contact', { kind: 'edit' }),
  media: step('media', { kind: 'leaf', section: 'media' }),
  posts: step('posts', { kind: 'route', to: '/home' }),
  links: step('links', { kind: 'edit' }),
  ambassadors: step('ambassadors', { kind: 'route', to: '/dashboard/profile?tab=ambassadors' }),
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
  return /\b(player|athlete)$/i.test(t) ? t : tProfile('profileV2.sponsorPlayer', { brand: t })
}

/** Open-role status line: the shared deadline label (closesLabel, audit A5), else "New" (≤ 7 days old). */
export function roleStatusLine(deadline: string | null | undefined, createdAt: string | null | undefined, now = new Date()): string | null {
  const day = 86_400_000
  const closes = deadline ? closesLabel(deadline.slice(0, 10), now) : null
  if (closes) return closes
  if (createdAt && now.getTime() - new Date(createdAt).getTime() <= 7 * day) return tProfile('profileV2.roleNew')
  return null
}

export function countLabel(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}
