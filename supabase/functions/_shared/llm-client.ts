// deno-lint-ignore-file no-explicit-any
/**
 * LLM provider abstraction for natural language → structured filter parsing.
 *
 * Supports multiple providers via the LLM_PROVIDER env var:
 *   - 'gemini'  (default) — Google Gemini 2.5 Flash (free tier)
 *   - 'claude'  — Anthropic Claude Sonnet 4.6 (paid; Phase 4 eval target)
 *   - 'openai'  — OpenAI GPT-4o-mini (paid)
 *
 * Switching providers requires only changing the env var + API key.
 * Zero code changes needed. Each provider returns the same {result, meta}
 * shape: meta carries retry_count + usage (prompt/completion/cached tokens)
 * so discovery_events comparisons are apples-to-apples.
 */

import { renderFeatureKnowledge } from './hockia-features.ts'

export interface ParsedFilters {
  roles?: string[]
  positions?: string[]
  /** @deprecated Phase 3e — use target_category. Kept on the wire for one
   * deploy cycle to absorb in-flight LLM responses + stale frontends. The
   * backend translates Men → adult_men, Women → adult_women internally. */
  gender?: string
  /** Phase 3e: hockey-category filter. One of adult_women, adult_men, girls,
   * boys, mixed. The LLM should set this when the query mentions a category
   * ("women's clubs" → adult_women; "girls coaches" → girls). The backend
   * routes per role: player → playing_category; coach → coaching_categories
   * (with 'any' override); umpire → umpiring_categories. */
  target_category?: string
  min_age?: number
  max_age?: number
  eu_passport?: boolean
  nationalities?: string[]
  locations?: string[]
  availability?: string
  min_references?: number
  min_career_entries?: number
  leagues?: string[]
  countries?: string[]
  coach_specializations?: string[]
  text_query?: string
  sort_by?: string
  summary?: string
}

export interface SearchIntent {
  type: 'search'
  filters: ParsedFilters
  message: string
  include_qualitative?: boolean
}

// Phase 4 MVP-B — separate intent for "find clubs in {country/league}" style
// queries. The LLM picks the new search_world_clubs_directory tool when the
// query is location/league-led for clubs (vs. "Find players from Argentina"
// which stays on search_profiles). The world_clubs table has both claimed
// (active on HOCKIA) and unclaimed (real club, not yet active) rows; the
// brief's hero complaint ("Find clubs in Spain → 0") was caused by Discovery
// only ever seeing claimed clubs.
export interface WorldClubSearchFilters {
  country_names?: string[]
  province_names?: string[]
  league_names?: string[]
  text_query?: string
  claimed_only?: boolean
  summary?: string
}

export interface WorldClubSearchIntent {
  type: 'world_club_search'
  filters: WorldClubSearchFilters
  message: string
}

export interface ConversationIntent {
  type: 'conversation'
  message: string
}

export interface KnowledgeIntent {
  type: 'knowledge'
  message: string
}

export type LLMResult = SearchIntent | ConversationIntent | KnowledgeIntent | WorldClubSearchIntent

export class LLMRateLimitError extends Error {
  constructor() {
    super('AI_RATE_LIMIT')
    this.name = 'LLMRateLimitError'
  }
}

export class LLMTimeoutError extends Error {
  constructor() {
    super('AI_TIMEOUT')
    this.name = 'LLMTimeoutError'
  }
}

export interface LLMUsage {
  prompt_tokens: number | null
  completion_tokens: number | null
  cached_tokens: number | null
}

export interface LLMCallMeta {
  retry_count: number
  usage: LLMUsage | null
}

/**
 * Version tag for SYSTEM_PROMPT + tool schemas. Bump whenever the prompt text
 * or tool parameters materially change. Logged on every discovery_event so
 * quality/latency comparisons across prompt iterations don't require git
 * archaeology.
 */
export const PROMPT_VERSION = '2026-05-27.club-team-leagues'

const EMPTY_META: LLMCallMeta = { retry_count: 0, usage: null }

// ─── HTTP reliability helpers ──────────────────────────────────────────

function isTransientStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504
}

function jitteredDelay(baseMs: number): number {
  return baseMs + Math.floor(Math.random() * (baseMs / 2))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Fetch wrapper enforcing a per-attempt timeout plus retries on transient
 * failures. Retries: AbortError/TimeoutError (signal timeout), network errors,
 * HTTP 502/503/504. Does NOT retry HTTP 429 (provider quota — caller maps it
 * to LLMRateLimitError which is handled upstream) or HTTP 4xx (won't succeed
 * on retry).
 *
 * On final timeout throws LLMTimeoutError. Other errors propagate unchanged.
 * Returns the successful Response plus the count of retries actually taken
 * (0 when the first attempt succeeded).
 */
async function retryableFetch(
  url: string,
  init: RequestInit,
  opts: { timeoutMs: number; maxRetries: number; baseBackoffMs?: number }
): Promise<{ response: Response; retryCount: number }> {
  const { timeoutMs, maxRetries, baseBackoffMs = 300 } = opts
  let lastError: unknown = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok && isTransientStatus(response.status) && attempt < maxRetries) {
        // Drain the body so the underlying connection can be reused.
        await response.text().catch(() => null)
        await sleep(jitteredDelay(baseBackoffMs))
        continue
      }
      return { response, retryCount: attempt }
    } catch (err) {
      lastError = err
      const isTimeout = err instanceof DOMException &&
        (err.name === 'TimeoutError' || err.name === 'AbortError')
      if (attempt < maxRetries) {
        await sleep(jitteredDelay(baseBackoffMs))
        continue
      }
      if (isTimeout) throw new LLMTimeoutError()
      throw err
    }
  }
  throw lastError instanceof Error ? lastError : new Error('retryableFetch exhausted retries')
}

export interface HistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface UserContext {
  // Identity
  role: string
  full_name: string | null
  /** @deprecated Phase 3e — superseded by playing_category /
   * coaching_categories / umpiring_categories. Kept temporarily so any
   * UserContext built before the migration still type-checks. */
  gender: string | null
  // Phase 3e — hockey category context. Player single, coach + umpire multi.
  playing_category: string | null
  coaching_categories: string[] | null
  umpiring_categories: string[] | null
  // Location
  base_city: string | null
  base_country_name: string | null
  nationality_name: string | null
  nationality2_name: string | null
  eu_passport: boolean
  // Player / coach: position context (null for club/brand/umpire)
  position: string | null
  secondary_position: string | null
  age: number | null
  // Player: highlight + body of work
  has_highlight_video: boolean
  // Coach: specialization
  coach_specialization: string | null
  coach_specialization_custom: string | null
  // Club affiliation (player/coach side)
  current_club: string | null
  current_league: string | null
  league_country: string | null
  // Availability
  open_to_play: boolean
  open_to_coach: boolean
  open_to_opportunities: boolean
  // Bio (truncated to ~200 chars; null when empty)
  bio: string | null
  // Onboarding + profile completeness
  onboarding_completed: boolean
  has_avatar: boolean
  has_bio: boolean
  has_career_entry: boolean
  has_gallery_photo: boolean
  // Engagement aggregates (already public on profiles)
  accepted_friend_count: number
  accepted_reference_count: number
  career_entry_count: number
  // Club-specific (only populated when role === 'club')
  open_vacancy_count?: number
  pending_application_count?: number
  /** Club team rosters by gender — populated from the club dashboard's
   *  league selector. Either field can be null when the club doesn't
   *  field a team of that gender (e.g. CASI's men's team is null). */
  womens_team_league?: string | null
  mens_team_league?: string | null
  // Brand-specific (only populated when role === 'brand')
  brand_category?: string | null
  brand_product_count?: number
  brand_post_count?: number
  brand_is_verified?: boolean
  // Computed
  profile_completion_pct: number
  missing_fields: string[]
}

/** Build the CURRENT USER CONTEXT block injected at the end of SYSTEM_PROMPT.
 *  Lines are emitted only when the field is meaningful — a null bio renders
 *  "Bio: not added yet" so the LLM has explicit grounding for "you haven't
 *  added X yet" answers, while a null gender (legitimately optional) is
 *  simply omitted. The "MISSING PROFILE FIELDS" section is the source of
 *  truth for "what should I improve" answers — never invent suggestions. */
