// Hockia AI · "Prepare my application" (handoff A4, Figma 175:222). A short
// note to the club drafted from the player's OWN profile facts — never
// invented, no promises, no comparisons with other applicants. The player
// edits it; nothing is sent until "Send application". Kept in _shared so the
// deno suite covers the facts and the template fallback.

import { spanishPositionLabel } from './member-language.ts'
import { withOutputLanguage, type MemberLanguage } from './ai-language.ts'

export const NOTE_MAX = 450

export interface ApplyFacts {
  firstName: string | null
  role: 'player' | 'coach'
  position: string | null
  secondary: string | null
  passports: { name: string; eu: boolean }[]
  availableFrom: string | null // "January 2027"
  currentClub: string | null
  career: { club: string; years: string | null; league: string | null }[]
  references: number
  hasVideo: boolean
}

export interface RoleFacts {
  club: string
  title: string
  position: string | null
  euRequired: boolean
  city: string | null
}

export const APPLY_NOTE_SYSTEM = [
  'You write a short application note from a field hockey player or coach to a club on Hockia.',
  'Write as the member, first person, warm and plain: 2–4 short sentences, under 400 characters.',
  'Start with "Hi <club>," using the club name given.',
  'Use ONLY the facts given about the member and the role. Never invent clubs, seasons, levels, results, dates or availability.',
  'No promises, no superlatives, no comparisons with other players, no salary talk.',
  'If the role needs an EU passport and the member has one, mention it once. Mention when they can start only if it is given.',
  'No emoji, no hashtags, no placeholders. Reply with the note only.',
  'Never use em dashes (—) in your answers; use a period, a colon, a comma or parentheses.',
].join('\n')

/** The system prompt in the member's language; English is APPLY_NOTE_SYSTEM unchanged. */
export function applyNoteSystem(lang: MemberLanguage = 'en'): string {
  if (lang !== 'es') return APPLY_NOTE_SYSTEM
  return `${withOutputLanguage(
    APPLY_NOTE_SYSTEM.replace('Start with "Hi <club>," using the club name given.', 'Start with "Hola, <club>:" using the club name given.'),
    'es',
  )}\n${APPLY_NOTE_SPANISH_RULE}`
}

/** Spanish only: the note is the member writing about themself to a club. */
const APPLY_NOTE_SPANISH_RULE = [
  '- The member writes about themself in the first person: never use a doublet for the writer ("Soy defensor/a"). Say "Juego en el arco", "Juego en la defensa", "Juego de volante", "Juego en la delantera"; a coach says "Trabajo como entrenador/a principal" (the doublet only when no other wording exists).',
  '- The note speaks to a club: "tú" forms or, when the club is clearly a group, "ustedes" ("su plantel", "les escribo") are fine. Never voseo.',
  '- Example: "Hola, Club Atlético: Juego de volante en CASI y me interesa postularme a Volante de Primera. Tengo pasaporte de la UE (Italia) y disponibilidad desde enero de 2027. Con gusto cuento más sobre mi trayectoria."',
].join('\n')

const POSITION: Record<string, string> = { goalkeeper: 'goalkeeper', defender: 'defender', midfielder: 'midfielder', forward: 'forward' }
const human = (v: string | null) => (v ? POSITION[v] ?? v.replace(/_/g, ' ') : null)

/** The facts sent to the model, one per line. */
export function factLines(m: ApplyFacts, r: RoleFacts): string[] {
  const lines = [`Club: ${r.club}`, `Role: ${r.title}${r.position ? ` (${human(r.position)})` : ''}${r.city ? `, ${r.city}` : ''}`]
  if (r.euRequired) lines.push('The role needs an EU passport.')
  lines.push(`The member is a ${m.role}.`)
  if (m.position) lines.push(`Position: ${human(m.position)}${m.secondary ? `, also ${human(m.secondary)}` : ''}`)
  if (m.currentClub) lines.push(`Current club: ${m.currentClub}`)
  for (const c of m.career.slice(0, 4)) lines.push(`Played at ${c.club}${c.years ? ` (${c.years})` : ''}${c.league ? `, ${c.league}` : ''}`)
  if (m.passports.length) lines.push(`Passports: ${m.passports.map((p) => p.name + (p.eu ? ' (EU)' : '')).join(', ')}`)
  if (m.availableFrom) lines.push(`Available from: ${m.availableFrom}`)
  if (m.references > 0) lines.push(`Has ${m.references} reference${m.references === 1 ? '' : 's'} on Hockia.`)
  if (m.hasVideo) lines.push('Has a highlights video on their profile.')
  return lines
}

/** A plain note from the same facts when the model isn't available. */
export function templateNote(m: ApplyFacts, r: RoleFacts): string {
  const parts: string[] = [`Hi ${r.club},`]
  const pos = human(m.position)
  const where = m.currentClub ?? m.career[0]?.club ?? null
  parts.push(pos ? `I’m a ${pos}${where ? ` at ${where}` : ''} and I’d like to apply for ${r.title}.` : `I’d like to apply for ${r.title}.`)
  const eu = m.passports.find((p) => p.eu)
  if (r.euRequired && eu) parts.push(`I have an EU passport (${eu.name}).`)
  if (m.availableFrom) parts.push(`I can start from ${m.availableFrom}.`)
  parts.push('Happy to share more about my hockey.')
  return parts.join(' ').slice(0, NOTE_MAX)
}

const PLAYS_ES: Record<string, string> = {
  goalkeeper: 'Juego en el arco',
  defender: 'Juego en la defensa',
  midfielder: 'Juego de volante',
  forward: 'Juego en la delantera',
}

/** The Spanish template (same facts, same shape as templateNote). */
export function templateNoteEs(m: ApplyFacts, r: RoleFacts): string {
  const parts: string[] = [`Hola, ${r.club}:`]
  const pos = m.position ? spanishPositionLabel(m.position) ?? m.position.replace(/_/g, ' ') : null
  const where = m.currentClub ?? m.career[0]?.club ?? null
  // First person without a doublet for the writer ("Juego de volante", not "Soy volante/a").
  const lead = !pos ? null
    : m.role === 'coach' ? `Trabajo como ${pos.charAt(0).toLowerCase()}${pos.slice(1)}`
      : PLAYS_ES[m.position ?? ''] ?? `Juego de ${pos.toLowerCase()}`
  parts.push(lead
    ? `${lead}${where ? ` en ${where}` : ''} y me interesa postularme a ${r.title}.`
    : `Me interesa postularme a ${r.title}.`)
  const eu = m.passports.find((p) => p.eu)
  if (r.euRequired && eu) parts.push(`Tengo pasaporte de la UE (${eu.name}).`)
  if (m.availableFrom) parts.push(`Tengo disponibilidad desde ${m.availableFrom}.`)
  parts.push('Con gusto cuento más sobre mi trayectoria.')
  return parts.join(' ').slice(0, NOTE_MAX)
}

/** templateNote in the member's language. */
export function templateNoteFor(m: ApplyFacts, r: RoleFacts, lang: MemberLanguage = 'en'): string {
  return lang === 'es' ? templateNoteEs(m, r) : templateNote(m, r)
}

/** Keep a model note only when it's a clean note: no placeholders, right length. */
export function cleanNote(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim().replace(/^"|"$/g, '')
  if (t.length < 20 || t.length > NOTE_MAX) return null
  if (/[[\]{}]|_{2,}|\bTBD\b|<[^>]+>/i.test(t)) return null
  return t
}
