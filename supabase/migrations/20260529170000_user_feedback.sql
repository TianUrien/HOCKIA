-- ─────────────────────────────────────────────────────────────────────
-- user_feedback — in-app feedback collection (MVP)
-- ─────────────────────────────────────────────────────────────────────
-- Lets any signed-in user file feedback via a SettingsSheet entry.
-- Auto-captures route, role, device, environment, app version. Routes
-- to an admin notification email (gmail by default) and the
-- /admin/feedback dashboard.
--
-- Design references in this session:
--   - Mirrors ai_opinion_feedback's RLS pattern (viewer writes own,
--     reads own; service_role full; admin reads via SECURITY DEFINER
--     RPC).
--   - Mirrors the admin_ai_opinion_analytics RPC pattern for the
--     admin metrics + list endpoints.
--   - Explicit GRANTs per post-Oct-30-2026 Data API rule (see
--     20260528110000_explicit_data_api_grants.sql).

BEGIN;

-- ── Table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_feedback (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Auth.uid() at submit time. Cascade-delete on profile removal so a
  -- deleted user's feedback doesn't linger as orphan rows.
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Denormalized role at time of submit. Lets admin filter by "all
  -- feedback from coaches" without joining + handles the case where
  -- the user later switches roles.
  user_role         TEXT NOT NULL,
  -- 5-category intent taxonomy. Domain (recruitment / profile / AI
  -- opinion / etc.) is inferred from `route`, not asked at submit
  -- time — keeps the form low-friction.
  category          TEXT NOT NULL CHECK (category IN ('bug','confusing','idea','praise','other')),
  body              TEXT NOT NULL CHECK (length(body) BETWEEN 50 AND 2000),
  is_urgent         BOOLEAN NOT NULL DEFAULT false,
  -- Sanitized route — UUID segments replaced with :id by the client
  -- before insert (reuses lib/analyticsSanitizers.ts). Safe to expose
  -- to the user via their own SELECT.
  route             TEXT,
  -- Raw route with UUIDs intact. Admin-only via the
  -- admin_get_feedback_list RPC; never returned to the submitting
  -- user. Lets the developer reproduce the specific bug without
  -- juggling between sanitized and raw paths.
  route_raw         TEXT,
  user_agent        TEXT,
  viewport          TEXT,  -- "390x844" format
  environment       TEXT,  -- 'production' | 'staging' | 'development'
  app_version       TEXT,  -- git SHA at deploy time
  sentry_replay_url TEXT,
  -- ── Admin workflow ───────────────────────────────────────────────
  status            TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewing','planned','fixed','closed')),
  priority          TEXT CHECK (priority IS NULL OR priority IN ('p0','p1','p2','p3')),
  assigned_to       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  admin_notes       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  resolved_at       TIMESTAMPTZ
);

COMMENT ON TABLE public.user_feedback IS
  'In-app feedback submitted by any signed-in user. Five-category intent taxonomy + free-text body + auto-captured context. Admin workflow fields (status/priority/assignment/notes) for triage.';

-- Common admin queries
CREATE INDEX IF NOT EXISTS user_feedback_status_created_idx
  ON public.user_feedback (status, created_at DESC);
