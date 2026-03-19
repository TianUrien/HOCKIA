-- 002_functions_and_triggers.sql
-- Helper functions, triggers, and grants for HOCKIA Supabase project
-- Run via: supabase db execute --file supabase_setup/002_functions_and_triggers.sql

SET search_path = public;

-- ============================================================================
-- GENERIC UPDATED_AT HANDLER
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VACANCY STATUS TIMESTAMPS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_vacancy_status_timestamps()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'open' AND (OLD.status IS DISTINCT FROM 'open') AND NEW.published_at IS NULL THEN
    NEW.published_at = timezone('utc', now());
  END IF;

  IF NEW.status = 'closed' AND (OLD.status IS DISTINCT FROM 'closed') AND NEW.closed_at IS NULL THEN
    NEW.closed_at = timezone('utc', now());
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- CONVERSATION TIMESTAMP MAINTENANCE
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.conversations
  SET
    last_message_at = NEW.sent_at,
    updated_at = timezone('utc', now())
  WHERE id = NEW.conversation_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- OPTIMISTIC LOCKING
-- ============================================================================
CREATE OR REPLACE FUNCTION public.increment_version()
RETURNS TRIGGER AS $$
BEGIN
  NEW.version = OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- CONVERSATION NORMALIZATION
-- ============================================================================
CREATE OR REPLACE FUNCTION public.normalize_conversation_participants()
RETURNS TRIGGER AS $$
DECLARE
  tmp UUID;
