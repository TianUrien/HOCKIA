-- Hidden-profile hardening batch (Jul-7 integration audit findings).
--
-- Profiles can be hidden: admin ban (is_blocked) OR frozen minor
-- (frozen_minor_at). Base RLS enforces this only for direct table reads as
-- anon/authenticated. SECURITY DEFINER functions and service-role/edge-fn
-- reads BYPASS RLS — each such surface must apply the predicate itself
-- (standing invariant, see CLAUDE.md). The audit found the surfaces below
-- missing it. Zero ACTIVE exposure today (no hidden account owns any of the
-- affected rows) — this closes the structural gaps before one does.
--
-- Every body below is a FULL REPLACE of the live definition plus the fence.
-- Safety: on 2026-07-10 every one of these objects was verified BYTE-IDENTICAL
-- between staging and prod (md5 of pg_get_functiondef/pg_get_viewdef), and
-- identical to its source migration — none is on the known drifted-fns list.
-- A self-check at the end asserts every object now carries the predicate.
--
-- Counts stay in parity with lists throughout (digest counts + top-viewer
-- arrays, comment totals + pages, conversation pagination) — never a
-- list/count mismatch.

-- ────────────────────────────────────────────────────────────────────
-- 1. VIEW public_opportunities (HIGH) — anon-facing public API.
--    security_invoker=true fences BROWSER reads via profiles RLS, but the
--    public-opportunities edge fn reads it as service_role (rolbypassrls) —
--    a hidden publisher's name/avatar/location would go to the open
--    internet. The view now self-carries the predicate, like it already
--    self-carries is_test_account and onboarding_completed.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.public_opportunities
WITH (security_invoker = true) AS
 SELECT v.id,
    v.title,
    v.opportunity_type,
    v."position",
    v.gender,
    v.description,
    v.location_city,
    v.location_country,
    v.start_date,
    v.duration_text,
    v.application_deadline,
    v.priority,
    v.requirements,
    v.benefits,
    v.custom_benefits,
    v.published_at,
    v.created_at,
    p.full_name AS club_name,
    p.avatar_url AS club_logo_url,
    p.base_location AS club_location,
    p.league_division AS club_league,
    p.role AS publisher_role,
    v.organization_name,
    p.current_club AS publisher_current_club,
    wc.club_name AS world_club_name,
    wc.avatar_url AS world_club_avatar_url,
    COALESCE(ml.name, wl.name) AS world_club_league,
    v.eu_passport_required
   FROM opportunities v
     JOIN profiles p ON p.id = v.club_id
     LEFT JOIN world_clubs wc ON wc.id = v.world_club_id
     LEFT JOIN world_leagues ml ON ml.id = wc.men_league_id
     LEFT JOIN world_leagues wl ON wl.id = wc.women_league_id
  WHERE v.status = 'open'::opportunity_status
    AND COALESCE(p.is_test_account, false) = false
    AND p.onboarding_completed = true
    AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at);

-- Belt: a prior CREATE OR REPLACE VIEW once shipped without security_invoker
-- (see 202602101900) — re-assert it and the grants explicitly.
ALTER VIEW public.public_opportunities SET (security_invoker = true);
GRANT SELECT ON public.public_opportunities TO anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 2. get_post_comments (MED) — named a hidden author (name/avatar/role).
--    Fence applied to BOTH the total and the pre-LIMIT page query so the
--    count stays in parity with the list.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_post_comments(p_post_id UUID, p_limit INTEGER DEFAULT 20, p_offset INTEGER DEFAULT 0)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_comments JSONB; v_total BIGINT; v_user_id UUID := auth.uid();
BEGIN
  SELECT COUNT(*) INTO v_total FROM post_comments WHERE post_id = p_post_id AND deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = author_id) OR (ub.blocker_id = author_id AND ub.blocked_id = v_user_id))
    AND NOT EXISTS (SELECT 1 FROM profiles hp WHERE hp.id = author_id AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at));

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', pc.id, 'post_id', pc.post_id, 'author_id', pc.author_id,
    'author_name', p.full_name, 'author_avatar', p.avatar_url, 'author_role', p.role,
    'content', pc.content, 'created_at', pc.created_at
  ) ORDER BY pc.created_at ASC), '[]'::jsonb) INTO v_comments
  FROM (
    SELECT id, post_id, author_id, content, created_at FROM post_comments
    WHERE post_id = p_post_id AND deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = author_id) OR (ub.blocker_id = author_id AND ub.blocked_id = v_user_id))
      AND NOT EXISTS (SELECT 1 FROM profiles hp WHERE hp.id = author_id AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at))
    ORDER BY created_at ASC LIMIT p_limit OFFSET p_offset
  ) pc JOIN profiles p ON p.id = pc.author_id;

  RETURN jsonb_build_object('comments', v_comments, 'total', v_total);
