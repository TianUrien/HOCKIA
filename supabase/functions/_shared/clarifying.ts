/**
 * Phase 1A — Clarifying-question detection.
 *
 * Pure module. Decides whether a query is too vague to route or search
 * confidently and, if so, returns a deterministic clarifying question
 * with disambiguation options. Triggered by short, generic asks that
 * have a search shape but no specific entity:
 *
 *   "Find people"
 *   "Show me options"
 *   "Who can help me?"
 *   "Any recommendations?"
 *   "Search hockey"
 *
 * Without this the user gets generic LLM advice or worse — a fallthrough
 * to all-4-roles search returning mixed results. With this, they get a
 * focused 4-option pill row in <1s.
 *
 * Pure functions: no Deno globals, no fetch. Easy to unit-test.
 */

import type { ClarifyingOption } from './suggested-actions.ts'

/**
 * Vague-ask shapes — short, generic queries with a search/help intent but
 * no concrete entity word. Tight by design; specificity in the patterns
 * matters because false positives steal the LLM round-trip.
 */
const VAGUE_PATTERNS: RegExp[] = [
  // "Find people" / "find someone" / "find anyone"
  /^\s*(find|show me|search for|look for|browse|get me)\s+(some\s*(one|body)?|people|anyone|anybody|options?|something|stuff)\s*\??\s*$/i,
  // "Show me options" / "show options"
  /^\s*show\s+(me\s+)?(some\s+)?(options?|recommendations?|stuff|results?)\s*\??\s*$/i,
  // "Who can help me?" / "who should I talk to?"
  /^\s*who\s+(can|should|could|might)\s+(help\s+me|i\s+(talk\s+to|reach\s+out\s+to|contact))\s*\??\s*$/i,
  // "Any recommendations?" / "any suggestions?" — only when standalone
  // (not "any other recommendations?" which is a recovery follow-up).
  /^\s*(any\s+)?(recommendations?|suggestions?|ideas?|tips?)\s*\??\s*$/i,
  // "Search hockey" / "browse hockia" — bare verbs without an entity
  /^\s*(search|browse|explore)\s+(hockey|hockia|the platform|profiles?)\s*\??\s*$/i,
]

export interface ClarifyingResult {
  message: string
  options: ClarifyingOption[]
}

/**
 * Build a 4-option disambiguation set tailored to the user's role:
 *   - Player / coach see Clubs, Coaches/Players, Opportunities, Brands.
 *   - Club sees Players, Coaches, Opportunities (to post), Brands.
 *   - Brand sees Players (ambassadors), Clubs (sponsorships), Opportunities,
 *     Coaches.
 *   - Default (no role) sees the four core entity types.
 *
 * Each option's routed_query is a phrasing the keyword router will classify
 * as HIGH confidence, so the follow-up search stays predictable.
 */
function buildClarifyingOptions(userRole: string | null): ClarifyingOption[] {
  // The recommended option comes first (Hockia AI choice card, 2026-10-18):
  // what that role most often came to Hockia for.
  switch (userRole) {
    case 'player':
      return [
        { label: 'Opportunities', routed_query: 'Find opportunities for my position', description: 'Open roles that match your position', recommended: true },
        { label: 'Clubs', routed_query: 'Find clubs for me', description: 'Clubs that fit your level and category' },
        { label: 'Coaches', routed_query: 'Find coaches in my position', description: 'Coaches who work with your position' },
        { label: 'Brands', routed_query: 'Find brands', description: 'Brands on Hockia' },
      ]
    case 'coach':
      return [
        { label: 'Opportunities', routed_query: 'Find opportunities for coaches', description: 'Open coaching roles', recommended: true },
        { label: 'Clubs hiring', routed_query: 'Find clubs hiring head coaches', description: 'Clubs looking for coaching staff' },
        { label: 'Players', routed_query: 'Find players for my staff', description: 'Players open to new teams' },
        { label: 'Brands', routed_query: 'Find brands', description: 'Brands on Hockia' },
      ]
    case 'club':
      return [
        { label: 'Players', routed_query: 'Find players for my team', description: 'Players open to joining a club', recommended: true },
        { label: 'Coaches', routed_query: 'Find coaches with head-coach experience', description: 'Coaches with head-coach experience' },
        { label: 'Opportunities', routed_query: 'Find opportunities to post', description: 'Help posting a role' },
        { label: 'Brands', routed_query: 'Find brands', description: 'Brands on Hockia' },
      ]
    case 'brand':
      return [
        { label: 'Player ambassadors', routed_query: 'Find player ambassadors', description: 'Players who could represent your brand', recommended: true },
        { label: 'Clubs', routed_query: 'Find clubs', description: 'Clubs for sponsorships' },
        { label: 'Coaches', routed_query: 'Find coaches', description: 'Coaches on Hockia' },
        { label: 'Marketplace', routed_query: 'Show me products', description: 'Products on Hockia' },
      ]
    default:
      return [
        { label: 'Clubs', routed_query: 'Find clubs' },
        { label: 'Players', routed_query: 'Find players' },
        { label: 'Coaches', routed_query: 'Find coaches' },
        { label: 'Opportunities', routed_query: 'Find opportunities' },
      ]
  }
}

/**
 * Returns a clarifying response when the query is vague enough to need one.
 * Returns null otherwise (caller falls through to the normal LLM path).
 */
export function detectClarifyingNeed(
  query: string,
  userRole: string | null,
): ClarifyingResult | null {
  const q = (query || '').trim()
  // Substantive long queries belong to the LLM.
  if (q.length === 0 || q.length > 50) return null

  const isVague = VAGUE_PATTERNS.some(p => p.test(q))
  if (!isVague) return null

  return {
    message: 'Who would you like to look for?',
    options: buildClarifyingOptions(userRole),
  }
}
