-- Rollback for 20261025150000_member_goals_and_gear_rail.sql (drops the goals: they are lost).
DROP FUNCTION IF EXISTS public.get_home_gear_rail(integer);
DROP FUNCTION IF EXISTS public.get_my_goal_actions();
DROP FUNCTION IF EXISTS public.country_family_by_name(text);
DROP FUNCTION IF EXISTS public.goal_later();
DROP FUNCTION IF EXISTS public.set_my_goal(text[], text);
DROP FUNCTION IF EXISTS public.get_my_goal();
DROP FUNCTION IF EXISTS public.goal_option_keys(text);
DROP TABLE IF EXISTS public.member_goals;
