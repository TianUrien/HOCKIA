/**
 * International / representative experience — the shared vocabulary.
 *
 * ONE place read by all three stages (intent router, filter binding,
 * retrieval + composer labels) so the taxonomy can never drift between
 * them. Adding a tournament or a language is a data change in this file,
 * not a code change elsewhere.
 *
 * Design doc: docs/ai/INTERNATIONAL_EXPERIENCE_DESIGN.md
 * Born from the 2026-07-23 incident where "players who played in the
 * Argentina national team" was answered with a passport filter.
 *
 * Pure functions, no Deno globals — unit-testable like intent-router.ts.
 */

// ── Tournament / competition taxonomy ───────────────────────────────────

export interface TournamentDef {
  /** Canonical key. Stable — logged to discovery_events. */
  key: string
  /** Currency hierarchy: 1 Olympics … 7 elite domestic league. */
  tier: number
  aliases_en: string[]
  aliases_es: string[]
  /** Some competitions imply a level (Junior World Cup → junior). */
  level_hint?: 'senior' | 'junior'
}

export const TOURNAMENTS: TournamentDef[] = [
  { key: 'olympics', tier: 1, aliases_en: ['olympics', 'olympic games', 'olympian', 'olympic experience', 'olympic qualifier'], aliases_es: ['juegos olímpicos', 'juegos olimpicos', 'olímpicos', 'olimpicos', 'olimpiadas', 'olímpiadas'] },
  { key: 'world_cup', tier: 2, aliases_en: ['world cup'], aliases_es: ['mundial', 'copa del mundo'] },
  { key: 'junior_world_cup', tier: 5, level_hint: 'junior', aliases_en: ['junior world cup', 'u21 world cup', 'u-21 world cup'], aliases_es: ['mundial junior', 'mundial juvenil'] },
  { key: 'eurohockey', tier: 3, aliases_en: ['eurohockey', 'euro hockey', 'european championship', 'the euro'], aliases_es: ['campeonato europeo', 'la euro', 'una euro'] },
  { key: 'pan_am', tier: 3, aliases_en: ['pan american cup', 'pan am cup', 'pan american games', 'pan-american'], aliases_es: ['panamericano', 'panamericanos', 'copa panamericana', 'juegos panamericanos'] },
  { key: 'asia_cup', tier: 3, aliases_en: ['asia cup', 'asian games', 'asian champions trophy'], aliases_es: ['copa de asia', 'juegos asiáticos'] },
  { key: 'africa_cup', tier: 3, aliases_en: ['africa cup', 'african cup'], aliases_es: ['copa de áfrica', 'copa africana'] },
  { key: 'oceania_cup', tier: 3, aliases_en: ['oceania cup'], aliases_es: ['copa de oceanía'] },
  { key: 'commonwealth', tier: 3, aliases_en: ['commonwealth games'], aliases_es: ['juegos de la commonwealth', 'juegos de la mancomunidad'] },
  { key: 'pro_league', tier: 4, aliases_en: ['pro league', 'fih pro league'], aliases_es: ['pro league'] },
  { key: 'nations_cup', tier: 4, aliases_en: ['nations cup'], aliases_es: ['copa de naciones'] },
  // Elite domestic top flights — tier 7. Matched in league/division text.
  { key: 'hoofdklasse', tier: 7, aliases_en: ['hoofdklasse'], aliases_es: ['hoofdklasse'] },
  { key: 'honor_division', tier: 7, aliases_en: ['división de honor', 'division de honor', 'honor division'], aliases_es: ['división de honor', 'division de honor'] },
  { key: 'bundesliga_hockey', tier: 7, aliases_en: ['bundesliga'], aliases_es: ['bundesliga'] },
  { key: 'england_premier', tier: 7, aliases_en: ['england premier division', 'english premier division'], aliases_es: ['premier division inglesa'] },
  { key: 'hockey_one', tier: 7, aliases_en: ['hockey one'], aliases_es: ['hockey one'] },
  { key: 'hil', tier: 7, aliases_en: ['hockey india league', 'hil'], aliases_es: ['hockey india league'] },
  { key: 'metropolitano', tier: 7, aliases_en: ['metropolitano'], aliases_es: ['metropolitano', 'torneo metropolitano'] },
]