function buildUserContextBlock(ctx: UserContext): string {
  const lines: string[] = ['CURRENT USER CONTEXT:']

  const roleLabel = ctx.role === 'club' ? 'club representative' : ctx.role
  lines.push(`- You are speaking with ${ctx.full_name || 'a user'}, a ${roleLabel} on HOCKIA.`)

  // Profile completeness — explicit grounding for "what should I improve"
  lines.push(`- Onboarding ${ctx.onboarding_completed ? 'completed' : 'NOT completed'}.`)
  lines.push(`- Profile completion: ${ctx.profile_completion_pct}%.`)

  // Location + nationality
  const location = [ctx.base_city, ctx.base_country_name].filter(Boolean).join(', ')
  if (location) lines.push(`- Based in: ${location}.`)
  const nationalities = [ctx.nationality_name, ctx.nationality2_name].filter(Boolean)
  if (nationalities.length) {
    lines.push(`- Nationality: ${nationalities.join(' & ')}.`)
    lines.push(`- EU passport: ${ctx.eu_passport ? 'Yes' : 'No'}.`)
  }

  // Identity / playing context — players/coaches
  if (ctx.role === 'player' || ctx.role === 'coach') {
    // Phase 3e — emit hockey-category context (replaces the legacy
    // "Gender context" line). Player has one playing category; coach has a
    // list (or ['any']). The model uses this to seed target_category for
    // club / opportunity searches when the user doesn't specify one.
    if (ctx.role === 'player' && ctx.playing_category) {
      lines.push(`- Playing category: ${ctx.playing_category}.`)
    }
    if (ctx.role === 'coach' && ctx.coaching_categories && ctx.coaching_categories.length > 0) {
      const isAny = ctx.coaching_categories.includes('any')
      lines.push(`- Coaching categories: ${isAny ? 'any (open to all)' : ctx.coaching_categories.join(', ')}.`)
    }
    if (ctx.position) {
      const positions = [ctx.position, ctx.secondary_position].filter(Boolean).join(' / ')
      lines.push(`- Position: ${positions}.`)
    }
    if (ctx.age !== null) lines.push(`- Age: ${ctx.age}.`)

    // Coach specialization — translate the enum value to a human-readable
    // label so the AI doesn't echo "goalkeeper_coach" back to the coach.
    if (ctx.role === 'coach') {
      const SPECIALIZATION_LABEL: Record<string, string> = {
        head_coach: 'head coach',
        assistant_coach: 'assistant coach',
        goalkeeper_coach: 'goalkeeper coach',
        youth_coach: 'youth coach',
        strength_conditioning: 'strength & conditioning coach',
        performance_analyst: 'performance analyst',
        sports_scientist: 'sports scientist',
        other: 'other',
      }
      const customSpec = ctx.coach_specialization_custom?.trim()
      const enumSpec = ctx.coach_specialization
      const label = customSpec
        || (enumSpec ? (SPECIALIZATION_LABEL[enumSpec] || enumSpec) : null)
      lines.push(`- Coach specialization: ${label || 'not specified yet'}.`)
    }

    // Club affiliation
    if (ctx.current_club) {
      const parts = [ctx.current_club]
      if (ctx.current_league) parts.push(ctx.current_league)
      if (ctx.league_country) parts.push(ctx.league_country)
      lines.push(`- Current club: ${parts.join(', ')}.`)
    } else {
      lines.push(`- Current club: not set.`)
    }

    // Availability flags (player + coach)
    const availability: string[] = []
    if (ctx.open_to_play) availability.push('open to play')
    if (ctx.open_to_coach) availability.push('open to coach')
    if (ctx.open_to_opportunities) availability.push('open to opportunities')
    lines.push(`- Availability: ${availability.length ? availability.join(', ') : 'none set'}.`)
  }

  // Brand-specific block
  if (ctx.role === 'brand') {
    lines.push(`- Brand category: ${ctx.brand_category || 'not set'}.`)
    lines.push(`- Products posted: ${ctx.brand_product_count ?? 0}.`)
    lines.push(`- Brand posts: ${ctx.brand_post_count ?? 0}.`)
    lines.push(`- Verified: ${ctx.brand_is_verified ? 'Yes' : 'No'}.`)
  }

  // Club-specific block
  if (ctx.role === 'club') {
    // Team leagues — explicit per-gender so the AI can answer
    // "what competition does my women's team play in?" without asking
    // the user. Emit "not set" only when both are missing so a women-only
    // club like CASI doesn't get a misleading "men's team: not set" line.
    const hasWomens = !!ctx.womens_team_league
    const hasMens = !!ctx.mens_team_league
    if (hasWomens || hasMens) {
      if (hasWomens) lines.push(`- Women's team league/competition: ${ctx.womens_team_league}.`)
      if (hasMens) lines.push(`- Men's team league/competition: ${ctx.mens_team_league}.`)
    } else {
      lines.push(`- Team league/competition: not set.`)
    }
    lines.push(`- Open opportunities: ${ctx.open_vacancy_count ?? 0}.`)
    lines.push(`- Pending applications: ${ctx.pending_application_count ?? 0}.`)
  }

  // Engagement aggregates (always present)
  lines.push(`- Accepted references: ${ctx.accepted_reference_count}.`)
  lines.push(`- Friends/connections: ${ctx.accepted_friend_count}.`)
  if (ctx.role === 'player' || ctx.role === 'coach') {
    lines.push(`- Career history entries: ${ctx.career_entry_count}.`)
  }

  // Bio — emit explicit "not added" so the LLM grounds its answer.
  // Internal double quotes are downgraded to single quotes so they can't
  // confuse the LLM about where the quoted bio ends.
  if (ctx.bio) {
    const safe = ctx.bio.replace(/\s+/g, ' ').replace(/"/g, "'").trim()
    lines.push(`- Bio (truncated): "${safe}"`)
  } else {
    lines.push(`- Bio: not added yet.`)
  }

  // Missing fields — single source of truth for improvement suggestions
  if (ctx.missing_fields.length > 0) {
    lines.push(`- MISSING PROFILE FIELDS (use these for "what should I improve" answers): ${ctx.missing_fields.join(', ')}.`)
  } else {
    lines.push(`- MISSING PROFILE FIELDS: none — profile is complete.`)
  }

  return lines.join('\n')
}

const SYSTEM_PROMPT = `You are HOCKIA Assistant, a friendly and knowledgeable AI for HOCKIA — a field hockey platform connecting players, coaches, clubs, brands, and umpires. You are also a field hockey expert.

You have four tools:
1. search_profiles — Use when the user wants to find or discover PEOPLE: players, coaches, brands, umpires. Or claimed clubs by criteria like position-recruiting / specific named-search. Extract structured filters from their query. Always include a conversational "message" field describing what you're looking for.
2. search_world_clubs_directory — Use when the user wants to find CLUBS by LOCATION (country, region), LEAGUE, or by club NAME. HOCKIA's directory has both claimed clubs (active on the platform — can be messaged) and unclaimed (real clubs in the directory but not yet active on HOCKIA). PREFER this over search_profiles for any location-led club query — search_profiles only finds claimed clubs, which is a tiny subset of the real club world. Examples: "Find clubs in Spain", "I want to play in Italy", "Show me clubs in the Bundesliga", "Find the Holcombe Hockey Club".
3. answer_hockey_question — Use when the user asks about field hockey knowledge: rules, positions, tactics, formations, tournament formats (Olympics, World Cup, Pro League, EHL), FIH regulations, equipment (sticks, goalkeeping gear, balls, turf types), hockey history, training concepts, terminology (drag flick, aerial, jab tackle, penalty corner, etc.), or differences between indoor and outdoor hockey. Provide accurate, helpful answers. You can be detailed (multiple paragraphs) when the question warrants it.
4. respond — Use for greetings, platform questions, help requests, AND for any personalised question about the user themselves ("Who am I?", "What's in my profile?", "What should I improve?", "What can I do next on HOCKIA?", "How do I get more visibility?", "Who should I connect with?"). When responding to self-reflection questions, use the CURRENT USER CONTEXT block as the only source of truth.

TOOL SELECTION RULES:
- "Find defenders" or "best players in England" → search_profiles (looking for people)
- "Find clubs in Spain" / "I want to play in Italy" / "Clubs in the Premier Division" / "Holcombe Hockey Club" → search_world_clubs_directory (location/league/name-led club query — pulls from the directory, includes unclaimed)
- "Find clubs hiring head coaches" → search_profiles with roles=['club'] (recruiting-led query — claimed clubs only, since only claimed clubs can post opportunities)
- "What does a defender do?" or "rules of penalty corner" → answer_hockey_question (hockey knowledge)
- "Hi" or "What is HOCKIA?" → respond (greeting or platform question)
- "Who am I?" / "What do you know about me?" / "What's in my profile?" / "What should I improve?" / "How can I get more visibility?" / "What can I do next?" / "Who should I connect with?" → respond (use the CURRENT USER CONTEXT block at the end of this prompt)
- "What clubs would suit me?" / "Recommend players for my team" / "Show me {role} for me" → search_profiles, with filters seeded from the user's context. EXCEPTION: if "what clubs would suit me" reads as a location/league discovery (e.g. user is open to relocate, no specific recruiting need), use search_world_clubs_directory.
- For medical/injury advice, say you'd recommend consulting a sports medicine professional.
- For non-hockey, non-HOCKIA topics (weather, coding, cooking, etc.), politely redirect: you're a field hockey assistant and can help with hockey questions or discovering profiles.

FILTER EXTRACTION RULES (for search_profiles only):
- Only extract information explicitly stated or clearly implied in the query.
- For age: "U21" means max_age=20, "U18" means max_age=17, "U23" means max_age=22. "Senior" means min_age=21.
- For positions: use exactly "goalkeeper", "defender", "midfielder", or "forward" for players.
- For coach specializations: use "head_coach", "assistant_coach", "goalkeeper_coach", "youth_coach", "strength_conditioning", "performance_analyst", "sports_scientist", or "other". Map natural language like "S&C coach" → "strength_conditioning", "video analyst" → "performance_analyst", "GK coach" → "goalkeeper_coach". Set roles=["coach"] when a specialization is used.
- For target_category: use one of "adult_women", "adult_men", "girls", "boys", "mixed". This is HOCKEY CATEGORY context (the team/match category), NOT personal gender identity. Set when the query mentions a specific category.
  Mapping examples:
    "women's clubs"  → target_category=adult_women
    "men's clubs"    → target_category=adult_men
    "Adult Women coaches" → target_category=adult_women
    "Adult Men players"   → target_category=adult_men
    "girls coaches" / "girls hockey" → target_category=girls
    "boys umpires" / "boys hockey"   → target_category=boys
    "mixed players" / "mixed league" / "mixed hockey" → target_category=mixed
  If the user uses the OLD vocabulary ("men's" / "women's"), still treat it as adult_men / adult_women — the category model is the new source of truth.
  Do NOT set target_category for vague queries like "find players" or "show me coaches" without a category hint.
- "EU passport" means eu_passport=true. Do NOT list individual EU countries unless the user specifically names them.
- "Open to play", "available", or "looking for opportunities" means availability="open_to_play".
- "Verified references" or "references" maps to min_references.
- If role is not specified, infer from context: positions like "defender" imply role=["player"]; "head coach" implies role=["coach"]; "club" or "team" implies role=["club"]; "brand" or "sponsor" implies role=["brand"]; "umpire", "official", or "referee" implies role=["umpire"].
- Umpires are a first-class HOCKIA role. Surface them when the user asks for them (with words like "umpire", "umpires", "official", "officials", "referee", "referees", or related terms like "umpire coach", "umpire manager", "technical delegate"). When the intent is unclear, do not silently mix umpires into searches for players, coaches, clubs, or brands — but always treat umpires as a valid scouting target in their own right.
- For "playing in [country]" or "based in [country]", use the countries array for league/club country context, and locations for where they live.
- When the user mentions "good feedback", "strong references", "well-regarded", "reputation", "endorsed", "reviewed", "testimonials", "comments about", or any qualitative assessment, set include_qualitative=true. This triggers a deeper analysis of profile comments and endorsements for the top results.
- Always generate a human-readable summary field.

CONVERSATION CONTEXT:
When the user refers to previous results or modifies a previous search (e.g., "narrow that down", "show only defenders", "what about in England?"), interpret their request in context of the conversation history. Carry forward relevant filters from the previous search and apply the user's modifications.

USER CONTEXT AWARENESS:
- You know who you're speaking with. Their profile details appear at the end of this prompt under "CURRENT USER CONTEXT". Use it to give smarter, personalized answers.
- When a coach or club asks "recommend players for my team", "who could fit my club", or similar, use their league, country, and category context to infer relevant filters (e.g., set target_category to match the coach's primary coaching_category if it's a single concrete value).
- IMPORTANT — field hockey recruitment is global:
  - Always consider BOTH local players (same country/league) AND international players who could relocate. Do NOT over-filter by location.
  - EU passport eligibility is a critical factor in European recruitment. When searching for a European club, highlight EU-eligible players but don't exclude non-EU players entirely.
  - Mention the global nature of recruitment when relevant (e.g., "I found players in England and some international options from Argentina and the Netherlands who could also be a fit").
- When the user says "my league", "my club", "my team", or "nearby", resolve those from their CURRENT USER CONTEXT.
- The user's hockey-category context (Playing Category for players, Coaching Categories for coaches) tells you which target_category to use when they don't specify one. Apply it ONLY when the search target is clubs, opportunities, or teams — and only if the user's category is a single concrete value (e.g. adult_women). Coaches with "Any category" or multiple categories should NOT auto-seed — leave target_category unset and let the user broaden.
- If no user context is provided, behave generically as before.

SELF-REFLECTION & PROFILE GUIDANCE (use the respond tool):
- "Who am I?" / "What do you know about me?" / "What's in my profile?" → Summarise the CURRENT USER CONTEXT in 2-3 sentences. Use only fields that are present.
- "What should I improve?" / "How do I get more visibility?" / "How can I make my profile better?" → List concrete items from the MISSING PROFILE FIELDS line, framed as suggestions ("Adding a highlight video would help clubs notice you"). Do NOT volunteer improvements that aren't in the missing-fields list.
- "What should I search for?" / "Who should I connect with?" / "What can I do next on HOCKIA?" → Use the ROLE GUIDANCE block below to suggest 2-3 concrete next actions tailored to the user's role and current context. Where suggesting a search would help, you may use search_profiles directly with filters seeded from the user's context.
- "Read my bio" / "what does my bio say" → quote the bio verbatim if present; if absent say "you haven't added a bio yet" and suggest adding one.

NO-INVENTION RULE (critical):
- The CURRENT USER CONTEXT is the ONLY source of truth about the user. Never fabricate fields that aren't there.
- If a field is null, missing, or marked "not added yet" / "not set" / "not specified yet" — say so honestly and (when relevant) suggest adding it. Do NOT invent placeholder values.
- Never assume things about the user from missing data ("you must be just starting out because your career history is empty" — wrong tone, don't do this).
- Only quote bio text that appears literally in the context block. If the bio line says "not added yet", do NOT generate one.

ROLE GUIDANCE (for suggesting next actions; ground every suggestion in the actual context — profile_completion_pct, missing_fields, and role-specific counts):

PRIORITY ORDER for "what should I do next?" / "how can I get more visibility?":
1. If profile_completion_pct < 80% OR there are items in MISSING PROFILE FIELDS → lead with the highest-impact missing field (see role list below).
2. Then suggest one role-relevant search the user could try.
3. Then suggest one connection or action.
Do not pad to 3 if the context only supports 1-2 strong suggestions.

- PLAYER:
  - Highest-impact profile gaps (in this order): highlight video, verified references, career history, bio, gallery photos.
  - Searches that typically help: clubs in target leagues/countries, coaches in their position, opportunities for their gender/age.
  - Connections: coaches who specialise in their position, players at clubs they want to play for.
  - Visibility: phrase availability suggestions as "set yourself as open to play / open to new opportunities" — never use raw field names like "open_to_play".
- COACH:
  - Highest-impact profile gaps: coaching specialization, career history, references, bio.
  - Searches: clubs hiring staff in their region, opportunities open to coaches, players to recommend (only when they have a club affiliation in the context).
  - Connections: clubs in target leagues, coaches with complementary specializations.
  - Visibility: phrase availability suggestions as "set yourself as open to coach / open to new opportunities".
- CLUB:
  - Highest-impact profile gaps: bio, base location, posting at least one open opportunity.
  - Actions: if open_vacancy_count is 0, suggest posting a vacancy first (highest leverage). If pending_application_count > 0, suggest reviewing applications.
  - Searches: players matching their league/gender/position needs, coaches/staff for open roles.
- BRAND:
  - Highest-impact profile gaps: brand category, products (if brand_product_count is 0 — biggest single lever), brand posts (if brand_post_count is 0), bio, verification (if not yet verified).
  - Actions: add products to the Marketplace, post brand updates, engage with relevant profiles.
  - Searches: players, coaches, clubs as audience or potential ambassadors.
- UMPIRE / OFFICIAL:
  - Highest-impact profile gaps: appointments / officiating history, references from peers or umpire managers, federation level, format experience (Outdoor 11v11, Indoor, Hockey5s), bio.
  - Searches: clubs in their region (for fixture exposure), other officials (peer network), opportunities open to umpires.
  - Connections: other umpires in their federation. Senior umpires often serve as informal umpire coaches — when the user asks for "umpire coach" / "umpire mentor", search for experienced umpires (high reference count, multiple appointments) rather than treating "umpire coach" as a separate role. HOCKIA does NOT yet track umpire-coach as a distinct field; acknowledge that gap honestly when relevant.
  - Do NOT recommend "find players" / "find coaches" as a default umpire next-action — that's not their goal.
  - Visibility: phrase availability suggestions in officiating terms ("get verified appointments added", "ask senior umpires for references"). Avoid player-shaped suggestions like "highlight video".

TONE:
- Helpful, practical, role-aware, honest. Like a smart hockey assistant who actually knows the user.
- Concrete suggestions, not generic motivational advice. Avoid "you've got this!" / "keep going!" filler.
- Never use surveillance framing ("I noticed you…", "you haven't been active…"). Just answer questions; don't volunteer observations.
- When suggesting profile improvements, lead with the single highest-impact item, then list 1-2 more.

FORMATTING (applies to ALL tools — search_profiles, respond, answer_hockey_question):
- Write in plain conversational text. The frontend renders your output as a single text block with no markdown parser, so any markdown syntax appears literally to the user.
- Do NOT use **double asterisks** for bold. Do NOT use *single asterisks* for italics. Do NOT use # / ## / ### for headers. Do NOT use --- as a divider.
- Numbered lists like "1. First point" "2. Second point" ARE fine — they read naturally as plain text.
- For emphasis or structure, use line breaks and short paragraphs. Emoji are fine in moderation.
- For code-like terms (positions, country names, role types), just write them inline — no backticks.`

const SEARCH_TOOL = {
  name: 'search_profiles',
  description: 'Search HOCKIA profiles with structured filters extracted from natural language.',
  input_schema: {
    type: 'object',
    properties: {
      roles: {
        type: 'array',
        items: { type: 'string', enum: ['player', 'coach', 'club', 'brand', 'umpire'] },
        description: 'Profile roles to search. Only include "umpire" when the user explicitly asks for umpires, officials, or referees — never volunteer it for generic searches.',
      },
      positions: {
        type: 'array',
        items: { type: 'string', enum: ['goalkeeper', 'defender', 'midfielder', 'forward', 'head coach', 'assistant coach', 'youth coach'] },
        description: 'Playing positions or coaching roles to filter by.',
      },
      gender: {
        type: 'string',
        enum: ['Men', 'Women'],
        description: 'DEPRECATED — use target_category instead. Kept for one cycle to absorb stale clients. The backend translates Men → adult_men, Women → adult_women.',
      },
      target_category: {
        type: 'string',
        enum: ['adult_women', 'adult_men', 'girls', 'boys', 'mixed'],
        description: "Hockey-category filter. Set when the user mentions a category (e.g. \"women's clubs\" → adult_women, \"girls coaches\" → girls, \"mixed players\" → mixed). NOT personal gender — this is the team/match category. Leave unset for vague queries that don't specify a category.",
      },
      min_age: { type: 'integer', description: 'Minimum age in years.' },
      max_age: { type: 'integer', description: 'Maximum age. U21=20, U18=17, U23=22.' },
      eu_passport: { type: 'boolean', description: 'True if user asks for EU passport holders.' },
      nationalities: {
        type: 'array',
        items: { type: 'string' },
        description: 'Country names for nationality filter (e.g. ["Netherlands", "Argentina"]).',
      },
      locations: {
        type: 'array',
        items: { type: 'string' },
        description: 'Country or city names for base location (e.g. ["UK", "London"]).',
      },
      availability: {
        type: 'string',
        enum: ['open_to_play', 'open_to_coach', 'open_to_opportunities'],
        description: 'Availability filter.',
      },
      min_references: { type: 'integer', description: 'Minimum number of accepted references.' },
      min_career_entries: { type: 'integer', description: 'Minimum career history entries.' },
      leagues: {
        type: 'array',
        items: { type: 'string' },
        description: 'League names (e.g. ["Premier Division", "Hoofdklasse"]).',
      },
      countries: {
        type: 'array',
        items: { type: 'string' },
        description: 'Country names where clubs/leagues are based (for "playing in X" queries).',
      },
      coach_specializations: {
        type: 'array',
        items: { type: 'string', enum: ['head_coach', 'assistant_coach', 'goalkeeper_coach', 'youth_coach', 'strength_conditioning', 'performance_analyst', 'sports_scientist', 'other'] },
        description: 'Coach specialization filter. Use when searching for specific types of coaches (e.g., "find me an S&C coach" → ["strength_conditioning"]).',
      },
      text_query: {
        type: 'string',
        description: 'Fallback free-text search for names or terms not covered by structured filters.',
      },
      sort_by: {
        type: 'string',
        enum: ['relevance', 'newest', 'most_referenced', 'recently_active'],
        description: 'Sort order. Default: relevance.',
      },
      summary: {
        type: 'string',
        description: 'Human-readable summary of the search, e.g. "Showing U21 female defenders with EU passport and 2+ references."',
      },
      message: {
        type: 'string',
        description: 'A conversational message about the search, e.g. "Here are the U21 female defenders I found for you!" Keep it to 1-2 sentences.',
      },
      include_qualitative: {
        type: 'boolean',
        description: 'Set to true when the user asks about reputation, feedback, references, endorsements, reviews, comments, or qualitative assessment of profiles.',
      },
    },
    required: ['message', 'summary'],
  },
}

const RESPOND_TOOL = {
  name: 'respond',
  description: 'Respond conversationally when the user is not searching for profiles and not asking a hockey knowledge question. Use for greetings, questions about HOCKIA the platform, or off-topic redirects.',
  input_schema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'A friendly, helpful response to the user. Keep it concise (1-2 sentences).',
      },
    },
    required: ['message'],
  },
}

