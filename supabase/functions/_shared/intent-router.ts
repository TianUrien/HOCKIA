/**
 * Server-side intent / entity-type router.
 *
 * Phase 0 of the HOCKIA AI architecture rebuild: instead of trusting the LLM
 * to route every query (which we observed dropping `roles` ~50% of the time
 * for clear queries like "find clubs for me"), we run a small deterministic
 * pre-classifier here. The result is:
 *
 *   - HIGH confidence routing → backend ENFORCES the entity type, even if
 *     the LLM tries to return a different one
 *   - MEDIUM confidence → backend hints to the LLM via the system prompt
 *     but doesn't override
 *   - LOW / no match → existing LLM-only flow
 *
 * This file is pure functions with no Deno-only globals so it's easy to unit-
 * test. Keep it boring on purpose.
 */

export type EntityType =
  | 'clubs'
  | 'players'
  | 'coaches'
  | 'brands'
  | 'umpires'
  | 'opportunities'
  | 'products'
  | 'self_profile'
  | 'self_advice'
  | 'platform_help'
  | 'knowledge'
  | 'greeting'
  // Phase 5 — opportunity-owner recruitment intent ("who applied", "best
  // applicants", "strongest match", "who should I review"). Only fires
  // when the asker actually owns at least one open opportunity; otherwise
  // nl-search falls back to normal search.
  | 'own_applicants'
  | 'unknown'

export type Confidence = 'high' | 'medium' | 'low' | 'none'

export type FilterSource = 'keyword' | 'llm' | 'context' | 'mixed'

export interface RoutedIntent {
  entity_type: EntityType
  confidence: Confidence
  /** Why we made this call — useful for logging + debugging */
  matched_signals: string[]
}

/**
 * Self-reflection wins over entity search when both match — "what should I
 * do as a player" is self-advice, not a player search. Knowledge wins over
 * entity search ("what does a defender do?" is knowledge, "find a defender"
 * is search). Order matters in the lists below.
 */

