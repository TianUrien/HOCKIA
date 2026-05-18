-- =========================================================================
-- Grant anon SELECT on profiles count + visibility columns
-- =========================================================================
-- Background
-- ----------
-- Public profile pages (/players/:username, /coaches/:username, etc.) read
-- a curated whitelist from `profiles` via PUBLIC_PROFILE_FIELDS_LIST in
-- client/src/lib/publicProfileFields.ts. Anonymous viewers hit those
-- queries through the `anon` Postgres role; column-level GRANTs control
-- which fields they can see.
--
-- Recent additions to the whitelist landed without matching grants:
--   * show_last_active        — added in 20260508800000, grant missed
--   * accepted_friend_count   — PR1 Bento Grid (visitor Hero Friends tile)
--   * post_count              — PR1 Bento Grid (visitor Community card)
--   * full_game_video_count   — PR1 Bento Grid (visitor Media card)
--
-- Without these grants, a logged-out viewer hitting a public profile
-- gets `42501 permission denied for table profiles` — Postgres returns
-- a single denial for the whole query the moment ANY selected column is
-- ungranted. Surfaced by Sentry JAVASCRIPT-REACT-97 where the
-- auth-callback race hit the same wall during the brief window before
-- the JWT attaches and the role falls back to anon.
--
-- These are denormalized counts + one boolean visibility flag — same
-- trust class as the columns that already have anon SELECT (e.g.
-- accepted_reference_count, career_entry_count). No PII concern.
--
-- RLS is unchanged. Grants control whether a role can touch the column;
-- RLS controls which rows it sees. Both still required.
-- =========================================================================

SET search_path = public;

GRANT SELECT (
  show_last_active,
  accepted_friend_count,
  post_count,
  full_game_video_count
) ON public.profiles TO anon;
