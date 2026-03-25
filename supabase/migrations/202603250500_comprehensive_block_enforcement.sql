-- ============================================================
-- COMPREHENSIVE BLOCK ENFORCEMENT (Apple Guideline 1.2)
-- ============================================================
-- When User A blocks User B:
-- - Neither can see each other in search, discovery, feed, profiles
-- - Neither can message, friend, reference, or interact
-- - All existing relationships are severed
-- - Enforcement is bidirectional and at the database level
-- ============================================================

-- ============================================================
-- 0. HELPER: Bidirectional block check
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_blocked_pair(p_user_a UUID, p_user_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = p_user_a AND blocked_id = p_user_b)
       OR (blocker_id = p_user_b AND blocked_id = p_user_a)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_blocked_pair TO authenticated;

-- Performance index for reverse lookups
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked_blocker ON public.user_blocks(blocked_id, blocker_id);

-- ============================================================
-- 1. ENHANCE block_user RPC — sever ALL relationships
-- ============================================================
CREATE OR REPLACE FUNCTION public.block_user(p_blocked_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_blocked_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot block yourself.';
  END IF;

  -- Record the block
  INSERT INTO public.user_blocks (blocker_id, blocked_id)
  VALUES (auth.uid(), p_blocked_id)
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

  -- Remove friendships (bidirectional)
  DELETE FROM public.profile_friendships
  WHERE (user_one = auth.uid() AND user_two = p_blocked_id)
     OR (user_one = p_blocked_id AND user_two = auth.uid());

  -- Revoke pending reference requests (bidirectional)
  UPDATE public.profile_references
  SET status = 'revoked'
  WHERE status = 'pending'
    AND ((requester_id = auth.uid() AND reference_id = p_blocked_id)
      OR (requester_id = p_blocked_id AND reference_id = auth.uid()));

  -- Clear notifications between the two users (bidirectional)
  UPDATE public.profile_notifications
  SET cleared_at = COALESCE(cleared_at, now())
  WHERE cleared_at IS NULL
    AND ((recipient_profile_id = auth.uid() AND actor_profile_id = p_blocked_id)
      OR (recipient_profile_id = p_blocked_id AND actor_profile_id = auth.uid()));

  -- Audit log (best-effort)
  BEGIN
    INSERT INTO public.admin_audit_logs (admin_id, action, target_type, target_id, metadata)
    VALUES (
      auth.uid(), 'user_block', 'profile', p_blocked_id,
      jsonb_build_object('blocker_id', auth.uid(), 'blocked_id', p_blocked_id)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$$;

-- ============================================================
-- 2. MESSAGING — hide conversations, prevent new messages
-- ============================================================

-- 2a. get_user_conversations: filter out blocked users
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

-- 2b. Conversations INSERT: prevent creating with blocked user
DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
CREATE POLICY "Users can create conversations"
  ON public.conversations
  FOR INSERT
  WITH CHECK (
    (participant_one_id = auth.uid() OR participant_two_id = auth.uid())
    AND NOT public.is_blocked_pair(participant_one_id, participant_two_id)
  );

-- 2c. Messages INSERT: prevent sending to blocked user
DROP POLICY IF EXISTS "Users can send messages in their conversations v2" ON public.messages;
CREATE POLICY "Users can send messages in their conversations v2"
  ON public.messages
  FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND public.user_in_conversation(conversation_id, auth.uid())
    AND NOT EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.user_blocks ub ON
        (ub.blocker_id = auth.uid() AND ub.blocked_id = CASE WHEN c.participant_one_id = auth.uid() THEN c.participant_two_id ELSE c.participant_one_id END)
        OR (ub.blocked_id = auth.uid() AND ub.blocker_id = CASE WHEN c.participant_one_id = auth.uid() THEN c.participant_two_id ELSE c.participant_one_id END)
      WHERE c.id = conversation_id
    )
  );

-- ============================================================
-- 3. SEARCH & DISCOVERY
-- ============================================================