END;
$$;

-- ────────────────────────────────────────────────────────────────────
-- 3. get_profile_references (MED) — exposed a hidden reference GIVER's
--    full identity in reference_profile.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_profile_references(p_profile_id UUID)
RETURNS TABLE(id uuid, requester_id uuid, reference_id uuid, relationship_type text, endorsement_text text, accepted_at timestamp with time zone, reference_profile jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF p_profile_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT pr.id, pr.requester_id, pr.reference_id, pr.relationship_type, pr.endorsement_text, pr.accepted_at,
    jsonb_build_object('id', ref.id, 'full_name', ref.full_name, 'role', ref.role, 'username', ref.username,
      'avatar_url', ref.avatar_url, 'base_location', ref.base_location, 'position', ref.position,
      'current_club', ref.current_club, 'nationality_country_id', ref.nationality_country_id, 'nationality2_country_id', ref.nationality2_country_id
    ) AS reference_profile
  FROM public.profile_references pr
  JOIN public.profiles ref ON ref.id = pr.reference_id
  WHERE pr.requester_id = p_profile_id AND pr.status = 'accepted'
    AND NOT public.profile_is_hidden(ref.is_blocked, ref.frozen_minor_at)
    AND (v_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = ref.id) OR (ub.blocker_id = ref.id AND ub.blocked_id = v_user_id)))
  ORDER BY pr.accepted_at DESC NULLS LAST, pr.created_at DESC;
END;
$$;

