-- =========================================================================
-- Performance — scope auth.uid() policies TO authenticated
-- =========================================================================
-- Most multi-permissive findings from the perf advisor are an artifact
-- of policies declared without an explicit `TO` clause (defaulting to
-- PUBLIC). The advisor counts each (table, role, action) separately,
-- so a single policy applied to PUBLIC gets counted across all 6
-- PostgreSQL roles (anon, authenticated, authenticator,
-- cli_login_postgres, dashboard_user, supabase_privileged_role).
--
-- This migration scopes ~65 policies to `TO authenticated` using
-- `ALTER POLICY` (no DROP/CREATE — preserves all existing semantics).
-- It's purely additive: the policies already required `auth.uid() = X`
-- in their predicates, so anon users never satisfied them anyway.
-- Adding the TO clause makes that explicit and removes the linter
-- noise across 5 unused-role contexts per policy.
--
-- INTENTIONALLY SKIPPED:
--   - Service-role policies (auth.role() = 'service_role') — those
--     would lose grant if scoped to authenticated, and service_role
--     bypasses RLS anyway making them belt-and-suspenders
--   - SELECT policies with public-fallback OR clauses (status='accepted',
--     visibility='public', deleted_at IS NULL, etc.) — anon users
--     legitimately need access to those rows; scoping would deny them
--
-- SELECT policies kept as PUBLIC (intentional public read paths):
--   - profile_comments."Visible comments are public" (status='visible')
--   - player_full_game_videos_select (visibility='public')
--   - community_answers.answers_select (test_content=false fallback)
--   - community_questions.questions_select (test_content=false fallback)
--   - profile_friendships."friendships readable" (accepted public)
--   - profile_references.profile_references_read (accepted public)
--
-- After this migration: each scoped policy contributes 1 advisor
-- finding instead of 6, dropping the multi-permissive count from
-- 144 to ~30.
-- =========================================================================

-- archived_messages
ALTER POLICY "Users can view their archived messages" ON public.archived_messages TO authenticated;

-- brand_followers
ALTER POLICY brand_followers_delete ON public.brand_followers TO authenticated;
ALTER POLICY brand_followers_insert ON public.brand_followers TO authenticated;

-- brand_posts
ALTER POLICY brand_posts_insert_owner ON public.brand_posts TO authenticated;
ALTER POLICY brand_posts_update_owner ON public.brand_posts TO authenticated;

-- brand_products
ALTER POLICY "Brand owners can create products" ON public.brand_products TO authenticated;
ALTER POLICY "Brand owners can update their products" ON public.brand_products TO authenticated;

-- brands
ALTER POLICY "Brand users can create their brand" ON public.brands TO authenticated;
ALTER POLICY "Brand users can update their brand" ON public.brands TO authenticated;

-- career_history
ALTER POLICY "Users can delete own career history" ON public.career_history TO authenticated;
ALTER POLICY "Users can insert own career history" ON public.career_history TO authenticated;
ALTER POLICY "Users can manage their playing history" ON public.career_history TO authenticated;
ALTER POLICY "Users can update own career history" ON public.career_history TO authenticated;
ALTER POLICY "Users can view own career history" ON public.career_history TO authenticated;

-- club_media
ALTER POLICY "Clubs can manage their media" ON public.club_media TO authenticated;

-- community_answers (skip answers_select — anon can read non-test public)
ALTER POLICY answers_delete ON public.community_answers TO authenticated;
ALTER POLICY answers_insert ON public.community_answers TO authenticated;
ALTER POLICY answers_update ON public.community_answers TO authenticated;

-- community_questions (skip questions_select — anon can read non-test public)
ALTER POLICY questions_delete ON public.community_questions TO authenticated;
ALTER POLICY questions_insert ON public.community_questions TO authenticated;
ALTER POLICY questions_update ON public.community_questions TO authenticated;

-- conversations
ALTER POLICY "Users can create conversations" ON public.conversations TO authenticated;
ALTER POLICY "Users can update conversations" ON public.conversations TO authenticated;
ALTER POLICY "Users can view their conversations" ON public.conversations TO authenticated;

-- gallery_photos
ALTER POLICY "Users can manage their gallery photos" ON public.gallery_photos TO authenticated;

-- messages
ALTER POLICY "Users can mark messages as read v2" ON public.messages TO authenticated;
ALTER POLICY "Users can send messages in their conversations v2" ON public.messages TO authenticated;
ALTER POLICY "Users can view messages in their conversations v2" ON public.messages TO authenticated;