-- 3a. search_content: filter blocked users from people and posts
CREATE OR REPLACE FUNCTION public.search_content(
  p_query TEXT,
  p_type TEXT DEFAULT NULL,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_test BOOLEAN;
  v_tsquery tsquery;
  v_results JSONB := '[]'::jsonb;
  v_post_results JSONB;
  v_people_results JSONB;
  v_club_results JSONB;
  v_brand_results JSONB;
  v_opportunity_results JSONB;
  v_post_count BIGINT := 0;
  v_people_count BIGINT := 0;
  v_club_count BIGINT := 0;
  v_brand_count BIGINT := 0;
  v_opportunity_count BIGINT := 0;
  v_normalized TEXT;
  v_sanitized TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  v_normalized := trim(p_query);
  IF char_length(v_normalized) < 2 THEN
    RETURN jsonb_build_object(
      'results', '[]'::jsonb, 'total', 0,
      'type_counts', jsonb_build_object('posts', 0, 'people', 0, 'clubs', 0, 'brands', 0, 'opportunities', 0)
    );
  END IF;

  SELECT COALESCE(is_test_account, false) INTO v_is_test FROM profiles WHERE id = v_user_id;

  v_sanitized := regexp_replace(regexp_replace(v_normalized, '[^a-zA-Z0-9\s]', ' ', 'g'), '\s+', ' ', 'g');
  v_sanitized := trim(v_sanitized);

  IF char_length(v_sanitized) < 1 THEN
    RETURN jsonb_build_object(
      'results', '[]'::jsonb, 'total', 0,
      'type_counts', jsonb_build_object('posts', 0, 'people', 0, 'clubs', 0, 'brands', 0, 'opportunities', 0)
    );
  END IF;

  BEGIN
    v_tsquery := to_tsquery('english', regexp_replace(v_sanitized, '\s+', ':* & ', 'g') || ':*');
  EXCEPTION WHEN OTHERS THEN
    v_tsquery := plainto_tsquery('english', v_normalized);
  END;

  -- POSTS (with block filter on author)
  IF p_type IS NULL OR p_type = 'posts' THEN
    SELECT COUNT(*) INTO v_post_count
    FROM user_posts up
    JOIN profiles p ON p.id = up.author_id
    WHERE up.deleted_at IS NULL AND up.search_vector @@ v_tsquery
      AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = up.author_id) OR (ub.blocker_id = up.author_id AND ub.blocked_id = v_user_id));

    SELECT COALESCE(jsonb_agg(row_data ORDER BY rank DESC), '[]'::jsonb) INTO v_post_results
    FROM (
      SELECT jsonb_build_object(
        'result_type', 'post', 'post_id', up.id, 'content', up.content, 'images', up.images,
        'author_id', up.author_id, 'author_name', COALESCE(b.name, p.full_name),
        'author_avatar', COALESCE(b.logo_url, p.avatar_url), 'author_role', p.role,
        'like_count', up.like_count, 'comment_count', up.comment_count,
        'post_type', COALESCE(up.post_type, 'text'), 'created_at', up.created_at
      ) AS row_data, ts_rank(up.search_vector, v_tsquery) AS rank
      FROM user_posts up
      JOIN profiles p ON p.id = up.author_id
      LEFT JOIN brands b ON b.profile_id = p.id
      WHERE up.deleted_at IS NULL AND up.search_vector @@ v_tsquery
        AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
        AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = up.author_id) OR (ub.blocker_id = up.author_id AND ub.blocked_id = v_user_id))
      ORDER BY rank DESC, up.created_at DESC
      LIMIT CASE WHEN p_type = 'posts' THEN p_limit ELSE 5 END
      OFFSET CASE WHEN p_type = 'posts' THEN p_offset ELSE 0 END
    ) sub;
  END IF;

  -- PEOPLE (with block filter)
  IF p_type IS NULL OR p_type = 'people' THEN
    SELECT COUNT(*) INTO v_people_count
    FROM profiles p
    WHERE p.onboarding_completed = true
      AND (p.search_vector @@ v_tsquery OR p.full_name ILIKE '%' || v_normalized || '%')
      AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = p.id) OR (ub.blocker_id = p.id AND ub.blocked_id = v_user_id));

    SELECT COALESCE(jsonb_agg(row_data ORDER BY rank DESC), '[]'::jsonb) INTO v_people_results
    FROM (
      SELECT jsonb_build_object(
        'result_type', 'person', 'profile_id', p.id, 'full_name', COALESCE(b.name, p.full_name),
        'avatar_url', COALESCE(b.logo_url, p.avatar_url), 'role', p.role,
        'bio', COALESCE(p.bio, p.club_bio), 'position', p.position,
        'base_location', p.base_location, 'current_club', p.current_club
      ) AS row_data, ts_rank(p.search_vector, v_tsquery) AS rank
      FROM profiles p
      LEFT JOIN brands b ON b.profile_id = p.id
      WHERE p.onboarding_completed = true
        AND (p.search_vector @@ v_tsquery OR p.full_name ILIKE '%' || v_normalized || '%')
        AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
        AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = p.id) OR (ub.blocker_id = p.id AND ub.blocked_id = v_user_id))
      ORDER BY rank DESC, p.full_name
      LIMIT CASE WHEN p_type = 'people' THEN p_limit ELSE 5 END
      OFFSET CASE WHEN p_type = 'people' THEN p_offset ELSE 0 END
    ) sub;
  END IF;

  -- CLUBS (no block filter — clubs are organizations)
  IF p_type IS NULL OR p_type = 'clubs' THEN
    SELECT COUNT(*) INTO v_club_count FROM world_clubs wc WHERE wc.club_name_normalized LIKE '%' || lower(v_normalized) || '%';
    SELECT COALESCE(jsonb_agg(row_data ORDER BY rank, club_name), '[]'::jsonb) INTO v_club_results
    FROM (
      SELECT jsonb_build_object(
        'result_type', 'club', 'world_club_id', wc.id, 'club_name', wc.club_name,
        'country_id', wc.country_id, 'country_code', c.code, 'country_name', c.name,
        'flag_emoji', c.flag_emoji, 'avatar_url', p.avatar_url,
        'is_claimed', wc.is_claimed, 'claimed_profile_id', wc.claimed_profile_id
      ) AS row_data,
      CASE WHEN wc.club_name_normalized LIKE lower(v_normalized) || '%' THEN 0 ELSE 1 END AS rank, wc.club_name
      FROM world_clubs wc
      JOIN countries c ON c.id = wc.country_id
      LEFT JOIN profiles p ON p.id = wc.claimed_profile_id
      WHERE wc.club_name_normalized LIKE '%' || lower(v_normalized) || '%'
      ORDER BY rank, wc.club_name
      LIMIT CASE WHEN p_type = 'clubs' THEN p_limit ELSE 5 END
      OFFSET CASE WHEN p_type = 'clubs' THEN p_offset ELSE 0 END
    ) sub;
  END IF;

  -- BRANDS (no block filter — brands are organizations)
  IF p_type IS NULL OR p_type = 'brands' THEN
    SELECT COUNT(*) INTO v_brand_count FROM brands b WHERE b.deleted_at IS NULL AND (b.search_vector @@ v_tsquery OR lower(b.name) LIKE '%' || lower(v_normalized) || '%');
    SELECT COALESCE(jsonb_agg(row_data ORDER BY rank, brand_name), '[]'::jsonb) INTO v_brand_results
    FROM (
      SELECT jsonb_build_object(
        'result_type', 'brand', 'brand_id', b.id, 'brand_slug', b.slug, 'brand_name', b.name,
        'brand_logo_url', b.logo_url, 'brand_category', b.category,
        'brand_is_verified', b.is_verified, 'brand_bio', b.bio
      ) AS row_data,
      CASE WHEN lower(b.name) LIKE lower(v_normalized) || '%' THEN 0 ELSE 1 END AS rank, b.name AS brand_name
      FROM brands b
      WHERE b.deleted_at IS NULL AND (b.search_vector @@ v_tsquery OR lower(b.name) LIKE '%' || lower(v_normalized) || '%')
      ORDER BY rank, b.name
      LIMIT CASE WHEN p_type = 'brands' THEN p_limit ELSE 5 END
      OFFSET CASE WHEN p_type = 'brands' THEN p_offset ELSE 0 END
    ) sub;
  END IF;

  -- OPPORTUNITIES (no block filter — organizational content)
  IF p_type IS NULL OR p_type = 'opportunities' THEN
    SELECT COUNT(*) INTO v_opportunity_count FROM opportunities o JOIN profiles cp ON cp.id = o.club_id
    WHERE o.status = 'open' AND o.search_vector @@ v_tsquery AND (v_is_test OR cp.is_test_account IS NULL OR cp.is_test_account = false);
    SELECT COALESCE(jsonb_agg(row_data ORDER BY rank DESC), '[]'::jsonb) INTO v_opportunity_results
    FROM (
      SELECT jsonb_build_object(
        'result_type', 'opportunity', 'opportunity_id', o.id, 'title', o.title,
        'opportunity_type', o.opportunity_type, 'position', o.position,
        'location_city', o.location_city, 'location_country', o.location_country,
        'club_name', COALESCE(cp.full_name, o.organization_name, 'Unknown Club'),
        'club_avatar_url', cp.avatar_url, 'published_at', o.published_at
      ) AS row_data, ts_rank(o.search_vector, v_tsquery) AS rank
      FROM opportunities o JOIN profiles cp ON cp.id = o.club_id
      WHERE o.status = 'open' AND o.search_vector @@ v_tsquery AND (v_is_test OR cp.is_test_account IS NULL OR cp.is_test_account = false)
      ORDER BY rank DESC, o.published_at DESC NULLS LAST
      LIMIT CASE WHEN p_type = 'opportunities' THEN p_limit ELSE 5 END
      OFFSET CASE WHEN p_type = 'opportunities' THEN p_offset ELSE 0 END
    ) sub;
  END IF;

  IF p_type = 'posts' THEN v_results := COALESCE(v_post_results, '[]'::jsonb);
  ELSIF p_type = 'people' THEN v_results := COALESCE(v_people_results, '[]'::jsonb);
  ELSIF p_type = 'clubs' THEN v_results := COALESCE(v_club_results, '[]'::jsonb);
  ELSIF p_type = 'brands' THEN v_results := COALESCE(v_brand_results, '[]'::jsonb);
  ELSIF p_type = 'opportunities' THEN v_results := COALESCE(v_opportunity_results, '[]'::jsonb);
  ELSE
    v_results := COALESCE(v_post_results, '[]'::jsonb)
              || COALESCE(v_people_results, '[]'::jsonb)
              || COALESCE(v_club_results, '[]'::jsonb)
              || COALESCE(v_brand_results, '[]'::jsonb)
              || COALESCE(v_opportunity_results, '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'results', v_results,
    'total', v_post_count + v_people_count + v_club_count + v_brand_count + v_opportunity_count,
    'type_counts', jsonb_build_object('posts', v_post_count, 'people', v_people_count, 'clubs', v_club_count, 'brands', v_brand_count, 'opportunities', v_opportunity_count)
  );
