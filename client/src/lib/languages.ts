/**
 * Languages seed list.
 *
 * Surfaced on the Umpire profile — umpires working internationally
 * need to signal which languages they can officiate in. The seed list
 * covers the languages actually used in competitive field hockey
 * (FIH / continental / major national leagues). Stored as free text
 * on `profiles.languages` (TEXT[]), so users can add anything not in
 * the list via the "Add language" input — it just keeps the common
 * choices one tap away.
 *
 * Ordering: the handful of languages most common across FIH events
 * first, then alpha.
 */
export const LANGUAGE_SUGGESTIONS = [
  // Most common across FIH events
  'English',
  'Spanish',
  'French',
  'German',
  'Dutch',
  // Alpha for the rest
  'Afrikaans',
  'Arabic',
  'Bengali',
  'Catalan',
  'Chinese (Mandarin)',
  'Chinese (Cantonese)',
  'Czech',
  'Danish',
  'Finnish',
  'Greek',
  'Hebrew',
  'Hindi',
  'Hungarian',
  'Indonesian',
  'Italian',
  'Japanese',
  'Korean',
  'Malay',
  'Norwegian',
  'Polish',
  'Portuguese',
  'Russian',
  'Swedish',
  'Thai',
  'Turkish',
  'Ukrainian',
  'Urdu',
  'Vietnamese',
  'Welsh',
] as const
