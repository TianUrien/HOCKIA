// Hockia AI "Improve my bio" (next steps, 2026-10-18): two bio drafts written
// ONLY from the member's own profile facts, the first one recommended. The
// member picks one, edits it and saves; nothing is written here.
//
// Claims policy: no invented clubs, titles, stats or caps; no age, date of
// birth, gender words or contact details; no promises. First person.

export const BIO_MAX = 600
export const NOTE_MAX = 300

export type BioFocus = 'experience' | 'next' | 'style' | 'custom'
export const BIO_FOCI: BioFocus[] = ['experience', 'next', 'style', 'custom']

export const FOCUS_BRIEF: Record<BioFocus, string> = {
  experience: 'Lead with the clubs, leagues and seasons they have played or coached.',
  next: 'Lead with what they are looking for next (the kind of club, level or move), then back it with their experience.',
  style: 'Lead with how they play or coach (position, role, strengths they named), then their experience.',
  custom: 'Follow the member\'s own instruction below.',
}

export const PROFILE_BIO_SYSTEM = `You write short field hockey profile bios for Hockia, a network where players and coaches meet clubs.
Rules:
- Use ONLY the facts given. Never invent clubs, leagues, titles, caps, stats, achievements or years.
- First person ("I play…"), warm and plain. 2 to 4 sentences, under ${BIO_MAX} characters each.
- Never mention age, date of birth, gender, looks, religion, health, or contact details (email, phone, links, handles).
- No promises or superlatives ("best", "guaranteed", "world-class"). No hashtags or emojis.
- If facts are thin, keep it short and honest rather than padding.
- Write two different drafts: the first follows the focus most closely (it is the recommended one); the second takes a slightly different angle.
- The language is English unless the member's instruction asks otherwise.`

// Flat string fields: the model sometimes JSON-encodes a nested array into a
// string (seen 2026-10-18), so the tool asks for plain strings instead.
export const PROFILE_BIO_TOOL = {
  name: 'propose_bios',
  description: 'Return two bio drafts for the member to choose from.',
  input_schema: {
    type: 'object',
    properties: {
      recommended_angle: { type: 'string', description: 'Two to four words naming the first draft\'s angle, e.g. "Experience first".' },
      recommended_bio: { type: 'string', description: 'The draft that follows the focus most closely.' },
      other_angle: { type: 'string', description: 'Two to four words naming the second draft\'s angle.' },
      other_bio: { type: 'string', description: 'A second draft from a slightly different angle.' },
    },
    required: ['recommended_angle', 'recommended_bio', 'other_angle', 'other_bio'],
  },
}

export interface BioFacts {
  role: 'player' | 'coach'
  position?: string | null
  secondary_position?: string | null
  playing_category?: string | null
  coach_specialization?: string | null
  base_location?: string | null
  nationalities: string[]
  languages: string[]
  open_to: string[]
  current_bio?: string | null
  career: { club: string; league?: string | null; role?: string | null; years: string }[]
}

const label = (s?: string | null) => (s ? s.replace(/_/g, ' ') : null)

/** The facts as the model reads them; empty ones are left out. */
export function bioFactLines(f: BioFacts): string {
  const lines = [`Role: ${f.role}`]
  if (f.position) lines.push(`Position: ${label(f.position)}${f.secondary_position ? ` (also ${label(f.secondary_position)})` : ''}`)
  if (f.playing_category) lines.push(`Category: ${label(f.playing_category)}`)
  if (f.coach_specialization) lines.push(`Coaching: ${label(f.coach_specialization)}`)
  if (f.base_location) lines.push(`Based in: ${f.base_location}`)
  if (f.nationalities.length) lines.push(`Passports: ${f.nationalities.join(', ')}`)
  if (f.languages.length) lines.push(`Languages: ${f.languages.join(', ')}`)
  if (f.open_to.length) lines.push(`Open to: ${f.open_to.join(', ')}`)
  for (const c of f.career.slice(0, 8)) lines.push(`Career: ${c.club}${c.league ? `, ${c.league}` : ''}${c.role ? `, ${c.role}` : ''} (${c.years})`)
  if (f.current_bio) lines.push(`Current bio (improve it, keep what is true): """${f.current_bio.slice(0, BIO_MAX * 2)}"""`)
  return lines.join('\n')
}

// A phone number has 9+ digits; "2019-2023" (8) and season ranges are fine.
const CONTACT = /[\w.+-]+@[\w-]+\.[\w.]+|https?:\/\/|www\.|(^|\s)@\w{2,}|(?:\+?\d[\s().-]{0,2}){9,}/i
const CLAIMS = /\b(guarantee[sd]?|world[- ]class|best (player|coach) in|years? old|\d{1,2} ?(yo|y\/o))\b/i

/** Keep drafts that respect the rules; trim to length on a sentence end. */
export function validateBioDrafts(raw: unknown): { angle: string; bio: string }[] {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  // Flat fields (current tool); an older { drafts: [...] } shape is read too.
  let drafts: unknown[] = [
    { angle: o.recommended_angle, bio: o.recommended_bio },
    { angle: o.other_angle, bio: o.other_bio },
  ]
  if (Array.isArray(o.drafts)) drafts = o.drafts
  const out: { angle: string; bio: string }[] = []
  for (const d of drafts.slice(0, 2)) {
    const o = (d && typeof d === 'object' ? d : {}) as { angle?: unknown; bio?: unknown }
    let bio = typeof o.bio === 'string' ? o.bio.replace(/\s+/g, ' ').trim() : ''
    if (!bio || CONTACT.test(bio) || CLAIMS.test(bio)) continue
    if (bio.length > BIO_MAX) {
      const cut = bio.slice(0, BIO_MAX)
      const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
      bio = end > 80 ? cut.slice(0, end + 1) : `${cut.slice(0, BIO_MAX - 1).trimEnd()}…`
    }
    const angle = typeof o.angle === 'string' && o.angle.trim() ? o.angle.trim().slice(0, 40) : out.length ? 'Another angle' : 'Recommended'
    out.push({ angle, bio })
  }
  return out
}

export function yearsSpan(start?: string | null, end?: string | null): string {
  const y = (d?: string | null) => (d && /^\d{4}/.test(d) ? d.slice(0, 4) : null)
  const a = y(start), b = y(end)
  if (a && b) return a === b ? a : `${a}–${b}`
  if (a) return `${a}–present`
  return b ?? 'dates not given'
}
