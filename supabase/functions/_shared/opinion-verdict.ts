/**
 * Fit-opinion verdict length (ai-opinion).
 *
 * The verdict is capped (280 characters) and the model writes close to the
 * cap, so now and then it runs a few words over. Until 2026-11-20 that failed
 * the whole request and the recruiter saw an error. A verdict that runs over
 * is now cut back to the whole sentences that fit; only a verdict whose first
 * sentence alone is too long is refused (and the call is retried once).
 */

/** The verdict within `max` characters, or null when no whole sentence fits. */
export function fitVerdict(raw: string, max: number): string | null {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return null
  if (text.length <= max) return text
  // Sentence ends: . ! ? followed by a space or the end (closing quotes and brackets allowed).
  const ends: number[] = []
  const re = /[.!?]["')\]]?(?=\s|$)/g
  for (let m = re.exec(text); m; m = re.exec(text)) ends.push(m.index + m[0].length)
  const last = ends.filter((end) => end <= max).pop()
  return last ? text.slice(0, last).trim() : null
}