END;
$$;

-- 3b. discover_profiles: filter blocked users
CREATE OR REPLACE FUNCTION public.discover_profiles(
  p_roles TEXT[] DEFAULT NULL, p_positions TEXT[] DEFAULT NULL,
  p_gender TEXT DEFAULT NULL, p_min_age INT DEFAULT NULL, p_max_age INT DEFAULT NULL,
  p_nationality_country_ids INT[] DEFAULT NULL, p_eu_passport BOOLEAN DEFAULT NULL,
  p_base_country_ids INT[] DEFAULT NULL, p_base_location TEXT DEFAULT NULL,
  p_availability TEXT DEFAULT NULL, p_min_references INT DEFAULT NULL,
  p_min_career_entries INT DEFAULT NULL, p_league_ids INT[] DEFAULT NULL,
  p_country_ids INT[] DEFAULT NULL, p_search_text TEXT DEFAULT NULL,
  p_sort_by TEXT DEFAULT 'relevance', p_limit INT DEFAULT 20, p_offset INT DEFAULT 0,
  p_coach_specializations TEXT[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eu_country_ids INT[];
  v_total BIGINT;
  v_results JSONB;
  v_user_id UUID := auth.uid();
BEGIN
  IF p_eu_passport = true THEN
    SELECT ARRAY_AGG(id) INTO v_eu_country_ids FROM countries
    WHERE code IN ('AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE');
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM profiles p
  LEFT JOIN world_clubs wc ON wc.id = p.current_world_club_id
  WHERE p.onboarding_completed = true AND p.is_test_account = false AND p.is_blocked = false
    AND (p_roles IS NULL OR p.role = ANY(p_roles))
    AND (p_positions IS NULL OR p.position = ANY(p_positions) OR p.secondary_position = ANY(p_positions))
    AND (p_gender IS NULL OR p.gender = p_gender)
    AND (p_min_age IS NULL OR p.date_of_birth IS NOT NULL AND p.date_of_birth <= CURRENT_DATE - (p_min_age * INTERVAL '1 year'))
    AND (p_max_age IS NULL OR p.date_of_birth IS NOT NULL AND p.date_of_birth >= CURRENT_DATE - ((p_max_age + 1) * INTERVAL '1 year'))
    AND (p_nationality_country_ids IS NULL OR p.nationality_country_id = ANY(p_nationality_country_ids) OR p.nationality2_country_id = ANY(p_nationality_country_ids))
    AND (p_eu_passport IS NULL OR p_eu_passport = false OR p.nationality_country_id = ANY(v_eu_country_ids) OR p.nationality2_country_id = ANY(v_eu_country_ids))
    AND (p_base_country_ids IS NULL OR p.base_country_id = ANY(p_base_country_ids))
    AND (p_base_location IS NULL OR p.base_city ILIKE '%' || p_base_location || '%' OR p.base_location ILIKE '%' || p_base_location || '%')
    AND (p_availability IS NULL OR (p_availability = 'open_to_play' AND p.open_to_play = true) OR (p_availability = 'open_to_coach' AND p.open_to_coach = true) OR (p_availability = 'open_to_opportunities' AND p.open_to_opportunities = true))
    AND (p_min_references IS NULL OR p.accepted_reference_count >= p_min_references)
    AND (p_min_career_entries IS NULL OR p.career_entry_count >= p_min_career_entries)
    AND (p_league_ids IS NULL OR p.mens_league_id = ANY(p_league_ids) OR p.womens_league_id = ANY(p_league_ids))
    AND (p_country_ids IS NULL OR wc.country_id = ANY(p_country_ids))
    AND (p_coach_specializations IS NULL OR p.coach_specialization = ANY(p_coach_specializations))
    AND (p_search_text IS NULL OR p.search_vector @@ plainto_tsquery('english', p_search_text))
    -- BLOCK FILTER
    AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = p.id) OR (ub.blocker_id = p.id AND ub.blocked_id = v_user_id));

  SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb) INTO v_results
  FROM (
    SELECT jsonb_build_object(
      'id', p.id, 'full_name', p.full_name, 'username', p.username, 'avatar_url', p.avatar_url,
      'role', p.role, 'position', p.position, 'secondary_position', p.secondary_position,
      'gender', p.gender,
      'age', CASE WHEN p.date_of_birth IS NOT NULL THEN EXTRACT(YEAR FROM age(CURRENT_DATE, p.date_of_birth))::INT ELSE NULL END,
      'nationality_country_id', p.nationality_country_id, 'nationality2_country_id', p.nationality2_country_id,
      'nationality_name', cn1.nationality_name, 'nationality2_name', cn2.nationality_name,
      'flag_emoji', cn1.flag_emoji, 'flag_emoji2', cn2.flag_emoji,
      'base_location', COALESCE(p.base_city, p.base_location), 'base_country_name', cnb.name,
      'current_club', p.current_club, 'current_world_club_id', p.current_world_club_id,
      'open_to_play', p.open_to_play, 'open_to_coach', p.open_to_coach, 'open_to_opportunities', p.open_to_opportunities,
      'accepted_reference_count', p.accepted_reference_count, 'career_entry_count', p.career_entry_count,
      'accepted_friend_count', p.accepted_friend_count, 'last_active_at', p.last_active_at,
      'coach_specialization', p.coach_specialization, 'coach_specialization_custom', p.coach_specialization_custom
    ) AS row_data
    FROM profiles p
    LEFT JOIN countries cn1 ON cn1.id = p.nationality_country_id
    LEFT JOIN countries cn2 ON cn2.id = p.nationality2_country_id
    LEFT JOIN countries cnb ON cnb.id = p.base_country_id
    LEFT JOIN world_clubs wc ON wc.id = p.current_world_club_id
    WHERE p.onboarding_completed = true AND p.is_test_account = false AND p.is_blocked = false
      AND (p_roles IS NULL OR p.role = ANY(p_roles))
      AND (p_positions IS NULL OR p.position = ANY(p_positions) OR p.secondary_position = ANY(p_positions))
      AND (p_gender IS NULL OR p.gender = p_gender)
      AND (p_min_age IS NULL OR p.date_of_birth IS NOT NULL AND p.date_of_birth <= CURRENT_DATE - (p_min_age * INTERVAL '1 year'))
      AND (p_max_age IS NULL OR p.date_of_birth IS NOT NULL AND p.date_of_birth >= CURRENT_DATE - ((p_max_age + 1) * INTERVAL '1 year'))
      AND (p_nationality_country_ids IS NULL OR p.nationality_country_id = ANY(p_nationality_country_ids) OR p.nationality2_country_id = ANY(p_nationality_country_ids))
      AND (p_eu_passport IS NULL OR p_eu_passport = false OR p.nationality_country_id = ANY(v_eu_country_ids) OR p.nationality2_country_id = ANY(v_eu_country_ids))
      AND (p_base_country_ids IS NULL OR p.base_country_id = ANY(p_base_country_ids))
      AND (p_base_location IS NULL OR p.base_city ILIKE '%' || p_base_location || '%' OR p.base_location ILIKE '%' || p_base_location || '%')
      AND (p_availability IS NULL OR (p_availability = 'open_to_play' AND p.open_to_play = true) OR (p_availability = 'open_to_coach' AND p.open_to_coach = true) OR (p_availability = 'open_to_opportunities' AND p.open_to_opportunities = true))
      AND (p_min_references IS NULL OR p.accepted_reference_count >= p_min_references)
      AND (p_min_career_entries IS NULL OR p.career_entry_count >= p_min_career_entries)
      AND (p_league_ids IS NULL OR p.mens_league_id = ANY(p_league_ids) OR p.womens_league_id = ANY(p_league_ids))
      AND (p_country_ids IS NULL OR wc.country_id = ANY(p_country_ids))
      AND (p_coach_specializations IS NULL OR p.coach_specialization = ANY(p_coach_specializations))
      AND (p_search_text IS NULL OR p.search_vector @@ plainto_tsquery('english', p_search_text))
      -- BLOCK FILTER
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = p.id) OR (ub.blocker_id = p.id AND ub.blocked_id = v_user_id))
    ORDER BY
      CASE WHEN p_sort_by = 'most_referenced' THEN p.accepted_reference_count END DESC NULLS LAST,
      CASE WHEN p_sort_by = 'recently_active' THEN p.last_active_at END DESC NULLS LAST,
      CASE WHEN p_sort_by = 'relevance' AND p_search_text IS NOT NULL THEN ts_rank(p.search_vector, plainto_tsquery('english', p_search_text)) END DESC NULLS LAST,
      p.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object('results', v_results, 'total', v_total, 'has_more', (p_offset + p_limit) < v_total);
