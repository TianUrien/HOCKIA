-- Rollback for 20261123200000_admin_member_blockers.sql: the function is new, so drop it.
-- Audit rows already written (action 'view_member_blockers') are kept.
DROP FUNCTION IF EXISTS public.admin_get_member_blockers(uuid);