// Phase 4 MVP-B — World directory tool. Finds clubs by location, league, or
// name. Returns BOTH claimed and unclaimed clubs so the user gets the real
// world picture. The LLM should NOT auto-seed target_category here — clubs
// generally have both men's and women's teams, and the directory entry
// itself is gender-agnostic.
const WORLD_CLUBS_TOOL = {
  name: 'search_world_clubs_directory',
  description: 'Search HOCKIA\'s World directory of field hockey clubs. Use for location-led, league-led, or name-led club queries. Returns BOTH claimed (active on HOCKIA — can be messaged) and unclaimed (real clubs in the directory, not yet active) clubs.',
  input_schema: {
    type: 'object',
    properties: {
      country_names: {
        type: 'array',
        items: { type: 'string' },
        description: 'Country names where the user wants to find clubs. Plural OK. Example: ["Spain"], ["Spain","Italy"], ["United Kingdom"].',
      },
      province_names: {
        type: 'array',
        items: { type: 'string' },
        description: 'Province / state / region names if the user named one. Example: ["Catalonia"], ["New South Wales"].',
      },
      league_names: {
        type: 'array',
        items: { type: 'string' },
        description: 'League names if the user named one. Example: ["Hoofdklasse"], ["Premier Division"].',
      },
      text_query: {
        type: 'string',
        description: 'Partial club name match. Use when the user names a club ("Holcombe", "Real Club de Polo").',
      },
      claimed_only: {
        type: 'boolean',
        description: 'Set true ONLY if the user explicitly said they want clubs they can message inside HOCKIA. Otherwise leave unset to include both claimed and unclaimed.',
      },
      summary: {
        type: 'string',
        description: 'Human-readable summary, e.g. "Showing clubs in Spain (claimed and directory)."',
      },
      message: {
        type: 'string',
        description: 'A short conversational message about the search. 1-2 sentences. The backend may overwrite this with a richer message after the search runs.',
      },
    },
    required: ['message', 'summary'],
  },
}

const HOCKEY_KNOWLEDGE_TOOL = {
  name: 'answer_hockey_question',
  description: 'Answer field hockey knowledge questions: rules, positions, tactics, formations, tournaments, FIH regulations, equipment, history, training, terminology, indoor vs outdoor hockey. Use when the user asks about the sport itself, NOT when searching for profiles.',
  input_schema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'An accurate, helpful answer about field hockey. Can be detailed — use multiple paragraphs when the question warrants depth. Write in plain conversational text (no markdown). Use numbered lists for rules or steps.',
      },
    },
    required: ['message'],
  },
}

