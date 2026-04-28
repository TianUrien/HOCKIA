// deno-lint-ignore-file no-explicit-any
/**
 * LLM provider abstraction for natural language → structured filter parsing.
 *
 * Supports multiple providers via the LLM_PROVIDER env var:
 *   - 'gemini'  (default) — Google Gemini 2.5 Flash (free tier)
 *   - 'claude'  — Anthropic Claude Haiku (paid)
 *   - 'openai'  — OpenAI GPT-4o-mini (paid)
 *
 * Switching providers requires only changing the env var + API key.
 * Zero code changes needed.
 */

export interface ParsedFilters {
  roles?: string[]
  positions?: string[]
  gender?: string
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

export interface ConversationIntent {
  type: 'conversation'
  message: string
}

export interface KnowledgeIntent {
  type: 'knowledge'
  message: string
}

export type LLMResult = SearchIntent | ConversationIntent | KnowledgeIntent

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
export const PROMPT_VERSION = '2026-04-27.phase0-entity-router'

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
  gender: string | null
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
    if (ctx.gender) lines.push(`- Gender context: ${ctx.gender}.`)
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

You have three tools:
1. search_profiles — Use when the user wants to find or discover people/profiles. Extract structured filters from their query. Always include a conversational "message" field describing what you're looking for.
2. answer_hockey_question — Use when the user asks about field hockey knowledge: rules, positions, tactics, formations, tournament formats (Olympics, World Cup, Pro League, EHL), FIH regulations, equipment (sticks, goalkeeping gear, balls, turf types), hockey history, training concepts, terminology (drag flick, aerial, jab tackle, penalty corner, etc.), or differences between indoor and outdoor hockey. Provide accurate, helpful answers. You can be detailed (multiple paragraphs) when the question warrants it.
3. respond — Use for greetings, platform questions, help requests, AND for any personalised question about the user themselves ("Who am I?", "What's in my profile?", "What should I improve?", "What can I do next on HOCKIA?", "How do I get more visibility?", "Who should I connect with?"). When responding to self-reflection questions, use the CURRENT USER CONTEXT block as the only source of truth.

TOOL SELECTION RULES:
- "Find defenders" or "best players in England" → search_profiles (looking for people)
- "What does a defender do?" or "rules of penalty corner" → answer_hockey_question (hockey knowledge)
- "Hi" or "What is HOCKIA?" → respond (greeting or platform question)
- "Who am I?" / "What do you know about me?" / "What's in my profile?" / "What should I improve?" / "How can I get more visibility?" / "What can I do next?" / "Who should I connect with?" → respond (use the CURRENT USER CONTEXT block at the end of this prompt)
- "What clubs would suit me?" / "Recommend players for my team" / "Show me {role} for me" → search_profiles, with filters seeded from the user's context
- For medical/injury advice, say you'd recommend consulting a sports medicine professional.
- For non-hockey, non-HOCKIA topics (weather, coding, cooking, etc.), politely redirect: you're a field hockey assistant and can help with hockey questions or discovering profiles.

FILTER EXTRACTION RULES (for search_profiles only):
- Only extract information explicitly stated or clearly implied in the query.
- For age: "U21" means max_age=20, "U18" means max_age=17, "U23" means max_age=22. "Senior" means min_age=21.
- For positions: use exactly "goalkeeper", "defender", "midfielder", or "forward" for players.
- For coach specializations: use "head_coach", "assistant_coach", "goalkeeper_coach", "youth_coach", "strength_conditioning", "performance_analyst", "sports_scientist", or "other". Map natural language like "S&C coach" → "strength_conditioning", "video analyst" → "performance_analyst", "GK coach" → "goalkeeper_coach". Set roles=["coach"] when a specialization is used.
- For gender: use "Men" or "Women" exactly (capital first letter).
- "EU passport" means eu_passport=true. Do NOT list individual EU countries unless the user specifically names them.
- "Open to play", "available", or "looking for opportunities" means availability="open_to_play".
- "Verified references" or "references" maps to min_references.
- If role is not specified, infer from context: positions like "defender" imply role=["player"]; "head coach" implies role=["coach"]; "club" or "team" implies role=["club"]; "brand" or "sponsor" implies role=["brand"]; "umpire", "official", or "referee" implies role=["umpire"].
- IMPORTANT — umpires are ONLY surfaced when the user explicitly asks for them (with words like "umpire", "umpires", "official", "officials", "referee", "referees"). Never volunteer umpires in searches for players, coaches, clubs, or brands. When the intent is unclear, default to NOT including "umpire" in roles.
- For "playing in [country]" or "based in [country]", use the countries array for league/club country context, and locations for where they live.
- When the user mentions "good feedback", "strong references", "well-regarded", "reputation", "endorsed", "reviewed", "testimonials", "comments about", or any qualitative assessment, set include_qualitative=true. This triggers a deeper analysis of profile comments and endorsements for the top results.
- Always generate a human-readable summary field.

CONVERSATION CONTEXT:
When the user refers to previous results or modifies a previous search (e.g., "narrow that down", "show only defenders", "what about in England?"), interpret their request in context of the conversation history. Carry forward relevant filters from the previous search and apply the user's modifications.

USER CONTEXT AWARENESS:
- You know who you're speaking with. Their profile details appear at the end of this prompt under "CURRENT USER CONTEXT". Use it to give smarter, personalized answers.
- When a coach or club asks "recommend players for my team", "who could fit my club", or similar, use their club's league, country, and gender context to infer relevant filters (e.g., set gender to match their league context).
- IMPORTANT — field hockey recruitment is global:
  - Always consider BOTH local players (same country/league) AND international players who could relocate. Do NOT over-filter by location.
  - EU passport eligibility is a critical factor in European recruitment. When searching for a European club, highlight EU-eligible players but don't exclude non-EU players entirely.
  - Mention the global nature of recruitment when relevant (e.g., "I found players in England and some international options from Argentina and the Netherlands who could also be a fit").
- When the user says "my league", "my club", "my team", or "nearby", resolve those from their CURRENT USER CONTEXT.
- The user's gender context tells you whether to filter by "Men" or "Women" when they don't specify.
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

TONE:
- Helpful, practical, role-aware, honest. Like a smart hockey assistant who actually knows the user.
- Concrete suggestions, not generic motivational advice. Avoid "you've got this!" / "keep going!" filler.
- Never use surveillance framing ("I noticed you…", "you haven't been active…"). Just answer questions; don't volunteer observations.
- When suggesting profile improvements, lead with the single highest-impact item, then list 1-2 more.`

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
        description: 'Gender filter. Only set if explicitly mentioned.',
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

  const { message, include_qualitative, ...filters } = args
  return {
    result: { type: 'search', filters: filters as ParsedFilters, message: message || filters.summary || '', include_qualitative: include_qualitative === true },
    meta,
  }
}

// ─── Claude (Anthropic — paid) ────────────────────────────────────────

async function callClaude(query: string, history: HistoryTurn[] = [], userContext?: UserContext, intentHint?: IntentHint): Promise<LLMResult> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const hintBlock = intentHint ? buildIntentHintBlock(intentHint) : ''
  const systemPrompt = [
    SYSTEM_PROMPT,
    userContext ? buildUserContextBlock(userContext) : '',
    hintBlock,
  ].filter(Boolean).join('\n\n')

  const messages = [
    ...history.map(turn => ({ role: turn.role as 'user' | 'assistant', content: turn.content })),
    { role: 'user' as const, content: query },
  ]

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      tools: [
        { name: SEARCH_TOOL.name, description: SEARCH_TOOL.description, input_schema: SEARCH_TOOL.input_schema },
        { name: RESPOND_TOOL.name, description: RESPOND_TOOL.description, input_schema: RESPOND_TOOL.input_schema },
        { name: HOCKEY_KNOWLEDGE_TOOL.name, description: HOCKEY_KNOWLEDGE_TOOL.description, input_schema: HOCKEY_KNOWLEDGE_TOOL.input_schema },
      ],
      tool_choice: { type: 'auto' },
      messages,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Claude API error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  const toolUse = data.content?.find((c: any) => c.type === 'tool_use')

  if (!toolUse?.input) {
    const textBlock = data.content?.find((c: any) => c.type === 'text')
    return { type: 'conversation', message: textBlock?.text || DEFAULT_CONVERSATION_RESPONSE }
  }

  if (toolUse.name === 'respond') {
    return { type: 'conversation', message: toolUse.input.message || DEFAULT_CONVERSATION_RESPONSE }
  }
  if (toolUse.name === 'answer_hockey_question') {
    return { type: 'knowledge', message: toolUse.input.message || 'I couldn\'t generate an answer. Try rephrasing your question.' }
  }

  const { message, include_qualitative, ...filters } = toolUse.input
  return { type: 'search', filters: filters as ParsedFilters, message: message || filters.summary || '', include_qualitative: include_qualitative === true }
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
    case 'claude':  return { result: await callClaude(query, history, userContext, intentHint), meta: EMPTY_META }
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

async function synthesizeWithClaude(profiles: ProfileQualitativeData[], userQuery: string): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SYNTHESIS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildSynthesisUserMessage(profiles, userQuery) }],
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Claude synthesis error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  const textBlock = data.content?.find((c: any) => c.type === 'text')
  return textBlock?.text || ''
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
    case 'claude':  return { text: await synthesizeWithClaude(profiles, userQuery), meta: EMPTY_META }
    case 'openai':  return { text: await synthesizeWithOpenAI(profiles, userQuery), meta: EMPTY_META }
    default:        return synthesizeWithGemini(profiles, userQuery)
  }
}