END;
$$;

-- 3c. search_people_for_signing: filter blocked users
CREATE OR REPLACE FUNCTION public.search_people_for_signing(p_query TEXT, p_limit INT DEFAULT 10)
RETURNS TABLE (id UUID, full_name TEXT, avatar_url TEXT, "role" TEXT, "position" TEXT, current_club TEXT, base_location TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_user_id UUID := auth.uid(); v_normalized TEXT;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;
  v_normalized := lower(trim(p_query));
  IF char_length(v_normalized) < 2 THEN RETURN; END IF;
  RETURN QUERY
  SELECT p.id, p.full_name, p.avatar_url, p.role, p.position, p.current_club, p.base_location
  FROM profiles p
  WHERE p.role IN ('player', 'coach') AND p.onboarding_completed = true AND p.id != v_user_id
    AND lower(p.full_name) LIKE '%' || v_normalized || '%'
    AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = p.id) OR (ub.blocker_id = p.id AND ub.blocked_id = v_user_id))
  ORDER BY CASE WHEN lower(p.full_name) LIKE v_normalized || '%' THEN 0 ELSE 1 END, p.full_name ASC
  LIMIT LEAST(p_limit, 20);
END;
$$;

-- ============================================================
-- 4. HOME FEED
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_home_feed(p_limit INTEGER DEFAULT 20, p_offset INTEGER DEFAULT 0, p_item_type TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_items JSONB; v_total BIGINT; v_user_id UUID := auth.uid(); v_is_test BOOLEAN;
BEGIN
  SELECT COALESCE(is_test_account, false) INTO v_is_test FROM profiles WHERE id = v_user_id;

  IF p_item_type IS NOT NULL AND p_item_type != 'user_post' THEN
    SELECT COUNT(*) INTO v_total FROM home_feed_items WHERE deleted_at IS NULL AND item_type = p_item_type AND item_type != 'member_joined' AND (v_is_test OR is_test_account = false);
    SELECT COALESCE(jsonb_agg(hfi.metadata || jsonb_build_object('feed_item_id', hfi.id, 'item_type', hfi.item_type, 'created_at', hfi.created_at) ORDER BY hfi.created_at DESC), '[]'::jsonb)
    INTO v_items FROM (SELECT id, item_type, metadata, created_at FROM home_feed_items WHERE deleted_at IS NULL AND item_type = p_item_type AND item_type != 'member_joined' AND (v_is_test OR is_test_account = false) ORDER BY created_at DESC LIMIT p_limit OFFSET p_offset) hfi;
    RETURN jsonb_build_object('items', v_items, 'total', v_total);
  END IF;

  IF p_item_type = 'user_post' THEN
    SELECT COUNT(*) INTO v_total FROM user_posts up JOIN profiles p ON p.id = up.author_id
    WHERE up.deleted_at IS NULL AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = up.author_id) OR (ub.blocker_id = up.author_id AND ub.blocked_id = v_user_id));

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'feed_item_id', up.id, 'item_type', 'user_post', 'created_at', up.created_at,
      'post_id', up.id, 'author_id', up.author_id, 'author_name', p.full_name,
      'author_avatar', p.avatar_url, 'author_role', p.role, 'content', up.content,
      'images', up.images, 'like_count', up.like_count, 'comment_count', up.comment_count,
      'has_liked', EXISTS (SELECT 1 FROM post_likes pl WHERE pl.post_id = up.id AND pl.user_id = v_user_id)
    ) ORDER BY up.created_at DESC), '[]'::jsonb)
    INTO v_items FROM (
      SELECT up2.id, up2.author_id, up2.content, up2.images, up2.like_count, up2.comment_count, up2.created_at
      FROM user_posts up2 JOIN profiles p2 ON p2.id = up2.author_id
      WHERE up2.deleted_at IS NULL AND (v_is_test OR p2.is_test_account IS NULL OR p2.is_test_account = false)
        AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = up2.author_id) OR (ub.blocker_id = up2.author_id AND ub.blocked_id = v_user_id))
      ORDER BY up2.created_at DESC LIMIT p_limit OFFSET p_offset
    ) up JOIN profiles p ON p.id = up.author_id;
    RETURN jsonb_build_object('items', v_items, 'total', v_total);
  END IF;

  -- Unified feed
  SELECT (
    (SELECT COUNT(*) FROM home_feed_items WHERE deleted_at IS NULL AND item_type != 'member_joined' AND (v_is_test OR is_test_account = false)) +
    (SELECT COUNT(*) FROM user_posts up JOIN profiles p ON p.id = up.author_id WHERE up.deleted_at IS NULL AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = up.author_id) OR (ub.blocker_id = up.author_id AND ub.blocked_id = v_user_id)))
  ) INTO v_total;

  SELECT COALESCE(jsonb_agg(c.item_data ORDER BY c.created_at DESC), '[]'::jsonb) INTO v_items
  FROM (
    SELECT item_data, created_at FROM (
      SELECT hfi.created_at, hfi.metadata || jsonb_build_object('feed_item_id', hfi.id, 'item_type', hfi.item_type, 'created_at', hfi.created_at) AS item_data
      FROM home_feed_items hfi WHERE hfi.deleted_at IS NULL AND hfi.item_type != 'member_joined' AND (v_is_test OR hfi.is_test_account = false)
      UNION ALL
      SELECT up.created_at, jsonb_build_object(
        'feed_item_id', up.id, 'item_type', 'user_post', 'created_at', up.created_at,
        'post_id', up.id, 'author_id', up.author_id, 'author_name', p.full_name,
        'author_avatar', p.avatar_url, 'author_role', p.role, 'content', up.content,
        'images', up.images, 'like_count', up.like_count, 'comment_count', up.comment_count,
        'has_liked', EXISTS (SELECT 1 FROM post_likes pl WHERE pl.post_id = up.id AND pl.user_id = v_user_id)
      ) AS item_data
      FROM user_posts up JOIN profiles p ON p.id = up.author_id
      WHERE up.deleted_at IS NULL AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
        AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = up.author_id) OR (ub.blocker_id = up.author_id AND ub.blocked_id = v_user_id))
    ) unified ORDER BY created_at DESC LIMIT p_limit OFFSET p_offset
  ) c;
  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_home_feed_new_count(p_since TIMESTAMPTZ)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count INTEGER; v_is_test BOOLEAN; v_user_id UUID := auth.uid();