// ── Self-reflection patterns (highest priority — short, self-referential) ──
const SELF_PROFILE = [
  /\bwho am i\b/i,
  /\bmy profile\b/i,
  /\bwhat (do you|'?ve you got|info do you have) (know|got) (about )?(me|my)\b/i,
  /\bdo i have (a )?(bio|video|highlight|club|profile)\b/i,
  /\b(read|show) my bio\b/i,
  /\bwhat'?s in my profile\b/i,
  /\bhow many (open )?(vacancies|opportunities|products|posts) (do i|have i)\b/i,
]

const SELF_ADVICE = [
  /\bwhat should i (improve|do|add|change|next)\b/i,
  /\bhow (can|do) i (improve|get more|increase|complete|grow|stand out)\b/i,
  /\bwhat (can|should) i do( next)? on hockia\b/i,
  /\b(my |for my )(visibility|profile completion|next steps?)\b/i,
  /\bwhat'?s missing( from)? my (profile|brand|page|club)\b/i,
  /\b(advice|tips?) (for|on) my profile\b/i,
  // Phase 1A — connection / next-action advice. Treat these as self-advice
  // so the assistant can append role-aware action chips ("Find clubs for me",
  // "Improve my profile", etc.) instead of leaving the user with a generic
  // wall of text and no next step.
  /\bwho should i (connect|reach\s*out|talk|message|follow)\b/i,
  /\bwhat should i (search|look) for\b/i,
  /\bwhere (should|do) i (start|begin)\b/i,
  /\bwhat can i do( next)?\??\s*$/i,  // bare "what can I do?" / "what can I do next?"
  // Phase 4 audit fix — also catch "what can I do to improve / fix / complete
  // / grow / build my profile/brand/page/club". Previously only the bare
  // form matched, so "What can I do to improve my profile?" fell through to
  // 'unknown' and the response shipped without role-aware chips.
  /\bwhat can i do (to|about) (improve|fix|complete|grow|build|update|enhance|make).*(profile|brand|page|club|visibility|presence|account)\b/i,
  // Phase 4 chip-label fix — bare imperative forms produced by aligning
  // chip label = query. "Improve my profile", "Improve my brand profile",
  // "Improve my club profile", "Improve my umpire profile". Without this
  // pattern these short queries fall through to 'unknown' and the
  // response ships with no chips.
  /\b(improve|complete|fix|update|enhance) my (profile|brand profile|club profile|umpire profile|page|account|visibility)\b/i,
  // Phase 4 — short umpire-specific self-advice prompt from the chip catalog.
  /\badd (an |a |my )?appointment\b/i,
  // Phase 4 audit P1-4 — "What can you do?" / "What can you help me with?"
  // are technically platform-help questions, not self-advice — but the
  // user-facing fix is the same: emit role-aware chips so the conversation
  // doesn't dead-end after the AI prints its capability list. Routing
  // through self_advice gives this for free.
  /\bwhat can you (do|help)/i,
]

// ── Platform / feature help ("how do I use HOCKIA?") ──
// Detected as a pair: a help-question FORM plus a HOCKIA feature NOUN. Both
// must match. This keeps "how do I find defenders" (a search) out — only
// questions about HOCKIA's own features route here. Checked after
// self_advice / self_profile (those own "improve MY profile") but before
// entity search, so "how do I post an opportunity" is treated as a how-to,
// not an opportunity search.
const HELP_QUESTION_FORM = [
  /\bhow (do|can|would|should|to)\b/i,
  /\bwhere (do|can|is|are|should)\b/i,
  /\bcan i (create|post|publish|add|make|manage|edit|upload|apply|write|leave|send|request)\b/i,
  /\bwhat'?s the (way|process|steps?|best way) (to|for)\b/i,
]
const FEATURE_NOUNS = [
  /\bopportunit(y|ies)\b/i,
  /\bvacanc(y|ies)\b/i,
  /\bposts?\b/i,
  /\bapplications?\b/i,
  /\bapplicants?\b/i,
  /\bcandidates?\b/i,
  /\bcomments?\b/i,
  /\breferences?\b/i,
  /\bfriends?\b/i,
  /\bconnections?\b/i,
  /\bnetwork\b/i,
  /\bjourney\b/i,
  /\bmilestones?\b/i,
  /\bmedia\b/i,
  /\bgaller(y|ies)\b/i,
  /\bphotos?\b/i,
  /\b(highlight )?videos?\b/i,
  /\bprofile\b/i,
  /\bbio\b/i,
  /\baccount\b/i,
  /\bsettings?\b/i,
  /\bdiscover(y)?\b/i,
]

// ── Opportunity-owner recruitment intent (Phase 5) ──
// Fires when a club or coach asks Hockia AI about THEIR OWN recruitment:
// "who applied", "best applicants", "strongest match", "who should I
// review first", etc. nl-search verifies the asker is an owner before
// honouring this routing — otherwise it falls back to normal search.
const OWN_APPLICANTS = [
  /\b(my|our) applicants?\b/i,
  /\bwho applied\b/i,
  /\b(best|top|strongest) applicants?\b/i,
  /\b(strongest|best|top) match(es)?\b/i,
  // Bare forms like "Who should I shortlist?" need the whole "first|now|next"
  // tail to be optional INCLUDING the leading space — without (?:\s+...)? the
  // trailing literal space made the bare form fail to match. (Production
  // audit: this was item 3 — "Who should I shortlist?" fell through to the
  // generic LLM advice essay.)
  /\bwho should i (review|look at|see|consider|shortlist|pick)(?:\s+(first|now|next))?\b/i,
  /\breview first\b/i,
  /\b(my|our) (recruitment|pipeline|inbox|shortlist)\b/i,
  /\b(my|our) opening(s)?\b/i,
  /\b(best|top) (for|fit for) (my|our) (opportunit(y|ies)|opening|role)\b/i,
  /\b(applicants?|candidates?) (for|on) (my|our) (opportunit(y|ies)|opening)\b/i,
]

// ── Hockey knowledge (rules / explanations / how-to) ──
const KNOWLEDGE = [
  /\bwhat (is|does|are) (a |the )?(penalty corner|drag flick|aerial|jab|tackle|goalkeeper kit|turf)/i,
  /\bhow does (a |the )?(penalty|drag flick|short corner|stroke)/i,
  /\brules? of (field )?hockey\b/i,
  /\bdifference between indoor and outdoor hockey\b/i,
  /\bwhen (was|did) (the )?(world cup|olympics|pro league|ehl)\b/i,
  /\bhow long is a (field )?hockey (match|game|half)\b/i,
  /\b(what|who) is (the )?fih\b/i,
]

// ── Entity-search patterns (per role) ──
// We require either a clear noun ("clubs", "players") OR a clearly role-bound
// phrase ("hiring coaches", "head coach") to route to a specific role.
const CLUBS = [
  /\bclubs?\b/i,
  /\bteams?\b(?! (mate|mates|spirit))/i, // skip "teammates", "team spirit"
  /\bacadem(y|ies)\b/i,
  /\b(field )?hockey clubs?\b/i,
]

const PLAYERS = [
  /\bplayers?\b/i,
  /\bdefenders?\b/i,
  /\bmidfielders?\b/i,
  /\bforwards?\b/i,
  /\bstrikers?\b/i,
  /\b(?:goalkeepers?|gks?|keepers?)\b/i,
  /\bplayer ambassadors?\b/i,
]

const COACHES = [
  /\bcoaches\b/i,
  /\bhead coach(es)?\b/i,
  /\bassistant coach(es)?\b/i,
  /\b(s ?& ?c|strength (and|&) conditioning) coach\b/i,
  /\b(gk|goalkeep(er|ing)) coach\b/i,
  /\byouth coach\b/i,
  /\bperformance analysts?\b/i,
  /\b(coaching|hockey) staff\b/i,
]

const BRANDS = [
  /\bbrands?\b/i,
  /\bsponsors?\b/i,
]

const UMPIRES = [
  /\bumpires?\b/i,
  /\bofficials?\b/i,
  /\breferees?\b/i,
]

// ── Opportunities (vacancies / hiring) ──
const OPPORTUNITIES = [
  /\bopportunit(y|ies)\b/i,
  /\bvacanc(y|ies)\b/i,
  /\bopen (positions?|roles?)\b/i,
  /\btr(y|ial)outs?\b/i,
  /\b(hiring|recruiting)\b(?! (a |for )?(coach|player))/i, // "hiring coaches" handled separately
  // NOTE — "open to play" / "open to coach" are the platform's own
  // availability LABELS on player/coach profiles. Routing them to the
  // opportunities entity collides with what clubs naturally type
  // ("find me 5 defenders open to play") and sends them to /opportunities
  // instead of a people search. Availability is a profile filter, not an
  // opportunities intent.
]

// ── Products / marketplace ──
const PRODUCTS = [
  /\bproducts?\b/i,
  /\b(hockey )?(sticks?|shoes?|boots|gear|equipment|kit|bag|protective)\b/i,
  /\bmarketplace\b/i,
  /\b(buy|shop|browse)\b/i,
]

const GREETING = [
  /^\s*(hi|hello|hey|yo|sup|hola)[\s!,.]*$/i,
  /^\s*(thanks?|thank you|cheers)[\s!,.]*$/i,
  /^\s*(good morning|good afternoon|good evening)[\s!,.]*$/i,
]

function anyMatch(patterns: RegExp[], text: string): string[] {
  const hits: string[] = []
  for (const p of patterns) {
    const m = text.match(p)
    if (m) hits.push(m[0].toLowerCase())
  }
  return hits
}

/**
 * "for my X" / "for the X" possessive phrases describe the user's CONTEXT,
 * not the search target. We strip them before scoring entity types so
 * "find players for my team" doesn't accidentally route to clubs because
 * of the word "team", and "find player ambassadors for my brand" doesn't
 * accidentally include brands as a candidate.
 */
function stripPossessiveContext(query: string): string {
  return query.replace(
    /\bfor (my|the|our|a|an) (team|club|brand|company|organization|league|country|profile|page)\b/gi,
    '',
  )
}

/**
 * Classify the user's query into an entity_type with a confidence level.
 *
 * Decision order (highest priority first):
 *   1. Greeting (single-word "hi" / "thanks")
 *   2. Self-advice ("what should I improve") — checked BEFORE self_profile
 *      because "improve in my profile" mentions "my profile" as context but
 *      the intent is clearly advice
 *   3. Self-profile (who am I / read my bio / how many vacancies do I have)
 *   4. Hockey knowledge (rules, terminology)
 *   5. Opportunities (vacancy-style queries beat generic role search)
 *   6. Specific role search with possessive-context stripped
 *   7. Products
 *   8. Unknown → fallback to existing LLM-only flow
 *
 * Confidence is HIGH when exactly one entity-type pattern matches strongly
 * after disambiguation rules, MEDIUM when multiple plausible types remain,
 * NONE when nothing matched. The backend ENFORCES on HIGH confidence only;
 * MEDIUM passes through as a hint for the LLM but doesn't override.
 */
export function classifyEntityType(query: string): RoutedIntent {
  const q = (query || '').trim()
  if (!q) return { entity_type: 'unknown', confidence: 'none', matched_signals: [] }

  // 1. Greeting — must be the entire utterance
  const greeting = anyMatch(GREETING, q)
  if (greeting.length > 0) {
    return { entity_type: 'greeting', confidence: 'high', matched_signals: greeting }
  }

  // 2. Self-advice FIRST — beats self-profile when both match. "what should
  //    I improve in my profile" is advice, not a profile recap.
  const selfAdvice = anyMatch(SELF_ADVICE, q)
  if (selfAdvice.length > 0) {
    return { entity_type: 'self_advice', confidence: 'high', matched_signals: selfAdvice }
  }

  // 3. Self-profile (who am I, read my bio, do I have X)
  const selfProfile = anyMatch(SELF_PROFILE, q)
  if (selfProfile.length > 0) {
    return { entity_type: 'self_profile', confidence: 'high', matched_signals: selfProfile }
  }

  // 3b. Platform / feature help — a help-question form AND a HOCKIA feature
  //     noun. Beats entity search ("how do I post an opportunity" is a
  //     how-to, not an opportunity search) but loses to self_advice /
  //     self_profile above (which own "improve / what's in my profile").
  const helpForm = anyMatch(HELP_QUESTION_FORM, q)
  const featureNoun = anyMatch(FEATURE_NOUNS, q)
  if (helpForm.length > 0 && featureNoun.length > 0) {
    return {
      entity_type: 'platform_help',
      confidence: 'high',
      matched_signals: [...helpForm, ...featureNoun],
    }
  }

  // 3c. Opportunity-owner recruitment intent (Phase 5). Detected BEFORE
  //     entity search so "who applied to my opportunity" doesn't get
  //     scored as players/opportunities and dropped. Confidence is high
  //     here; nl-search still gates on whether the user actually owns
  //     any opportunities — non-owners fall through to normal search.
  const ownApplicants = anyMatch(OWN_APPLICANTS, q)
  if (ownApplicants.length > 0) {
    return { entity_type: 'own_applicants', confidence: 'high', matched_signals: ownApplicants }
  }

  // 4. Hockey knowledge (rules / how does X work)
  const knowledge = anyMatch(KNOWLEDGE, q)
  if (knowledge.length > 0) {
    return { entity_type: 'knowledge', confidence: 'high', matched_signals: knowledge }
  }

  // 5. Strip possessive context BEFORE entity scoring so "find players for
  //    my team" is scored as "find players ___" and doesn't pick up team→club.
  const scoringInput = stripPossessiveContext(q)

  const opps = anyMatch(OPPORTUNITIES, scoringInput)
  const products = anyMatch(PRODUCTS, scoringInput)
  const clubs = anyMatch(CLUBS, scoringInput)
  const players = anyMatch(PLAYERS, scoringInput)
  const coaches = anyMatch(COACHES, scoringInput)
  const brands = anyMatch(BRANDS, scoringInput)
  const umpires = anyMatch(UMPIRES, scoringInput)

  // 6. "hiring/recruiting + role" — recruitment-style queries route to the
  //    role being recruited, not the recruiter's role. "find clubs hiring
  //    coaches" → coaches; "clubs hiring players" → players.
  const isRecruiting = /\b(hir(e|ing)|recruit(e|ing)|looking for)\b/i.test(scoringInput)
  if (isRecruiting) {
    if (coaches.length > 0) {
      return { entity_type: 'coaches', confidence: 'high', matched_signals: coaches }
    }
    if (players.length > 0) {
      return { entity_type: 'players', confidence: 'high', matched_signals: players }
    }
  }

  const scores = [
    { type: 'opportunities' as EntityType, hits: opps },
    { type: 'clubs' as EntityType, hits: clubs },
    { type: 'coaches' as EntityType, hits: coaches },
    { type: 'players' as EntityType, hits: players },
    { type: 'brands' as EntityType, hits: brands },
    { type: 'umpires' as EntityType, hits: umpires },
    { type: 'products' as EntityType, hits: products },
  ].filter(s => s.hits.length > 0)

  if (scores.length === 0) {
    return { entity_type: 'unknown', confidence: 'none', matched_signals: [] }
  }

  // Single clear winner
  if (scores.length === 1) {
    return {
      entity_type: scores[0].type,
      confidence: 'high',
      matched_signals: scores[0].hits,
    }
  }

  // Imperative-verb anchoring runs BEFORE the opportunities tiebreak —
  // when the user says "find/show me/look for X", the entity word right
  // after the verb wins, even if other entity words appear later as
  // context. Without this, "find coaches available for club opportunities"
  // would route to opportunities (because "opportunities" appears) instead
  // of coaches. A leading count is skipped so "find me 5 defenders" still
  // anchors on "defenders".
  const verbMatch = q.match(/\b(?:find|show( me)?|look(ing)? for|recommend|search)\s+(?:me\s+)?(?:\d+\s+)?(\w+)/i)
  if (verbMatch) {
    const objectWord = verbMatch[3]?.toLowerCase()
    const objectScore = scores.find(s =>
      s.hits.some(h => h.startsWith(objectWord!) || objectWord!.startsWith(h.slice(0, 4)))
    )
    if (objectScore) {
      return {
        entity_type: objectScore.type,
        confidence: 'high',
        matched_signals: objectScore.hits,
      }
    }
  }

  // Multiple matches — opportunities is more specific than role search
  // ("find coaching opportunities" → opportunities, not coaches).
  if (scores.find(s => s.type === 'opportunities')) {
    return {
      entity_type: 'opportunities',
      confidence: 'high',
      matched_signals: scores.flatMap(s => s.hits),
    }
  }

  // Otherwise → ambiguous. Medium confidence — backend won't enforce, LLM
  // gets to decide.
  scores.sort((a, b) => b.hits.length - a.hits.length)
  return {
    entity_type: scores[0].type,
    confidence: 'medium',
    matched_signals: scores.flatMap(s => s.hits),
  }
}

/**
 * Map the EntityType (clubs/players/coaches/brands/umpires) to the role string
 * used by `discover_profiles(p_roles)`. Returns null for non-profile entity
 * types (opportunities, products, self_*, etc.).
 */
export function entityTypeToRole(t: EntityType): string | null {
  switch (t) {
    case 'clubs': return 'club'
    case 'players': return 'player'
    case 'coaches': return 'coach'
    case 'brands': return 'brand'
    case 'umpires': return 'umpire'
    default: return null
  }
}