-- ────────────────────────────────────────────────────────────────────
-- 4. get_user_conversations (LOW-MED) — a hidden counterpart's name/avatar
--    still rendered in the inbox. Fenced in the user_conversations CTE
--    (parallel to the block filter) so pagination, unread counts and
--    has_more all derive from the fenced set — parity for free.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_user_conversations(
  p_user_id UUID,
  p_limit INT DEFAULT 50,
  p_cursor_last_message_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_conversation_id UUID DEFAULT NULL
)
RETURNS TABLE (
  conversation_id UUID,
  other_participant_id UUID,
  other_participant_name TEXT,
  other_participant_username TEXT,
  other_participant_avatar TEXT,
  other_participant_role TEXT,
  last_message_content TEXT,
  last_message_sent_at TIMESTAMPTZ,
  last_message_sender_id UUID,
  unread_count BIGINT,
  conversation_created_at TIMESTAMPTZ,
  conversation_updated_at TIMESTAMPTZ,
  conversation_last_message_at TIMESTAMPTZ,
  has_more BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_requesting_user UUID := auth.uid();
BEGIN
  IF v_requesting_user IS NULL THEN
    RAISE EXCEPTION 'get_user_conversations requires authentication' USING ERRCODE = '42501';
  END IF;
  IF v_requesting_user <> p_user_id THEN
    RAISE EXCEPTION 'Cannot fetch conversations for another user' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH user_conversations AS (
    SELECT
      c.id AS conv_id,
      CASE WHEN c.participant_one_id = p_user_id THEN c.participant_two_id ELSE c.participant_one_id END AS other_user_id,
      c.created_at,
      c.updated_at,
      c.last_message_at,
      COALESCE(c.last_message_at, c.created_at) AS sort_timestamp
    FROM public.conversations c
    WHERE (c.participant_one_id = p_user_id OR c.participant_two_id = p_user_id)
      -- BLOCK FILTER: hide conversations with blocked users
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks ub
        WHERE (ub.blocker_id = p_user_id AND ub.blocked_id = CASE WHEN c.participant_one_id = p_user_id THEN c.participant_two_id ELSE c.participant_one_id END)
           OR (ub.blocker_id = CASE WHEN c.participant_one_id = p_user_id THEN c.participant_two_id ELSE c.participant_one_id END AND ub.blocked_id = p_user_id)
      )
      -- HIDDEN FILTER: hide conversations with banned / frozen-minor profiles
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles hp
        WHERE hp.id = CASE WHEN c.participant_one_id = p_user_id THEN c.participant_two_id ELSE c.participant_one_id END
          AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at)
      )
  ),
  paginated AS (
    SELECT *
    FROM user_conversations uc
    WHERE (p_cursor_last_message_at IS NULL AND p_cursor_conversation_id IS NULL)
       OR (uc.sort_timestamp < p_cursor_last_message_at)
       OR (uc.sort_timestamp = p_cursor_last_message_at AND (p_cursor_conversation_id IS NULL OR uc.conv_id < p_cursor_conversation_id))
    ORDER BY uc.sort_timestamp DESC, uc.conv_id DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 200) + 1
  ),
  limited AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY sort_timestamp DESC, conv_id DESC) AS row_num FROM paginated
  ),
  final_page AS (
    SELECT * FROM limited WHERE row_num <= LEAST(GREATEST(p_limit, 1), 200)
  ),
  last_messages AS (
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id, m.content, m.sent_at, m.sender_id
    FROM public.messages m
    INNER JOIN final_page fp ON fp.conv_id = m.conversation_id
    ORDER BY m.conversation_id, m.sent_at DESC
  ),
  unread_counts AS (
    SELECT m.conversation_id, COUNT(*) AS unread_count
    FROM public.messages m
    INNER JOIN final_page fp ON fp.conv_id = m.conversation_id
    WHERE m.sender_id <> p_user_id AND m.read_at IS NULL
    GROUP BY m.conversation_id
  )
  SELECT
    fp.conv_id, fp.other_user_id, p.full_name, p.username, p.avatar_url, p.role::TEXT,
    lm.content, lm.sent_at, lm.sender_id, COALESCE(ur.unread_count, 0),
    fp.created_at, fp.updated_at, fp.last_message_at,
    EXISTS (SELECT 1 FROM limited WHERE row_num > LEAST(GREATEST(p_limit, 1), 200)) AS has_more
  FROM final_page fp
  LEFT JOIN public.profiles p ON p.id = fp.other_user_id
  LEFT JOIN last_messages lm ON lm.conversation_id = fp.conv_id
  LEFT JOIN unread_counts ur ON ur.conversation_id = fp.conv_id
  ORDER BY fp.sort_timestamp DESC, fp.conv_id DESC;
END;
$$;

-- ────────────────────────────────────────────────────────────────────
-- 5. get_profile_posts (LOW-MED) — served a hidden profile's posts.
--    One early-return guard fences count AND items together. Self-view is
--    exempt, mirroring the "Users can view their own profile" RLS policy
--    (a frozen minor still sees their own posts on their own profile).
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_profile_posts(p_profile_id UUID, p_limit INTEGER DEFAULT 20, p_offset INTEGER DEFAULT 0)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_items JSONB; v_total BIGINT; v_user_id UUID := auth.uid();
BEGIN
  -- If blocked pair, return empty
  IF v_user_id IS NOT NULL AND public.is_blocked_pair(v_user_id, p_profile_id) THEN
    RETURN jsonb_build_object('items', '[]'::jsonb, 'total', 0);
  END IF;

  -- Hidden target profile: empty for everyone except the owner themself.
  IF (v_user_id IS NULL OR v_user_id <> p_profile_id)
     AND EXISTS (SELECT 1 FROM profiles tp WHERE tp.id = p_profile_id
                   AND public.profile_is_hidden(tp.is_blocked, tp.frozen_minor_at)) THEN
    RETURN jsonb_build_object('items', '[]'::jsonb, 'total', 0);
  END IF;

  SELECT COUNT(*) INTO v_total FROM user_posts WHERE author_id = p_profile_id AND deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'feed_item_id', up.id, 'item_type', 'user_post', 'created_at', up.created_at,
    'post_id', up.id, 'author_id', up.author_id,
    'author_name', COALESCE(b.name, p.full_name), 'author_avatar', COALESCE(b.logo_url, p.avatar_url),
    'author_role', p.role, 'content', up.content, 'images', up.images,
    'like_count', up.like_count, 'comment_count', up.comment_count,
    'has_liked', EXISTS (SELECT 1 FROM post_likes pl WHERE pl.post_id = up.id AND pl.user_id = v_user_id),
    'post_type', COALESCE(up.post_type, 'text'), 'metadata', up.metadata
  ) ORDER BY up.created_at DESC), '[]'::jsonb) INTO v_items
  FROM (
    SELECT up2.id, up2.author_id, up2.content, up2.images, up2.like_count, up2.comment_count, up2.created_at, up2.post_type, up2.metadata
    FROM user_posts up2 WHERE up2.author_id = p_profile_id AND up2.deleted_at IS NULL
    ORDER BY up2.created_at DESC LIMIT p_limit OFFSET p_offset
  ) up JOIN profiles p ON p.id = up.author_id LEFT JOIN brands b ON b.profile_id = p.id;

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$$;