/** Junior-level markers, matched in queries AND in career-history row text. */
export const JUNIOR_MARKERS = [
  'u14', 'u15', 'u16', 'u17', 'u18', 'u19', 'u21', 'u23',
  'u-14', 'u-15', 'u-16', 'u-17', 'u-18', 'u-19', 'u-21', 'u-23',
  'junior', 'juvenil', 'juveniles', 'youth', 'sub-21', 'sub 21', 'sub-19', 'sub 19',
]

/** Masters markers — counts as representative experience but is labelled.
 *  Founder call 2026-07-27 (design doc §8 Q2): include, never hide. */
export const MASTERS_MARKERS = ['masters', "master's", 'o35', 'o40', 'o45', 'o50', 'o60', 'over 35', 'over-35']

// ── National-team phrase detection ──────────────────────────────────────
//
// COUNTRY_TOKEN deliberately loose (letters across scripts + spaces for
// multi-word countries); resolution against countries/aliases happens in
// nl-search against the DB — an unresolvable capture fails SAFE (nothing
// is moved out of nationalities).

const C = "[A-Za-zÀ-ÿ'’]+(?:[ -][A-Za-zÀ-ÿ'’]+){0,3}"

/** EN/ES patterns that BIND a country to representative experience.
 *  First capture group = the country-ish token. */
const NT_COUNTRY_PATTERNS: RegExp[] = [
  // "Argentina national team", "the Spain senior national team"
  new RegExp(`\\b(${C}?)\\s+(?:senior\\s+|junior\\s+|men'?s\\s+|women'?s\\s+|u-?\\d{2}\\s+)*national\\s+(?:hockey\\s+)?(?:field hockey\\s+)?te?am\\b`, 'i'),
  // "national team of Argentina"
  new RegExp(`\\bnational\\s+te?am\\s+of\\s+(?:the\\s+)?(${C})`, 'i'),
  // "played for / represented / capped for Argentina" — verb-bound
  new RegExp(`\\b(?:represent(?:ed|ing|s)?|capped\\s+(?:for|by)|international\\s+caps\\s+(?:for|with))\\s+(?:the\\s+)?(${C})`, 'i'),
  // ES: "selección de España" / "seleccionado de X" / "la selección argentina"
  new RegExp(`\\bselecci[oó]n(?:\\s+nacional)?(?:\\s+(?:de|del|de la))?\\s+(${C})`, 'i'),
  new RegExp(`\\bseleccionad[oa](?:\\s+(?:de|del|de la|nacional))?\\s+(${C})`, 'i'),
  new RegExp(`\\bequipo\\s+nacional(?:\\s+(?:de|del))?\\s+(${C})`, 'i'),
  new RegExp(`\\binternacional(?:es)?\\s+con\\s+(${C})`, 'i'),
]

/** Generic representative-experience markers (no country attached). */
const NT_GENERIC_PATTERNS: RegExp[] = [
  /\bnational\s+te?am\b/i,
  /\binternational\s+(?:experience|caps|level)\b/i,
  /\bcapped\b/i,
  /\bselecci[oó]n\b/i,
  /\bseleccionad[oa]s?\b/i,
  /\bequipo\s+nacional\b/i,
  /\bexperiencia\s+internacional\b/i,
  /\bolympians?\b/i,
]

/** Words a sloppy country-capture can produce that are never countries.
 *  (Articles/pronouns/possessives on both languages + "the X national team"
 *  where X was actually an adjective like "senior".) */
