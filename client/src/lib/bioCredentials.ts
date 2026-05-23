/**
 * Bio credential extraction — frontend mirror.
 *
 * Canonical source lives in `supabase/functions/nl-search/index.ts`
 * (BIO_CREDENTIAL_PATTERNS + detectBioCredentials). This file is a
 * verbatim mirror so the player-profile UI can surface the same
 * extraction the Hockia AI owner-handler already runs server-side.
 *
 * Why duplicate instead of share? Frontend (`client/`, Vite) and the
 * Edge Function (`supabase/functions/`, Deno) live in different module
 * systems. Crossing that boundary for ~25 lines of regex isn't worth
 * the build-tooling overhead. If a credential pattern is added, update
 * BOTH files in the same commit — there's no other call site.
 *
 * Production QA report (CASI session, 2026-05-23): owners clicking
 * "Review applicant" expected to verify the AI's "World Cup experience"
 * bullet on the player's Journey section but hit "no career history yet".
 * Surfacing the same extraction on the profile closes that trust gap.
 */

const BIO_CREDENTIAL_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bworld cup\b/i, label: 'World Cup experience' },
  { pattern: /\bolympic[s]?\b/i, label: 'Olympic experience' },
  { pattern: /\bcommonwealth games?\b/i, label: 'Commonwealth Games' },
  { pattern: /\bpan ?am(?:erican)?(?:\s+games?)?\b/i, label: 'Pan American competition' },
  { pattern: /\bchampions trophy\b/i, label: 'Champions Trophy' },
  { pattern: /\bfih (?:level|world|pro|champion|hockey)/i, label: 'FIH credential' },
  { pattern: /\bnational team\b/i, label: 'National team' },
  { pattern: /\bncaa( division)?\b/i, label: 'NCAA experience' },
  { pattern: /\bpremier(?:ship| league)\b/i, label: 'Premier League / Premiership' },
  { pattern: /\beuro(?:pean| ?hockey) (?:league|cup)\b/i, label: 'European hockey competition' },
  { pattern: /\beuro hockey league\b/i, label: 'Euro Hockey League' },
  { pattern: /\bcaptain(?:ed)?\b/i, label: 'Captain' },
  { pattern: /\bgold medal\b/i, label: 'Gold medal' },
  { pattern: /\bsilver medal\b/i, label: 'Silver medal' },
  { pattern: /\bbronze medal\b/i, label: 'Bronze medal' },
]

/** Returns the de-duped credential labels found in the bio. Order matches
 *  BIO_CREDENTIAL_PATTERNS (so World Cup beats Pan Am beats NCAA). */
export function detectBioCredentials(bio: string | null | undefined): string[] {
  if (!bio) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const { pattern, label } of BIO_CREDENTIAL_PATTERNS) {
    if (pattern.test(bio) && !seen.has(label)) {
      out.push(label)
      seen.add(label)
    }
  }
  return out
}
