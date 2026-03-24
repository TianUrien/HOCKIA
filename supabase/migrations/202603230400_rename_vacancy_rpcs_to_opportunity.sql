-- ============================================================================
-- Rename remaining admin RPC functions from vacancy→opportunity naming.
-- Tables were already renamed in 202601272000_terminology_alignment.sql.
-- Some RPCs were re-created under old names by later migrations.
-- This migration drops the old-named functions and creates new-named ones.
-- ============================================================================

-- ============================================================================
-- 1. admin_get_vacancies → admin_get_opportunities
-- ============================================================================
-- Drop ALL overloads of both old and new names to start clean
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure::text AS sig
    FROM pg_proc
    WHERE proname IN ('admin_get_vacancies', 'admin_get_opportunities')
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.admin_get_opportunities(
  p_status opportunity_status DEFAULT NULL,
  p_club_id UUID DEFAULT NULL,
  p_days INTEGER DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  club_id UUID,
  club_name TEXT,
  club_avatar_url TEXT,
  status opportunity_status,
  opportunity_type opportunity_type,
  "position" opportunity_position,
  location_city TEXT,
  location_country TEXT,
  application_count BIGINT,
  pending_count BIGINT,
  shortlisted_count BIGINT,
  first_application_at TIMESTAMPTZ,
  time_to_first_app_minutes INTEGER,
  created_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  application_deadline DATE,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT COUNT(*)
  INTO v_total
  FROM opportunities o
  WHERE
    (p_status IS NULL OR o.status = p_status)
    AND (p_club_id IS NULL OR o.club_id = p_club_id)
    AND (p_days IS NULL OR o.created_at > now() - (p_days || ' days')::INTERVAL);

  RETURN QUERY
  WITH opportunity_stats AS (
    SELECT
      oa.opportunity_id,
      COUNT(oa.id) as app_count,
      COUNT(oa.id) FILTER (WHERE oa.status = 'pending') as pending_cnt,
      COUNT(oa.id) FILTER (WHERE oa.status = 'shortlisted') as shortlisted_cnt,
      MIN(oa.applied_at) as first_app
    FROM opportunity_applications oa
    GROUP BY oa.opportunity_id
  )
  SELECT
    o.id,
    o.title,
    o.club_id,
    p.full_name as club_name,
    p.avatar_url as club_avatar_url,
    o.status,
    o.opportunity_type,
    o."position",
    o.location_city,
    o.location_country,
    COALESCE(os.app_count, 0)::BIGINT,
    COALESCE(os.pending_cnt, 0)::BIGINT,
    COALESCE(os.shortlisted_cnt, 0)::BIGINT,
    os.first_app,
    CASE
      WHEN os.first_app IS NOT NULL AND o.published_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (os.first_app - o.published_at))::INTEGER / 60
      ELSE NULL
    END,
    o.created_at,
    o.published_at,
    o.application_deadline,
    v_total
  FROM opportunities o
  JOIN profiles p ON p.id = o.club_id
  LEFT JOIN opportunity_stats os ON os.opportunity_id = o.id
  WHERE
    (p_status IS NULL OR o.status = p_status)
    AND (p_club_id IS NULL OR o.club_id = p_club_id)
    AND (p_days IS NULL OR o.created_at > now() - (p_days || ' days')::INTERVAL)
  ORDER BY o.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.admin_get_opportunities(opportunity_status, UUID, INTEGER, INTEGER, INTEGER) IS 'Get paginated opportunity list with application statistics for admin';
GRANT EXECUTE ON FUNCTION public.admin_get_opportunities(opportunity_status, UUID, INTEGER, INTEGER, INTEGER) TO authenticated;