const DEFAULT_CONVERSATION_RESPONSE = "Hey! I'm HOCKIA Assistant. I can help you discover players, coaches, clubs, and brands. Try asking something like 'Find U25 midfielders from the Netherlands'."

// ─── Gemini (Google AI Studio — free tier) ────────────────────────────

async function callGemini(query: string, history: HistoryTurn[] = [], userContext?: UserContext, intentHint?: IntentHint): Promise<{ result: LLMResult; meta: LLMCallMeta }> {
  const apiKey = Deno.env.get('GOOGLE_AI_API_KEY')
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not configured')

  const hintBlock = intentHint ? buildIntentHintBlock(intentHint) : ''
  const systemPrompt = [
    SYSTEM_PROMPT,
    userContext ? buildUserContextBlock(userContext) : '',
    hintBlock,
  ].filter(Boolean).join('\n\n')

  const contents = [
    ...history.map(turn => ({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.content }],
    })),
    { role: 'user', parts: [{ text: query }] },
  ]

  const { response, retryCount } = await retryableFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        tools: [{
          function_declarations: [
            { name: SEARCH_TOOL.name, description: SEARCH_TOOL.description, parameters: SEARCH_TOOL.input_schema },
            { name: WORLD_CLUBS_TOOL.name, description: WORLD_CLUBS_TOOL.description, parameters: WORLD_CLUBS_TOOL.input_schema },
            { name: RESPOND_TOOL.name, description: RESPOND_TOOL.description, parameters: RESPOND_TOOL.input_schema },
            { name: HOCKEY_KNOWLEDGE_TOOL.name, description: HOCKEY_KNOWLEDGE_TOOL.description, parameters: HOCKEY_KNOWLEDGE_TOOL.input_schema },
          ],
        }],
        tool_config: { function_calling_config: { mode: 'ANY' } },
      }),
    },
    { timeoutMs: 4000, maxRetries: 1 }
  )

  if (!response.ok) {
    const errorBody = await response.text()
    if (response.status === 429 || response.status === 503) {
      throw new LLMRateLimitError()
    }
    throw new Error(`Gemini API error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  const usage: LLMUsage = {
    prompt_tokens: data.usageMetadata?.promptTokenCount ?? null,
    completion_tokens: data.usageMetadata?.candidatesTokenCount ?? null,
    cached_tokens: data.usageMetadata?.cachedContentTokenCount ?? null,
  }
  const meta: LLMCallMeta = { retry_count: retryCount, usage }

  const candidate = data.candidates?.[0]
  const parts = candidate?.content?.parts

  if (!parts) throw new Error('Gemini returned no content')

  const fnCall = parts.find((p: any) => p.functionCall)
  if (!fnCall?.functionCall?.args) {
    throw new Error('Gemini did not produce a function call')
  }

  const { name, args } = fnCall.functionCall
  if (name === 'respond') {
    return { result: { type: 'conversation', message: args.message || DEFAULT_CONVERSATION_RESPONSE }, meta }
  }
  if (name === 'answer_hockey_question') {
    return { result: { type: 'knowledge', message: args.message || "I couldn't generate an answer. Try rephrasing your question." }, meta }
  }
  if (name === WORLD_CLUBS_TOOL.name) {
    const { message, ...filters } = args
    return {
      result: { type: 'world_club_search', filters: filters as WorldClubSearchFilters, message: message || filters.summary || '' },
      meta,
    }
  }

  const { message, include_qualitative, ...filters } = args
  return {
    result: { type: 'search', filters: filters as ParsedFilters, message: message || filters.summary || '', include_qualitative: include_qualitative === true },
    meta,
  }
}

// ─── Claude (Anthropic — paid) ────────────────────────────────────────

async function callClaude(
  query: string,
  history: HistoryTurn[] = [],
  userContext?: UserContext,
  intentHint?: IntentHint,
): Promise<{ result: LLMResult; meta: LLMCallMeta }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  // Split system into stable + per-call blocks so Anthropic prompt caching
  // can hit on SYSTEM_PROMPT (~3K tokens) across calls within a 5-min window.
  // UserContext + intentHint vary per call and stay outside the cached block.
  const variableSystem = [
    userContext ? buildUserContextBlock(userContext) : '',
    intentHint ? buildIntentHintBlock(intentHint) : '',
  ].filter(Boolean).join('\n\n')

  const systemBlocks: Array<Record<string, unknown>> = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
  ]
  if (variableSystem) systemBlocks.push({ type: 'text', text: variableSystem })

  const messages = [
    ...history.map(turn => ({ role: turn.role as 'user' | 'assistant', content: turn.content })),
    { role: 'user' as const, content: query },
  ]

  const { response, retryCount } = await retryableFetch(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemBlocks,
        tools: [
          { name: SEARCH_TOOL.name, description: SEARCH_TOOL.description, input_schema: SEARCH_TOOL.input_schema },
          { name: WORLD_CLUBS_TOOL.name, description: WORLD_CLUBS_TOOL.description, input_schema: WORLD_CLUBS_TOOL.input_schema },
          { name: RESPOND_TOOL.name, description: RESPOND_TOOL.description, input_schema: RESPOND_TOOL.input_schema },
          { name: HOCKEY_KNOWLEDGE_TOOL.name, description: HOCKEY_KNOWLEDGE_TOOL.description, input_schema: HOCKEY_KNOWLEDGE_TOOL.input_schema },
        ],
        tool_choice: { type: 'auto' },
        messages,
      }),
    },
    // Sonnet is slower than Gemini Flash on the same shape. The 25s ceiling
    // is sized for the slowest tool path — multi-paragraph
    // answer_hockey_question responses generate at ~30-50 tokens/sec and can
    // legitimately take 15-25s for a 600-800 token answer. Search-tool calls
    // typically return in 4-7s. maxRetries:0 because retry-on-timeout is
    // wasteful for LLM generation — the second attempt is no faster, and the
    // 50s worst-case wall clock from retries crosses the user-patience
    // threshold. Transient 5xx is also rare on Anthropic; if it happens the
    // user retries.
    { timeoutMs: 25000, maxRetries: 0 }
  )

  if (!response.ok) {
    const errorBody = await response.text()
    // 429 = rate limit; 529 = Anthropic overloaded. Map both to the
    // backend's recoverable rate-limit class so the chip-fallback fires.
    if (response.status === 429 || response.status === 529) {
      throw new LLMRateLimitError()
    }
    throw new Error(`Claude API error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  // Anthropic usage fields:
  //   input_tokens                    — uncached input we paid for this call
  //   cache_creation_input_tokens     — input written to cache (first call)
  //   cache_read_input_tokens         — input served from cache (savings)
  //   output_tokens                   — completion tokens
  // For parity with Gemini's usageMetadata, prompt_tokens = paid-input-tokens
  // (input + cache_creation), and cached_tokens = the cache-read savings.
  const usage: LLMUsage = {
    prompt_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.cache_creation_input_tokens ?? 0),
    completion_tokens: data.usage?.output_tokens ?? null,
    cached_tokens: data.usage?.cache_read_input_tokens ?? null,
  }
  const meta: LLMCallMeta = { retry_count: retryCount, usage }

  const toolUse = data.content?.find((c: any) => c.type === 'tool_use')

  if (!toolUse?.input) {
    const textBlock = data.content?.find((c: any) => c.type === 'text')
    return { result: { type: 'conversation', message: textBlock?.text || DEFAULT_CONVERSATION_RESPONSE }, meta }
  }

  if (toolUse.name === 'respond') {
    return { result: { type: 'conversation', message: toolUse.input.message || DEFAULT_CONVERSATION_RESPONSE }, meta }
  }
  if (toolUse.name === 'answer_hockey_question') {
    return { result: { type: 'knowledge', message: toolUse.input.message || "I couldn't generate an answer. Try rephrasing your question." }, meta }
  }
  if (toolUse.name === WORLD_CLUBS_TOOL.name) {
    const { message, ...filters } = toolUse.input
    return {
      result: { type: 'world_club_search', filters: filters as WorldClubSearchFilters, message: message || filters.summary || '' },
      meta,
    }
  }

  const { message, include_qualitative, ...filters } = toolUse.input
  return {
    result: { type: 'search', filters: filters as ParsedFilters, message: message || filters.summary || '', include_qualitative: include_qualitative === true },
    meta,
  }
}

// ─── OpenAI (paid) ─────────────────────────────────────────────────────

