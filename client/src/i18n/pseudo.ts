/**
 * Pseudo-locale for development: every English string comes back accented,
 * about 30% longer and wrapped in brackets. Text that stays plain on screen
 * is hard-coded; text that overflows will overflow in Spanish too.
 * Variables ({{name}}) and tags (<b>) are left untouched.
 */
const ACCENTS: Record<string, string> = {
  a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', n: 'ñ', N: 'Ñ', c: 'ç', C: 'Ç',
}

export function pseudoString(value: string): string {
  // Odd-indexed parts are the variables and tags the split captured.
  const parts = value.split(/(\{\{[^}]*\}\}|<[^>]*>)/)
  let accented = ''
  let plainLength = 0
  parts.forEach((part, index) => {
    if (index % 2 === 1) { accented += part; return }
    plainLength += part.length
    accented += part.replace(/[aeiouncAEIOUNC]/g, (ch) => ACCENTS[ch] ?? ch)
  })
  const padding = '~'.repeat(Math.ceil(plainLength * 0.3))
  return `[${accented}${padding}]`
}

export type Catalog = { [key: string]: string | Catalog }

export function pseudoCatalog(catalog: Catalog): Catalog {
  const out: Catalog = {}
  for (const [key, value] of Object.entries(catalog)) {
    out[key] = typeof value === 'string' ? pseudoString(value) : pseudoCatalog(value)
  }
  return out
}
