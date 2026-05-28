-- ─────────────────────────────────────────────────────────────────────
-- recruiting_context — remove auto-seeded type='club' rows
-- ─────────────────────────────────────────────────────────────────────
-- Sprint 4 UX correction (2026-05-28).
--
-- The original Sprint 2 backfill (migration 20260528010000) created a
-- `type='club'` row for every existing club with `is_active=TRUE`,
-- pre-populating the target_category from their league columns and
-- the region from `base_city`. The intent was "implicit context
-- derived from the profile so Fit works out of the box".
--
-- User QA feedback (2026-05-28) flagged the consequence:
--   - A club lands on Community and finds the recruiting chip
--     pre-active with "Mixed · Manchester" — they never asked for
--     this
--   - The chip's sheet shows the auto-seeded row with no way to
--     deselect it (radio-style picker, no "no context" option)
--   - The active region narrows the carousel + grid + Saved list
--     aggressively → the user sees only a handful of members and
--     thinks Community is broken
--
-- The product principle: recruiting context is an OPTIONAL overlay
-- that personalises Fit + filters Community. It must be opt-in, not
-- automatic. Coaches were never auto-seeded; clubs should match.
--
-- Fix: delete every auto-seeded `type='club'` row. Going forward:
--   - New clubs sign up with NO active context (no trigger fires)
--   - Existing clubs lose their auto-context but keep any user-
--     created `type='custom'` or `type='opportunity'` rows
--   - The chip UI shows the "Set recruiting context →" empty CTA
--   - All members are visible on Community by default
--
-- Idempotent: re-runs delete zero additional rows.

BEGIN;

DELETE FROM public.recruiting_context
WHERE type = 'club';

COMMIT;