BEGIN
  IF NEW.participant_one_id > NEW.participant_two_id THEN
    tmp := NEW.participant_one_id;
    NEW.participant_one_id := NEW.participant_two_id;
    NEW.participant_two_id := tmp;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PROFILE UPDATE SAFETY
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_concurrent_profile_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.avatar_url IS DISTINCT FROM OLD.avatar_url THEN
    PERFORM pg_sleep(0.05);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ADVISORY LOCK HELPERS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.acquire_profile_lock(profile_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN pg_try_advisory_lock(hashtext(profile_id::TEXT));
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.release_profile_lock(profile_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN pg_advisory_unlock(hashtext(profile_id::TEXT));
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- USER CONVERSATION GUARD (USED BY RLS)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.user_in_conversation(
  p_conversation_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND (c.participant_one_id = p_user_id OR c.participant_two_id = p_user_id)
  );
$$;

-- ============================================================================
-- CURRENT PROFILE ROLE LOOKUP
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_profile_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.profiles
  WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION public.current_profile_role IS 'Returns the canonical role from profiles for the current auth.uid().';
GRANT EXECUTE ON FUNCTION public.current_profile_role() TO authenticated, service_role;

-- ============================================================================
-- PROFILE CREATION & COMPLETION (RPC)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_profile_for_new_user(
  user_id UUID,
  user_email TEXT,
  user_role TEXT DEFAULT 'player'
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requester_role TEXT := auth.role();
  requester_id UUID := auth.uid();
  new_profile public.profiles;
BEGIN
  IF requester_role <> 'service_role' THEN
    IF requester_id IS NULL THEN
      RAISE EXCEPTION 'create_profile_for_new_user requires authentication' USING ERRCODE = '42501';
    END IF;

    IF requester_id <> user_id THEN
      RAISE EXCEPTION 'Cannot create or update profile % as user %', user_id, requester_id USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.profiles (
    id,
    email,
    role,
    full_name,
    base_location,
    nationality,
    username,
    onboarding_completed
  )
  VALUES (
    user_id,
    user_email,
    user_role,
    NULL,
    NULL,
    NULL,
    NULL,
    FALSE
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      role = EXCLUDED.role,
      updated_at = timezone('utc', now())
  RETURNING * INTO new_profile;

  RETURN new_profile;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_profile_for_new_user(UUID, TEXT, TEXT) TO authenticated, service_role;
COMMENT ON FUNCTION public.create_profile_for_new_user IS 'Idempotent helper to ensure a profile row exists after auth signup.';

CREATE OR REPLACE FUNCTION public.complete_user_profile(
  p_user_id UUID,
  p_full_name TEXT,
  p_base_location TEXT,
  p_nationality TEXT,
  p_role TEXT,
  p_position TEXT DEFAULT NULL,
  p_secondary_position TEXT DEFAULT NULL,
  p_gender TEXT DEFAULT NULL,
  p_date_of_birth DATE DEFAULT NULL,
  p_current_club TEXT DEFAULT NULL,
  p_club_history TEXT DEFAULT NULL,
  p_highlight_video_url TEXT DEFAULT NULL,
  p_bio TEXT DEFAULT NULL,
  p_club_bio TEXT DEFAULT NULL,
  p_league_division TEXT DEFAULT NULL,
  p_website TEXT DEFAULT NULL,
  p_contact_email TEXT DEFAULT NULL,
  p_contact_email_public BOOLEAN DEFAULT NULL,
  p_year_founded INTEGER DEFAULT NULL,
  p_passport_1 TEXT DEFAULT NULL,
  p_passport_2 TEXT DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requester_role TEXT := auth.role();
  requester_id UUID := auth.uid();
  updated_profile public.profiles;
BEGIN
  IF requester_role <> 'service_role' THEN
    IF requester_id IS NULL THEN
      RAISE EXCEPTION 'complete_user_profile requires authentication' USING ERRCODE = '42501';
    END IF;

    IF requester_id <> p_user_id THEN
      RAISE EXCEPTION 'Cannot complete profile % as user %', p_user_id, requester_id USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.profiles
  SET
    role = COALESCE(p_role, role),
    full_name = p_full_name,
    base_location = p_base_location,
    nationality = p_nationality,
    position = COALESCE(p_position, position),
    secondary_position = COALESCE(p_secondary_position, secondary_position),
    gender = COALESCE(p_gender, gender),
    date_of_birth = COALESCE(p_date_of_birth, date_of_birth),
    current_club = COALESCE(p_current_club, current_club),
    club_history = COALESCE(p_club_history, club_history),
    highlight_video_url = COALESCE(p_highlight_video_url, highlight_video_url),
    bio = COALESCE(p_bio, bio),
    club_bio = COALESCE(p_club_bio, club_bio),
    league_division = COALESCE(p_league_division, league_division),
    website = COALESCE(p_website, website),
    contact_email = COALESCE(p_contact_email, contact_email),
    contact_email_public = COALESCE(p_contact_email_public, contact_email_public),
    year_founded = COALESCE(p_year_founded, year_founded),
    passport_1 = COALESCE(p_passport_1, passport_1),
    passport_2 = COALESCE(p_passport_2, passport_2),
    onboarding_completed = TRUE,
    updated_at = timezone('utc', now())
  WHERE id = p_user_id
  RETURNING * INTO updated_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found for user %', p_user_id;
  END IF;

  RETURN updated_profile;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_user_profile TO authenticated;
COMMENT ON FUNCTION public.complete_user_profile IS 'Atomic profile completion helper used by onboarding flow.';

-- ============================================================================
-- ZOMBIE ACCOUNT TOOLING (ADMIN ONLY)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.find_zombie_accounts()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  email_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  intended_role TEXT,
  profile_exists BOOLEAN,
  profile_complete BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    au.id,
    au.email::TEXT,
    au.email_confirmed_at,
    au.created_at,
    (au.raw_user_meta_data->>'role')::TEXT,
    (p.id IS NOT NULL),
    (p.full_name IS NOT NULL)
  FROM auth.users au
  LEFT JOIN public.profiles p ON p.id = au.id
  WHERE au.email_confirmed_at IS NOT NULL
    AND (p.id IS NULL OR p.full_name IS NULL)
  ORDER BY au.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_zombie_accounts TO service_role;
COMMENT ON FUNCTION public.find_zombie_accounts IS 'Audit helper to find verified users missing profile records.';

CREATE OR REPLACE FUNCTION public.recover_zombie_accounts()
RETURNS TABLE (
  user_id UUID,
  action_taken TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  zombie RECORD;
BEGIN
  FOR zombie IN
    SELECT
      au.id,
      au.email,
      COALESCE((au.raw_user_meta_data->>'role')::TEXT, 'player') AS role
    FROM auth.users au
    LEFT JOIN public.profiles p ON p.id = au.id
    WHERE au.email_confirmed_at IS NOT NULL
      AND p.id IS NULL
  LOOP
    BEGIN
      PERFORM public.create_profile_for_new_user(zombie.id, zombie.email, zombie.role);
      user_id := zombie.id;
      action_taken := 'Profile created';
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      user_id := zombie.id;
      action_taken := 'ERROR: ' || SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recover_zombie_accounts TO service_role;
COMMENT ON FUNCTION public.recover_zombie_accounts IS 'Bulk recovery helper that backfills missing profile rows.';

-- ============================================================================
-- CONVERSATION FETCH OPTIMIZATION (RPC)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_user_conversations(
  p_user_id UUID,
  p_limit INT DEFAULT 50
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
  conversation_last_message_at TIMESTAMPTZ
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
    RAISE EXCEPTION 'get_user_conversations access denied for %', p_user_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH user_conversations AS (
    SELECT
      c.id AS conv_id,
      CASE WHEN c.participant_one_id = p_user_id THEN c.participant_two_id ELSE c.participant_one_id END AS other_user_id,
      c.created_at,
      c.updated_at,
      c.last_message_at
    FROM public.conversations c
    WHERE c.participant_one_id = p_user_id OR c.participant_two_id = p_user_id
    ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
    LIMIT p_limit
  ),
  last_messages AS (
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id,
      m.content,
      m.sent_at,
      m.sender_id
    FROM public.messages m
    INNER JOIN user_conversations uc ON uc.conv_id = m.conversation_id
    ORDER BY m.conversation_id, m.sent_at DESC
  ),
  unread_counts AS (
    SELECT
      m.conversation_id,
      COUNT(*) AS unread_count
    FROM public.messages m
    INNER JOIN user_conversations uc ON uc.conv_id = m.conversation_id
    WHERE m.sender_id != p_user_id
      AND m.read_at IS NULL
    GROUP BY m.conversation_id
  )
  SELECT
    uc.conv_id,
    uc.other_user_id,
    p.full_name,
    p.username,
    p.avatar_url,
    p.role::TEXT,
    lm.content,
    lm.sent_at,
    lm.sender_id,
    COALESCE(ur.unread_count, 0),
    uc.created_at,
    uc.updated_at,
    uc.last_message_at
  FROM user_conversations uc
  LEFT JOIN public.profiles p ON p.id = uc.other_user_id
  LEFT JOIN last_messages lm ON lm.conversation_id = uc.conv_id
  LEFT JOIN unread_counts ur ON ur.conversation_id = uc.conv_id
  ORDER BY uc.last_message_at DESC NULLS LAST, uc.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_conversations TO authenticated;
COMMENT ON FUNCTION public.get_user_conversations IS 'Returns enriched conversation list with profile + unread metadata.';

-- ============================================================================
-- TRIGGERS
-- ============================================================================
-- Profiles triggers
DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS profiles_version_trigger ON public.profiles;
CREATE TRIGGER profiles_version_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_version();

DROP TRIGGER IF EXISTS check_profile_concurrent_update ON public.profiles;
CREATE TRIGGER check_profile_concurrent_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (NEW.avatar_url IS DISTINCT FROM OLD.avatar_url)
  EXECUTE FUNCTION public.check_concurrent_profile_update();

-- Vacancies triggers
DROP TRIGGER IF EXISTS set_vacancies_updated_at ON public.vacancies;
CREATE TRIGGER set_vacancies_updated_at
  BEFORE UPDATE ON public.vacancies
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_vacancy_timestamps ON public.vacancies;
CREATE TRIGGER set_vacancy_timestamps
  BEFORE UPDATE ON public.vacancies
  FOR EACH ROW
  EXECUTE FUNCTION public.set_vacancy_status_timestamps();

DROP TRIGGER IF EXISTS vacancies_version_trigger ON public.vacancies;
CREATE TRIGGER vacancies_version_trigger
  BEFORE UPDATE ON public.vacancies
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_version();

-- Vacancy applications trigger
DROP TRIGGER IF EXISTS set_vacancy_applications_updated_at ON public.vacancy_applications;
CREATE TRIGGER set_vacancy_applications_updated_at
  BEFORE UPDATE ON public.vacancy_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Playing history trigger
DROP TRIGGER IF EXISTS set_playing_history_updated_at ON public.playing_history;
CREATE TRIGGER set_playing_history_updated_at
  BEFORE UPDATE ON public.playing_history
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Club media trigger
DROP TRIGGER IF EXISTS set_club_media_updated_at ON public.club_media;
CREATE TRIGGER set_club_media_updated_at
  BEFORE UPDATE ON public.club_media
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Conversations triggers
DROP TRIGGER IF EXISTS set_conversations_updated_at ON public.conversations;
CREATE TRIGGER set_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS normalize_conversation_before_insert ON public.conversations;
CREATE TRIGGER normalize_conversation_before_insert
  BEFORE INSERT ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_conversation_participants();

DROP TRIGGER IF EXISTS conversations_version_trigger ON public.conversations;
CREATE TRIGGER conversations_version_trigger
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_version();

-- Messages trigger
DROP TRIGGER IF EXISTS update_conversation_on_new_message ON public.messages;
CREATE TRIGGER update_conversation_on_new_message
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_conversation_timestamp();

-- Messages idempotency indexes are in 004_indexes_views.sql
