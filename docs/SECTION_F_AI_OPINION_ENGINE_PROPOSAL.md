# Section F — AI Opinion Engine (recruitment spec G.7)

**Status:** Drafted 2026-05-28 — **NOT approved for implementation**, awaiting user sign-off on scope + open decisions.

**One-line intent:** synthesize HOCKIA's deterministic Club Fit math + the player's verifiable facts into a short, natural-language verdict that a recruiter can read in 4 seconds and act on.

## HOCKIA principles this slice must respect

Pulled verbatim from the design guardrails the user has reinforced across this session — these are non-negotiable:

1. **Facts, not judgment about the person.** Hockia AI gives opinions about the MATCH only, never about the player. ❌ "Maria is talented" ✅ "Maria's full-match footage at Hoofdklasse level lines up with your team's competition tier."
2. **Opinions are anchored.** Every verdict cites the specific player attributes that drove it. No floating claims.
3. **Recruiter decisions are private.** AI opinions visible only to the asking club/coach. Player never sees the opinion the recruiter is reading.
4. **Closed vocabulary at the model boundary.** No "elite / star / generational" copy — Hockia AI's outputs go through a content filter before persistence.
5. **No context, no score.** If the recruiter has no active context AND no profile-derived target, no opinion is generated (consistent with the existing ClubFitChip gating).

## What we already have

| Asset | Lives at | Reusable for |
|---|---|---|
| Deterministic Club Fit math | `client/src/lib/clubFit.ts` — `computeClubFit()` | The structured input the LLM reasons over |
| Recruiting context resolver | `client/src/hooks/useRecruitingContext.ts` + `recruiting_context` table | The viewer's target the opinion is scoped to |
| Pluggable LLM provider | `supabase/functions/nl-search/index.ts` — `LLM_PROVIDER` env (Gemini default, Claude Sonnet on prod) | Same provider abstraction, copied into the new edge function |
| Bio credential extraction | `client/src/lib/bioCredentials.ts` | Bio-derived signals for the prompt |
| Player profile facts | `profiles` row + denormalized counts | Direct LLM context |
| Career history breakdown | `career_history` table | Past clubs / selections / achievements as evidence |

## Architecture (Phase 1)

```
┌──────────────────────────────┐
│ Recruiter opens player       │
│ profile (ScoutingCard)       │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│ useAIOpinion(playerId)                   │
│  - cache hit (24h TTL)? → return         │
│  - else → call ai-opinion edge function  │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│ ai-opinion edge function                 │
│  1. Auth check (recruiter only)          │
│  2. Resolve viewer's effective target    │
│  3. Read player facts + Fit math         │
│  4. Build structured prompt (CLOSED      │
│     vocabulary, evidence-required)       │
│  5. LLM call (Claude Sonnet on prod)     │
│  6. Validate output via content filter   │
│  7. Persist to ai_opinions (recruiter    │
│     scoped, context_hash keyed)          │
│  8. Return verdict + citations           │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│ AIOpinionPanel renders                   │
│  - verdict_short (1-2 sentences)         │
│  - citations (clickable, jumps to source │
│    field on the profile)                 │
│  - "Regenerate" button (busts cache)     │
│  - Feedback affordance (Phase 2)         │
└──────────────────────────────────────────┘
```

## Phase 1 scope (the minimum slice that proves the loop)

**DB:**
- New migration: `ai_opinions` table
  - `id`, `viewer_id` (FK profiles), `player_id` (FK profiles), `context_hash` (md5 of recruiting context for cache invalidation), `verdict_short` (text, ≤280 chars), `citations` (jsonb — array of `{field, value, claim}`), `model` (text — which LLM), `prompt_version` (text — for prompt evolution), `created_at`, `expires_at` (24h default)
- RLS: viewer can only SELECT/INSERT their own rows. Player NEVER reads opinions about themselves.
- Per-recruiter rate limit: max 50 fresh-generate calls / day (cached re-reads unlimited)