-- ────────────────────────────────────────────────────────────────────
-- 6. enqueue_profile_view_emails (MED) — hidden viewers inflated the
--    "N people viewed you" digest counts. Fenced in all three viewer
--    reads AND the recipient. The top_viewers ARRAY subquery previously
--    joined profiles NOT AT ALL (it could even include test accounts and
--    anonymous browsers) — it now carries the same filters as view_stats,
--    fixing that pre-existing list/count mismatch in the same pass.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_profile_view_emails()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ := now() - INTERVAL '7 days';
  v_user RECORD;
BEGIN
  FOR v_user IN
    WITH view_stats AS (
      SELECT
        e.entity_id AS viewed_user_id,
        COUNT(*) AS total_views,
        COUNT(DISTINCT e.user_id) AS unique_viewers,
        -- Top 5 most recent distinct viewers (for avatar display in email).
        -- Same filters as the outer count so the array and the counts can
        -- never disagree.
        (ARRAY(
          SELECT DISTINCT ON (sub.user_id) sub.user_id
          FROM events sub
          WHERE sub.event_name = 'profile_view'
            AND sub.entity_type = 'profile'
            AND sub.entity_id = e.entity_id
            AND sub.user_id IS NOT NULL
            AND sub.user_id != e.entity_id
            AND sub.created_at >= v_since
            AND EXISTS (
              SELECT 1 FROM profiles svp
              WHERE svp.id = sub.user_id
                AND COALESCE(svp.is_test_account, false) = false
                AND svp.browse_anonymously = false
                AND NOT public.profile_is_hidden(svp.is_blocked, svp.frozen_minor_at)
            )
          ORDER BY sub.user_id, sub.created_at DESC
          LIMIT 5
        )) AS top_viewers
      FROM events e
      INNER JOIN profiles vp ON vp.id = e.user_id
      WHERE e.event_name = 'profile_view'
        AND e.entity_type = 'profile'
        AND e.user_id IS NOT NULL
        AND e.user_id != e.entity_id
        AND e.created_at >= v_since
        AND COALESCE(vp.is_test_account, false) = false
        AND vp.browse_anonymously = false
        AND NOT public.profile_is_hidden(vp.is_blocked, vp.frozen_minor_at)
      GROUP BY e.entity_id
    ),
    anon_counts AS (
      SELECT
        e.entity_id AS viewed_user_id,
        COUNT(DISTINCT e.user_id) AS anon_viewers
      FROM events e
      INNER JOIN profiles vp ON vp.id = e.user_id
      WHERE e.event_name = 'profile_view'
        AND e.entity_type = 'profile'
        AND e.user_id IS NOT NULL
        AND e.user_id != e.entity_id
        AND e.created_at >= v_since
        AND COALESCE(vp.is_test_account, false) = false
        AND vp.browse_anonymously = true
        AND NOT public.profile_is_hidden(vp.is_blocked, vp.frozen_minor_at)
      GROUP BY e.entity_id
    )
    SELECT
      vs.viewed_user_id,
      vs.total_views,
      vs.unique_viewers,
      COALESCE(ac.anon_viewers, 0) AS anonymous_viewers,
      vs.top_viewers
    FROM view_stats vs
    LEFT JOIN anon_counts ac ON ac.viewed_user_id = vs.viewed_user_id
    INNER JOIN profiles p ON p.id = vs.viewed_user_id
    WHERE p.notify_profile_views = true
      AND p.onboarding_completed = true
      AND COALESCE(p.is_test_account, false) = false
      -- Hidden recipients never get the digest.
      AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
      -- 7-day cooldown (was 24 hours)
      AND (p.last_profile_view_email_at IS NULL
           OR p.last_profile_view_email_at < v_since)
  LOOP
    INSERT INTO profile_view_email_queue (
      recipient_id, unique_viewers, total_views, anonymous_viewers, top_viewer_ids
    ) VALUES (
      v_user.viewed_user_id,
      v_user.unique_viewers,
      v_user.total_views,
      v_user.anonymous_viewers,
      v_user.top_viewers
    );

    UPDATE profiles
    SET last_profile_view_email_at = now()
    WHERE id = v_user.viewed_user_id;
  END LOOP;