BEGIN
  SELECT COALESCE(is_test_account, false) INTO v_is_test FROM profiles WHERE id = v_user_id;
  SELECT COUNT(*) INTO v_count FROM (
    SELECT created_at FROM home_feed_items WHERE deleted_at IS NULL AND created_at > p_since AND item_type != 'member_joined' AND (v_is_test OR is_test_account = false)
    UNION ALL
    SELECT up.created_at FROM user_posts up JOIN profiles p ON p.id = up.author_id
    WHERE up.deleted_at IS NULL AND up.created_at > p_since AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = up.author_id) OR (ub.blocker_id = up.author_id AND ub.blocked_id = v_user_id))
  ) combined;
  RETURN v_count;
END;
$$;

-- ============================================================
-- 5. COMMENTS
-- ============================================================

-- 5a. Profile comments: hide from blocked users
DROP POLICY IF EXISTS "Visible comments are public" ON public.profile_comments;
CREATE POLICY "Visible comments are public"
  ON public.profile_comments FOR SELECT
  USING (
    (status = 'visible' OR profile_id = auth.uid() OR author_profile_id = auth.uid() OR public.is_platform_admin())
    AND NOT public.is_blocked_pair(auth.uid(), author_profile_id)
  );

-- 5b. Profile comments: prevent commenting on blocked user's profile
DROP POLICY IF EXISTS "Users can create comments" ON public.profile_comments;
CREATE POLICY "Users can create comments"
  ON public.profile_comments FOR INSERT
  WITH CHECK (
    auth.uid() = author_profile_id
    AND author_profile_id <> profile_id
    AND NOT public.is_blocked_pair(auth.uid(), profile_id)
  );

