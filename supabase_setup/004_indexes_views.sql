-- 004_rls_policies.sql
-- Row Level Security configuration for HOCKIA Supabase project
-- Run via: supabase db execute --file supabase_setup/004_indexes_views.sql

SET search_path = public;

-- ============================================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gallery_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playing_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vacancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vacancy_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PROFILES POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Public can view onboarded profiles" ON public.profiles;
CREATE POLICY "Public can view onboarded profiles"
  ON public.profiles
  FOR SELECT
  USING (onboarding_completed = TRUE);

DROP POLICY IF EXISTS "Clubs can view applicant player profiles" ON public.profiles;
CREATE POLICY "Clubs can view applicant player profiles"
  ON public.profiles
  FOR SELECT
  USING (
    role = 'player'
    AND public.club_has_applicant(auth.uid(), id)
  );

-- ============================================================================
-- GALLERY_PHOTOS POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "Public can view all gallery photos" ON public.gallery_photos;
CREATE POLICY "Public can view all gallery photos"
  ON public.gallery_photos
  FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS "Users can manage their gallery photos" ON public.gallery_photos;
CREATE POLICY "Users can manage their gallery photos"
  ON public.gallery_photos
  FOR ALL
  USING (
    auth.uid() = user_id
    AND coalesce(public.current_profile_role(), '') IN ('player', 'coach')
  )
  WITH CHECK (
    auth.uid() = user_id
    AND coalesce(public.current_profile_role(), '') IN ('player', 'coach')
  );

-- ============================================================================
-- CLUB_MEDIA POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "Public can view club media" ON public.club_media;
CREATE POLICY "Public can view club media"
  ON public.club_media
  FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS "Clubs can manage their media" ON public.club_media;
CREATE POLICY "Clubs can manage their media"
  ON public.club_media
  FOR ALL
  USING (
    auth.uid() = club_id
    AND coalesce(public.current_profile_role(), '') = 'club'
  )
  WITH CHECK (
    auth.uid() = club_id
    AND coalesce(public.current_profile_role(), '') = 'club'
  );

-- ============================================================================
-- PLAYING_HISTORY POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "Public can view all playing history" ON public.playing_history;
CREATE POLICY "Public can view all playing history"
  ON public.playing_history
  FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS "Users can manage their playing history" ON public.playing_history;
CREATE POLICY "Users can manage their playing history"
  ON public.playing_history
  FOR ALL
  USING (
    auth.uid() = user_id
    AND coalesce(public.current_profile_role(), '') IN ('player', 'coach')
  )
  WITH CHECK (
    auth.uid() = user_id
    AND coalesce(public.current_profile_role(), '') IN ('player', 'coach')
  );

