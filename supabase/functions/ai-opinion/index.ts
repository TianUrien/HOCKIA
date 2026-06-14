/**
 * ai-opinion — Section F AI Opinion Engine (recruitment spec G.7)
 *
 * Phase 1 Session B. See docs/SECTION_F_AI_OPINION_ENGINE_PROPOSAL.md
 * for design intent + the 6 open decisions and their agreed defaults.
 *
 * Request shape:
 *   POST /functions/v1/ai-opinion
 *   Authorization: Bearer <user JWT>
 *   Body: { player_id: uuid }
 *
 * Response shape:
 *   200 { verdict_short, citations: [{ field, value, claim }], cached, quota_remaining }
 *   401 { error: 'unauthenticated' }
 *   403 { error: 'recruiter_only' | 'not_applicable' }
 *   429 { error: 'quota_exceeded', resets_at }
 *   500 { error: 'internal' }
 *
 * Behaviour:
 *   1. Auth check (must be authenticated club/coach).
 *   2. Resolve viewer's effective target (override from recruiting_context
 *      or profile-derived for clubs). Same logic as clubFit.ts.
 *   3. Fetch viewer + player facts + both sides' league bands.
 *   4. Compute deterministic Fit math (mirror of clubFit.ts).
 *   5. Compute context_hash. Cache lookup on ai_opinions —
 *      same viewer+player+hash AND not expired → return cached.
 *   6. Cache miss: check per-viewer daily quota in ai_opinion_quota.
 *      If >= 50 → 429.
 *   7. Build structured prompt, call Claude Sonnet, parse JSON output.
 *   8. Content filter (closed vocabulary) — reject if banned words.
 *   9. UPSERT into ai_opinions; increment ai_opinion_quota; return.
 *
 * Prompt v1.0 — FIRST DRAFT. Review docs/SECTION_F_AI_OPINION_ENGINE_PROPOSAL.md
 * before this is deployed to staging.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceClient } from '../_shared/supabase-client.ts'
import type { Json } from '../_shared/database.types.ts'

// ── Prompt version + constants ──────────────────────────────────────
// Bump PROMPT_VERSION when the system prompt or output schema changes
// in a way that should invalidate cached opinions. ai_opinions cache
// keys include this — bumping forces a full regenerate next read.
const PROMPT_VERSION = 'v1.9'
const MODEL = 'claude-sonnet-4-6'
const VERDICT_MAX_CHARS = 280
const QUOTA_PER_DAY = 50

// Words the LLM must NOT use — judgment about the PERSON, not the
// MATCH. Stays small Phase 1; tighten via staging review.
const BANNED_WORDS = [
  'elite',
  'star',
  'generational',
  'talented',
  'gifted',
  'amazing',
  'incredible',
  'world-class',
  'phenomenal',
  'exceptional',
  'genius',
]

// ── Types ───────────────────────────────────────────────────────────
interface Citation {
  field: string
  value: string
  claim: string
}

interface OpinionPayload {
  verdict_short: string
  citations: Citation[]
}

interface FitContext {
  // #6b — which kind of candidate this is ('player' | 'coach'); selects the
  // player↔club vs coach↔team assessment path + prompt branch.
  candidate_role: string
  // #6b — coach-seeking scope fields (the role + specific coaching role the
  // opening seeks); null for a player-seeking scope.
  scope_target_role: string | null
  scope_target_position: string | null
  // #6b — coach candidate's own specialization + categories.
  player_coach_specialization: string | null
  player_coaching_categories: string[] | null
  // Phase 2 (2c) — player's held specialisms + the opening's wanted
  // specialisms (a held specialism the opening seeks is a positive fit signal).
  player_specialist_skills: string[] | null
  viewer_target_specialists: string[] | null
  // Phase 3d — per-criterion MUST-HAVE hardness off the active scope. A
  // must-have the player EXPLICITLY fails = "out of scope" (mirrors the
  // deterministic verdict's hard cap); a blank field stays neutral. All
  // false for coach scopes (the toggles are player-opps-only).
  scope_position_required: boolean
  scope_level_required: boolean
  scope_compensation_required: boolean
  scope_location_required: boolean
  scope_availability_required: boolean
  scope_specialists_required: boolean
  // Phase 3d — player's positions, so the AI can narrate a position
  // (mis)match, incl. a must-have goalkeeper/etc. (the canonical case).
  player_position: string | null
  player_secondary_position: string | null
  viewer_target: 'Men' | 'Women' | 'Mixed' | null
  viewer_band: number | null
  // #5 Part 2 — the active opportunity scope (level_sought / compensation /
  // location / start) so the verdict reflects the #4a/#4b recruiter intent,
  // not just category + band. Null when no opportunity scope is active.
  viewer_target_level: string | null
  viewer_target_compensation: string | null
  viewer_target_location_country: string | null
  viewer_target_start_date: string | null
  // #6 — the recruiter's stated problem; frames which dimensions matter most.
  viewer_recruitment_problem: string | null
  player_category: string | null
  player_band: number | null
  player_open_to_play: boolean | null
  player_open_to_coach: boolean | null
  player_open_to_opportunities: boolean | null
  player_last_active_at: string | null
  // Phase 2 Slice B1: prompt-relevant signals that should invalidate
  // the cache when they change. Previously these were in the prompt
  // payload but NOT in context_hash, so a player adding a highlight
  // video could leave a stale "no video evidence" verdict in cache for
  // up to 24h.
  player_accepted_reference_count: number
  player_career_entry_count: number
  player_has_highlight_video: boolean
  player_full_match_video_count: number
  // #5 Part 2 — self-declared candidate intent (#2.1/#4b). PROVEN level
  // (player_band) still outranks these for level matching.
  player_level_target: string | null
  player_opportunity_preference: string | null
  player_relocation_willingness: string | null
  player_available_from: string | null
}

// ── sha256 hash via Web Crypto (Deno) ──────────────────────────────
// NOT MD5: Deno's Web Crypto API follows the spec strictly and only
// supports SHA-1/256/384/512. Earlier this function used MD5 which
// throws DOMException, killing the handler before the success path
// could return a CORS-headed response — surfaced to the browser as
// `FunctionsFetchError: Failed to send a request to the Edge
// Function` (QA F1 on staging). Truncating SHA-256 to 32 hex chars
// gives an identically-shaped cache key without changing the schema.
async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

function computeContextHash(viewerId: string, playerId: string, fit: FitContext): Promise<string> {
  // Includes everything that would change the verdict. When ANY input
  // changes the hash differs → cache miss → fresh generation.
  //
  // Phase 2 Slice B1 added the bottom four fields. They appear in the
  // prompt's player payload, so a verdict written for a player with
  // zero videos becomes wrong the moment that player uploads a
  // highlight reel. Lazy invalidation via hash drift keeps the cache
  // correct without needing a separate trigger. Cost: one extra LLM
  // call per recruiter per relevant player update inside the 24h TTL
  // window — acceptable for the correctness gain.
  const payload = JSON.stringify({
    v: viewerId,
    p: playerId,
    vt: fit.viewer_target,
    vb: fit.viewer_band,
    pc: fit.player_category,
    pb: fit.player_band,
    op: fit.player_open_to_play,
    oc: fit.player_open_to_coach,
    oo: fit.player_open_to_opportunities,
    pv: PROMPT_VERSION,
    arc: fit.player_accepted_reference_count,
    cec: fit.player_career_entry_count,
    hhv: fit.player_has_highlight_video,
    fmv: fit.player_full_match_video_count,
    // #5 Part 2 — scope intent + candidate intent change the verdict, so
    // they must drift the hash (else a recruiter switching to a paid /
    // higher-level scope keeps a stale verdict for up to 24h).
    vtl: fit.viewer_target_level,
    vtc: fit.viewer_target_compensation,
    vtloc: fit.viewer_target_location_country,
    vtsd: fit.viewer_target_start_date,
    vrp: fit.viewer_recruitment_problem,
    plt: fit.player_level_target,
    pop: fit.player_opportunity_preference,
    prw: fit.player_relocation_willingness,
    paf: fit.player_available_from,
    // #6b — coach-candidate dimensions.
    cr: fit.candidate_role,
    str: fit.scope_target_role,
    stp: fit.scope_target_position,
    pcs: fit.player_coach_specialization,
    pcc: fit.player_coaching_categories,
    // Phase 2 (2c) — specialism intent. Sort so a mere reorder of the TEXT[]
    // doesn't false-drift the hash (and force a needless regenerate).
    pss: [...(fit.player_specialist_skills ?? [])].sort(),
    vts: [...(fit.viewer_target_specialists ?? [])].sort(),
    // Phase 3d — must-have hardness + player positions. A recruiter flipping
    // a criterion to must-have changes the verdict (possibly to out-of-scope),
    // so it must drift the hash; the player's position likewise feeds the
    // position (mis)match narration.
    posR: fit.scope_position_required,
    lvlR: fit.scope_level_required,
    compR: fit.scope_compensation_required,
    locR: fit.scope_location_required,
    availR: fit.scope_availability_required,
    specR: fit.scope_specialists_required,
    ppos: fit.player_position,
    psec: fit.player_secondary_position,
  })
  return sha256(payload)
}

// ── Viewer + player profile fetch ───────────────────────────────────
interface ProfileRow {
  id: string
  role: string
  full_name: string | null
  current_world_club_id: string | null
  playing_category: string | null
  coaching_categories: string[] | null
  open_to_play: boolean | null
  open_to_coach: boolean | null
  open_to_opportunities: boolean | null
  last_active_at: string | null
  accepted_reference_count: number | null
  career_entry_count: number | null
  highlight_video_url: string | null
  full_game_video_count: number | null
  current_club: string | null
  // #5 Part 2 — self-declared candidate intent (#2.1/#4b).
  level_target: string | null
  opportunity_preference: string | null
  relocation_willingness: string | null
  available_from: string | null
  // #6b — coach candidate's specialization (coaching_categories above).
  coach_specialization: string | null
  // Phase 2 (2c) — player's held specialisms (drag_flicker, penalty_corner,
  // playmaker, …). Already scored by clubFit's position_match; surfaced here so
  // the AI verdict can cite a specialism the opening wants.
  specialist_skills: string[] | null
  // Phase 3d — player's primary + secondary position, so the AI can assess
  // position fit against the opening's sought position (incl. must-have).
  position: string | null
  secondary_position: string | null
}

async function fetchProfile(supabase: ReturnType<typeof getServiceClient>, id: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, full_name, current_world_club_id, playing_category, coaching_categories, open_to_play, open_to_coach, open_to_opportunities, last_active_at, accepted_reference_count, career_entry_count, highlight_video_url, full_game_video_count, current_club, level_target, opportunity_preference, relocation_willingness, available_from, coach_specialization, specialist_skills, position, secondary_position')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data as ProfileRow | null
}

// ── World-club join: derive competition level band per side ─────────
// Mirrors the SQL in get_top_community_members RPC: read men's band
// when player is men/boys, women's band when women/girls, COALESCE
// either way as fallback.
async function fetchLevelBand(
  supabase: ReturnType<typeof getServiceClient>,
  worldClubId: string | null,
  category: string | null,
): Promise<number | null> {
  if (!worldClubId) return null
  const { data, error } = await supabase
    .from('world_clubs')
    .select('men_league_id, women_league_id')
    .eq('id', worldClubId)
    .maybeSingle()
  if (error || !data) return null
  const club = data as { men_league_id: number | null; women_league_id: number | null }
  const wantWomen = category === 'adult_women' || category === 'girls'
  const primaryId = wantWomen ? club.women_league_id : club.men_league_id
  const fallbackId = wantWomen ? club.men_league_id : club.women_league_id
  const targetId = primaryId ?? fallbackId
  if (!targetId) return null
  const { data: league } = await supabase
    .from('world_leagues')
    .select('level_band_global')
    .eq('id', targetId)
    .maybeSingle()
  return (league as { level_band_global: number | null } | null)?.level_band_global ?? null
}

// ── Effective recruiting scope ──────────────────────────────────────
// The active recruiting_context carries the full opportunity intent — the
// sought category PLUS (when scoped to an opportunity, #4a/#4b) the
// level_sought / compensation / location / start. The verdict needs all of
// it so the AI narrates the same picture the deterministic lenses score.
interface RecruitingScope {
  target: 'Men' | 'Women' | 'Mixed' | null
  level: string | null
  compensation: string | null
  location_country: string | null
  start_date: string | null
  problem: string | null
  // #6b — the role the opening seeks ('player' | 'coach' | null) + the
  // specific coaching role (opportunity.position holds the coach enum).
  role: string | null
  position: string | null
  // Phase 2 (2c) — specialisms the opening wants (from
  // opportunities.specialist_skills_wanted, derived onto recruiting_context).
  specialists: string[] | null
  // Phase 3d — per-criterion MUST-HAVE hardness, derived onto recruiting_context.
  position_required: boolean
  level_required: boolean
  compensation_required: boolean
  location_required: boolean
  availability_required: boolean
  specialists_required: boolean
}

async function resolveScope(
  supabase: ReturnType<typeof getServiceClient>,
  viewerId: string,
  viewerRole: string,
): Promise<RecruitingScope> {
  // Active recruiting_context wins if present (clubs auto-seed, coaches
  // opt-in via ContextSwitcher).
  const { data: ctx } = await supabase
    .from('recruiting_context')
    .select('target_category, target_level, target_compensation, target_location_country, target_start_date, target_problem, target_role, target_position, target_specialists, position_required, level_required, compensation_required, location_required, availability_required, specialists_required')
    .eq('owner_id', viewerId)
    .eq('is_active', true)
    .maybeSingle()
  const row = ctx as {
    target_category: string | null
    target_level: string | null
    target_compensation: string | null
    target_location_country: string | null
    target_start_date: string | null
    target_problem: string | null
    target_role: string | null
    target_position: string | null
    target_specialists: string[] | null
    position_required: boolean | null
    level_required: boolean | null
    compensation_required: boolean | null
    location_required: boolean | null
    availability_required: boolean | null
    specialists_required: boolean | null
  } | null
  const scope: RecruitingScope = {
    target: (row?.target_category as 'Men' | 'Women' | 'Mixed' | null) ?? null,
    level: row?.target_level ?? null,
    compensation: row?.target_compensation ?? null,
    location_country: row?.target_location_country ?? null,
    start_date: row?.target_start_date ?? null,
    problem: row?.target_problem ?? null,
    role: row?.target_role ?? null,
    position: row?.target_position ?? null,
    specialists: row?.target_specialists ?? null,
    position_required: row?.position_required ?? false,
    level_required: row?.level_required ?? false,
    compensation_required: row?.compensation_required ?? false,
    location_required: row?.location_required ?? false,
    availability_required: row?.availability_required ?? false,
    specialists_required: row?.specialists_required ?? false,
  }
  if (scope.target) return scope

  // Clubs: derive the category from profile's league divisions (men's /
  // women's). Coaches: no profile-derived target — leave target null (the
  // caller returns not_applicable). The opportunity-scope fields stay null
  // either way (only an active opportunity context carries them).
  if (viewerRole !== 'club') return scope
  const { data: profile } = await supabase
    .from('profiles')
    .select('mens_league_division, womens_league_division')
    .eq('id', viewerId)
    .maybeSingle()
  const p = profile as { mens_league_division: string | null; womens_league_division: string | null } | null
  const hasMen = Boolean(p?.mens_league_division)
  const hasWomen = Boolean(p?.womens_league_division)
  scope.target = hasMen && hasWomen ? 'Mixed' : hasMen ? 'Men' : hasWomen ? 'Women' : null
  return scope
}

// ── Prompt v1.2 ─────────────────────────────────────────────────────
// QA-driven changes:
//   v1.1:
//   - Delta B (F12): cite MISSING fields as evidence (no empty citations
//     array). Closes the broken "Why" affordance on insufficient-info.
//   - Delta C (F13): pin to 2nd-person voice. Matches "Private to you"
//     framing on the panel; QA caught drift to "the club"/3rd-person.
//   v1.2:
//   - F21: lock the BAND CONVENTION (lower = higher tier). QA caught
//     the model flipping "above"/"below" directionality between adjacent
//     calls on the same band relationship; explicit rule removes the
//     50/50 coin flip.
//   v1.3 (#5 Part 2):
//   - Feed the active opportunity scope (level_sought / compensation /
//     location / start) + the player's self-declared intent (level_target,
//     opportunity_preference, relocation, available_from) so the verdict
//     reflects the full #4a/#4b model, not just category + band.
//   - SELF-DECLARED VS PROVEN rule: proven level (band) outranks the
//     player's stated level_target for level matching.
//   v1.4: humanize all values in verdict_short (no raw field/enum tokens).
//   v1.5 (#6): frame the verdict around the recruiter's recruitment_problem
//     — lead with the dimension that problem cares about most.
//   v1.6 (#6 QA): derived is_open signal + rule (the model was reading
//     open_to_opportunities=false literally and inverting availability);
//     strengthen young_talent guidance against "nothing to assess".
//   v1.7 (#6b): coach-candidate support — when the payload has a `coach`
//     object (opportunity_scope.seeking='coach'), assess coaching-role +
//     team-category match + experience + availability, not player level.
//   v1.8 (Phase 2 2c): specialist-skills support — weigh the opening's
//     specialists_sought vs the player's specialist_skills (a held specialism
//     the opening wants is a positive fit signal). Adds pss/vts to the
//     context_hash so a specialism edit invalidates the cached verdict.
//   v1.9 (Phase 3d): MUST-HAVE criteria — opportunity_scope.must_have_criteria
//     lists the dimensions the recruiter REQUIRES. A player who EXPLICITLY
//     fails a must-have is OUT OF SCOPE (mirrors the deterministic verdict's
//     hard cap); a blank field stays neutral; a nice-to-have miss is a soft
//     gap. Also adds position_sought vs the player's position so the canonical
//     "must-have goalkeeper" case can be narrated. New hash inputs invalidate
//     the cache when a recruiter flips a criterion's hardness.
const SYSTEM_PROMPT = `You are HOCKIA AI's recruitment opinion engine. You produce short, evidence-based verdicts on player↔club AND coach↔team fit for field-hockey recruiters.

RULES (non-negotiable):
1. Opinions are about the MATCH, never about the PERSON. Address the recruiter in second person: "your team", "your scope", "this player". Never use "the club", "the coach", or any third-person referral to the recruiter — the panel says "Private to you" and the voice must match. ❌ "Maria is talented" ❌ "The club's Hoofdklasse team could benefit from Maria" ✅ "Maria's full-match footage at Hoofdklasse level matches your team's competition tier."
2. Every claim must cite a specific player profile field. No floating assertions.
2a. AVAILABILITY: use the derived player.is_open as THE signal for whether the player is available. When is_open is true, the player IS open — never write that they "aren't open to offers" or similar. open_to_opportunities is only one of several openness flags; a player who is open_to_play is available even if open_to_opportunities is false. Cite is_open (or the specific true flag), not the false one.
3. Closed vocabulary. Do NOT use: elite, star, generational, talented, gifted, amazing, incredible, world-class, phenomenal, exceptional, genius. Describe the FIT, not the PLAYER.
4. Maximum ${VERDICT_MAX_CHARS} characters for verdict_short. 1-2 sentences total.
5. Output JSON only. No prose outside the JSON object.
6. HUMANIZE all values in verdict_short. Never write raw field names or enum tokens — no underscores, no snake_case. Translate to natural English: open_to_opportunities=false → "isn't open to offers"; high_performance → "high-performance"; unpaid_development → "a development role"; competition_level_band → "their league level". Raw field names belong ONLY in the citations array's "field" key, never in prose.

OUTPUT SCHEMA (strict):
{
  "verdict_short": "1-2 sentences about the MATCH",
  "citations": [
    { "field": "<profile field name>", "value": "<actual value>", "claim": "<what this evidences about the fit>" }
  ]
}

CITATION RULES:
- Each citation must reference a real field from the input (e.g. competition_level_band, accepted_reference_count, open_to_play).
- "claim" describes what the field EVIDENCES about fit, not about the player.
- At least 1 citation, at most 4. Pick the most decisive ones.
- The citations array MUST NEVER be empty. An unscorable fit is itself evidenced by absences — cite the missing fields with value="null".

FIT-MATH CONTEXT:
BAND CONVENTION: competition_level_band uses a 1–10 scale where LOWER numbers are HIGHER tiers (band 1 = national top tier; band 10 = recreational). When comparing bands, a player at band 3 vs a recruiter at band 5 is TWO TIERS ABOVE the recruiter (player plays at a higher level). "Step up" means moving from a higher band number to a lower one; "step down" is the reverse. Never invert this — apply the convention consistently across every verdict.
You are given a deterministic Fit calculation. Treat it as ground truth. Your job is to translate the inputs into recruiter-readable language.

OPPORTUNITY SCOPE (when opportunity_scope fields are present): the recruiter is hiring for a specific opening. Weigh these against the player:
- position_sought (goalkeeper / defender / midfielder / forward): the position the opening seeks. The player fits when their position OR secondary_position matches; a different primary with no matching secondary is a position gap. HUMANIZE the value (goalkeeper → "goalkeeper"). Only weigh position when position_sought is present; a player with no position on file is a missing-info case, not a mismatch.
- level_sought (elite > high_performance > competitive > development): the level the opening targets. Compare it to the player's PROVEN level (competition_level_band) FIRST.
- compensation (paid / unpaid_development / either) vs the player's opportunity_preference (paid / development / either): an "either" on either side is compatible; a player who wants paid being shown an unpaid/development role is a real mismatch worth flagging.
- location_country + start_date vs the player's relocation_willingness + available_from: logistics that can make or break a deal.
- specialists_sought (the opening's wanted specialisms, e.g. drag_flicker, penalty_corner, playmaker) vs the player's specialist_skills: a held specialism the opening explicitly wants is a strong positive fit signal worth leading with; the absence of a sought specialism is a soft gap, not a disqualifier. HUMANIZE every tag in prose (drag_flicker → "drag-flicking", penalty_corner → "penalty-corner work") — never print the raw token. Only weigh specialisms when specialists_sought is non-empty.
When opportunity_scope fields are null, the recruiter hasn't scoped to an opening — do not invent level/compensation/logistics claims; stick to category + band + evidence.

MUST-HAVE CRITERIA (when opportunity_scope.must_have_criteria is a non-empty list): the recruiter has marked those dimensions as REQUIRED, not merely preferred. This OVERRIDES the "soft gap" framing above for those dimensions:
- If the player EXPLICITLY fails a must-have — a KNOWN mismatch, e.g. plays midfielder when position is required goalkeeper; proven (band) below a required level; wants paid for a required-unpaid role; excluded the required country or won't relocate there; can't start by a required start_date; holds specialisms but none of the required ones — then the player is OUT OF SCOPE for this opening. Lead the verdict by saying plainly they're out of scope and the single clearest reason, in the recruiter's second-person voice. One clear must-have failure is enough.
- A BLANK / UNKNOWN field is NOT a must-have failure: a player with no position, no league band, or no stated preference on a required dimension is a missing-info case ("their position isn't on file"), never "out of scope". Cite the missing field with value="null".
- A miss on a NICE-TO-HAVE dimension (one NOT in must_have_criteria) is never "out of scope" — keep the soft-gap framing for those.
- When must_have_criteria is empty or absent, no dimension is required; use the normal soft weighting throughout.

RECRUITMENT PROBLEM (when opportunity_scope.recruitment_problem is present): this is what the recruiter is solving — frame the verdict around it and lead with the dimension it cares about most:
- replace_player ("replace a key player"): emphasise proven level + fit — a ready, like-for-like replacement.
- raise_level ("raise team level"): emphasise proven level above the team's — does this player lift the level?
- best_available ("best available anywhere"): emphasise overall quality/proven; fit can stretch.
- young_talent ("young talent with potential"): a sparse evidence file (no footage, few references, no settled league level) is EXPECTED for a young prospect and must NOT be framed as "nothing to assess" or a reason to dismiss them. Lead with upside, openness and availability — frame them as worth a conversation, not a dead end.
- leadership ("add leadership / experience"): emphasise proven experience + fit.
- urgent ("urgent need"): emphasise availability + interest — can they come, and soon? Lead with logistics over polish.
Never invent facts to fit the problem; just weight and order the REAL evidence to answer it.

SELF-DECLARED VS PROVEN (non-negotiable): competition_level_band is the player's PROVEN level (where they actually play); level_target is only what they SAY they want. PROVEN outranks self-declared for level matching — never describe a player as being at a level their band doesn't support just because their level_target claims it. You may note the stated aspiration as colour ("they're targeting a higher level than they've proven"), but anchor the level verdict on the band.

COACH CANDIDATE (when the payload has a "coach" object instead of "player", i.e. opportunity_scope.seeking="coach"): you are assessing a COACH for a coaching role, NOT a player. Ignore all player concepts — there is no competition_level_band, level, or footage to weigh. Judge on:
- coaching role: coach.coach_specialization vs opportunity_scope.coaching_role_sought (e.g. a head_coach for a head_coach opening is a direct match; a different specialization is a weaker fit).
- team category: coach.coaching_categories vs opportunity_scope.team_category (do they coach that category?).
- experience / trust: accepted_reference_count + career_entry_count (who vouches + track record).
- availability: is_open (same rule as above — true means available).
Cite the coach fields (coach_specialization, coaching_categories, accepted_reference_count, is_open). All other rules (MATCH not person, 2nd person, closed vocabulary, humanized values, ≤${VERDICT_MAX_CHARS} chars, JSON only) apply unchanged.

If insufficient information (e.g., no playing_category, no level_band on either side, no openness signals), respond with a verdict naming the missing fields AND cite each missing field as a citation with value="null" — e.g. { "field": "competition_level_band", "value": "null", "claim": "Not set on your side, so tier comparison isn't possible yet." }. Do not return an empty citations array.`

function buildUserPrompt(viewer: ProfileRow, player: ProfileRow, fit: FitContext): string {
  const isOpen =
    Boolean(fit.player_open_to_play) ||
    Boolean(fit.player_open_to_coach) ||
    Boolean(fit.player_open_to_opportunities)

  // #6b — coach candidate: assess on coaching-role + team-category match +
  // experience + availability. Level/band/footage don't apply to coaches.
  if (fit.candidate_role === 'coach') {
    return JSON.stringify({
      viewer_role: viewer.role,
      opportunity_scope: {
        seeking: 'coach',
        coaching_role_sought: fit.scope_target_position, // e.g. head_coach
        team_category: fit.viewer_target,
        recruitment_problem: fit.viewer_recruitment_problem,
      },
      coach: {
        role: player.role,
        coach_specialization: fit.player_coach_specialization,
        coaching_categories: fit.player_coaching_categories,
        is_open: isOpen,
        open_to_coach: fit.player_open_to_coach,
        open_to_opportunities: fit.player_open_to_opportunities,
        last_active_at: fit.player_last_active_at,
        accepted_reference_count: player.accepted_reference_count ?? 0,
        career_entry_count: player.career_entry_count ?? 0,
        current_club: player.current_club,
      },
    }, null, 2)
  }

  // Phase 3d — the criteria the recruiter marked MUST-HAVE (only the true
  // ones, so the LLM sees a focused "these are required" list).
  const mustHaveCriteria: string[] = []
  if (fit.scope_position_required) mustHaveCriteria.push('position')
  if (fit.scope_level_required) mustHaveCriteria.push('level')
  if (fit.scope_compensation_required) mustHaveCriteria.push('compensation')
  if (fit.scope_location_required) mustHaveCriteria.push('location')
  if (fit.scope_availability_required) mustHaveCriteria.push('availability')
  if (fit.scope_specialists_required) mustHaveCriteria.push('specialists')

  return JSON.stringify({
    viewer_role: viewer.role,
    viewer_target_category: fit.viewer_target,
    viewer_competition_level_band: fit.viewer_band,
    // #5 Part 2 — the active opportunity scope (null when the recruiter
    // hasn't scoped to an opportunity; then skip level/comp/logistics).
    opportunity_scope: {
      // #2B — the player position the opening seeks (goalkeeper/defender/…).
      position_sought: fit.scope_target_position,
      level_sought: fit.viewer_target_level,
      compensation: fit.viewer_target_compensation,
      location_country: fit.viewer_target_location_country,
      start_date: fit.viewer_target_start_date,
      // #6 — what the recruiter is solving; frame the verdict around it.
      recruitment_problem: fit.viewer_recruitment_problem,
      // Phase 2 (2c) — specialisms the opening wants (humanize the tags).
      specialists_sought: fit.viewer_target_specialists,
      // Phase 3d — criteria the recruiter REQUIRES (must-have). An explicit
      // miss on one of these = out of scope (see MUST-HAVE rule).
      must_have_criteria: mustHaveCriteria,
    },
    player: {
      role: player.role,
      playing_category: fit.player_category,
      // Phase 3d — positions, for the position (mis)match vs position_sought.
      position: fit.player_position,
      secondary_position: fit.player_secondary_position,
      // PROVEN level — derived from their real club's league band.
      competition_level_band: fit.player_band,
      current_club: player.current_club,
      // Derived availability — TRUE when ANY openness flag is set. This is
      // the single signal to use for "are they available?"; the three
      // granular flags below are secondary detail. (v1.6 fix: the model was
      // reading open_to_opportunities=false literally and asserting "not
      // open" even when open_to_play=true — inverting the verdict's badge.)
      is_open:
        Boolean(fit.player_open_to_play) ||
        Boolean(fit.player_open_to_coach) ||
        Boolean(fit.player_open_to_opportunities),
      open_to_play: fit.player_open_to_play,
      open_to_coach: fit.player_open_to_coach,
      open_to_opportunities: fit.player_open_to_opportunities,
      last_active_at: fit.player_last_active_at,
      accepted_reference_count: player.accepted_reference_count ?? 0,
      career_entry_count: player.career_entry_count ?? 0,
      has_highlight_video: Boolean(player.highlight_video_url?.trim()),
      full_match_video_count: player.full_game_video_count ?? 0,
      // SELF-DECLARED intent — what the player SAYS they want. Outranked by
      // proven level for level matching (see SELF-DECLARED VS PROVEN rule).
      level_target: fit.player_level_target,
      opportunity_preference: fit.player_opportunity_preference,
      relocation_willingness: fit.player_relocation_willingness,
      available_from: fit.player_available_from,
      // Phase 2 (2c) — held specialisms (humanize the tags in prose).
      specialist_skills: fit.player_specialist_skills,
    },
  }, null, 2)
}

// ── Claude Sonnet call (inline, no shared helper) ───────────────────
async function callClaude(systemPrompt: string, userPrompt: string): Promise<OpinionPayload> {
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
      model: MODEL,
      max_tokens: 512,
      // Prompt caching: the system prompt is ~600 tokens of identical
      // RULES + SCHEMA on every call — cache it so we only pay full
      // input cost once per 5-minute window. User prompt is per-call.
      system: [
        { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Anthropic API error (${response.status}): ${body}`)
  }
  const data = await response.json() as { content: Array<{ type: string; text?: string }> }
  // Extract text content. Claude returns content[].text for text blocks.
  const text = data.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('')
    .trim()
  // Strip ```json fences if Claude wraps the output despite "JSON only" rule.
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    throw new Error(`Claude returned non-JSON output: ${text.slice(0, 200)}`)
  }
  // Shape validation
  const obj = parsed as Record<string, unknown>
  const verdict = typeof obj.verdict_short === 'string' ? obj.verdict_short : ''
  const rawCitations = Array.isArray(obj.citations) ? obj.citations : []
  const citations: Citation[] = rawCitations
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c) => ({
      field: typeof c.field === 'string' ? c.field : '',
      value: typeof c.value === 'string' ? c.value : String(c.value ?? ''),
      claim: typeof c.claim === 'string' ? c.claim : '',
    }))
    .filter((c) => c.field && c.claim)
  if (!verdict || verdict.length > VERDICT_MAX_CHARS) {
    throw new Error(`Invalid verdict_short: empty or > ${VERDICT_MAX_CHARS} chars`)
  }
  return { verdict_short: verdict, citations }
}

// ── Content filter: enforce closed vocabulary ───────────────────────
function passesContentFilter(payload: OpinionPayload): { ok: boolean; reason?: string } {
  const haystack = [
    payload.verdict_short,
    ...payload.citations.map((c) => c.claim),
  ].join(' ').toLowerCase()
  for (const banned of BANNED_WORDS) {
    if (new RegExp(`\\b${banned}\\b`, 'i').test(haystack)) {
      return { ok: false, reason: `banned vocabulary: ${banned}` }
    }
  }
  return { ok: true }
}

// ── HTTP handler ────────────────────────────────────────────────────
serve(async (req: Request) => {
  // CORS headers must be resolved BEFORE any work that could throw —
  // the outer try/catch below uses them to return a CORS-headed 500
  // when something unexpected happens. Without that, the browser
  // surfaces the failure as `FunctionsFetchError: Failed to send a
  // request to the Edge Function` (QA F1) instead of giving the
  // client a clean error code + message to render in the UI.
  const corsHeaders = getCorsHeaders(req.headers.get('origin'))
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {

  const supabase = getServiceClient()

  // 1) Auth check — must be authenticated.
  const authHeader = req.headers.get('Authorization')
  const jwt = authHeader?.replace(/^Bearer\s+/i, '') ?? ''
  if (!jwt) {
    return new Response(JSON.stringify({ error: 'unauthenticated' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const { data: userData, error: userError } = await supabase.auth.getUser(jwt)
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: 'unauthenticated' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const viewerId = userData.user.id

  // 2) Parse + validate request body.
  //    `force: true` (QA F8) bypasses the server-side cache check
  //    below — the client's regenerate() affordance sends it so a
  //    user-triggered "give me a fresh take" doesn't silently re-serve
  //    the cached row. Quota still applies; force doesn't grant extra
  //    daily generations.
  let playerId: string
  let force = false
  try {
    const body = await req.json() as { player_id?: string; force?: boolean }
    if (!body.player_id || typeof body.player_id !== 'string') throw new Error()
    playerId = body.player_id
    force = body.force === true
  } catch {
    return new Response(JSON.stringify({ error: 'missing_player_id' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (playerId === viewerId) {
    return new Response(JSON.stringify({ error: 'no_self_opinion' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 3) Fetch viewer + player profiles in parallel.
  const [viewer, player] = await Promise.all([
    fetchProfile(supabase, viewerId),
    fetchProfile(supabase, playerId),
  ])
  if (!viewer || !player) {
    return new Response(JSON.stringify({ error: 'profile_not_found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 4) Recruiter gate — club or coach only (matches ClubFitChip + spec).
  if (viewer.role !== 'club' && viewer.role !== 'coach') {
    return new Response(JSON.stringify({ error: 'recruiter_only' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 5) Resolve effective scope (category + opportunity intent) + bands.
  const scope = await resolveScope(supabase, viewerId, viewer.role)
  if (!scope.target) {
    return new Response(JSON.stringify({ error: 'not_applicable', detail: 'no recruiting target — set a context via the chip' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  // 5a) Role compatibility (#6b) — mirror the lenses: a coach-seeking scope
  // assesses coach candidates (Coach Fit); a player-seeking scope assesses
  // player candidates (Club Fit). A mismatch is not_applicable (no opinion),
  // exactly like the deterministic chip hiding.
  const isCoachScope = scope.role === 'coach'
  const candidateIsCoach = player.role === 'coach'
  if (isCoachScope !== candidateIsCoach) {
    return new Response(JSON.stringify({ error: 'not_applicable', detail: 'candidate role does not match the scoped opening' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const [viewerBand, playerBand] = await Promise.all([
    fetchLevelBand(supabase, viewer.current_world_club_id, scope.target === 'Women' ? 'adult_women' : 'adult_men'),
    fetchLevelBand(supabase, player.current_world_club_id, player.playing_category),
  ])
  const fit: FitContext = {
    candidate_role: player.role,
    scope_target_role: scope.role,
    scope_target_position: scope.position,
    player_coach_specialization: player.coach_specialization,
    player_coaching_categories: player.coaching_categories,
    player_specialist_skills: player.specialist_skills,
    viewer_target_specialists: scope.specialists,
    scope_position_required: scope.position_required,
    scope_level_required: scope.level_required,
    scope_compensation_required: scope.compensation_required,
    scope_location_required: scope.location_required,
    scope_availability_required: scope.availability_required,
    scope_specialists_required: scope.specialists_required,
    player_position: player.position,
    player_secondary_position: player.secondary_position,
    viewer_target: scope.target,
    viewer_band: viewerBand,
    viewer_target_level: scope.level,
    viewer_target_compensation: scope.compensation,
    viewer_target_location_country: scope.location_country,
    viewer_target_start_date: scope.start_date,
    viewer_recruitment_problem: scope.problem,
    player_category: player.playing_category,
    player_band: playerBand,
    player_open_to_play: player.open_to_play,
    player_open_to_coach: player.open_to_coach,
    player_open_to_opportunities: player.open_to_opportunities,
    player_last_active_at: player.last_active_at,
    player_accepted_reference_count: player.accepted_reference_count ?? 0,
    player_career_entry_count: player.career_entry_count ?? 0,
    player_has_highlight_video: Boolean(player.highlight_video_url?.trim()),
    player_full_match_video_count: player.full_game_video_count ?? 0,
    player_level_target: player.level_target,
    player_opportunity_preference: player.opportunity_preference,
    player_relocation_willingness: player.relocation_willingness,
    player_available_from: player.available_from,
  }

  // 6) Compute hash + cache check.
  //    When `force: true` (Regenerate from the panel — F8 fix), skip
  //    the cache lookup entirely so the user gets a fresh LLM call.
  //    Quota still gates further down, so abusive Regenerate clicking
  //    still hits the 50/day soft cap.
  const contextHash = await computeContextHash(viewerId, playerId, fit)
  if (!force) {
    const { data: cached } = await supabase
      .from('ai_opinions')
      .select('id, verdict_short, citations, expires_at')
      .eq('viewer_id', viewerId)
      .eq('player_id', playerId)
      .eq('context_hash', contextHash)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()
    if (cached) {
      // citations is a jsonb column (typed Json); at rest it's the
      // {field,value,claim}[] we wrote on the persist path. Json doesn't
      // structurally overlap Citation[], so narrow via Json first.
      const c = cached as { id: string; verdict_short: string; citations: Json }
      const citations = c.citations as unknown as Citation[]
      // F10 fix: include quota_remaining: null for shape consistency
      // with the fresh-generation path. The client union expects this
      // field on every ready response.
      //
      // Phase 2 Slice A: opinion_id surfaced so the client can submit
      // feedback (thumbs up/down) tied to this specific verdict row.
      return new Response(JSON.stringify({
        opinion_id: c.id,
        verdict_short: c.verdict_short,
        citations,
        cached: true,
        quota_remaining: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  // 7) Cache miss — quota check before paying the LLM.
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD UTC
  const { data: quotaRow } = await supabase
    .from('ai_opinion_quota')
    .select('count')
    .eq('viewer_id', viewerId)
    .eq('day', today)
    .maybeSingle()
  const used = (quotaRow as { count: number } | null)?.count ?? 0
  if (used >= QUOTA_PER_DAY) {
    return new Response(JSON.stringify({
      error: 'quota_exceeded',
      resets_at: `${today}T23:59:59Z`,
      quota_per_day: QUOTA_PER_DAY,
    }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 8) LLM call + content filter.
  const userPrompt = buildUserPrompt(viewer, player, fit)
  let payload: OpinionPayload
  try {
    payload = await callClaude(SYSTEM_PROMPT, userPrompt)
  } catch (err) {
    console.error('[ai-opinion] LLM call failed', err)
    return new Response(JSON.stringify({ error: 'llm_failed' }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const filter = passesContentFilter(payload)
  if (!filter.ok) {
    console.error('[ai-opinion] content filter rejected', filter.reason, payload.verdict_short)
    return new Response(JSON.stringify({ error: 'content_filter_rejected', detail: filter.reason }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 9) Persist + increment quota. The upsert RETURNS the row id so we
  // can surface it to the client for Phase 2 Slice A feedback tying
  // (thumbs up/down references the specific opinion row). Best-effort
  // on the quota increment — even if it fails the verdict still goes
  // back, but a failed upsert here means we can't return an id and
  // the panel will gracefully hide the feedback affordance.
  let opinionId: string | null = null
  try {
    const { data: upserted } = await supabase.from('ai_opinions').upsert({
      viewer_id: viewerId,
      player_id: playerId,
      context_hash: contextHash,
      verdict_short: payload.verdict_short,
      // citations is a jsonb column (typed Json). Citation lacks an index
      // signature so isn't structurally a Json object literal; the array is
      // valid JSON at runtime, so cast it to the column's Json type.
      citations: payload.citations as unknown as Json,
      model: MODEL,
      prompt_version: PROMPT_VERSION,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: 'viewer_id,player_id,context_hash' })
      .select('id')
      .single()
    opinionId = (upserted as { id: string } | null)?.id ?? null
    await supabase.from('ai_opinion_quota').upsert({
      viewer_id: viewerId,
      day: today,
      count: used + 1,
    }, { onConflict: 'viewer_id,day' })
  } catch (err) {
    console.error('[ai-opinion] persist failed (response still returned)', err)
  }

  return new Response(JSON.stringify({
    opinion_id: opinionId,
    verdict_short: payload.verdict_short,
    citations: payload.citations,
    cached: false,
    quota_remaining: QUOTA_PER_DAY - used - 1,
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

  } catch (err) {
    // Top-level safety net. Any uncaught throw — bad UUID coerce in a
    // supabase query, a runtime DOMException from Web Crypto, a parse
    // bug we didn't anticipate — lands here so the client gets a
    // CORS-headed 500 with a stable error code, never a fetch-layer
    // failure. The QA pass (F1) explicitly called out the missing
    // catch as the reason `FunctionsFetchError: Failed to send a
    // request` was reaching the browser.
    console.error('[ai-opinion] unhandled exception', err)
    return new Response(
      JSON.stringify({
        error: 'internal',
        detail: err instanceof Error ? err.message : 'unknown',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