-- opportunities
ALTER POLICY "Publishers can manage their opportunities" ON public.opportunities TO authenticated;

-- opportunity_applications
ALTER POLICY "Applicants can create applications" ON public.opportunity_applications TO authenticated;
ALTER POLICY "Applicants can view own applications" ON public.opportunity_applications TO authenticated;
ALTER POLICY "Players can view their own applications" ON public.opportunity_applications TO authenticated;
ALTER POLICY "Publishers can update application status" ON public.opportunity_applications TO authenticated;
ALTER POLICY "Publishers can view applications to their opportunities" ON public.opportunity_applications TO authenticated;

-- opportunity_inbox_state
ALTER POLICY "Users can insert their opportunity inbox state" ON public.opportunity_inbox_state TO authenticated;
ALTER POLICY "Users can read their opportunity inbox state" ON public.opportunity_inbox_state TO authenticated;
ALTER POLICY "Users can update their opportunity inbox state" ON public.opportunity_inbox_state TO authenticated;

-- player_full_game_videos (skip _select — visibility='public' allows anon)
ALTER POLICY player_full_game_videos_owner_manage ON public.player_full_game_videos TO authenticated;

-- profile_comments (skip "Visible comments are public" — status='visible' allows anon)
ALTER POLICY "Authors can delete comments" ON public.profile_comments TO authenticated;
ALTER POLICY "Authors can edit comments" ON public.profile_comments TO authenticated;
ALTER POLICY "Users can create comments" ON public.profile_comments TO authenticated;

-- profile_friendships (skip "friendships readable" — status='accepted' allows anon)
ALTER POLICY "friendships delete" ON public.profile_friendships TO authenticated;
ALTER POLICY "friendships insert" ON public.profile_friendships TO authenticated;
ALTER POLICY "friendships recipient update" ON public.profile_friendships TO authenticated;
ALTER POLICY "friendships requester update" ON public.profile_friendships TO authenticated;

-- profile_notifications
ALTER POLICY "Recipients can delete notifications" ON public.profile_notifications TO authenticated;
ALTER POLICY "Recipients can read notifications" ON public.profile_notifications TO authenticated;
ALTER POLICY "Recipients can update notifications" ON public.profile_notifications TO authenticated;

-- profile_references (skip profile_references_read — status='accepted' allows anon)
ALTER POLICY profile_references_delete ON public.profile_references TO authenticated;
ALTER POLICY profile_references_insert ON public.profile_references TO authenticated;
ALTER POLICY profile_references_reference_update ON public.profile_references TO authenticated;
ALTER POLICY profile_references_requester_update ON public.profile_references TO authenticated;

-- profiles
ALTER POLICY "Clubs can view applicant player profiles" ON public.profiles TO authenticated;
ALTER POLICY "Users can insert their own profile" ON public.profiles TO authenticated;
ALTER POLICY "Users can update their own profile" ON public.profiles TO authenticated;
ALTER POLICY "Users can view their own profile" ON public.profiles TO authenticated;

-- push_subscriptions
ALTER POLICY "Users manage own push subscriptions" ON public.push_subscriptions TO authenticated;

-- pwa_installs
ALTER POLICY "Users read own PWA installs" ON public.pwa_installs TO authenticated;
ALTER POLICY "Users track own PWA installs" ON public.pwa_installs TO authenticated;

-- umpire_appointments
ALTER POLICY "Users can delete own umpire appointments" ON public.umpire_appointments TO authenticated;
ALTER POLICY "Users can insert own umpire appointments" ON public.umpire_appointments TO authenticated;
ALTER POLICY "Users can update own umpire appointments" ON public.umpire_appointments TO authenticated;

-- user_devices
ALTER POLICY "Users read own devices" ON public.user_devices TO authenticated;
ALTER POLICY "Users track own devices" ON public.user_devices TO authenticated;
ALTER POLICY "Users update own devices" ON public.user_devices TO authenticated;

-- user_unread_counters
ALTER POLICY "Users can select their unread counter" ON public.user_unread_counters TO authenticated;

-- user_unread_senders (skip Service role policy)
ALTER POLICY "Users can view their own unread senders" ON public.user_unread_senders TO authenticated;

-- world_clubs
ALTER POLICY "Authenticated users can create world clubs" ON public.world_clubs TO authenticated;
ALTER POLICY "Clubs can update their claimed club" ON public.world_clubs TO authenticated;