-- =========================================================================
-- PROFILE_COMMENTS POLICIES
-- =========================================================================
DROP POLICY IF EXISTS "Visible comments are public" ON public.profile_comments;
CREATE POLICY "Visible comments are public"
  ON public.profile_comments
  FOR SELECT
  USING (
    status = 'visible'
    OR profile_id = auth.uid()
    OR author_profile_id = auth.uid()
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS "Users can create comments" ON public.profile_comments;
CREATE POLICY "Users can create comments"
  ON public.profile_comments
  FOR INSERT
  WITH CHECK (
    auth.uid() = author_profile_id
    AND author_profile_id <> profile_id
  );

DROP POLICY IF EXISTS "Authors can edit comments" ON public.profile_comments;
CREATE POLICY "Authors can edit comments"
  ON public.profile_comments
  FOR UPDATE
  USING (auth.uid() = author_profile_id)
  WITH CHECK (auth.uid() = author_profile_id);

DROP POLICY IF EXISTS "Admins can manage comments" ON public.profile_comments;
CREATE POLICY "Admins can manage comments"
  ON public.profile_comments
  FOR ALL
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- ============================================================================
-- VACANCIES POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "Public can view open vacancies" ON public.vacancies;
CREATE POLICY "Public can view open vacancies"
  ON public.vacancies
  FOR SELECT
  USING (status = 'open');

DROP POLICY IF EXISTS "Clubs can manage their vacancies" ON public.vacancies;
CREATE POLICY "Clubs can manage their vacancies"
  ON public.vacancies
  FOR ALL
  USING (
    auth.uid() = club_id
    AND coalesce(public.current_profile_role(), '') = 'club'
  )
  WITH CHECK (
    auth.uid() = club_id
    AND coalesce(public.current_profile_role(), '') = 'club'
  );

-- ============================================================================
-- VACANCY_APPLICATIONS POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "Players can view their own applications" ON public.vacancy_applications;
CREATE POLICY "Players can view their own applications"
  ON public.vacancy_applications
  FOR SELECT
  USING (auth.uid() = player_id);

DROP POLICY IF EXISTS "Clubs can view applications to their vacancies" ON public.vacancy_applications;
CREATE POLICY "Clubs can view applications to their vacancies"
  ON public.vacancy_applications
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.vacancies v
      WHERE v.id = public.vacancy_applications.vacancy_id
        AND v.club_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Applicants can create applications" ON public.vacancy_applications;
CREATE POLICY "Applicants can create applications"
  ON public.vacancy_applications
  FOR INSERT
  WITH CHECK (
    auth.uid() = player_id
    AND coalesce(public.current_profile_role(), '') IN ('player', 'coach')
  );

DROP POLICY IF EXISTS "Clubs can update application status" ON public.vacancy_applications;
CREATE POLICY "Clubs can update application status"
  ON public.vacancy_applications
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.vacancies v
      WHERE v.id = public.vacancy_applications.vacancy_id
        AND v.club_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.vacancies v
      WHERE v.id = public.vacancy_applications.vacancy_id
        AND v.club_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Applicants can withdraw applications" ON public.vacancy_applications;
CREATE POLICY "Applicants can withdraw applications"
  ON public.vacancy_applications
  FOR UPDATE
  USING (auth.uid() = player_id)
  WITH CHECK (
    auth.uid() = player_id
    AND status = 'withdrawn'
  );

-- ============================================================================
-- CONVERSATIONS POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "Users can view their conversations" ON public.conversations;
CREATE POLICY "Users can view their conversations"
  ON public.conversations
  FOR SELECT
  USING (
    participant_one_id = auth.uid()
    OR participant_two_id = auth.uid()
  );

DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
CREATE POLICY "Users can create conversations"
  ON public.conversations
  FOR INSERT
  WITH CHECK (
    participant_one_id = auth.uid()
    OR participant_two_id = auth.uid()
  );

-- Prevent direct updates from non participants
DROP POLICY IF EXISTS "Users can update conversations" ON public.conversations;
CREATE POLICY "Users can update conversations"
  ON public.conversations
  FOR UPDATE
  USING (
    participant_one_id = auth.uid()
    OR participant_two_id = auth.uid()
  );

-- ============================================================================
-- MESSAGES POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON public.messages;
DROP POLICY IF EXISTS "Users can view messages in their conversations v2" ON public.messages;
CREATE POLICY "Users can view messages in their conversations v2"
  ON public.messages
  FOR SELECT
  USING (public.user_in_conversation(conversation_id, auth.uid()));

DROP POLICY IF EXISTS "Users can send messages in their conversations" ON public.messages;
DROP POLICY IF EXISTS "Users can send messages in their conversations v2" ON public.messages;
CREATE POLICY "Users can send messages in their conversations v2"
  ON public.messages
  FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND public.user_in_conversation(conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users can mark messages as read" ON public.messages;
DROP POLICY IF EXISTS "Users can mark messages as read v2" ON public.messages;
CREATE POLICY "Users can mark messages as read v2"
  ON public.messages
  FOR UPDATE
  USING (
    public.user_in_conversation(conversation_id, auth.uid())
    AND sender_id <> auth.uid()
  )
  WITH CHECK (
    public.user_in_conversation(conversation_id, auth.uid())
    AND sender_id <> auth.uid()
  );