CREATE INDEX IF NOT EXISTS user_feedback_user_created_idx
  ON public.user_feedback (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_feedback_category_created_idx
  ON public.user_feedback (category, created_at DESC);
-- The user_created_idx above already covers the rate-limit query
-- ("rows from this user in the last hour"). A partial index with
-- a now()-bound predicate would be stricter but Postgres rejects
-- it because now() isn't IMMUTABLE.

-- Auto-touch updated_at on any update
CREATE OR REPLACE FUNCTION public.set_user_feedback_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  -- Side effect: if status transitions to fixed/closed, stamp resolved_at
  -- if not already set. Going BACK to a non-resolved status doesn't
  -- clear it — keeps the audit trail of when work was completed.
  IF NEW.status IN ('fixed', 'closed') AND OLD.status NOT IN ('fixed', 'closed') AND NEW.resolved_at IS NULL THEN
    NEW.resolved_at := timezone('utc', now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_feedback_updated_at_trigger ON public.user_feedback;
CREATE TRIGGER user_feedback_updated_at_trigger
  BEFORE UPDATE ON public.user_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.set_user_feedback_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;

-- Read own
DROP POLICY IF EXISTS "user_feedback_viewer_read_own" ON public.user_feedback;
CREATE POLICY "user_feedback_viewer_read_own"
  ON public.user_feedback FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- No direct authenticated INSERT — all writes go through
-- submit_user_feedback() RPC so rate limit + auto-fields are
-- consistently enforced.

-- Service role for the admin RPCs + edge functions
DROP POLICY IF EXISTS "user_feedback_service_role_all" ON public.user_feedback;
CREATE POLICY "user_feedback_service_role_all"
  ON public.user_feedback FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── GRANTs (post-Oct-30 2026 explicit pattern) ──────────────────────
REVOKE ALL ON TABLE public.user_feedback FROM anon, authenticated;
GRANT SELECT ON TABLE public.user_feedback TO authenticated;
GRANT ALL ON TABLE public.user_feedback TO service_role;

-- ── submit_user_feedback RPC ────────────────────────────────────────
-- The single entry point for new feedback. SECURITY DEFINER so it
-- can write into a table that authenticated users can't INSERT into
-- directly. Enforces rate limit (5/hour per user) + auto-captures
-- user_role from profiles + returns the new row id so the client can
-- fire its notification edge function.
CREATE OR REPLACE FUNCTION public.submit_user_feedback(
  p_category          TEXT,
  p_body              TEXT,
  p_is_urgent         BOOLEAN DEFAULT false,
  p_route             TEXT DEFAULT NULL,
  p_route_raw         TEXT DEFAULT NULL,
  p_user_agent        TEXT DEFAULT NULL,
  p_viewport          TEXT DEFAULT NULL,
  p_environment       TEXT DEFAULT NULL,
  p_app_version       TEXT DEFAULT NULL,
  p_sentry_replay_url TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_user_role  TEXT;
  v_recent_count INT;
  v_new_id     UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'P0001';
  END IF;

  -- Rate limit: 5/hour per user. Friendly error code so the client
  -- can show a toast.
  SELECT COUNT(*)::INT INTO v_recent_count
  FROM public.user_feedback
  WHERE user_id = v_user_id
    AND created_at > timezone('utc', now()) - interval '1 hour';

  IF v_recent_count >= 5 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;

  -- Auto-capture user_role at submit time.
  SELECT role INTO v_user_role
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_user_role IS NULL THEN
    -- Defensive — the FK on user_id ensures the profile exists, but
    -- a missing role would break the NOT NULL constraint downstream.
    v_user_role := 'unknown';
  END IF;

  INSERT INTO public.user_feedback (
    user_id, user_role, category, body, is_urgent,
    route, route_raw, user_agent, viewport, environment, app_version,
    sentry_replay_url
  )
  VALUES (
    v_user_id, v_user_role, p_category, p_body, COALESCE(p_is_urgent, false),
    p_route, p_route_raw, p_user_agent, p_viewport, p_environment, p_app_version,
    p_sentry_replay_url
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION public.submit_user_feedback IS
  'Single entry point for client feedback submissions. Rate-limited to 5/hour per user. Auto-captures user_role from profiles. Returns the new row id.';

GRANT EXECUTE ON FUNCTION public.submit_user_feedback(
  TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

-- ── admin_get_feedback_metrics RPC ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_feedback_metrics(
  p_days INT DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_since TIMESTAMPTZ := timezone('utc', now()) - (p_days || ' days')::INTERVAL;
  v_summary JSONB;
  v_daily JSONB;
  v_by_category JSONB;
  v_by_status JSONB;
  v_by_role JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT jsonb_build_object(
    'total', COALESCE(COUNT(*), 0),
    'urgent', COALESCE(COUNT(*) FILTER (WHERE is_urgent), 0),
    'new', COALESCE(COUNT(*) FILTER (WHERE status = 'new'), 0),
    'open_total', COALESCE(COUNT(*) FILTER (WHERE status IN ('new','reviewing','planned')), 0),
    'unique_users', COALESCE(COUNT(DISTINCT user_id), 0)
  )
  INTO v_summary
  FROM public.user_feedback
  WHERE created_at >= v_since;

  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.day), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT
      to_char(date_trunc('day', created_at AT TIME ZONE 'utc'), 'YYYY-MM-DD') AS day,
      COUNT(*) AS submissions
    FROM public.user_feedback
    WHERE created_at >= v_since
    GROUP BY date_trunc('day', created_at AT TIME ZONE 'utc')
  ) sub;

  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.count DESC), '[]'::jsonb)
  INTO v_by_category
  FROM (
    SELECT category, COUNT(*) AS count
    FROM public.user_feedback
    WHERE created_at >= v_since
    GROUP BY category
  ) sub;

  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.count DESC), '[]'::jsonb)
  INTO v_by_status
  FROM (
    SELECT status, COUNT(*) AS count
    FROM public.user_feedback
    WHERE created_at >= v_since
    GROUP BY status
  ) sub;

  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.count DESC), '[]'::jsonb)
  INTO v_by_role
  FROM (
    SELECT user_role, COUNT(*) AS count
    FROM public.user_feedback
    WHERE created_at >= v_since
    GROUP BY user_role
  ) sub;

  RETURN jsonb_build_object(
    'summary', v_summary,
    'daily', v_daily,
    'by_category', v_by_category,
    'by_status', v_by_status,
    'by_role', v_by_role,
    'window_days', p_days,
    'generated_at', timezone('utc', now())
  );
