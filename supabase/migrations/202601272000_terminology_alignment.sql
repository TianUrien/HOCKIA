-- ============================================================================
-- HOCKIA Terminology Alignment Migration
-- ============================================================================
-- This migration aligns database terminology with product terminology:
--   - vacancies → opportunities
--   - vacancy_applications → opportunity_applications
--   - playing_history → career_history
--   - player_id → applicant_id (in applications)
--   - vacancy_* enums → opportunity_* enums
--
-- IMPORTANT: This migration must be applied to both staging and production.
-- Test thoroughly on staging before applying to production.
-- ============================================================================

-- ============================================================================
-- PHASE 1: DROP DEPENDENT OBJECTS
-- ============================================================================
-- We must drop triggers, indexes, and policies before renaming tables

-- Drop triggers on vacancies
DROP TRIGGER IF EXISTS set_vacancies_updated_at ON public.vacancies;
DROP TRIGGER IF EXISTS set_vacancy_timestamps ON public.vacancies;
DROP TRIGGER IF EXISTS vacancies_version_trigger ON public.vacancies;
DROP TRIGGER IF EXISTS vacancy_published_at_trigger ON public.vacancies;

-- Drop triggers on vacancy_applications
DROP TRIGGER IF EXISTS set_vacancy_applications_updated_at ON public.vacancy_applications;
DROP TRIGGER IF EXISTS vacancy_applications_notify ON public.vacancy_applications;

-- Drop triggers on playing_history
DROP TRIGGER IF EXISTS set_playing_history_updated_at ON public.playing_history;

-- Drop indexes on vacancies (will recreate with new names)
DROP INDEX IF EXISTS public.idx_vacancies_club_id;
DROP INDEX IF EXISTS public.idx_vacancies_club_status;
DROP INDEX IF EXISTS public.idx_vacancies_status_position_club;
DROP INDEX IF EXISTS public.idx_vacancies_open;
DROP INDEX IF EXISTS public.idx_vacancies_published;
DROP INDEX IF EXISTS public.idx_vacancies_club_status_updated;

-- Drop indexes on vacancy_applications
DROP INDEX IF EXISTS public.idx_vacancy_apps_vacancy_status;
DROP INDEX IF EXISTS public.idx_vacancy_apps_player_status;
DROP INDEX IF EXISTS public.idx_vacancy_applications_vacancy_id;
DROP INDEX IF EXISTS public.idx_vacancy_applications_player_id;

-- Drop indexes on playing_history
DROP INDEX IF EXISTS public.idx_playing_history_user_display;
DROP INDEX IF EXISTS public.idx_playing_history_user_id;

-- Drop RLS policies on vacancies
DROP POLICY IF EXISTS "Public can view open vacancies" ON public.vacancies;
DROP POLICY IF EXISTS "Clubs can manage their vacancies" ON public.vacancies;
DROP POLICY IF EXISTS "Admins can view all vacancies" ON public.vacancies;

-- Drop RLS policies on vacancy_applications
DROP POLICY IF EXISTS "Clubs can view applications to their vacancies" ON public.vacancy_applications;
DROP POLICY IF EXISTS "Applicants can view own applications" ON public.vacancy_applications;
DROP POLICY IF EXISTS "Applicants can create applications" ON public.vacancy_applications;
DROP POLICY IF EXISTS "Clubs can update application status" ON public.vacancy_applications;
DROP POLICY IF EXISTS "Applicants can withdraw applications" ON public.vacancy_applications;

-- Drop RLS policies on playing_history
DROP POLICY IF EXISTS "Users can view own playing history" ON public.playing_history;
DROP POLICY IF EXISTS "Users can insert own playing history" ON public.playing_history;
DROP POLICY IF EXISTS "Users can update own playing history" ON public.playing_history;
DROP POLICY IF EXISTS "Users can delete own playing history" ON public.playing_history;
DROP POLICY IF EXISTS "Anyone can view playing history" ON public.playing_history;

-- ============================================================================
-- PHASE 2: RENAME ENUM TYPES
-- ============================================================================

