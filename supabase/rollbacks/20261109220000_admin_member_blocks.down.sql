-- Rollback for 20261109220000_admin_member_blocks.sql: the function is new, so drop it.
DROP FUNCTION IF EXISTS public.admin_get_member_blocks(integer, integer);