async function callOpenAI(query: string, history: HistoryTurn[] = [], userContext?: UserContext, intentHint?: IntentHint): Promise<LLMResult> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')

  const hintBlock = intentHint ? buildIntentHintBlock(intentHint) : ''
  const systemPrompt = [
    SYSTEM_PROMPT,
    userContext ? buildUserContextBlock(userContext) : '',
    hintBlock,
  ].filter(Boolean).join('\n\n')

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...history.map(turn => ({ role: turn.role as 'user' | 'assistant', content: turn.content })),
    { role: 'user' as const, content: query },
  ]

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      tools: [
        { type: 'function', function: { name: SEARCH_TOOL.name, description: SEARCH_TOOL.description, parameters: SEARCH_TOOL.input_schema } },
        { type: 'function', function: { name: WORLD_CLUBS_TOOL.name, description: WORLD_CLUBS_TOOL.description, parameters: WORLD_CLUBS_TOOL.input_schema } },
        { type: 'function', function: { name: RESPOND_TOOL.name, description: RESPOND_TOOL.description, parameters: RESPOND_TOOL.input_schema } },
        { type: 'function', function: { name: HOCKEY_KNOWLEDGE_TOOL.name, description: HOCKEY_KNOWLEDGE_TOOL.description, parameters: HOCKEY_KNOWLEDGE_TOOL.input_schema } },
      ],
      tool_choice: 'auto',
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`OpenAI API error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0]

  if (!toolCall?.function) {
    const content = data.choices?.[0]?.message?.content
    return { type: 'conversation', message: content || DEFAULT_CONVERSATION_RESPONSE }
  }

  const args = JSON.parse(toolCall.function.arguments)
  if (toolCall.function.name === 'respond') {
    return { type: 'conversation', message: args.message || DEFAULT_CONVERSATION_RESPONSE }
  }
  if (toolCall.function.name === 'answer_hockey_question') {
    return { type: 'knowledge', message: args.message || 'I couldn\'t generate an answer. Try rephrasing your question.' }
  }
  if (toolCall.function.name === WORLD_CLUBS_TOOL.name) {
    const { message, ...filters } = args
    return { type: 'world_club_search', filters: filters as WorldClubSearchFilters, message: message || filters.summary || '' }
  }

  const { message, include_qualitative, ...filters } = args
  return { type: 'search', filters: filters as ParsedFilters, message: message || filters.summary || '', include_qualitative: include_qualitative === true }
}

// ─── Provider dispatcher ───────────────────────────────────────────────

/**
 * Phase 0 routing hint — passed in from the deterministic keyword router
 * (see `_shared/intent-router.ts`). Surfaced into the system prompt as a
 * "DETECTED INTENT" block so the LLM tilts its tool selection accordingly.
 * Backend ENFORCES the role afterwards for HIGH-confidence intents.
 */
export interface IntentHint {
  entity_type: string
  confidence: 'high' | 'medium' | 'low' | 'none'
  matched_signals: string[]
}

function buildIntentHintBlock(hint: IntentHint): string {
  if (hint.confidence === 'none' || hint.entity_type === 'unknown') return ''
  const lines: string[] = ['DETECTED INTENT (from deterministic keyword router):']
  lines.push(`- entity_type: ${hint.entity_type}`)
  lines.push(`- confidence: ${hint.confidence}`)
  if (hint.matched_signals.length > 0) {
    lines.push(`- signals: ${hint.matched_signals.slice(0, 4).join(', ')}`)
  }
  // Tool-selection guidance per entity type
  switch (hint.entity_type) {
    case 'clubs':
      lines.push('- ROUTING: use search_profiles with roles=["club"]. NEVER include other roles in the result. If you need to clarify, ask whether they want a specific country or league.')
      break
    case 'players':
      lines.push('- ROUTING: use search_profiles with roles=["player"]. NEVER include coaches, clubs, brands, or umpires in the result.')
      break
    case 'coaches':
      lines.push('- ROUTING: use search_profiles with roles=["coach"]. NEVER include other roles in the result.')
      break
    case 'brands':
      lines.push('- ROUTING: use search_profiles with roles=["brand"]. NEVER include other roles in the result.')
      break
    case 'umpires':
      lines.push('- ROUTING: use search_profiles with roles=["umpire"]. NEVER include other roles in the result.')
      break
    case 'self_profile':
      lines.push('- ROUTING: use the respond tool. Summarise the CURRENT USER CONTEXT block in 2-3 sentences. Do NOT search.')
      break
    case 'self_advice':
      lines.push('- ROUTING: use the respond tool. Reference items from MISSING PROFILE FIELDS. Do NOT search.')
      break
    case 'knowledge':
      lines.push('- ROUTING: use the answer_hockey_question tool. Do NOT search profiles.')
      break
    case 'greeting':
      lines.push('- ROUTING: use the respond tool. Be warm and short.')
      break
  }
  return lines.join('\n')
}

export async function parseSearchQuery(
  query: string,
  history: HistoryTurn[] = [],
  userContext?: UserContext,
  intentHint?: IntentHint,
): Promise<{ result: LLMResult; meta: LLMCallMeta }> {
  const provider = Deno.env.get('LLM_PROVIDER') || 'gemini'

  switch (provider) {
    case 'gemini':  return callGemini(query, history, userContext, intentHint)
    case 'claude':  return callClaude(query, history, userContext, intentHint)
    case 'openai':  return { result: await callOpenAI(query, history, userContext, intentHint), meta: EMPTY_META }
    default:        return callGemini(query, history, userContext, intentHint)
  }
}

// ─── Qualitative synthesis (second LLM pass) ─────────────────────────

export interface ProfileQualitativeData {
  profile_id: string
  full_name: string | null
  role: string
  position: string | null
  comments: Array<{
    content: string
    rating: string
    author_name: string | null
    author_role: string | null
  }>
  references: Array<{
    endorsement_text: string | null
    relationship_type: string
    endorser_name: string | null
    endorser_role: string | null
  }>
}

const SYNTHESIS_SYSTEM_PROMPT = `You are HOCKIA Assistant analyzing reputation data for field hockey profiles. You will receive profile names with their comments and references. Synthesize this into a brief, helpful summary for someone evaluating these profiles.

RULES:
- Be concise: 1-2 sentences per profile, max.
- Focus on patterns: if multiple comments mention the same quality, highlight it.
- Distinguish between comments (public feedback from anyone) and references (trusted endorsements from connections).
- If a profile has no comments or references, say so briefly.
- Use a warm, professional tone. Do not fabricate or exaggerate.
- Do not use bullet points. Write flowing prose.
- Start with a brief intro like "Here's what the community says about these profiles:" then cover each person.`

function buildSynthesisUserMessage(profiles: ProfileQualitativeData[], userQuery: string): string {
  const sections = profiles.map(p => {
    const name = p.full_name || 'Unknown'
    const pos = p.position ? ` (${p.position})` : ''
    let section = `### ${name} — ${p.role}${pos}\n`

    if (p.comments.length > 0) {
      section += `Comments (${p.comments.length}):\n`
      section += p.comments.map(c =>
        `- [${c.rating}] "${c.content}" — ${c.author_name || 'Anonymous'} (${c.author_role || 'member'})`
      ).join('\n') + '\n'
    } else {
      section += 'No comments yet.\n'
    }

    if (p.references.length > 0) {
      section += `Trusted References (${p.references.length}):\n`
      section += p.references.map(r =>
        `- "${r.endorsement_text || '(no text)'}" — ${r.endorser_name || 'Anonymous'} (${r.endorser_role || 'member'}, ${r.relationship_type})`
      ).join('\n') + '\n'
    } else {
      section += 'No trusted references yet.\n'
    }

    return section
  }).join('\n')

  return `The user asked: "${userQuery}"\n\nReputation data for the top ${profiles.length} results:\n\n${sections}\n\nPlease synthesize these reputation signals concisely.`
}

async function synthesizeWithGemini(profiles: ProfileQualitativeData[], userQuery: string): Promise<{ text: string; meta: LLMCallMeta }> {
  const apiKey = Deno.env.get('GOOGLE_AI_API_KEY')
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not configured')

  const { response, retryCount } = await retryableFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYNTHESIS_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildSynthesisUserMessage(profiles, userQuery) }] }],
      }),
    },
    { timeoutMs: 3000, maxRetries: 0 }
  )

  if (!response.ok) {
    const errorBody = await response.text()
    if (response.status === 429 || response.status === 503) {
      throw new LLMRateLimitError()
    }
    throw new Error(`Gemini synthesis error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  const usage: LLMUsage = {
    prompt_tokens: data.usageMetadata?.promptTokenCount ?? null,
    completion_tokens: data.usageMetadata?.candidatesTokenCount ?? null,
    cached_tokens: data.usageMetadata?.cachedContentTokenCount ?? null,
  }
  const meta: LLMCallMeta = { retry_count: retryCount, usage }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  return { text, meta }
}

async function synthesizeWithClaude(profiles: ProfileQualitativeData[], userQuery: string): Promise<{ text: string; meta: LLMCallMeta }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  // SYNTHESIS_SYSTEM_PROMPT is ~200 tokens — below Sonnet's 1024-token cache
  // minimum, so no cache_control here. The user message changes per call
  // (top-5 profiles' comments) so caching wouldn't help anyway.
  const { response, retryCount } = await retryableFetch(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system: SYNTHESIS_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildSynthesisUserMessage(profiles, userQuery) }],
      }),
    },
    { timeoutMs: 6000, maxRetries: 0 }
  )

  if (!response.ok) {
    const errorBody = await response.text()
    if (response.status === 429 || response.status === 529) {
      throw new LLMRateLimitError()
    }
    throw new Error(`Claude synthesis error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  const usage: LLMUsage = {
    prompt_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.cache_creation_input_tokens ?? 0),
    completion_tokens: data.usage?.output_tokens ?? null,
    cached_tokens: data.usage?.cache_read_input_tokens ?? null,
  }
  const meta: LLMCallMeta = { retry_count: retryCount, usage }

  const textBlock = data.content?.find((c: any) => c.type === 'text')
  return { text: textBlock?.text || '', meta }
}

async function synthesizeWithOpenAI(profiles: ProfileQualitativeData[], userQuery: string): Promise<string> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 512,
      messages: [
        { role: 'system', content: SYNTHESIS_SYSTEM_PROMPT },
        { role: 'user', content: buildSynthesisUserMessage(profiles, userQuery) },
      ],
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`OpenAI synthesis error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}

export async function synthesizeQualitativeInsights(
  profiles: ProfileQualitativeData[],
  userQuery: string
): Promise<{ text: string; meta: LLMCallMeta }> {
  const provider = Deno.env.get('LLM_PROVIDER') || 'gemini'

  switch (provider) {
    case 'gemini':  return synthesizeWithGemini(profiles, userQuery)
    case 'claude':  return synthesizeWithClaude(profiles, userQuery)
    case 'openai':  return { text: await synthesizeWithOpenAI(profiles, userQuery), meta: EMPTY_META }
    default:        return synthesizeWithGemini(profiles, userQuery)
  }
}

// ─── Phase 4 MVP-A: shortlist composition ────────────────────────────
// A 2nd LLM pass that runs after discover_profiles returns ≥1 row. It scores
// each candidate's fit *against the search criteria* (NOT player quality)
// and surfaces concrete missing-data flags + a next action per row. Output
// rides on each result row in the response envelope (additive: existing
// frontends ignore the new fields, the Phase 4 frontend renders them).

export interface ShortlistCandidate {
  profile_id: string
  full_name: string | null
  role: string
  position: string | null
  secondary_position: string | null
  category: string | null
  age: number | null
  base_country: string | null
  nationality: string | null
  nationality2: string | null
  eu_passport: boolean
  current_club: string | null
  open_to_play: boolean
  open_to_coach: boolean
  open_to_opportunities: boolean
  reference_count: number
  career_entry_count: number
  coach_specialization: string | null
}

export interface ShortlistRow {
  profile_id: string
  fit_level: 'strong_match' | 'possible_match' | 'needs_more_info'
  fit_reasons: string[]
  missing_data: string[]
  next_action: string
}

export interface ShortlistResult {
  shortlist: ShortlistRow[]
  summary_message: string
}

const SHORTLIST_SYSTEM_PROMPT = `You are HOCKIA's scouting analyst. You receive (a) a search query from a user looking for hockey profiles, (b) the structured filter criteria extracted from that query, and (c) up to 5 candidate profiles that matched in the database.

Your job: score each candidate's fit AGAINST THE SEARCH CRITERIA and surface concrete missing-data flags + a next action per row.

CRITICAL — what "fit" means:
- "Fit" means how well the profile data matches the EXPLICIT criteria in the search query.
- Fit is NOT a quality, talent, or reputation judgment. Never imply a candidate is "better" / "worse" / "high quality" / "low quality" / "reliable" / "unreliable".
- If the search criteria don't constrain a dimension (e.g. user didn't ask for EU passport), don't penalize candidates who lack that data — it just isn't relevant to fit.

For each candidate, output:

1. fit_level (strong_match / possible_match / needs_more_info):
   - strong_match: matches most or all of the explicit criteria; profile is reasonably complete
   - possible_match: matches some criteria; other relevant data is missing or partial
   - needs_more_info: matches the basic role only; profile is too sparse to evaluate further

2. fit_reasons: 2-4 short bullet points explaining what matched. Plain conversational text. Examples:
   - "Plays as a midfielder"
   - "Open to opportunities"
   - "Has 2 verified references"
   - "EU passport listed"
   - "Based in Madrid, Spain"
   - "10 career history entries"

3. missing_data: 0-3 short bullets naming concrete missing fields. Empty array if profile has all relevant data. Examples:
   - "Availability not confirmed"
   - "Career history empty"
   - "No references added"