END;
$$;

-- ────────────────────────────────────────────────────────────────────
-- 7. enqueue_application_digests (LOW-MED) — hidden PUBLISHER still got
--    the weekly digest; a hidden APPLICANT still counted in it (digest
--    invariant: never count someone the list would hide).
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_application_digests()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week_start date := date_trunc('week', timezone('utc', now()))::date;
  v_pub RECORD;
BEGIN
  -- Deploy-dark master switch (application_response_settings is single-row).
  IF NOT EXISTS (SELECT 1 FROM application_response_settings WHERE digest_enabled) THEN
    RETURN;
  END IF;

  FOR v_pub IN
    SELECT
      o.club_id AS publisher_id,
      array_agg(a.id ORDER BY a.applied_at) AS app_ids
    FROM opportunity_applications a
    JOIN opportunities o ON o.id = a.opportunity_id
    JOIN profiles p ON p.id = o.club_id
    WHERE a.status = 'pending'
      AND o.status = 'open'
      AND (o.application_deadline IS NULL OR o.application_deadline >= (timezone('utc', now()))::date)
      AND p.notify_applications = true
      AND p.email IS NOT NULL
      AND (p.is_test_account = false OR public.is_staging_env())
      AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
      AND NOT EXISTS (
        SELECT 1 FROM profiles ap
        WHERE ap.id = a.applicant_id
          AND public.profile_is_hidden(ap.is_blocked, ap.frozen_minor_at)
      )
    GROUP BY o.club_id
  LOOP
    INSERT INTO application_digest_queue (publisher_id, week_start, application_ids)
    VALUES (v_pub.publisher_id, v_week_start, v_pub.app_ids)
    ON CONFLICT (publisher_id, week_start) DO NOTHING;
  END LOOP;
END;
$$;