**Edge function:** `supabase/functions/ai-opinion/index.ts`
- Auth-gated: viewer.role must be `club` or `coach`
- Reuses `_shared/llm.ts` provider pattern from nl-search (extract if not already shared)
- Prompt template versioned (`v1.0`) so we can iterate without losing analytic history
- Output: JSON only — no free-text. LLM forced into a strict schema `{ verdict_short, citations: [...] }`
- Content filter: run output through existing `contentFilter.ts` (or extend) to enforce closed vocabulary

**Client:**
- New hook: `useAIOpinion(playerId)` — checks cache, calls edge function on miss
- New component: `AIOpinionPanel` — renders on `ScoutingCard` (recruiter view of another player's profile)
- Feature flag: `VITE_ENABLE_AI_OPINION=true` on staging only initially. Prod default off.

**Tests:**
- Prompt construction unit tests (snapshot the structured prompt for a known player+context)
- Edge function integration test with mocked LLM (asserts JSON schema enforcement + content filter passes)
- DB integration test for RLS isolation (recruiter A cannot read recruiter B's opinion)
- Component test for AIOpinionPanel (loading / error / empty / loaded states)

## Open decisions for you

These shape Phase 1 — flagging so we agree before code:

1. **Gating model.** Recruiter-only is set. Within that:
   - **Free / unlimited** for clubs + coaches?
   - **Soft-rate-limit** (50/day per recruiter)?
   - **Paid tier gate** (kept for a future monetization slice)?
   *My recommendation:* soft-rate-limit Phase 1, no payment integration yet.

2. **LLM provider for v1.** Memory says nl-search is on Claude Sonnet 4.6 on prod (cutover 2026-04-30). Same provider for AI opinions?
   *My recommendation:* yes — keep consistent, reuse cost/quality calibration already done.

3. **Cache TTL.** 24h default — feels right for "this player hasn't dramatically changed in a day." Profile updates should invalidate but I'd skip that complexity Phase 1.
   *My recommendation:* 24h fixed TTL Phase 1; mutation-driven invalidation Phase 2 if needed.

4. **Where the chip lives.** ScoutingCard (full profile view) is the obvious surface. Should it ALSO appear:
   - On MemberPreviewModal? *(would burn rate-limit on every preview tap)*
   - As a compact one-line summary on tiles? *(would burn rate-limit on every grid load)*
   *My recommendation:* ScoutingCard only Phase 1. Tile + modal in Phase 3 if recruiters ask.

5. **Content-filter strictness.** The closed vocabulary needs explicit lists for what's allowed/banned. Do we:
   - **Start permissive**, ban only obvious quality words (elite, star, generational) — let staging usage surface what else to ban?
   - **Start strict**, only words from a tight allow-list pass — more friction, fewer surprises?
   *My recommendation:* permissive Phase 1, with a banned-words list. Tighten based on staging review.

6. **Free Browse Mode behavior.** Per HOCKIA principle "no context, no score, free browse shows facts only" — when a coach has no active recruiting context, we hide AI Opinion entirely (same gate as ClubFitChip).
   *My recommendation:* enforce the same `useClubFit().isApplicable` gate. If no Fit, no Opinion.

## Phase 1 effort estimate

**~2-3 sessions:**
- Session A: DB migration + edge function skeleton + LLM provider + prompt template
- Session B: Client hook + AIOpinionPanel + feature flag + tests
- Session C: QA pass on staging (your AI agent loop), polish, prod merge

## Phase 2 (separate, opt-in)

- `ai_opinion_feedback` table — thumbs up/down + free-text reason
- Mutation-driven cache invalidation
- Pre-warm on shortlist add

## Phase 3 (separate, opt-in)

- Compact opinion summary on `MemberTile` / `MemberPreviewModal`
- Bulk opinion generation for a whole shortlist

## What I need from you to start Phase 1

A simple "approved, my recommendations on the 6 open decisions look fine — proceed" is enough. If you want to override any of the recommendations, flag them and I'll align before any code.
