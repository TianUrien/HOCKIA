// Copy helpers for role-description-draft ("Draft it with Hockia AI").
// Kept here, not in the function's index.ts, so the deno test suite in
// _shared covers the grammar and the no-placeholder rule.

export type Answers = {
  type?: string
  position?: string | null
  team?: string | null
  title?: string | null
  level?: string | null
  skills?: string[]
  start?: string | null
  duration?: string | null
  city?: string | null
  country?: string | null
  pay?: string | null
  package?: string[]
  euPassport?: boolean
}

export const clean = (s: unknown, max = 80) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '')
export const human = (s: string) => s.replace(/_/g, ' ')

const POSITION_WORDS: Record<string, string> = {
  strength_conditioning: 'strength & conditioning coach',
  performance_analyst: 'performance analyst',
  sports_scientist: 'sports scientist',
  other_coach: 'coach',
}

/** "midfielder", "head coach" — the role noun, lower case. */
export function roleNoun(a: Answers): string {
  const raw = clean(a.position).toLowerCase()
  if (!raw) return a.type === 'coach' ? 'coach' : 'player'
  return POSITION_WORDS[raw] ?? human(raw)
}

/** "men's team", "girls' team" — accepts the enum ("Men") or the pill label ("Men's"). */
export function teamPhrase(team: unknown): string | null {
  const t = clean(team).toLowerCase().replace(/[’']s?$/, '').replace(/[’']/g, '')
  switch (t) {
    case 'men': return 'men’s team'
    case 'women': return 'women’s team'
    case 'mixed': return 'mixed team'
    case 'boys': return 'boys’ team'
    case 'girls': return 'girls’ team'
    default: return null
  }
}

/** "a midfielder for the men's team" / "an assistant coach". */
export function lookingFor(a: Answers): string {
  const noun = roleNoun(a)
  const article = /^[aeiou]/i.test(noun) ? 'an' : 'a'
  const team = teamPhrase(a.team)
  return `${article} ${noun}${team ? ` for the ${team}` : ''}`
}

/** Never ship a bracketed prompt ("[training days]"): drop any sentence that has one. */
export function stripPlaceholders(text: string): string {
  if (!/\[[^\]]*\]/.test(text)) return text
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text]
  return sentences.filter((s) => !/\[[^\]]*\]/.test(s)).join('').replace(/\s+/g, ' ').trim()
}

export function facts(a: Answers, clubName: string, league: string | null): string[] {
  const out: string[] = []
  out.push(`Club: ${clubName}${league ? ` (${league})` : ''}`)
  out.push(`Looking for: ${lookingFor(a)}`)
  if (clean(a.title)) out.push(`Role title: ${clean(a.title, 120)}`)
  if (clean(a.level)) out.push(`Level: ${human(clean(a.level))}`)
  const skills = (a.skills ?? []).map((s) => human(clean(s))).filter(Boolean)
  if (skills.length) out.push(`Specialist skills wanted: ${skills.join(', ')}`)
  if (clean(a.start) || clean(a.duration)) out.push(`When: ${[clean(a.start) && `from ${clean(a.start)}`, clean(a.duration)].filter(Boolean).join(', ')}`)
  const place = [clean(a.city), clean(a.country)].filter(Boolean).join(', ')
  if (place) out.push(`Where: ${place}`)
  if (clean(a.pay)) out.push(`Pay: ${a.pay === 'unpaid_development' ? 'unpaid / development' : human(clean(a.pay))}`)
  const pkg = (a.package ?? []).map((s) => human(clean(s))).filter(Boolean)
  if (pkg.length) out.push(`Package: ${pkg.join(', ')}`)
  if (a.euPassport) out.push('EU passport required')
  return out
}

export function template(a: Answers, clubName: string): string {
  const place = clean(a.city) || clean(a.country)
  const lines = [`${clubName} is looking for ${lookingFor(a)}${place ? `, based in ${place}` : ''}.`]
  const when = [clean(a.start) && `from ${clean(a.start)}`, clean(a.duration) && `for ${clean(a.duration).toLowerCase()}`].filter(Boolean).join(' ')
  if (when) lines.push(`The role runs ${when}.`)
  const pkg = (a.package ?? []).map((s) => human(clean(s))).filter(Boolean)
  if (pkg.length) lines.push(`We offer ${pkg.join(', ')}.`)
  lines.push(a.type === 'coach'
    ? 'Tell us about your coaching so far and when you are available.'
    : 'Tell us about your season so far and when you are available.')
  return lines.join(' ')
}