-- ============================================================================
-- 2. admin_get_vacancy_applicants → admin_get_opportunity_applicants
-- ============================================================================
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure::text AS sig
    FROM pg_proc
    WHERE proname IN ('admin_get_vacancy_applicants', 'admin_get_opportunity_applicants')
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.admin_get_opportunity_applicants(
  p_opportunity_id UUID,
  p_status application_status DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  application_id UUID,
  player_id UUID,
  player_name TEXT,
  player_email TEXT,
  nationality TEXT,
  "position" TEXT,
  avatar_url TEXT,
  highlight_video_url TEXT,
  status application_status,
  applied_at TIMESTAMPTZ,
  onboarding_completed BOOLEAN,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT COUNT(*)
  INTO v_total
  FROM opportunity_applications oa
  WHERE oa.opportunity_id = p_opportunity_id
    AND (p_status IS NULL OR oa.status = p_status);

  RETURN QUERY
  SELECT
    oa.id as application_id,
    oa.applicant_id as player_id,
    p.full_name as player_name,
    p.email as player_email,
    COALESCE(c.name, p.nationality) as nationality,
    p."position",
    p.avatar_url,
    p.highlight_video_url,
    oa.status,
    oa.applied_at,
    p.onboarding_completed,
    v_total
  FROM opportunity_applications oa
  JOIN profiles p ON p.id = oa.applicant_id
  LEFT JOIN countries c ON c.id = p.nationality_country_id
  WHERE oa.opportunity_id = p_opportunity_id
    AND (p_status IS NULL OR oa.status = p_status)
  ORDER BY oa.applied_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.admin_get_opportunity_applicants IS 'Get applicants for a specific opportunity with profile details';
GRANT EXECUTE ON FUNCTION public.admin_get_opportunity_applicants TO authenticated;

-- ============================================================================
-- 3. admin_get_vacancy_detail → admin_get_opportunity_detail
-- ============================================================================
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure::text AS sig
    FROM pg_proc
    WHERE proname IN ('admin_get_vacancy_detail', 'admin_get_opportunity_detail')
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.admin_get_opportunity_detail(
  p_opportunity_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT json_build_object(
    'opportunity', (
      SELECT row_to_json(o.*)
      FROM opportunities o
      WHERE o.id = p_opportunity_id
    ),
    'club', (
      SELECT json_build_object(
        'id', p.id,
        'full_name', p.full_name,
        'email', p.email,
        'avatar_url', p.avatar_url,
        'base_location', p.base_location
      )
      FROM opportunities o
      JOIN profiles p ON p.id = o.club_id
      WHERE o.id = p_opportunity_id
    ),
    'stats', (
      SELECT json_build_object(
        'total_applications', COUNT(oa.id),
        'pending', COUNT(oa.id) FILTER (WHERE oa.status = 'pending'),
        'shortlisted', COUNT(oa.id) FILTER (WHERE oa.status = 'shortlisted'),
        'maybe', COUNT(oa.id) FILTER (WHERE oa.status = 'maybe'),
        'rejected', COUNT(oa.id) FILTER (WHERE oa.status = 'rejected'),
        'first_application_at', MIN(oa.applied_at),
        'last_application_at', MAX(oa.applied_at),
        'avg_apps_per_day', CASE
          WHEN (SELECT published_at FROM opportunities WHERE id = p_opportunity_id) IS NOT NULL
          THEN ROUND(
            COUNT(oa.id)::NUMERIC /
            NULLIF(EXTRACT(EPOCH FROM (now() - (SELECT published_at FROM opportunities WHERE id = p_opportunity_id))) / 86400, 0),
            1
          )
          ELSE NULL
        END
      )
      FROM opportunity_applications oa
      WHERE oa.opportunity_id = p_opportunity_id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.admin_get_opportunity_detail IS 'Get full opportunity details with club info and application stats';
GRANT EXECUTE ON FUNCTION public.admin_get_opportunity_detail TO authenticated;

-- ============================================================================
-- 4. Update hard_delete_profile_relations to use new table names
--    (regclass resolves by OID so the old names work, but fixing for clarity)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.hard_delete_profile_relations(
  p_user_id UUID,
  p_batch INTEGER DEFAULT 2000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB := '{}'::jsonb;
  batch_size INTEGER := GREATEST(COALESCE(p_batch, 2000), 100);
  deleted_profile INTEGER := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id_required';
  END IF;

  result := jsonb_set(result, '{applications}', to_jsonb(public.delete_rows_where_clause('public.opportunity_applications'::regclass, 'applicant_id = $1', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{vacancies}', to_jsonb(public.delete_rows_where_clause('public.opportunities'::regclass, 'club_id = $1', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{playingHistory}', to_jsonb(public.delete_rows_where_clause('public.career_history'::regclass, 'user_id = $1', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{galleryPhotos}', to_jsonb(public.delete_rows_where_clause('public.gallery_photos'::regclass, 'user_id = $1', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{clubMedia}', to_jsonb(public.delete_rows_where_clause('public.club_media'::regclass, 'club_id = $1', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{profileComments}', to_jsonb(public.delete_rows_where_clause('public.profile_comments'::regclass, 'profile_id = $1 OR author_profile_id = $1', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{profileNotifications}', to_jsonb(public.delete_rows_where_clause('public.profile_notifications'::regclass, 'recipient_profile_id = $1 OR actor_profile_id = $1', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{friendships}', to_jsonb(public.delete_rows_where_clause('public.profile_friendships'::regclass, 'user_one = $1 OR user_two = $1', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{archivedMessages}', to_jsonb(public.delete_rows_where_clause('public.archived_messages'::regclass, 'sender_id = $1 OR conversation_id IN (SELECT id FROM public.conversations WHERE participant_one_id = $1 OR participant_two_id = $1)', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{messages}', to_jsonb(public.delete_rows_where_clause('public.messages'::regclass, 'conversation_id IN (SELECT id FROM public.conversations WHERE participant_one_id = $1 OR participant_two_id = $1)', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{conversations}', to_jsonb(public.delete_rows_where_clause('public.conversations'::regclass, 'participant_one_id = $1 OR participant_two_id = $1', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{unreadCounters}', to_jsonb(public.delete_rows_where_clause('public.user_unread_counters'::regclass, 'user_id = $1', p_user_id, batch_size)), true);

  DELETE FROM public.profiles WHERE id = p_user_id;
  GET DIAGNOSTICS deleted_profile = ROW_COUNT;
  result := jsonb_set(result, '{profiles}', to_jsonb(deleted_profile), true);

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.hard_delete_profile_relations(UUID, INTEGER)
IS 'Removes all relational data tied to a profile in server-side batches and returns per-table deletion counts.';

GRANT EXECUTE ON FUNCTION public.hard_delete_profile_relations(UUID, INTEGER) TO service_role;