-- Use DO block for safe type renames (PostgreSQL doesn't support IF EXISTS for ALTER TYPE)
DO $$
BEGIN
  -- Rename vacancy_position to opportunity_position
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vacancy_position') THEN
    ALTER TYPE public.vacancy_position RENAME TO opportunity_position;
  END IF;

  -- Rename vacancy_gender to opportunity_gender
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vacancy_gender') THEN
    ALTER TYPE public.vacancy_gender RENAME TO opportunity_gender;
  END IF;

  -- Rename vacancy_priority to opportunity_priority
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vacancy_priority') THEN
    ALTER TYPE public.vacancy_priority RENAME TO opportunity_priority;
  END IF;

  -- Rename vacancy_status to opportunity_status
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vacancy_status') THEN
    ALTER TYPE public.vacancy_status RENAME TO opportunity_status;
  END IF;
END $$;

-- ============================================================================
-- PHASE 3: RENAME TABLES
-- ============================================================================

-- PostgreSQL RENAME doesn't support IF EXISTS, so we use a DO block
DO $$
BEGIN
  -- Rename vacancies to opportunities
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vacancies') THEN
    ALTER TABLE public.vacancies RENAME TO opportunities;
  END IF;

  -- Rename vacancy_applications to opportunity_applications
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vacancy_applications') THEN
    ALTER TABLE public.vacancy_applications RENAME TO opportunity_applications;
  END IF;

  -- Rename playing_history to career_history
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'playing_history') THEN
    ALTER TABLE public.playing_history RENAME TO career_history;
  END IF;
END $$;

-- ============================================================================
-- PHASE 4: RENAME COLUMNS
-- ============================================================================

-- Rename player_id to applicant_id in opportunity_applications
ALTER TABLE public.opportunity_applications RENAME COLUMN player_id TO applicant_id;

-- Rename vacancy_id to opportunity_id in opportunity_applications
ALTER TABLE public.opportunity_applications RENAME COLUMN vacancy_id TO opportunity_id;

-- ============================================================================
-- PHASE 5: UPDATE FOREIGN KEY CONSTRAINT NAMES
-- ============================================================================

-- Update FK constraint name for club_id reference
ALTER TABLE public.opportunities
  DROP CONSTRAINT IF EXISTS vacancies_club_id_fkey;