-- ────────────────────────────────────────────────────────────────────
-- 8. close_expired_opportunities (LOW-MED) — a hidden publisher still got
--    the "renew your listing" email. The CLOSE itself stays unfenced
--    (a hidden publisher's dead listing should absolutely close); only
--    the email enqueue is fenced.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.close_expired_opportunities()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := timezone('utc', now());
  v_closed integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM application_response_settings WHERE hygiene_enabled) THEN
    RETURN 0;
  END IF;

  WITH closed AS (
    UPDATE opportunities o
       SET status = 'closed',
           closed_at = v_now,
           auto_closed_at = v_now,
           updated_at = v_now
     WHERE o.status = 'open'
       AND o.application_deadline < (v_now)::date
     RETURNING o.id, o.club_id
  ), queued AS (
    INSERT INTO opportunity_renewal_queue (opportunity_id, publisher_id)
    SELECT c.id, c.club_id
    FROM closed c
    JOIN profiles p ON p.id = c.club_id
    WHERE p.email IS NOT NULL
      AND (p.is_test_account = false OR public.is_staging_env())
      AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    ON CONFLICT (opportunity_id, sweep_date) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_closed FROM closed;

  RETURN v_closed;
END;
$$;

-- ────────────────────────────────────────────────────────────────────
-- 9. apply_renewal_action (LOW-MED, compounding) — a hidden publisher
--    holding a valid renew token could flip their listing back to 'open',
--    landing it in the anon public API (§1) AND re-triggering the
--    notify-vacancy mass email. Now refused. The token is NOT consumed:
--    if the account is unbanned within the token's life, the link works.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_renewal_action(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_token RECORD;
  v_opp RECORD;
  v_new_deadline date;
BEGIN
  SELECT t.id, t.opportunity_id, t.expires_at, t.used_at
    INTO v_token
    FROM email_action_tokens t
   WHERE t.token_hash = p_token_hash
     AND t.action = 'renew'
   FOR UPDATE;

  IF v_token IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  SELECT o.id, o.title, o.status, o.application_deadline, o.auto_closed_at, o.club_id
    INTO v_opp
    FROM opportunities o
   WHERE o.id = v_token.opportunity_id
   FOR UPDATE;

  IF v_opp IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  IF v_token.used_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'used', 'action', 'renew',
      'opportunity_id', v_opp.id, 'opportunity_title', v_opp.title
    );
  END IF;

  IF v_token.expires_at < timezone('utc', now()) THEN
    RETURN jsonb_build_object(
      'outcome', 'expired', 'action', 'renew',
      'opportunity_id', v_opp.id, 'opportunity_title', v_opp.title
    );
  END IF;

  -- Hidden publishers (admin ban / frozen minor) cannot reopen a listing.
  IF EXISTS (SELECT 1 FROM profiles pp WHERE pp.id = v_opp.club_id
               AND public.profile_is_hidden(pp.is_blocked, pp.frozen_minor_at)) THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  -- A manually closed (or never-published) listing is the publisher's
  -- explicit intent — a renew link never overrides it. No-op, token kept.
  IF v_opp.status <> 'open' AND v_opp.auto_closed_at IS NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'closed_by_publisher', 'action', 'renew',
      'opportunity_id', v_opp.id, 'opportunity_title', v_opp.title
    );
  END IF;

  -- Renew = 30 fresh days from today (never shortens an already-later
  -- deadline if the listing is still open).
  v_new_deadline := greatest(coalesce(v_opp.application_deadline, (timezone('utc', now()))::date),
                             (timezone('utc', now()))::date + 30);

  UPDATE opportunities
     SET status = 'open',
         application_deadline = v_new_deadline,
         closed_at = NULL,
         auto_closed_at = NULL,
         updated_at = timezone('utc', now())
   WHERE id = v_opp.id;

  UPDATE email_action_tokens
     SET used_at = timezone('utc', now())
   WHERE id = v_token.id;

  RETURN jsonb_build_object(
    'outcome', 'renewed', 'action', 'renew',
    'opportunity_id', v_opp.id, 'opportunity_title', v_opp.title,
    'new_deadline', v_new_deadline
  );
END;
$function$;

-- Re-assert the tight grants from 20260707100000 (function was replaced).
REVOKE EXECUTE ON FUNCTION public.apply_renewal_action(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_renewal_action(text) TO service_role;

-- ────────────────────────────────────────────────────────────────────
-- 10. Grants hygiene (from the 2026-07-10 advisor scan): CREATE FUNCTION
--     grants EXECUTE to PUBLIC by default, so anon could call the launch
--     flag reader. Harmless (a boolean), but the composer is auth-only.
-- ────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.video_posts_enabled() FROM PUBLIC, anon;

-- ────────────────────────────────────────────────────────────────────
-- Self-check: every hardened object must now carry the predicate.
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_fn text;
BEGIN
  FOR v_fn IN SELECT unnest(ARRAY[
    'get_post_comments', 'get_profile_references', 'get_user_conversations',
    'get_profile_posts', 'enqueue_profile_view_emails',
    'enqueue_application_digests', 'close_expired_opportunities',
    'apply_renewal_action'
  ])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.proname = v_fn AND p.pronamespace = 'public'::regnamespace
        AND position('profile_is_hidden' in pg_get_functiondef(p.oid)) > 0
    ) THEN
      RAISE EXCEPTION 'HARDENING-CHECK: % is missing the hidden predicate', v_fn;
    END IF;
  END LOOP;

  IF position('profile_is_hidden' in pg_get_viewdef('public.public_opportunities'::regclass)) = 0 THEN
    RAISE EXCEPTION 'HARDENING-CHECK: public_opportunities view is missing the hidden predicate';
  END IF;

  RAISE NOTICE 'HARDENING-CHECK: all 9 objects fenced OK';
END $$;