-- 5c. Post comments: filter blocked authors
CREATE OR REPLACE FUNCTION public.get_post_comments(p_post_id UUID, p_limit INTEGER DEFAULT 20, p_offset INTEGER DEFAULT 0)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_comments JSONB; v_total BIGINT; v_user_id UUID := auth.uid();
BEGIN
  SELECT COUNT(*) INTO v_total FROM post_comments WHERE post_id = p_post_id AND deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = author_id) OR (ub.blocker_id = author_id AND ub.blocked_id = v_user_id));

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', pc.id, 'post_id', pc.post_id, 'author_id', pc.author_id,
    'author_name', p.full_name, 'author_avatar', p.avatar_url, 'author_role', p.role,
    'content', pc.content, 'created_at', pc.created_at
  ) ORDER BY pc.created_at ASC), '[]'::jsonb) INTO v_comments
  FROM (
    SELECT id, post_id, author_id, content, created_at FROM post_comments
    WHERE post_id = p_post_id AND deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = author_id) OR (ub.blocker_id = author_id AND ub.blocked_id = v_user_id))
    ORDER BY created_at ASC LIMIT p_limit OFFSET p_offset
  ) pc JOIN profiles p ON p.id = pc.author_id;

  RETURN jsonb_build_object('comments', v_comments, 'total', v_total);
END;
$$;

-- 5d. Post comments: prevent commenting on blocked user's post
CREATE OR REPLACE FUNCTION public.create_post_comment(p_post_id UUID, p_content TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_user_id UUID := auth.uid(); v_trimmed TEXT; v_comment_id UUID; v_post_author UUID;
BEGIN
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Not authenticated'); END IF;

  SELECT author_id INTO v_post_author FROM user_posts WHERE id = p_post_id AND deleted_at IS NULL;
  IF v_post_author IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Post not found'); END IF;

  -- Block check
  IF public.is_blocked_pair(v_user_id, v_post_author) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot interact with this user.');
  END IF;

  v_trimmed := trim(p_content);
  IF v_trimmed = '' OR char_length(v_trimmed) < 1 THEN RETURN jsonb_build_object('success', false, 'error', 'Comment content is required'); END IF;
  IF char_length(v_trimmed) > 500 THEN RETURN jsonb_build_object('success', false, 'error', 'Comment exceeds 500 character limit'); END IF;

  INSERT INTO post_comments (post_id, author_id, content) VALUES (p_post_id, v_user_id, v_trimmed) RETURNING id INTO v_comment_id;
  RETURN jsonb_build_object('success', true, 'comment_id', v_comment_id);
END;
$$;

-- ============================================================
-- 6. PROFILE POSTS
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_profile_posts(p_profile_id UUID, p_limit INTEGER DEFAULT 20, p_offset INTEGER DEFAULT 0)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_items JSONB; v_total BIGINT; v_user_id UUID := auth.uid();
BEGIN
  -- If blocked pair, return empty
  IF v_user_id IS NOT NULL AND public.is_blocked_pair(v_user_id, p_profile_id) THEN
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

-- ============================================================
-- 7. FRIENDSHIPS — prevent friend requests with blocked users
-- ============================================================
-- Friendship block check enforced in handle_friendship_state trigger
-- (NOT in RLS policy — causes PostgreSQL 42P10 error with generated column indexes)

-- ============================================================
-- 8. REFERENCES — block check on request + hide from blocked
-- ============================================================
CREATE OR REPLACE FUNCTION public.request_reference(p_reference_id UUID, p_relationship_type TEXT, p_request_note TEXT DEFAULT NULL)
RETURNS public.profile_references LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE current_profile UUID := auth.uid(); requester_role TEXT; accepted_count INTEGER; inserted_row public.profile_references;
BEGIN
  IF current_profile IS NULL THEN RAISE EXCEPTION 'You must be signed in to request a reference.'; END IF;
  IF current_profile = p_reference_id THEN RAISE EXCEPTION 'You cannot ask yourself to be a reference.'; END IF;

  -- BLOCK CHECK
  IF public.is_blocked_pair(current_profile, p_reference_id) THEN
    RAISE EXCEPTION 'Cannot interact with this user.';
  END IF;

  SELECT role INTO requester_role FROM public.profiles WHERE id = current_profile;
  IF requester_role IS NULL THEN RAISE EXCEPTION 'Profile not found.'; END IF;
  IF requester_role NOT IN ('player', 'coach') THEN RAISE EXCEPTION 'Only players and coaches can collect trusted references.'; END IF;

  SELECT COUNT(*) INTO accepted_count FROM public.profile_references WHERE requester_id = current_profile AND status = 'accepted';
  IF accepted_count >= 5 THEN RAISE EXCEPTION 'You already have 5 accepted references.'; END IF;

  PERFORM 1 FROM public.profile_friendships pf
  WHERE pf.status = 'accepted'
    AND ((pf.user_one = current_profile AND pf.user_two = p_reference_id) OR (pf.user_two = current_profile AND pf.user_one = p_reference_id)) LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'You can only request references from accepted friends.'; END IF;

  PERFORM 1 FROM public.profile_references pr WHERE pr.requester_id = current_profile AND pr.reference_id = p_reference_id AND pr.status IN ('pending', 'accepted');
  IF FOUND THEN RAISE EXCEPTION 'You already have an active reference with this connection.'; END IF;

  INSERT INTO public.profile_references (requester_id, reference_id, relationship_type, request_note)
  VALUES (current_profile, p_reference_id, p_relationship_type, NULLIF(btrim(p_request_note), ''))
  RETURNING * INTO inserted_row;
  RETURN inserted_row;
END;
$$;

-- get_profile_references: filter blocked reference givers
CREATE OR REPLACE FUNCTION public.get_profile_references(p_profile_id UUID)
RETURNS TABLE (id UUID, requester_id UUID, reference_id UUID, relationship_type TEXT, endorsement_text TEXT, accepted_at TIMESTAMPTZ, reference_profile JSONB)
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
    AND (v_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = ref.id) OR (ub.blocker_id = ref.id AND ub.blocked_id = v_user_id)))
  ORDER BY pr.accepted_at DESC NULLS LAST, pr.created_at DESC;
