-- Rollback for 20261125100000_mcp_connector_read_functions.sql: every object is new, so drop them.
-- rate_limits rows with action_type 'mcp_*' age out through cleanup_rate_limits.
-- The app_settings row 'mcp_connector_enabled', if one was added by hand, is removed too.
DROP FUNCTION IF EXISTS public.mcp_get_member_profile(uuid);
DROP FUNCTION IF EXISTS public.mcp_search_members(text, text, text, text, boolean, text, integer);
DROP FUNCTION IF EXISTS public.mcp_list_applicants(uuid, integer);
DROP FUNCTION IF EXISTS public.mcp_list_my_opportunities();
DROP FUNCTION IF EXISTS public.mcp_list_my_applications(integer);
DROP FUNCTION IF EXISTS public.mcp_get_opportunity(uuid);
DROP FUNCTION IF EXISTS public.mcp_search_opportunities(text, text, text, text, text, integer);
DROP FUNCTION IF EXISTS public.mcp_get_my_profile();
DROP FUNCTION IF EXISTS public.mcp_application_status_label(text, boolean);
DROP FUNCTION IF EXISTS public.mcp_guard(text, integer, integer);
DROP FUNCTION IF EXISTS public.mcp_connector_enabled();
DELETE FROM public.app_settings WHERE key = 'mcp_connector_enabled';