const CAPTURE_STOPWORDS = new Set([
  'the', 'a', 'an', 'my', 'our', 'your', 'their', 'his', 'her', 'its',
  'la', 'el', 'los', 'las', 'un', 'una', 'mi', 'nuestro', 'nuestra', 'su',
  'senior', 'junior', 'national', 'nacional', 'youth', 'first', 'this', 'that',
  'any', 'some', 'men', 'mens', 'women', 'womens', 'masters',
  // Verb/preposition glue the loose pre-"national team" capture swallows:
  // "players who played for the Spain national team" captures "played for
  // the Spain" — these strip from the front until the country remains.
  // ('and' is deliberately absent: "Trinidad and Tobago".)
  'played', 'play', 'plays', 'playing', 'for', 'in', 'on', 'of', 'with',
  'who', 'that', 'at', 'from', 'to', 'there', 'are', 'is', 'was', 'were',
  'hay', 'esta', 'están', 'estan',
  'jugado', 'jugó', 'jugaron', 'juega', 'jugar', 'hayan', 'haya', 'quien',
  'quienes', 'con', 'en', 'para', 'por', 'que',
])

export interface IntlIntent {
  /** Country-ish tokens as typed (unresolved). Empty = generic NT ask. */
  country_tokens: string[]
  /** Canonical tournament keys detected in the query. */
  tournaments: string[]
  level: 'senior' | 'junior' | null
  /** Matched marker strings — telemetry. */
  markers: string[]
  /** Character spans of the NT phrases (for outside-mention checks). */
  spans: Array<[number, number]>
}

/** Normalize a capture: trim, strip leading articles, drop stopword-only. */
function cleanCountryToken(raw: string): string | null {
  let t = raw.trim().replace(/^(?:the|la|el|los|las|de|del)\s+/i, '').trim()
  // Multi-word captures keep only the trailing 3 words max (C already caps).
  if (!t) return null
  const words = t.split(/\s+/)
  // Strip trailing glue the loose token may have swallowed.
  while (words.length && CAPTURE_STOPWORDS.has(words[words.length - 1].toLowerCase())) words.pop()
  while (words.length && CAPTURE_STOPWORDS.has(words[0].toLowerCase())) words.shift()
  if (!words.length) return null
  t = words.join(' ')
  if (t.length < 3) return null
  if (CAPTURE_STOPWORDS.has(t.toLowerCase())) return null
  return t
}

/**
 * Detect representative-experience intent in a raw query. Returns null when
 * the query has no NT/tournament signal at all.
 */
export function detectInternationalIntent(query: string): IntlIntent | null {
  const q = query || ''
  const markers: string[] = []
  const spans: Array<[number, number]> = []
  const countries: string[] = []
  const tournaments: string[] = []

  for (const re of NT_COUNTRY_PATTERNS) {
    const m = q.match(re)
    if (m && m.index !== undefined) {
      markers.push(m[0].toLowerCase())
      spans.push([m.index, m.index + m[0].length])
      const tok = cleanCountryToken(m[1] ?? '')
      if (tok && !countries.some((c) => c.toLowerCase() === tok.toLowerCase())) countries.push(tok)
    }
  }

  let generic = false
  for (const re of NT_GENERIC_PATTERNS) {
    const m = q.match(re)
    if (m && m.index !== undefined) {
      generic = true
      markers.push(m[0].toLowerCase())
      spans.push([m.index, m.index + m[0].length])
    }
  }

  const lower = q.toLowerCase()
  for (const t of TOURNAMENTS) {
    for (const alias of [...t.aliases_en, ...t.aliases_es]) {
      const idx = lower.indexOf(alias)
      // Word-ish boundary check so "hil" can't match inside "while".
      if (idx !== -1) {
        const before = idx === 0 ? ' ' : lower[idx - 1]
        const after = idx + alias.length >= lower.length ? ' ' : lower[idx + alias.length]
        if (/[^a-z0-9]/.test(before) && /[^a-z0-9]/.test(after)) {
          if (!tournaments.includes(t.key)) tournaments.push(t.key)
          markers.push(alias)
          spans.push([idx, idx + alias.length])
          break
        }
      }
    }
  }

  if (!countries.length && !tournaments.length && !generic) return null

  // Level: explicit junior markers in the query, or a level-hinted tournament.
  let level: 'senior' | 'junior' | null = null
  if (JUNIOR_MARKERS.some((jm) => new RegExp(`(?:^|[^a-z0-9])${jm.replace('-', '[- ]?')}(?:[^a-z0-9]|$)`, 'i').test(q))) {
    level = 'junior'
  } else if (tournaments.some((k) => TOURNAMENTS.find((t) => t.key === k)?.level_hint === 'junior')) {
    level = 'junior'
  } else if (/\bsenior\b/i.test(q)) {
    level = 'senior'
  }

  return { country_tokens: countries, tournaments, level, markers: [...new Set(markers)], spans }
}