ALTER TABLE public.opportunities
  ADD CONSTRAINT opportunities_club_id_fkey
  FOREIGN KEY (club_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Update FK constraints in opportunity_applications
ALTER TABLE public.opportunity_applications
  DROP CONSTRAINT IF EXISTS vacancy_applications_vacancy_id_fkey;
ALTER TABLE public.opportunity_applications
  DROP CONSTRAINT IF EXISTS vacancy_applications_player_id_fkey;

ALTER TABLE public.opportunity_applications
  ADD CONSTRAINT opportunity_applications_opportunity_id_fkey
  FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;
ALTER TABLE public.opportunity_applications
  ADD CONSTRAINT opportunity_applications_applicant_id_fkey
  FOREIGN KEY (applicant_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Update unique constraint
ALTER TABLE public.opportunity_applications
  DROP CONSTRAINT IF EXISTS vacancy_applications_vacancy_id_player_id_key;
ALTER TABLE public.opportunity_applications
  ADD CONSTRAINT opportunity_applications_opportunity_id_applicant_id_key
  UNIQUE (opportunity_id, applicant_id);

-- Update FK in career_history
ALTER TABLE public.career_history
  DROP CONSTRAINT IF EXISTS playing_history_user_id_fkey;
ALTER TABLE public.career_history
  ADD CONSTRAINT career_history_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- ============================================================================
-- PHASE 6: RECREATE INDEXES WITH NEW NAMES
-- ============================================================================

-- Indexes on opportunities
CREATE INDEX IF NOT EXISTS idx_opportunities_club_id
  ON public.opportunities(club_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_club_status
  ON public.opportunities(club_id, status);
CREATE INDEX IF NOT EXISTS idx_opportunities_status_position_club
  ON public.opportunities(status, position, club_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_open
  ON public.opportunities(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_opportunities_published
  ON public.opportunities(published_at DESC NULLS LAST) WHERE published_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opportunities_club_status_updated
  ON public.opportunities(club_id, status, updated_at DESC);

-- Indexes on opportunity_applications
CREATE INDEX IF NOT EXISTS idx_opportunity_apps_opportunity_status
  ON public.opportunity_applications(opportunity_id, status);
CREATE INDEX IF NOT EXISTS idx_opportunity_apps_applicant_status
  ON public.opportunity_applications(applicant_id, status);
CREATE INDEX IF NOT EXISTS idx_opportunity_applications_opportunity_id
  ON public.opportunity_applications(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_applications_applicant_id
  ON public.opportunity_applications(applicant_id);

-- Indexes on career_history
CREATE INDEX IF NOT EXISTS idx_career_history_user_display
  ON public.career_history(user_id, display_order);
CREATE INDEX IF NOT EXISTS idx_career_history_user_id
  ON public.career_history(user_id);

-- ============================================================================
-- PHASE 7: RECREATE RLS POLICIES WITH NEW NAMES
-- ============================================================================

-- Policies on opportunities
CREATE POLICY "Public can view open opportunities"
  ON public.opportunities
  FOR SELECT
  USING (status = 'open');

CREATE POLICY "Clubs can manage their opportunities"
  ON public.opportunities
  FOR ALL
  USING (auth.uid() = club_id)
  WITH CHECK (auth.uid() = club_id);

CREATE POLICY "Admins can view all opportunities"
  ON public.opportunities
  FOR SELECT
  USING (public.is_platform_admin());

-- Policies on opportunity_applications
CREATE POLICY "Clubs can view applications to their opportunities"
  ON public.opportunity_applications
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.opportunities o
      WHERE o.id = public.opportunity_applications.opportunity_id
        AND o.club_id = auth.uid()
    )
  );

CREATE POLICY "Applicants can view own applications"
  ON public.opportunity_applications
  FOR SELECT
  USING (auth.uid() = applicant_id);

CREATE POLICY "Applicants can create applications"
  ON public.opportunity_applications
  FOR INSERT
  WITH CHECK (
    auth.uid() = applicant_id
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.opportunities o ON o.id = opportunity_id
      WHERE p.id = auth.uid()
      AND (
        (p.role = 'player' AND o.opportunity_type = 'player')
        OR (p.role = 'coach' AND o.opportunity_type = 'coach')
      )
    )
  );

CREATE POLICY "Clubs can update application status"
  ON public.opportunity_applications
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.opportunities o
      WHERE o.id = public.opportunity_applications.opportunity_id
        AND o.club_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.opportunities o
      WHERE o.id = public.opportunity_applications.opportunity_id
        AND o.club_id = auth.uid()
    )
  );

CREATE POLICY "Applicants can withdraw applications"
  ON public.opportunity_applications
  FOR UPDATE
  USING (auth.uid() = applicant_id)
  WITH CHECK (
    auth.uid() = applicant_id
    AND status = 'withdrawn'
  );

-- Policies on career_history
CREATE POLICY "Users can view own career history"
  ON public.career_history
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Anyone can view career history"
  ON public.career_history
  FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own career history"
  ON public.career_history
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own career history"
  ON public.career_history
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own career history"
  ON public.career_history
  FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- PHASE 8: UPDATE/RECREATE TRIGGER FUNCTIONS
-- ============================================================================

-- Update opportunity timestamp function
CREATE OR REPLACE FUNCTION public.update_opportunities_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Update opportunity status timestamps function
CREATE OR REPLACE FUNCTION public.set_opportunity_status_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'open' AND (OLD.status IS NULL OR OLD.status != 'open') THEN
    NEW.published_at = NOW();
  END IF;
  IF NEW.status = 'closed' AND (OLD.status IS NULL OR OLD.status != 'closed') THEN
    NEW.closed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- Update opportunity published_at function
CREATE OR REPLACE FUNCTION public.set_opportunity_published_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'open' AND OLD.status != 'open' THEN
    NEW.published_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- Update career history timestamp function
CREATE OR REPLACE FUNCTION public.update_career_history_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Update opportunity applications timestamp function
CREATE OR REPLACE FUNCTION public.update_opportunity_applications_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ============================================================================
-- PHASE 9: RECREATE TRIGGERS
-- ============================================================================

-- Triggers on opportunities
CREATE TRIGGER set_opportunities_updated_at
  BEFORE UPDATE ON public.opportunities
  FOR EACH ROW
  EXECUTE FUNCTION public.update_opportunities_updated_at();

CREATE TRIGGER set_opportunity_timestamps
  BEFORE INSERT OR UPDATE ON public.opportunities
  FOR EACH ROW
  EXECUTE FUNCTION public.set_opportunity_status_timestamps();

-- Triggers on opportunity_applications
CREATE TRIGGER set_opportunity_applications_updated_at
  BEFORE UPDATE ON public.opportunity_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_opportunity_applications_updated_at();

-- Triggers on career_history
CREATE TRIGGER set_career_history_updated_at
  BEFORE UPDATE ON public.career_history
  FOR EACH ROW
  EXECUTE FUNCTION public.update_career_history_updated_at();

-- ============================================================================
-- PHASE 10: UPDATE RPC FUNCTIONS
-- ============================================================================

-- Update admin_get_opportunities function (renamed from admin_get_vacancies)
DROP FUNCTION IF EXISTS public.admin_get_vacancies(INTEGER, INTEGER, TEXT, public.opportunity_status, TEXT);
DROP FUNCTION IF EXISTS public.admin_get_vacancies(INTEGER, INTEGER, TEXT, public.vacancy_status, TEXT);

CREATE OR REPLACE FUNCTION public.admin_get_opportunities(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_search TEXT DEFAULT NULL,
  p_status public.opportunity_status DEFAULT NULL,
  p_sort TEXT DEFAULT 'created_at_desc'
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  club_id UUID,
  club_name TEXT,
  club_avatar_url TEXT,
  opportunity_type TEXT,
  "position" public.opportunity_position,
  gender public.opportunity_gender,
  location_city TEXT,
  location_country TEXT,
  status public.opportunity_status,
  priority public.opportunity_priority,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  application_count BIGINT,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
BEGIN
  -- Get total count for pagination
  SELECT COUNT(*) INTO v_total
  FROM public.opportunities o
  JOIN public.profiles p ON p.id = o.club_id
  WHERE (p_search IS NULL OR o.title ILIKE '%' || p_search || '%' OR p.full_name ILIKE '%' || p_search || '%')
    AND (p_status IS NULL OR o.status = p_status);

  RETURN QUERY
  SELECT
    o.id,
    o.title,
    o.club_id,
    p.full_name AS club_name,
    p.avatar_url AS club_avatar_url,
    o.opportunity_type,
    o."position",
    o.gender,
    o.location_city,
    o.location_country,
    o.status,
    o.priority,
    o.created_at,
    o.updated_at,
    o.published_at,
    COALESCE(app_counts.count, 0) AS application_count,
    v_total AS total_count
  FROM public.opportunities o
  JOIN public.profiles p ON p.id = o.club_id
  LEFT JOIN (
    SELECT opportunity_id, COUNT(*) as count
    FROM public.opportunity_applications
    GROUP BY opportunity_id
  ) app_counts ON app_counts.opportunity_id = o.id
  WHERE (p_search IS NULL OR o.title ILIKE '%' || p_search || '%' OR p.full_name ILIKE '%' || p_search || '%')
    AND (p_status IS NULL OR o.status = p_status)
  ORDER BY
    CASE WHEN p_sort = 'created_at_desc' THEN o.created_at END DESC,
    CASE WHEN p_sort = 'created_at_asc' THEN o.created_at END ASC,
    CASE WHEN p_sort = 'title_asc' THEN o.title END ASC,
    CASE WHEN p_sort = 'title_desc' THEN o.title END DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Update admin_get_opportunity_applicants function (renamed from admin_get_vacancy_applicants)
DROP FUNCTION IF EXISTS public.admin_get_vacancy_applicants(UUID, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.admin_get_opportunity_applicants(
  p_opportunity_id UUID,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  applicant_id UUID,
  applicant_name TEXT,
  applicant_avatar_url TEXT,
  applicant_role TEXT,
  application_id UUID,
  application_status TEXT,
  application_message TEXT,
  applied_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM public.opportunity_applications
  WHERE opportunity_id = p_opportunity_id;

  RETURN QUERY
  SELECT
    oa.applicant_id,
    p.full_name AS applicant_name,
    p.avatar_url AS applicant_avatar_url,
    p.role AS applicant_role,
    oa.id AS application_id,
    oa.status AS application_status,
    oa.message AS application_message,
    oa.created_at AS applied_at,
    v_total AS total_count
  FROM public.opportunity_applications oa
  JOIN public.profiles p ON p.id = oa.applicant_id
  WHERE oa.opportunity_id = p_opportunity_id
  ORDER BY oa.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Update admin_get_opportunity_detail function (renamed from admin_get_vacancy_detail)
DROP FUNCTION IF EXISTS public.admin_get_vacancy_detail(UUID);

CREATE OR REPLACE FUNCTION public.admin_get_opportunity_detail(
  p_opportunity_id UUID
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  description TEXT,
  club_id UUID,
  club_name TEXT,
  club_avatar_url TEXT,
  opportunity_type TEXT,
  "position" public.opportunity_position,
  gender public.opportunity_gender,
  location_city TEXT,
  location_country TEXT,
  status public.opportunity_status,
  priority public.opportunity_priority,
  requirements TEXT[],
  benefits TEXT[],
  start_date DATE,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  application_count BIGINT,
  pending_count BIGINT,
  shortlisted_count BIGINT,
  rejected_count BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.title,
    o.description,
    o.club_id,
    p.full_name AS club_name,
    p.avatar_url AS club_avatar_url,
    o.opportunity_type,
    o."position",
    o.gender,
    o.location_city,
    o.location_country,
    o.status,
    o.priority,
    o.requirements,
    o.benefits,
    o.start_date,
    o.created_at,
    o.updated_at,
    o.published_at,
    o.closed_at,
    (SELECT COUNT(*) FROM public.opportunity_applications WHERE opportunity_id = o.id) AS application_count,
    (SELECT COUNT(*) FROM public.opportunity_applications WHERE opportunity_id = o.id AND status = 'pending') AS pending_count,
    (SELECT COUNT(*) FROM public.opportunity_applications WHERE opportunity_id = o.id AND status = 'shortlisted') AS shortlisted_count,
    (SELECT COUNT(*) FROM public.opportunity_applications WHERE opportunity_id = o.id AND status = 'rejected') AS rejected_count
  FROM public.opportunities o
  JOIN public.profiles p ON p.id = o.club_id
  WHERE o.id = p_opportunity_id;
END;
$$;

-- Update fetch_club_opportunities_with_counts (renamed from fetch_club_vacancies_with_counts)
DROP FUNCTION IF EXISTS public.fetch_club_vacancies_with_counts(UUID);

CREATE OR REPLACE FUNCTION public.fetch_club_opportunities_with_counts(p_club_id UUID)
RETURNS TABLE (
  id UUID,
  title TEXT,
  opportunity_type TEXT,
  "position" public.opportunity_position,
  gender public.opportunity_gender,
  location_city TEXT,
  location_country TEXT,
  status public.opportunity_status,
  priority public.opportunity_priority,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  application_count BIGINT,
  pending_count BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.title,
    o.opportunity_type,
    o."position",
    o.gender,
    o.location_city,
    o.location_country,
    o.status,
    o.priority,
    o.created_at,
    o.updated_at,
    o.published_at,
    COALESCE(counts.total, 0) AS application_count,
    COALESCE(counts.pending, 0) AS pending_count
  FROM public.opportunities o
  LEFT JOIN (
    SELECT
      opportunity_id,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'pending') AS pending
    FROM public.opportunity_applications
    GROUP BY opportunity_id
  ) counts ON counts.opportunity_id = o.id
  WHERE o.club_id = p_club_id
  ORDER BY o.created_at DESC;
END;
$$;

-- Update is_test_opportunity function (renamed from is_test_vacancy)
DROP FUNCTION IF EXISTS public.is_test_vacancy(UUID);

CREATE OR REPLACE FUNCTION public.is_test_opportunity(opportunity_club_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_test_account FROM public.profiles WHERE id = opportunity_club_id),
    FALSE
  );
$$;

-- ============================================================================
-- PHASE 11: UPDATE NOTIFICATION TRIGGER FUNCTION
-- ============================================================================

-- Update the notification trigger function to use new column names
CREATE OR REPLACE FUNCTION public.handle_opportunity_application_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opportunity_title TEXT;
  v_club_id UUID;
  v_applicant_name TEXT;
BEGIN
  -- Get opportunity details
  SELECT title, club_id INTO v_opportunity_title, v_club_id
  FROM public.opportunities
  WHERE id = NEW.opportunity_id;

  -- Get applicant name
  SELECT full_name INTO v_applicant_name
  FROM public.profiles
  WHERE id = NEW.applicant_id;

  -- Notify club of new application
  INSERT INTO public.profile_notifications (
    profile_id,
    type,
    title,
    body,
    data,
    priority
  ) VALUES (
    v_club_id,
    'application_received',
    'New Application',
    v_applicant_name || ' applied to ' || v_opportunity_title,
    jsonb_build_object(
      'opportunity_id', NEW.opportunity_id,
      'applicant_id', NEW.applicant_id,
      'application_id', NEW.id
    ),
    'normal'
  );

  RETURN NEW;
END;
$$;

-- Recreate the notification trigger if it existed
DROP TRIGGER IF EXISTS opportunity_applications_notify ON public.opportunity_applications;
CREATE TRIGGER opportunity_applications_notify
  AFTER INSERT ON public.opportunity_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_opportunity_application_notifications();

-- ============================================================================
-- PHASE 12: ADD HELPFUL COMMENTS
-- ============================================================================

COMMENT ON TABLE public.opportunities IS 'Job/trial opportunities posted by clubs for players or coaches';
COMMENT ON TABLE public.opportunity_applications IS 'Applications from players/coaches to opportunities';
COMMENT ON TABLE public.career_history IS 'Chronological career history entries for players and coaches';

COMMENT ON COLUMN public.opportunity_applications.applicant_id IS 'The profile ID of the player or coach applying';
COMMENT ON COLUMN public.opportunity_applications.opportunity_id IS 'The opportunity being applied to';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- After running this migration:
-- 1. Regenerate TypeScript types: supabase gen types typescript
-- 2. Update all frontend code to use new table/column names
-- 3. Test thoroughly before deploying to production
-- ============================================================================
