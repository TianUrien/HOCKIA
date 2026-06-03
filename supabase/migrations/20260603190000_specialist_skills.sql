-- ─────────────────────────────────────────────────────────────────────
-- Specialist role/skill tags (Matching Increment #3.1 — capture)
-- ─────────────────────────────────────────────────────────────────────
-- Field-hockey coaches recruit by specialism, not just position — a
-- "drag-flicker", a "target striker", a "playmaker". These are skills
-- layered on top of position (GK/DEF/MID/FWD). This captures them on both
-- sides; the 🎯 Fit lens will consume them in Increment #3.2.
--
--   profiles.specialist_skills — what a PLAYER specialises in (multi).
--   opportunities.specialist_skills_wanted — what an opportunity SEEKS.
--
-- Both are text[] of the curated specialist vocabulary (validated client
-- side, like coaching_categories), NOT NULL default empty so they never
-- block a profile/opportunity and stay neutral in matching. Columns on
-- existing tables → standard RLS + grants already apply.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS specialist_skills TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS specialist_skills_wanted TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.profiles.specialist_skills IS
  'Player specialist tags (curated vocab, e.g. drag_flicker/target_striker). Multi. Feeds the Fit lens position_match refinement (Increment #3.2).';
COMMENT ON COLUMN public.opportunities.specialist_skills_wanted IS
  'Specialist skills an opportunity seeks (same vocab). Carried onto the scope for the Fit-lens specialist boost.';

COMMIT;