/**
 * Should a country ALSO stay in `nationalities`? True when it is mentioned
 * outside every NT phrase span ("Argentine defenders who played for the
 * Spain national team" keeps Argentina as a passport filter). Stem-matched
 * (first 6 chars) so Argentine/Argentina/argentino all count as the same
 * mention.
 */
export function countryMentionedOutsideSpans(query: string, country: string, spans: Array<[number, number]>): boolean {
  let blanked = query
  for (const [s, e] of spans) {
    blanked = blanked.slice(0, s) + ' '.repeat(e - s) + blanked.slice(e)
  }
  const stem = country.toLowerCase().slice(0, Math.min(6, country.length))
  return blanked.toLowerCase().includes(stem)
}

/**
 * Router support: blank out NT phrases so their words ("team", "selección")
 * don't drive entity classification toward clubs.
 */
export function stripNationalTeamPhrases(query: string): string {
  let out = query || ''
  for (const re of [...NT_COUNTRY_PATTERNS, ...NT_GENERIC_PATTERNS]) {
    const m = out.match(re)
    if (m && m.index !== undefined) {
      out = out.slice(0, m.index) + ' '.repeat(m[0].length) + out.slice(m.index + m[0].length)
    }
  }
  return out
}

/** True if the query carries any representative-experience signal. */
export function hasNationalTeamIntent(query: string): boolean {
  return detectInternationalIntent(query) !== null
}

// ── Retrieval-side text matching (career_history rows) ─────────────────

/** ILIKE patterns for a tournament key set (EN+ES aliases). */
export function tournamentAliasPatterns(keys: string[]): string[] {
  const out: string[] = []
  for (const key of keys) {
    const def = TOURNAMENTS.find((t) => t.key === key)
    if (!def) continue
    for (const a of [...def.aliases_en, ...def.aliases_es]) out.push(`%${a}%`)
  }
  return [...new Set(out)]
}

/** Junior / masters classification of a career-history row's text. */
export function rowTextLevel(text: string): { junior: boolean; masters: boolean } {
  const t = (text || '').toLowerCase()
  const junior = JUNIOR_MARKERS.some((jm) => new RegExp(`(?:^|[^a-z0-9])${jm.replace('-', '[- ]?')}(?:[^a-z0-9]|$)`, 'i').test(t))
  const masters = MASTERS_MARKERS.some((mm) => t.includes(mm))
  return { junior, masters }
}

/** True when any requested key is a TIER-7 domestic league. Those live on
 *  entry_type='club' rows ("played Hockey One" is club experience), so the
 *  retrieval scan must include club entries for them. */
export function tournamentIncludesDomestic(keys: string[]): boolean {
  return keys.some((k) => TOURNAMENTS.find((t) => t.key === k)?.tier === 7)
}

/** Bio markers for the SELF-DESCRIBED tier (never presented as verified). */
export const BIO_NT_MARKERS = [
  'national team', 'selección', 'seleccion', 'seleccionado', 'seleccionada',
  'equipo nacional', 'international caps', 'capped for',
]
