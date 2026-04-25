-- ============================================================================
-- Hotfix: drop the orphaned 3-arg get_home_feed overload
-- ============================================================================
-- 20260425010000_home_feed_author_filters.sql introduced a new 5-arg
-- signature for get_home_feed via CREATE OR REPLACE FUNCTION. CREATE OR
-- REPLACE only replaces a function with the *same* signature, so the
-- original 3-arg version (defined by 202602091200_home_feed_rpc.sql and
-- replaced in body by several follow-ups, all with the same args) was
-- left in place alongside the new 5-arg one.
--
-- PostgREST sees two get_home_feed functions and refuses to pick:
--   PGRST203: Could not choose the best candidate function between...
--
-- Drop the old 3-arg version. The new 5-arg version has DEFAULTs on every
-- parameter, so any caller that was using the 3-arg form continues to
-- work — PostgREST just resolves to the only remaining overload.

DROP FUNCTION IF EXISTS public.get_home_feed(INTEGER, INTEGER, TEXT);