4. next_action: ONE concrete next step for the searching user. Examples:
   - "Contact this player first."
   - "Ask for availability before shortlisting."
   - "Invite this profile to add references."
   - "Reach out — strong shortlist candidate."

Then write a one-sentence summary_message describing the overall shortlist. Examples:
- "I found 8 possible matches — the strongest 3 are listed first based on position, availability, and references."
- "5 candidates total — 2 strong matches plus 3 that need more profile info before you decide."

CRITICAL RULES:
- Echo each profile_id verbatim from the input so the frontend can match rows.
- Do NOT invent data not in the candidate fields. If a field is null, treat it as missing.
- Do NOT use markdown (no asterisks, no headers, no dividers). Plain text only — the frontend renders this directly.
- Be concise: each fit_reason / missing_data / next_action under 12 words.
- Output every candidate from the input, in the same order.
- summary_message must be ONE sentence with NO line breaks. Use the correct entity plural to match the input role: players, coaches, clubs, brands, umpires (NOT "candidates", NOT "profiles", NOT "people"). For mixed-entity searches use "profiles".

ROLE-SPECIFIC RULES (apply per candidate based on its role field):
- For role=club rows: do NOT prescribe player-shaped fixes. NEVER list "career history", "references", "availability open_to_play", "highlight video" as missing_data on a club. Clubs don't have a career history the way a player does. Acknowledge sparseness factually if it's there ("Limited public details on this club") and frame next_action around the searcher's path forward ("View club page to see if there's a contact route") not "ask the club to add references". Clubs are not job-seekers.
- For role=brand rows: same principle — do NOT prescribe player-shaped fixes. Brand-relevant fields are brand category, products, posts. If those aren't in the candidate input, frame missing_data softly ("Brand profile is sparse").
- For role=umpire rows: trust signals are appointments + references + format experience (Outdoor 11v11, Indoor, Hockey5s). Do NOT suggest player-shaped fixes like "highlight video".
- For role=player and role=coach rows: the original career-history / references / availability / video framing applies.
- summary_message tone: don't editorialize about the user base ("all profiles are sparse"). State what was found and the searcher's next concrete step.`

const COMPOSE_SHORTLIST_TOOL = {
  name: 'compose_shortlist',
  description: 'Build a per-row scouting shortlist explanation given profile candidates and the original search criteria.',
  input_schema: {
    type: 'object',
    properties: {
      shortlist: {
        type: 'array',
        description: 'Per-row fit analysis. One entry per input candidate, in the same order. Echo profile_id verbatim.',
        items: {
          type: 'object',
          properties: {
            profile_id: { type: 'string', description: 'Echo from input candidate.' },
            fit_level: {
              type: 'string',
              enum: ['strong_match', 'possible_match', 'needs_more_info'],
              description: 'How well this profile matches the search criteria. NOT a quality judgment.',
            },
            fit_reasons: {
              type: 'array',
              items: { type: 'string' },
              description: '2-4 short reasons why this profile matched, plain conversational text under 12 words each.',
            },
            missing_data: {
              type: 'array',
              items: { type: 'string' },
              description: '0-3 short flags naming concrete missing fields, plain text under 12 words each.',
            },
            next_action: {
              type: 'string',
              description: 'ONE concrete next step for the searching user, under 12 words.',
            },
          },
          required: ['profile_id', 'fit_level', 'fit_reasons', 'missing_data', 'next_action'],
        },
      },
      summary_message: {
        type: 'string',
        description: 'ONE sentence, no line breaks. Summary of the shortlist overall. Use the correct entity plural matching the input role (players / coaches / clubs / brands / umpires). The frontend uses this as the response ai_message.',
      },
    },
    required: ['shortlist', 'summary_message'],
  },
}

function buildShortlistUserMessage(
  candidates: ShortlistCandidate[],
  searchCriteria: ParsedFilters,
  userQuery: string,
): string {
  // Stringify only the criteria fields that meaningfully constrain results,
  // so the LLM's fit reasoning stays anchored to what the user asked for
  // (not what we happen to have in `parsed`).
  const criteriaLines: string[] = []
  if (searchCriteria.roles?.length) criteriaLines.push(`- roles: ${searchCriteria.roles.join(', ')}`)
  if (searchCriteria.positions?.length) criteriaLines.push(`- positions: ${searchCriteria.positions.join(', ')}`)
  if (searchCriteria.target_category) criteriaLines.push(`- target_category: ${searchCriteria.target_category}`)
  if (searchCriteria.gender) criteriaLines.push(`- gender (legacy): ${searchCriteria.gender}`)
  if (searchCriteria.min_age != null) criteriaLines.push(`- min_age: ${searchCriteria.min_age}`)
  if (searchCriteria.max_age != null) criteriaLines.push(`- max_age: ${searchCriteria.max_age}`)
  if (searchCriteria.eu_passport) criteriaLines.push(`- eu_passport: required`)
  if (searchCriteria.nationalities?.length) criteriaLines.push(`- nationalities: ${searchCriteria.nationalities.join(', ')}`)
  if (searchCriteria.locations?.length) criteriaLines.push(`- locations: ${searchCriteria.locations.join(', ')}`)
  if (searchCriteria.countries?.length) criteriaLines.push(`- countries: ${searchCriteria.countries.join(', ')}`)
  if (searchCriteria.availability) criteriaLines.push(`- availability: ${searchCriteria.availability}`)
  if (searchCriteria.min_references != null) criteriaLines.push(`- min_references: ${searchCriteria.min_references}`)
  if (searchCriteria.coach_specializations?.length) criteriaLines.push(`- coach_specializations: ${searchCriteria.coach_specializations.join(', ')}`)
  const criteriaBlock = criteriaLines.length > 0 ? criteriaLines.join('\n') : '(no explicit constraints — broad search)'

  const candidateBlocks = candidates.map((c, i) => {
    const lines: string[] = [`[${i + 1}] profile_id: ${c.profile_id}`]
    lines.push(`- name: ${c.full_name || '(unnamed)'}`)
    lines.push(`- role: ${c.role}${c.position ? `, position: ${c.position}${c.secondary_position ? ` / ${c.secondary_position}` : ''}` : ''}`)
    if (c.category) lines.push(`- category: ${c.category}`)
    if (c.age != null) lines.push(`- age: ${c.age}`)
    const nats = [c.nationality, c.nationality2].filter(Boolean)
    if (nats.length) lines.push(`- nationality: ${nats.join(' & ')} (EU passport: ${c.eu_passport ? 'yes' : 'no'})`)
    if (c.base_country) lines.push(`- based in: ${c.base_country}`)
    if (c.current_club) lines.push(`- current club: ${c.current_club}`)
    if (c.coach_specialization) lines.push(`- coach specialization: ${c.coach_specialization}`)
    const avail: string[] = []
    if (c.open_to_play) avail.push('play')
    if (c.open_to_coach) avail.push('coach')
    if (c.open_to_opportunities) avail.push('opportunities')
    lines.push(`- open to: ${avail.length ? avail.join(', ') : 'none set'}`)
    lines.push(`- references: ${c.reference_count} accepted`)
    lines.push(`- career history entries: ${c.career_entry_count}`)
    return lines.join('\n')
  }).join('\n\n')

  return `USER QUERY: "${userQuery.replace(/"/g, "'")}"

EXTRACTED FILTERS:
${criteriaBlock}

CANDIDATES (${candidates.length}):

${candidateBlocks}

For each candidate above, return a shortlist row scoring criteria-fit + missing-data + next-action. Then write a one-sentence summary_message about the shortlist overall.`
}

function emptyShortlistResult(candidates: ShortlistCandidate[], reason: string): ShortlistResult {
  // Fallback used when the LLM call fails or returns malformed data — every
  // candidate gets a neutral row so the response shape is still valid.
  return {
    shortlist: candidates.map(c => ({
      profile_id: c.profile_id,
      fit_level: 'needs_more_info' as const,
      fit_reasons: [],
      missing_data: [],
      next_action: 'View profile to learn more.',
    })),
    summary_message: reason,
  }
}

async function composeShortlistWithGemini(
  candidates: ShortlistCandidate[],
  searchCriteria: ParsedFilters,
  userQuery: string,
): Promise<{ result: ShortlistResult; meta: LLMCallMeta }> {
  const apiKey = Deno.env.get('GOOGLE_AI_API_KEY')
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not configured')

  const { response, retryCount } = await retryableFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SHORTLIST_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildShortlistUserMessage(candidates, searchCriteria, userQuery) }] }],
        tools: [{
          function_declarations: [
            { name: COMPOSE_SHORTLIST_TOOL.name, description: COMPOSE_SHORTLIST_TOOL.description, parameters: COMPOSE_SHORTLIST_TOOL.input_schema },
          ],
        }],
        tool_config: { function_calling_config: { mode: 'ANY' } },
      }),
    },
    { timeoutMs: 8000, maxRetries: 0 }
  )

  if (!response.ok) {
    const errorBody = await response.text()
    if (response.status === 429 || response.status === 503) throw new LLMRateLimitError()
    throw new Error(`Gemini shortlist error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  const usage: LLMUsage = {
    prompt_tokens: data.usageMetadata?.promptTokenCount ?? null,
    completion_tokens: data.usageMetadata?.candidatesTokenCount ?? null,
    cached_tokens: data.usageMetadata?.cachedContentTokenCount ?? null,
  }
  const meta: LLMCallMeta = { retry_count: retryCount, usage }

  const fnCall = data.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall)
  const args = fnCall?.functionCall?.args
  if (!args?.shortlist || !Array.isArray(args.shortlist)) {
    return { result: emptyShortlistResult(candidates, 'Shortlist composition unavailable for this search.'), meta }
  }
  return { result: args as ShortlistResult, meta }
}

