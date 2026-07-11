-- Home redesign Phase 1 — get_market_moves(): the Pulse "Happening now" read.
--
-- WHY A DEDICATED RPC: movement items (roles opened/filled, career moves,
-- open-to-play, evidence) are a minority of feed rows — on staging the first
-- 50 get_home_feed items are routinely ALL text posts + references, so any
-- client-side sample of the merged feed renders the module empty (Tian's QA
-- caught exactly that). One type-filtered, indexed read returns exactly the
-- movement layer.
--
-- Also the ONLY reader of career_move rows: the merged feed keeps excluding
-- them (transfers/signings render there as rich user_post cards — surfacing
-- career_move would double-card), but the digest shows no user posts, so the
-- compact career_move row is exactly right here.
--
-- FENCES (standing invariant — SECURITY DEFINER bypasses RLS, so this fn
-- applies every predicate itself, mirroring get_home_feed verbatim):
--   • hidden authors (banned / frozen minor) vanish, NULL authors pass;
--   • test-account rows only for test viewers (or on staging);
--   • bidirectional user_blocks;
--   • authenticated-only (unauthenticated → empty, and EXECUTE is revoked
--     from anon anyway).
--
-- Return: jsonb ARRAY of (metadata || {feed_item_id, item_type, created_at})
-- — the same passthrough shape as get_home_feed items, so the client mapper
-- is shared.

CREATE OR REPLACE FUNCTION public.get_market_moves(p_limit integer DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_items JSONB;
  v_user_id UUID := auth.uid();
  v_is_test BOOLEAN;
  v_blocked_ids UUID[];
BEGIN
  IF v_user_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT is_staging_env() OR COALESCE(is_test_account, false) INTO v_is_test
  FROM profiles WHERE id = v_user_id;

  -- Bidirectional: caller blocked them OR they blocked caller (same
  -- semantics as get_home_feed / is_blocked_pair).
  SELECT COALESCE(array_agg(other_id), ARRAY[]::UUID[])
    INTO v_blocked_ids
    FROM (
      SELECT blocked_id AS other_id FROM user_blocks WHERE blocker_id = v_user_id
      UNION
      SELECT blocker_id AS other_id FROM user_blocks WHERE blocked_id = v_user_id
    ) blocks;

  SELECT COALESCE(jsonb_agg(c.item_data ORDER BY c.created_at DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      hfi.created_at,
      hfi.metadata || jsonb_build_object(
        'feed_item_id', hfi.id,
        'item_type', hfi.item_type,
        'created_at', hfi.created_at
      ) AS item_data
    FROM home_feed_items hfi
    WHERE hfi.deleted_at IS NULL
      AND hfi.item_type IN (
        'opportunity_posted', 'role_filled', 'career_move',
        'open_to_play_confirmed', 'media_added', 'video_added', 'club_responded'
      )
      AND (v_is_test OR hfi.is_test_account = false)
      AND (hfi.author_profile_id IS NULL OR NOT (hfi.author_profile_id = ANY(v_blocked_ids)))
      -- age-gate: items by hidden authors vanish (NULL authors pass)
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles hp
        WHERE hp.id = hfi.author_profile_id
          AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at)
      )
    ORDER BY hfi.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20)
  ) c;

  RETURN v_items;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_market_moves(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_market_moves(integer) TO authenticated, service_role;