END;
$$;

-- ============================================================
-- 9. NOTIFICATIONS — filter blocked actors
-- ============================================================

-- 9a. enqueue_notification: don't create notifications between blocked users
CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_recipient_profile_id uuid, p_actor_profile_id uuid, p_kind public.profile_notification_kind,
  p_source_entity_id uuid DEFAULT NULL, p_metadata jsonb DEFAULT '{}'::jsonb, p_target_url text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE inserted_id uuid; now_ts timestamptz := timezone('utc', now());
BEGIN
  IF p_recipient_profile_id IS NULL THEN RETURN NULL; END IF;

  -- BLOCK CHECK: don't notify blocked users
  IF p_actor_profile_id IS NOT NULL AND public.is_blocked_pair(p_recipient_profile_id, p_actor_profile_id) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.profile_notifications (
    recipient_profile_id, actor_profile_id, kind, source_entity_id, metadata, target_url,
    created_at, updated_at, read_at, seen_at, cleared_at
  ) VALUES (
    p_recipient_profile_id, p_actor_profile_id, p_kind, p_source_entity_id,
    coalesce(p_metadata, '{}'::jsonb), p_target_url, now_ts, now_ts, NULL, NULL, NULL
  )
  ON CONFLICT (recipient_profile_id, kind, source_entity_id) WHERE source_entity_id IS NOT NULL DO UPDATE
    SET actor_profile_id = excluded.actor_profile_id, metadata = excluded.metadata,
        target_url = excluded.target_url, created_at = excluded.created_at,
        updated_at = excluded.updated_at, read_at = NULL, seen_at = NULL, cleared_at = NULL
  RETURNING id INTO inserted_id;
  RETURN inserted_id;
END;
$$;

-- 9b. get_notifications: filter blocked actors
CREATE OR REPLACE FUNCTION public.get_notifications(
  p_filter text DEFAULT 'all', p_kind public.profile_notification_kind DEFAULT NULL,
  p_limit integer DEFAULT 30, p_offset integer DEFAULT 0
)
RETURNS TABLE (id uuid, kind public.profile_notification_kind, source_entity_id uuid, metadata jsonb,
  target_url text, created_at timestamptz, read_at timestamptz, seen_at timestamptz, cleared_at timestamptz, actor jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE current_user_id uuid := auth.uid(); clamped_limit integer := least(greatest(coalesce(p_limit, 30), 1), 200); clamped_offset integer := greatest(coalesce(p_offset, 0), 0);
BEGIN
  IF current_user_id IS NULL THEN RETURN; END IF;
  IF lower(coalesce(p_filter, 'all')) NOT IN ('all', 'unread', 'by_type') THEN RAISE EXCEPTION 'Invalid notification filter: %', p_filter USING ERRCODE = '22023'; END IF;
  IF lower(coalesce(p_filter, 'all')) = 'by_type' AND p_kind IS NULL THEN RAISE EXCEPTION 'Filter "by_type" requires p_kind' USING ERRCODE = '22023'; END IF;

  RETURN QUERY
  WITH base AS (
    SELECT pn.id, pn.kind, pn.source_entity_id, pn.metadata, pn.target_url, pn.created_at, pn.read_at, pn.seen_at, pn.cleared_at, pn.actor_profile_id,
      jsonb_build_object('id', actor.id, 'full_name', actor.full_name, 'role', actor.role, 'username', actor.username, 'avatar_url', actor.avatar_url, 'base_location', actor.base_location) AS actor
    FROM public.profile_notifications pn
    LEFT JOIN public.profiles actor ON actor.id = pn.actor_profile_id
    WHERE pn.recipient_profile_id = current_user_id AND pn.cleared_at IS NULL
      AND (p_kind IS NULL OR pn.kind = p_kind)
      AND (lower(coalesce(p_filter, 'all')) <> 'unread' OR pn.read_at IS NULL)
      -- BLOCK FILTER
      AND (pn.actor_profile_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = current_user_id AND ub.blocked_id = pn.actor_profile_id) OR (ub.blocker_id = pn.actor_profile_id AND ub.blocked_id = current_user_id)
      ))
  ), ordered AS (
    SELECT b.* FROM base b ORDER BY (b.read_at IS NULL) DESC, b.created_at DESC LIMIT clamped_limit OFFSET clamped_offset
  ), marked AS (
    UPDATE public.profile_notifications AS u SET seen_at = timezone('utc', now()) WHERE u.id IN (SELECT ordered.id FROM ordered) AND u.seen_at IS NULL RETURNING u.id
  )
  SELECT ordered.id, ordered.kind, ordered.source_entity_id, ordered.metadata, ordered.target_url,
    ordered.created_at, ordered.read_at, ordered.seen_at, ordered.cleared_at, ordered.actor
  FROM ordered;
END;
$$;

-- 9c. get_notification_counts: exclude blocked actors
CREATE OR REPLACE FUNCTION public.get_notification_counts()
RETURNS TABLE (unread_count bigint, total_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE current_user_id uuid := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE pn.read_at IS NULL AND pn.cleared_at IS NULL) AS unread_count,
    COUNT(*) FILTER (WHERE pn.cleared_at IS NULL) AS total_count
  FROM public.profile_notifications pn
  WHERE pn.recipient_profile_id = current_user_id
    AND (pn.actor_profile_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = current_user_id AND ub.blocked_id = pn.actor_profile_id) OR (ub.blocker_id = pn.actor_profile_id AND ub.blocked_id = current_user_id)
    ));
END;
$$;

-- ============================================================
-- 10. COMMUNITY Q&A — hide from blocked users
-- ============================================================
DROP POLICY IF EXISTS "questions_select" ON public.community_questions;
CREATE POLICY "questions_select" ON public.community_questions FOR SELECT
  USING (
    deleted_at IS NULL
    AND (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_test_account = true) OR is_test_content = false OR public.is_platform_admin())
    AND NOT public.is_blocked_pair(auth.uid(), author_id)
  );