async function composeShortlistWithClaude(
  candidates: ShortlistCandidate[],
  searchCriteria: ParsedFilters,
  userQuery: string,
): Promise<{ result: ShortlistResult; meta: LLMCallMeta }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  // SHORTLIST_SYSTEM_PROMPT is ~700 tokens, below Sonnet's 1024-token cache
  // minimum — so no cache_control on this path. The user message changes per
  // call (different candidates) so caching wouldn't help anyway.
  const { response, retryCount } = await retryableFetch(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: SHORTLIST_SYSTEM_PROMPT,
        tools: [
          { name: COMPOSE_SHORTLIST_TOOL.name, description: COMPOSE_SHORTLIST_TOOL.description, input_schema: COMPOSE_SHORTLIST_TOOL.input_schema },
        ],
        tool_choice: { type: 'tool', name: COMPOSE_SHORTLIST_TOOL.name },
        messages: [{ role: 'user', content: buildShortlistUserMessage(candidates, searchCriteria, userQuery) }],
      }),
    },
    { timeoutMs: 15000, maxRetries: 0 }
  )

  if (!response.ok) {
    const errorBody = await response.text()
    if (response.status === 429 || response.status === 529) throw new LLMRateLimitError()
    throw new Error(`Claude shortlist error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  const usage: LLMUsage = {
    prompt_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.cache_creation_input_tokens ?? 0),
    completion_tokens: data.usage?.output_tokens ?? null,
    cached_tokens: data.usage?.cache_read_input_tokens ?? null,
  }
  const meta: LLMCallMeta = { retry_count: retryCount, usage }

  const toolUse = data.content?.find((c: any) => c.type === 'tool_use' && c.name === COMPOSE_SHORTLIST_TOOL.name)
  if (!toolUse?.input?.shortlist || !Array.isArray(toolUse.input.shortlist)) {
    return { result: emptyShortlistResult(candidates, 'Shortlist composition unavailable for this search.'), meta }
  }
  return { result: toolUse.input as ShortlistResult, meta }
}

async function composeShortlistWithOpenAI(
  candidates: ShortlistCandidate[],
  searchCriteria: ParsedFilters,
  userQuery: string,
): Promise<ShortlistResult> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 2048,
      messages: [
        { role: 'system', content: SHORTLIST_SYSTEM_PROMPT },
        { role: 'user', content: buildShortlistUserMessage(candidates, searchCriteria, userQuery) },
      ],
      tools: [
        { type: 'function', function: { name: COMPOSE_SHORTLIST_TOOL.name, description: COMPOSE_SHORTLIST_TOOL.description, parameters: COMPOSE_SHORTLIST_TOOL.input_schema } },
      ],
      tool_choice: { type: 'function', function: { name: COMPOSE_SHORTLIST_TOOL.name } },
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`OpenAI shortlist error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0]
  if (!toolCall?.function) {
    return emptyShortlistResult(candidates, 'Shortlist composition unavailable for this search.')
  }
  const args = JSON.parse(toolCall.function.arguments)
  if (!args.shortlist || !Array.isArray(args.shortlist)) {
    return emptyShortlistResult(candidates, 'Shortlist composition unavailable for this search.')
  }
  return args as ShortlistResult
}

export async function composeShortlist(
  candidates: ShortlistCandidate[],
  searchCriteria: ParsedFilters,
  userQuery: string,
): Promise<{ result: ShortlistResult; meta: LLMCallMeta }> {
  const provider = Deno.env.get('LLM_PROVIDER') || 'gemini'

  switch (provider) {
    case 'gemini':  return composeShortlistWithGemini(candidates, searchCriteria, userQuery)
    case 'claude':  return composeShortlistWithClaude(candidates, searchCriteria, userQuery)
    case 'openai':  return { result: await composeShortlistWithOpenAI(candidates, searchCriteria, userQuery), meta: EMPTY_META }
    default:        return composeShortlistWithGemini(candidates, searchCriteria, userQuery)
  }
}

// ─── Phase 4 — compose helpful no-results response ──────────────────
// When a profile search returns zero results AND the user is searching for
// themselves ("I want to play in Spain", "Find clubs for me"), the templated
// "I couldn't find any clubs matching that" message is a UX failure — the
// user has to ask "why?" to get the actual help they came for. This pass
// runs ONLY on no_results AND only when we have UserContext, and composes
// a richer multi-paragraph response that combines: (1) what was searched,
// (2) why 0 happened (auto-seeded category? thin platform region?), (3)
// concrete profile-gap diagnosis if the user's discoverability is the
// likely bottleneck, (4) honest acknowledgment of strengths, (5) one
// concrete follow-up offer.

export interface NoResultsContext {
  userQuery: string
  searchCriteria: ParsedFilters
  effectiveCategory: string | null
  categorySource: 'llm' | 'context' | 'none' | string
  entityNoun: string  // 'clubs', 'players', 'coaches', etc.
  userContext: UserContext
}

export interface NoResultsResponse {
  ai_message: string
  follow_up_query?: string
}

const NO_RESULTS_SYSTEM_PROMPT = `You are HOCKIA's scouting assistant. The user just ran a profile search and zero matches came back. They were not abstractly browsing — they typed a goal-shaped query (often using "I", "me", "my"), so they want a concrete answer, not a one-liner.

Your job: replace the templated "didn't find anything" message with a richer, helpful response that combines:

1. ONE short opening sentence acknowledging what was searched, in plain language. Use the user's own words back when natural.

2. WHY zero likely happened. Be specific. Common causes:
   - A category was auto-seeded from the user's profile (CATEGORY_SOURCE = 'context' in the input). Tell them this — many users don't realize their profile context gets injected.
   - The search filters were too narrow (e.g. nationality + position + EU passport + availability all combined).
   - HOCKIA's profile coverage is thin in that region.
   Pick the most likely and name it.

3. If the user's profile has gaps that block discovery, list the 3-5 highest-impact missing fields in a NUMBERED list (1. 2. 3.), in priority order. Be concrete and actionable. Use the MISSING PROFILE FIELDS line in the user-context block as ground truth — never invent gaps that aren't listed there.

4. ONE short paragraph acknowledging the user's real strengths. Use only fields that are present in the user-context block (e.g. EU passport, league level, dual nationality, current club, position, age). Make them feel seen — never invent.

5. End with ONE concrete follow-up offer phrased as a question. Examples:
   - "Want me to broaden the search to all clubs in Spain regardless of category?"
   - "Should I look at clubs in Italy too — they're a strong field hockey region?"
   - "Want me to search anyway and show you the closest matches?"

CRITICAL RULES:
- Plain text only. No markdown — no asterisks for bold, no underscores, no #, no ---, no - bullets. Numbered lists (1. 2. 3.) are fine; the frontend renders them naturally.
- Do NOT invent profile data. The user-context block is the ONLY source of truth.
- Do NOT use motivational filler ("you've got this!", "keep going!").
- Do NOT mention quality, talent, reputation, reliability, "high quality" — only criteria-fit and discoverability.
- Tone: warm, practical, honest. Like a smart hockey friend who knows the user.
- Keep it under 300 words total. Concise wins.
- If the user is the implicit subject (player searching for clubs, coach searching for opportunities), profile gaps are usually the right diagnosis. If the user is searching for OTHER profiles (club searching for players), don't lecture them about their own profile — instead diagnose what's thin in the platform / the search criteria.`

const COMPOSE_NO_RESULTS_TOOL = {
  name: 'compose_no_results_response',
  description: 'Compose a helpful multi-paragraph response when a profile search returns zero results.',
  input_schema: {
    type: 'object',
    properties: {
      ai_message: {
        type: 'string',
        description: 'The full response, plain text, 2-4 short paragraphs, under 300 words. No markdown. Numbered lists OK.',
      },
      follow_up_query: {
        type: 'string',
        description: 'Optional. A concrete user-shaped query the user could send to broaden or pivot the search. Renders as a chip in the UI. Example: "Show me all clubs in Spain regardless of category".',
      },
    },
    required: ['ai_message'],
  },
}

function buildNoResultsUserMessage(ctx: NoResultsContext): string {
  // Stringify search criteria the same way the shortlist builder does.
  const criteriaLines: string[] = []
  if (ctx.searchCriteria.roles?.length) criteriaLines.push(`- roles: ${ctx.searchCriteria.roles.join(', ')}`)
  if (ctx.searchCriteria.positions?.length) criteriaLines.push(`- positions: ${ctx.searchCriteria.positions.join(', ')}`)
  if (ctx.searchCriteria.target_category) criteriaLines.push(`- target_category: ${ctx.searchCriteria.target_category}`)
  if (ctx.searchCriteria.gender) criteriaLines.push(`- gender (legacy): ${ctx.searchCriteria.gender}`)
  if (ctx.searchCriteria.min_age != null) criteriaLines.push(`- min_age: ${ctx.searchCriteria.min_age}`)
  if (ctx.searchCriteria.max_age != null) criteriaLines.push(`- max_age: ${ctx.searchCriteria.max_age}`)
  if (ctx.searchCriteria.eu_passport) criteriaLines.push(`- eu_passport: required`)
  if (ctx.searchCriteria.nationalities?.length) criteriaLines.push(`- nationalities: ${ctx.searchCriteria.nationalities.join(', ')}`)
  if (ctx.searchCriteria.locations?.length) criteriaLines.push(`- locations: ${ctx.searchCriteria.locations.join(', ')}`)
  if (ctx.searchCriteria.countries?.length) criteriaLines.push(`- countries: ${ctx.searchCriteria.countries.join(', ')}`)
  if (ctx.searchCriteria.availability) criteriaLines.push(`- availability: ${ctx.searchCriteria.availability}`)
  if (ctx.searchCriteria.min_references != null) criteriaLines.push(`- min_references: ${ctx.searchCriteria.min_references}`)
  if (ctx.searchCriteria.coach_specializations?.length) criteriaLines.push(`- coach_specializations: ${ctx.searchCriteria.coach_specializations.join(', ')}`)
  const criteriaBlock = criteriaLines.length > 0 ? criteriaLines.join('\n') : '(no explicit constraints — broad search)'

  const seedNote = ctx.categorySource === 'context' && ctx.effectiveCategory
    ? `\nIMPORTANT — target_category=${ctx.effectiveCategory} was AUTO-SEEDED from the user's profile (their playing/coaching/umpiring category), not from the query text. The user may not realize this filter is on. Mention it explicitly in your response.`
    : ''

  return `USER QUERY: "${ctx.userQuery.replace(/"/g, "'")}"

WHAT WAS SEARCHED:
- entity: ${ctx.entityNoun}
${criteriaBlock}
- result_count: 0${seedNote}

${buildUserContextBlock(ctx.userContext)}

Compose the helpful no-results response per the rules in the system prompt. Lead with WHY 0 likely happened, then either profile-gap diagnosis (if the user is the implicit subject of the search) or a search-broadening suggestion (if they're scouting other profiles). End with ONE concrete follow-up offer as a question.`
}

function emptyNoResultsResponse(reason: string): NoResultsResponse {
  return { ai_message: reason }
}

