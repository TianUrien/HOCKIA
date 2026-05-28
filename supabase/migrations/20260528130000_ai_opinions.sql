-- ─────────────────────────────────────────────────────────────────────
-- ai_opinions — Section F AI Opinion Engine (recruitment spec G.7)
-- ─────────────────────────────────────────────────────────────────────
-- Phase 1 DB layer for the LLM-written verdict on player↔club fit.
-- See docs/SECTION_F_AI_OPINION_ENGINE_PROPOSAL.md for design intent.
--
-- HOCKIA principles enforced at the DB layer:
--   - Opinions are PRIVATE to the recruiter who asked. The player
--     never reads opinions about themselves. RLS enforces.
--   - Opinions are CACHED — context_hash composes the inputs that
--     would change the verdict (viewer target, both sides' bands,
--     player open flags, prompt version). When any change, the next
--     dedupe call produces a different hash and refreshes the cache.
--   - The recruiter is rate-limited on FRESH GENERATIONS only (cached
--     re-reads are unlimited). Daily counter in ai_opinion_quota.
--
-- Tables:
--   ai_opinions       — verdict rows, recruiter-scoped, TTL'd
--   ai_opinion_quota  — daily fresh-generate counter per recruiter
--
-- GRANTs follow the post-Oct-30-2026 explicit pattern. The schema
-- defaults from migration 20260528110000 would grant
-- anon/authenticated CRUD by default; we REVOKE that and re-grant
-- only what each role actually needs.

BEGIN;

-- ── ai_opinions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_opinions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The recruiter who triggered the opinion. Always = auth.uid() at
  -- generation time. NEVER == player_id (enforced by the
  -- ai_opinions_no_self_opinion CHECK below) so a recruiter can't
  -- accidentally use the engine to introspect themselves.
  viewer_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The player being evaluated.
  player_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- md5 of the structured inputs that would change the verdict:
  -- viewer target_category + viewer competition_level_band +
  -- player playing_category + player competition_level_band +
  -- player open_to_play/coach/opportunities + prompt_version.
  -- Any change → different hash → cache miss → fresh generation.
  context_hash    TEXT NOT NULL,
  -- The natural-language verdict. Bounded to 500 chars so it fits
  -- in 1-2 sentences and the LLM can't run away with copy.
  verdict_short   TEXT NOT NULL CHECK (length(verdict_short) BETWEEN 1 AND 500),
  -- Array of {field, value, claim} objects citing the profile fields
  -- that drove each part of the verdict. Empty array allowed for
  -- "no evidence" responses but not preferred.
  citations       JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Which LLM produced this verdict. Used for prompt-version + model
  -- migration analytics. e.g. 'claude-sonnet-4-6'.
  model           TEXT NOT NULL,
  -- Prompt template version. Bumped when the structured prompt
  -- shape changes, so analytic compare across versions stays clean.
  prompt_version  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  -- 24h TTL by default — Phase 1 has no mutation-driven invalidation.
  -- Cache reads ignore rows past expires_at; cleanup is a periodic
  -- job (not in this migration — backlog item for the operations slice).
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now()) + interval '24 hours'),
  -- A recruiter can't ask the engine to opine on themselves.
  CONSTRAINT ai_opinions_no_self_opinion CHECK (viewer_id <> player_id)
);

COMMENT ON TABLE public.ai_opinions IS
  'LLM-written player↔club fit verdicts. Recruiter-scoped + TTL-cached. RLS hard-isolates per viewer; player never reads opinions about themselves.';

-- One fresh row per (recruiter, player, context_hash) — the edge
-- function ON CONFLICT DO UPDATE-s on this triple to refresh expiry
-- without inserting duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS ai_opinions_viewer_player_context_unique
  ON public.ai_opinions (viewer_id, player_id, context_hash);

-- Supports cache lookups: "do we have a fresh opinion for this viewer
-- on this player?" Filters expired rows in the same lookup.
CREATE INDEX IF NOT EXISTS ai_opinions_viewer_player_expires_idx
  ON public.ai_opinions (viewer_id, player_id, expires_at DESC);

-- Supports the future periodic cleanup job (DELETE WHERE expires_at < now()).
CREATE INDEX IF NOT EXISTS ai_opinions_expires_idx
  ON public.ai_opinions (expires_at);

-- ── ai_opinion_quota ────────────────────────────────────────────────
-- Daily fresh-generate counter per recruiter. Cached re-reads are
-- unlimited; only the edge function's LLM-call path increments. Phase
-- 1 ceiling is 50/day (enforced in the edge function, not DB) —
-- documented here so future bumps land alongside the schema.
CREATE TABLE IF NOT EXISTS public.ai_opinion_quota (
  viewer_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day        DATE NOT NULL DEFAULT CURRENT_DATE,
  count      INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (viewer_id, day)
);

COMMENT ON TABLE public.ai_opinion_quota IS
  'Per-recruiter daily fresh-generate counter for ai_opinions. Cached re-reads do not increment.';

-- ── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE public.ai_opinions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_opinion_quota ENABLE ROW LEVEL SECURITY;

-- ai_opinions: viewer can only SELECT their own rows. INSERTs +
-- UPDATEs go exclusively through the edge function as service_role
-- (no policy for authenticated INSERT/UPDATE — DB rejects by
-- default-deny when RLS is on and no policy matches).
DROP POLICY IF EXISTS "ai_opinions_viewer_read_own" ON public.ai_opinions;
CREATE POLICY "ai_opinions_viewer_read_own"
  ON public.ai_opinions FOR SELECT
  TO authenticated
  USING (auth.uid() = viewer_id);

DROP POLICY IF EXISTS "ai_opinions_service_role_all" ON public.ai_opinions;
CREATE POLICY "ai_opinions_service_role_all"
  ON public.ai_opinions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ai_opinion_quota: same model — viewer reads own, service_role
-- writes. Surfacing "you have 17 fresh opinions remaining today" in
-- the UI requires read.
DROP POLICY IF EXISTS "ai_opinion_quota_viewer_read_own" ON public.ai_opinion_quota;
CREATE POLICY "ai_opinion_quota_viewer_read_own"
  ON public.ai_opinion_quota FOR SELECT
  TO authenticated
  USING (auth.uid() = viewer_id);

DROP POLICY IF EXISTS "ai_opinion_quota_service_role_all" ON public.ai_opinion_quota;
CREATE POLICY "ai_opinion_quota_service_role_all"
  ON public.ai_opinion_quota FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── GRANTs (post-Oct-30 2026 explicit pattern) ──────────────────────
-- Default privileges from migration 20260528110000 would grant
-- anon/authenticated SIUD by default. For AI opinions we tighten:
--   anon          — no access (recruiter-only feature)
--   authenticated — SELECT only (read own via RLS); no direct writes
--   service_role  — ALL (edge function writes)

REVOKE ALL ON TABLE public.ai_opinions      FROM anon, authenticated;
REVOKE ALL ON TABLE public.ai_opinion_quota FROM anon, authenticated;

GRANT SELECT ON TABLE public.ai_opinions      TO authenticated;
GRANT SELECT ON TABLE public.ai_opinion_quota TO authenticated;

GRANT ALL ON TABLE public.ai_opinions      TO service_role;
GRANT ALL ON TABLE public.ai_opinion_quota TO service_role;

COMMIT;