DROP POLICY IF EXISTS "answers_select" ON public.community_answers;
CREATE POLICY "answers_select" ON public.community_answers FOR SELECT
  USING (
    deleted_at IS NULL
    AND (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_test_account = true) OR is_test_content = false OR public.is_platform_admin())
    AND NOT public.is_blocked_pair(auth.uid(), author_id)
  );

-- ============================================================
-- 11. WHO VIEWED YOUR PROFILE — filter blocked viewers
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_profile_viewers(p_days INT DEFAULT 30, p_limit INT DEFAULT 20)
RETURNS TABLE (viewer_id UUID, full_name TEXT, role TEXT, username TEXT, avatar_url TEXT, base_location TEXT, viewed_at TIMESTAMPTZ, view_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_user_id UUID := auth.uid(); v_since TIMESTAMPTZ; v_clamped_limit INT;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;
  v_since := now() - (p_days || ' days')::INTERVAL;
  v_clamped_limit := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);

  RETURN QUERY
  WITH viewer_events AS (
    SELECT e.user_id AS vid, MAX(e.created_at) AS last_viewed_at, COUNT(*) AS cnt
    FROM events e
    WHERE e.event_name = 'profile_view' AND e.entity_type = 'profile' AND e.entity_id = v_user_id
      AND e.created_at >= v_since AND e.user_id IS NOT NULL AND e.user_id != v_user_id
    GROUP BY e.user_id
  )
  SELECT ve.vid, p.full_name, p.role, p.username, p.avatar_url, p.base_location, ve.last_viewed_at, ve.cnt
  FROM viewer_events ve INNER JOIN profiles p ON p.id = ve.vid
  WHERE p.browse_anonymously = false AND COALESCE(p.is_test_account, false) = false
    AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = ve.vid) OR (ub.blocker_id = ve.vid AND ub.blocked_id = v_user_id))
  ORDER BY ve.last_viewed_at DESC LIMIT v_clamped_limit;
END;
$$;

-- ============================================================
-- 12. CLUB MEMBERS, BRAND FOLLOWERS, AMBASSADORS
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_club_members(p_profile_id UUID, p_limit INT DEFAULT 30, p_offset INT DEFAULT 0)
RETURNS TABLE (id UUID, full_name TEXT, avatar_url TEXT, role TEXT, nationality TEXT, nationality_country_id INT, nationality2_country_id INT, base_location TEXT, "position" TEXT, secondary_position TEXT, current_club TEXT, current_world_club_id UUID, created_at TIMESTAMPTZ, open_to_play BOOLEAN, open_to_coach BOOLEAN, is_test_account BOOLEAN, total_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  WITH club_ids AS (SELECT wc.id AS world_club_id FROM world_clubs wc WHERE wc.claimed_profile_id = p_profile_id),
  members AS (
    SELECT DISTINCT ON (p.id) p.*
    FROM profiles p JOIN club_ids c ON p.current_world_club_id = c.world_club_id
    WHERE p.role IN ('player', 'coach') AND p.onboarding_completed = true
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = auth.uid() AND ub.blocked_id = p.id) OR (ub.blocker_id = p.id AND ub.blocked_id = auth.uid()))
  ),
  counted AS (SELECT COUNT(*) AS cnt FROM members)
  SELECT m.id, m.full_name, m.avatar_url, m.role::TEXT, m.nationality, m.nationality_country_id, m.nationality2_country_id, m.base_location, m.position, m.secondary_position, m.current_club, m.current_world_club_id, m.created_at, m.open_to_play, m.open_to_coach, m.is_test_account, c.cnt
  FROM members m CROSS JOIN counted c ORDER BY m.full_name ASC LIMIT p_limit OFFSET p_offset;
$$;

CREATE OR REPLACE FUNCTION public.get_brand_followers(p_brand_id UUID, p_limit INT DEFAULT 20, p_offset INT DEFAULT 0)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_total BIGINT; v_followers JSONB; v_user_id UUID := auth.uid();
BEGIN
  SELECT COUNT(*) INTO v_total FROM brand_followers bf WHERE bf.brand_id = p_brand_id
    AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = bf.follower_id) OR (ub.blocker_id = bf.follower_id AND ub.blocked_id = v_user_id));

  SELECT COALESCE(jsonb_agg(row_data ORDER BY followed_at DESC), '[]'::jsonb) INTO v_followers
  FROM (
    SELECT jsonb_build_object('profile_id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url, 'role', p.role, 'followed_at', bf.created_at) AS row_data, bf.created_at AS followed_at
    FROM brand_followers bf JOIN profiles p ON p.id = bf.follower_id
    WHERE bf.brand_id = p_brand_id
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = bf.follower_id) OR (ub.blocker_id = bf.follower_id AND ub.blocked_id = v_user_id))
    ORDER BY bf.created_at DESC LIMIT LEAST(p_limit, 50) OFFSET p_offset
  ) sub;
  RETURN jsonb_build_object('followers', v_followers, 'total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_brand_ambassadors_public(p_brand_id UUID, p_limit INT DEFAULT 12)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_total BIGINT; v_ambassadors JSONB; v_user_id UUID := auth.uid();
BEGIN
  SELECT COUNT(*) INTO v_total FROM brand_ambassadors WHERE brand_id = p_brand_id AND status = 'accepted'
    AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = player_id) OR (ub.blocker_id = player_id AND ub.blocked_id = v_user_id));

  SELECT COALESCE(jsonb_agg(row_data ORDER BY added_at DESC), '[]'::jsonb) INTO v_ambassadors
  FROM (
    SELECT jsonb_build_object('player_id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url, 'position', p.position, 'current_club', p.current_club) AS row_data, ba.created_at AS added_at
    FROM brand_ambassadors ba JOIN profiles p ON p.id = ba.player_id
    WHERE ba.brand_id = p_brand_id AND ba.status = 'accepted'
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = ba.player_id) OR (ub.blocker_id = ba.player_id AND ub.blocked_id = v_user_id))
    ORDER BY ba.created_at DESC LIMIT LEAST(p_limit, 12)
  ) sub;
  RETURN jsonb_build_object('ambassadors', v_ambassadors, 'total', v_total);
END;
$$;