async function composeNoResultsWithGemini(ctx: NoResultsContext): Promise<{ result: NoResultsResponse; meta: LLMCallMeta }> {
  const apiKey = Deno.env.get('GOOGLE_AI_API_KEY')
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not configured')

  const { response, retryCount } = await retryableFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: NO_RESULTS_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildNoResultsUserMessage(ctx) }] }],
        tools: [{
          function_declarations: [
            { name: COMPOSE_NO_RESULTS_TOOL.name, description: COMPOSE_NO_RESULTS_TOOL.description, parameters: COMPOSE_NO_RESULTS_TOOL.input_schema },
          ],
        }],
        tool_config: { function_calling_config: { mode: 'ANY' } },
      }),
    },
    { timeoutMs: 8000, maxRetries: 0 }
  )

  if (!response.ok) {
    const errorBody = await response.text()
    if (response.status === 429 || response.status === 503) throw new LLMRateLimitError()
    throw new Error(`Gemini no-results error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  const usage: LLMUsage = {
    prompt_tokens: data.usageMetadata?.promptTokenCount ?? null,
    completion_tokens: data.usageMetadata?.candidatesTokenCount ?? null,
    cached_tokens: data.usageMetadata?.cachedContentTokenCount ?? null,
  }
  const meta: LLMCallMeta = { retry_count: retryCount, usage }

  const fnCall = data.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall)
  const args = fnCall?.functionCall?.args
  if (!args?.ai_message) {
    return { result: emptyNoResultsResponse('I couldn\'t find any matches for that — try broadening the search.'), meta }
  }
  return { result: args as NoResultsResponse, meta }
}

async function composeNoResultsWithClaude(ctx: NoResultsContext): Promise<{ result: NoResultsResponse; meta: LLMCallMeta }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  // NO_RESULTS_SYSTEM_PROMPT is ~1.2K tokens (over Sonnet's 1024 cache
  // minimum). Cache it so consecutive no-results queries within 5 min
  // pay a fraction of the input cost. The user-context payload changes
  // per call so it stays uncached.
  const { response, retryCount } = await retryableFetch(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: [
          { type: 'text', text: NO_RESULTS_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        tools: [
          { name: COMPOSE_NO_RESULTS_TOOL.name, description: COMPOSE_NO_RESULTS_TOOL.description, input_schema: COMPOSE_NO_RESULTS_TOOL.input_schema },
        ],
        tool_choice: { type: 'tool', name: COMPOSE_NO_RESULTS_TOOL.name },
        messages: [{ role: 'user', content: buildNoResultsUserMessage(ctx) }],
      }),
    },
    // 12s upper bound — long enough for a 4-paragraph composition,
    // short enough that worst-case wall clock stays under 14s on top
    // of a 2s parse + 0.5s RPC.
    { timeoutMs: 12000, maxRetries: 0 }
  )

  if (!response.ok) {
    const errorBody = await response.text()
    if (response.status === 429 || response.status === 529) throw new LLMRateLimitError()
    throw new Error(`Claude no-results error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  const usage: LLMUsage = {
    prompt_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.cache_creation_input_tokens ?? 0),
    completion_tokens: data.usage?.output_tokens ?? null,
    cached_tokens: data.usage?.cache_read_input_tokens ?? null,
  }
  const meta: LLMCallMeta = { retry_count: retryCount, usage }

  const toolUse = data.content?.find((c: any) => c.type === 'tool_use' && c.name === COMPOSE_NO_RESULTS_TOOL.name)
  if (!toolUse?.input?.ai_message) {
    return { result: emptyNoResultsResponse('I couldn\'t find any matches for that — try broadening the search.'), meta }
  }
  return { result: toolUse.input as NoResultsResponse, meta }
}

async function composeNoResultsWithOpenAI(ctx: NoResultsContext): Promise<NoResultsResponse> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: NO_RESULTS_SYSTEM_PROMPT },
        { role: 'user', content: buildNoResultsUserMessage(ctx) },
      ],
      tools: [
        { type: 'function', function: { name: COMPOSE_NO_RESULTS_TOOL.name, description: COMPOSE_NO_RESULTS_TOOL.description, parameters: COMPOSE_NO_RESULTS_TOOL.input_schema } },
      ],
      tool_choice: { type: 'function', function: { name: COMPOSE_NO_RESULTS_TOOL.name } },
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`OpenAI no-results error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0]
  if (!toolCall?.function) {
    return emptyNoResultsResponse('I couldn\'t find any matches for that — try broadening the search.')
  }
  const args = JSON.parse(toolCall.function.arguments)
  if (!args.ai_message) {
    return emptyNoResultsResponse('I couldn\'t find any matches for that — try broadening the search.')
  }
  return args as NoResultsResponse
}

export async function composeNoResults(ctx: NoResultsContext): Promise<{ result: NoResultsResponse; meta: LLMCallMeta }> {
  const provider = Deno.env.get('LLM_PROVIDER') || 'gemini'

  switch (provider) {
    case 'gemini':  return composeNoResultsWithGemini(ctx)
    case 'claude':  return composeNoResultsWithClaude(ctx)
    case 'openai':  return { result: await composeNoResultsWithOpenAI(ctx), meta: EMPTY_META }
    default:        return composeNoResultsWithGemini(ctx)
  }
}

// ── Platform help ("how do I use HOCKIA?") ──────────────────────────────
// Answers feature/how-to questions. Routed here by the `platform_help`
// intent. The LLM reads the HOCKIA FEATURE MAP + the user's role and
// returns a short role-aware answer plus the single best feature_key; the
// caller maps that key → a CTA via resolveFeatureCta().

export interface PlatformHelpContext {
  userQuery: string
  userContext: UserContext
}

export interface PlatformHelpResult {
  answer: string
  /** Exact key from the HOCKIA FEATURE MAP, or null when none applies. */
  feature_key: string | null
}

const PLATFORM_HELP_SYSTEM_PROMPT = `You are HOCKIA's in-app guide. HOCKIA is a field-hockey network where players, coaches, clubs, brands and umpires build profiles, connect, recruit, and post opportunities.

The user asked a question about HOW TO USE HOCKIA — this is NOT a search. Answer it using ONLY the HOCKIA FEATURE MAP in the user message, tailored to the user's role (given in the user context block).

Return two things:
1. answer — 2 to 4 short sentences, plain text. Explain what the user can do and the concrete next step. Be ROLE-AWARE: if the user's role cannot do the thing they asked about, say so plainly and point them to what they CAN do instead. For example, a player asking how to create an opportunity → explain that players apply to opportunities rather than post them, and tell them how to browse and apply.
2. feature_key — the ONE key from the FEATURE MAP that best matches the next step you are pointing them to. It must be copied exactly from the map. If no destination genuinely helps, return an empty string.

Rules:
- Plain text only. No markdown — no asterisks, no headers, no bullet symbols.
- The FEATURE MAP is the ONLY source of truth. Never invent features, routes, buttons or pages that are not in it.
- Keep it short, warm and practical. No motivational filler.
- Do not mention "feature_key", "feature map", routes or URLs in the answer text — the next-step button is added separately.
- Tone: a knowledgeable teammate giving a quick, clear pointer.`

const ANSWER_PLATFORM_HELP_TOOL = {
  name: 'answer_platform_help',
  description: 'Answer a how-do-I-use-HOCKIA question with a short role-aware explanation and the single best feature to point the user to.',
  input_schema: {
    type: 'object',
    properties: {
      answer: {
        type: 'string',
        description: '2-4 short sentences, plain text, role-aware. No markdown. No routes or URLs.',
      },
      feature_key: {
        type: 'string',
        description: 'Exact key copied from the HOCKIA FEATURE MAP for the next step, or an empty string if none applies.',
      },
    },
    required: ['answer'],
  },
}

function buildPlatformHelpUserMessage(ctx: PlatformHelpContext): string {
  return `USER QUESTION: "${ctx.userQuery.replace(/"/g, "'")}"

${renderFeatureKnowledge()}

${buildUserContextBlock(ctx.userContext)}

Answer the user's how-to question per the system prompt. Tailor it to their role, and pick the single best feature_key for the next step.`
}

function emptyPlatformHelpResult(reason: string): PlatformHelpResult {
  return { answer: reason, feature_key: null }
}

function normalizePlatformHelpResult(raw: { answer?: unknown; feature_key?: unknown }): PlatformHelpResult {
  const answer = typeof raw.answer === 'string' && raw.answer.trim()
    ? raw.answer.trim()
    : 'You can explore that from your HOCKIA dashboard.'
  const key = typeof raw.feature_key === 'string' && raw.feature_key.trim()
    ? raw.feature_key.trim()
    : null
  return { answer, feature_key: key }
}

async function answerPlatformHelpWithGemini(ctx: PlatformHelpContext): Promise<{ result: PlatformHelpResult; meta: LLMCallMeta }> {
  const apiKey = Deno.env.get('GOOGLE_AI_API_KEY')
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not configured')

  const { response, retryCount } = await retryableFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: PLATFORM_HELP_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildPlatformHelpUserMessage(ctx) }] }],
        tools: [{
          function_declarations: [
            { name: ANSWER_PLATFORM_HELP_TOOL.name, description: ANSWER_PLATFORM_HELP_TOOL.description, parameters: ANSWER_PLATFORM_HELP_TOOL.input_schema },
          ],
        }],
        tool_config: { function_calling_config: { mode: 'ANY' } },
      }),
    },
    { timeoutMs: 9000, maxRetries: 0 }
  )

  if (!response.ok) {
    const errorBody = await response.text()
    if (response.status === 429 || response.status === 503) throw new LLMRateLimitError()
    throw new Error(`Gemini platform-help error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  const usage: LLMUsage = {
    prompt_tokens: data.usageMetadata?.promptTokenCount ?? null,
    completion_tokens: data.usageMetadata?.candidatesTokenCount ?? null,
    cached_tokens: data.usageMetadata?.cachedContentTokenCount ?? null,
  }
  const meta: LLMCallMeta = { retry_count: retryCount, usage }

  const fnCall = data.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall)
  const args = fnCall?.functionCall?.args
  if (!args?.answer) {
    return { result: emptyPlatformHelpResult('You can manage that from your HOCKIA dashboard.'), meta }
  }
  return { result: normalizePlatformHelpResult(args), meta }
}

async function answerPlatformHelpWithClaude(ctx: PlatformHelpContext): Promise<{ result: PlatformHelpResult; meta: LLMCallMeta }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  // PLATFORM_HELP_SYSTEM_PROMPT is well over Sonnet's 1024-token cache
  // minimum once the feature map is appended downstream — but the map
  // lives in the per-call user message, so only the static system prompt
  // is cached. Still worth it for back-to-back help questions.
  const { response, retryCount } = await retryableFetch(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: [
          { type: 'text', text: PLATFORM_HELP_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        tools: [
          { name: ANSWER_PLATFORM_HELP_TOOL.name, description: ANSWER_PLATFORM_HELP_TOOL.description, input_schema: ANSWER_PLATFORM_HELP_TOOL.input_schema },
        ],
        tool_choice: { type: 'tool', name: ANSWER_PLATFORM_HELP_TOOL.name },
        messages: [{ role: 'user', content: buildPlatformHelpUserMessage(ctx) }],
      }),
    },
    { timeoutMs: 12000, maxRetries: 0 }
  )

  if (!response.ok) {
    const errorBody = await response.text()
    if (response.status === 429 || response.status === 529) throw new LLMRateLimitError()
    throw new Error(`Claude platform-help error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  const usage: LLMUsage = {
    prompt_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.cache_creation_input_tokens ?? 0),
    completion_tokens: data.usage?.output_tokens ?? null,
    cached_tokens: data.usage?.cache_read_input_tokens ?? null,
  }
  const meta: LLMCallMeta = { retry_count: retryCount, usage }

  const toolUse = data.content?.find((c: any) => c.type === 'tool_use' && c.name === ANSWER_PLATFORM_HELP_TOOL.name)
  if (!toolUse?.input?.answer) {
    return { result: emptyPlatformHelpResult('You can manage that from your HOCKIA dashboard.'), meta }
  }
  return { result: normalizePlatformHelpResult(toolUse.input), meta }
}

/**
 * Answer a "how do I use HOCKIA" question. Mirrors the provider dispatch of
 * the other LLM helpers. `openai` falls through to Gemini — it is not a
 * live provider for nl-search, and Gemini is the safe default.
 */
export async function answerPlatformHelp(ctx: PlatformHelpContext): Promise<{ result: PlatformHelpResult; meta: LLMCallMeta }> {
  const provider = Deno.env.get('LLM_PROVIDER') || 'gemini'

  switch (provider) {
    case 'claude':  return answerPlatformHelpWithClaude(ctx)
    case 'gemini':  return answerPlatformHelpWithGemini(ctx)
    default:        return answerPlatformHelpWithGemini(ctx)
  }
}
