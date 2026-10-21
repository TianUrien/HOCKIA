/**
 * Club name casing rule (2026-10-21). Mirror of the SQL function
 * `public.normalize_club_name_casing` (migration 20261021180000_club_name_casing.sql),
 * which owns the rule: the server applies it on every insert into
 * world_clubs. The client uses this copy to show and send the same casing
 * before the request goes out. Keep both in step.
 *
 * Trim and collapse inner whitespace; capitalise the first letter of every
 * word that is entirely lowercase (hyphenated parts count as words), except
 * the particles below when they are not the first word. A word with any
 * uppercase letter or digit stays exactly as typed ("HC", "A1", "McDonald");
 * common club abbreviations typed in lowercase ("hc", "fc") become uppercase.
 * Spelling and accents never change.
 */

const PARTICLES = new Set([
  'de', 'del', 'della', 'di', 'da', 'do', 'dos', 'das', 'la', 'le', 'les', 'el', 'los', 'las',
  'y', 'e', 'of', 'the', 'and', 'van', 'von', 'der', 'den', 'het', 'du', 'des', 'et', 'a', 'en', 'at', 'on',
])

/** Club-type abbreviations typed in lowercase become uppercase ("hc" -> "HC"). */
const ACRONYMS = new Set([
  'hc', 'fc', 'sc', 'ac', 'hv', 'mhc', 'whc', 'thc', 'hhc', 'rhc', 'lhc', 'bhc', 'chc', 'tsv', 'sv', 'vfl', 'vfb', 'tc', 'rc', 'cd', 'cf', 'ymca',
])

function isEntirelyLowercase(part: string): boolean {
  return part !== '' && part === part.toLowerCase() && part !== part.toUpperCase() && !/[0-9]/.test(part)
}

function capitaliseFirstLetter(part: string): string {
  const chars = Array.from(part)
  const i = chars.findIndex((ch) => ch.toUpperCase() !== ch)
  if (i < 0) return part
  chars[i] = chars[i].toUpperCase()
  return chars.join('')
}

export function normalizeClubNameCasing(name: string): string
export function normalizeClubNameCasing(name: string | null | undefined): string | null
export function normalizeClubNameCasing(name: string | null | undefined): string | null {
  if (name == null) return null
  const clean = name.trim().replace(/\s+/g, ' ')
  if (!clean) return clean
  let first = true
  return clean
    .split(' ')
    .map((word) =>
      word
        .split('-')
        .map((part) => {
          let out = part
          if (ACRONYMS.has(part)) out = part.toUpperCase()
          else if (isEntirelyLowercase(part) && !(!first && PARTICLES.has(part))) out = capitaliseFirstLetter(part)
          if (part !== '') first = false
          return out
        })
        .join('-'),
    )
    .join(' ')
}