END;
$$;

COMMENT ON FUNCTION public.admin_get_feedback_metrics(INT) IS
  'Admin-only dashboard payload for /admin/feedback. Returns headline counts, daily trend, category + status + role splits.';

GRANT EXECUTE ON FUNCTION public.admin_get_feedback_metrics(INT) TO authenticated;

-- ── admin_get_feedback_list RPC ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_feedback_list(
  p_limit       INT DEFAULT 25,
  p_offset      INT DEFAULT 0,
  p_status      TEXT DEFAULT NULL,
  p_category    TEXT DEFAULT NULL,
  p_urgent_only BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows JSONB;
  v_total INT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('new','reviewing','planned','fixed','closed') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'P0001';
  END IF;
  IF p_category IS NOT NULL AND p_category NOT IN ('bug','confusing','idea','praise','other') THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = 'P0001';
  END IF;
  IF p_limit > 200 THEN p_limit := 200; END IF;
  IF p_limit < 1 THEN p_limit := 1; END IF;
  IF p_offset < 0 THEN p_offset := 0; END IF;

  SELECT COUNT(*)::INT
  INTO v_total
  FROM public.user_feedback f
  WHERE (p_status IS NULL OR f.status = p_status)
    AND (p_category IS NULL OR f.category = p_category)
    AND (NOT p_urgent_only OR f.is_urgent = true);

  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.is_urgent DESC, sub.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      f.id,
      f.user_id,
      p.full_name  AS user_name,
      p.avatar_url AS user_avatar_url,
      f.user_role,
      f.category,
      f.body,
      f.is_urgent,
      f.route,
      f.route_raw,
      f.user_agent,
      f.viewport,
      f.environment,
      f.app_version,
      f.sentry_replay_url,
      f.status,
      f.priority,
      f.assigned_to,
      assignee.full_name AS assigned_to_name,
      f.admin_notes,
      f.created_at,
      f.updated_at,
      f.resolved_at
    FROM public.user_feedback f
    LEFT JOIN public.profiles p        ON p.id = f.user_id
    LEFT JOIN public.profiles assignee ON assignee.id = f.assigned_to
    WHERE (p_status IS NULL OR f.status = p_status)
      AND (p_category IS NULL OR f.category = p_category)
      AND (NOT p_urgent_only OR f.is_urgent = true)
    ORDER BY f.is_urgent DESC, f.created_at DESC
    LIMIT p_limit
    OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset,
    'status_filter', p_status,
    'category_filter', p_category,
    'urgent_only', p_urgent_only
  );
END;
$$;

COMMENT ON FUNCTION public.admin_get_feedback_list(INT, INT, TEXT, TEXT, BOOLEAN) IS
  'Admin-only paginated feedback list with submitter + assignee identity. Urgent items float to the top.';

GRANT EXECUTE ON FUNCTION public.admin_get_feedback_list(INT, INT, TEXT, TEXT, BOOLEAN) TO authenticated;

-- ── admin_update_feedback RPC ───────────────────────────────────────
-- Status / priority / assignment / admin_notes mutations from the
-- /admin/feedback dashboard. Returns the updated row so the page
-- can patch its local state without re-fetching the full list.
CREATE OR REPLACE FUNCTION public.admin_update_feedback(
  p_id          UUID,
  p_status      TEXT DEFAULT NULL,
  p_priority    TEXT DEFAULT NULL,
  p_assigned_to UUID DEFAULT NULL,
  p_admin_notes TEXT DEFAULT NULL,
  p_clear_priority    BOOLEAN DEFAULT false,
  p_clear_assigned_to BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.user_feedback%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('new','reviewing','planned','fixed','closed') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'P0001';
  END IF;
  IF p_priority IS NOT NULL AND p_priority NOT IN ('p0','p1','p2','p3') THEN
    RAISE EXCEPTION 'invalid_priority' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.user_feedback
  SET status      = COALESCE(p_status, status),
      priority    = CASE WHEN p_clear_priority THEN NULL ELSE COALESCE(p_priority, priority) END,
      assigned_to = CASE WHEN p_clear_assigned_to THEN NULL ELSE COALESCE(p_assigned_to, assigned_to) END,
      admin_notes = COALESCE(p_admin_notes, admin_notes)
  WHERE id = p_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0001';
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

COMMENT ON FUNCTION public.admin_update_feedback IS
  'Mutate status / priority / assignment / notes on a single feedback row. Pass p_clear_priority=true or p_clear_assigned_to=true to set those columns to NULL.';

GRANT EXECUTE ON FUNCTION public.admin_update_feedback(
  UUID, TEXT, TEXT, UUID, TEXT, BOOLEAN, BOOLEAN
) TO authenticated;

COMMIT;
