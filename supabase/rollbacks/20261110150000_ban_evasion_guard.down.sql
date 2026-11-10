-- Rollback for 20261110150000_ban_evasion_guard.sql.
-- Removes the signup guard, the block→banned-email sync, the suspects read and
-- the banned_emails list (the list itself is lost; blocks on profiles stay).

DROP TRIGGER IF EXISTS trg_guard_banned_email_on_profile_insert ON public.profiles;
DROP TRIGGER IF EXISTS trg_sync_banned_email_on_block ON public.profiles;
DROP FUNCTION IF EXISTS public.guard_banned_email_on_profile_insert();
DROP FUNCTION IF EXISTS public.sync_banned_email_on_block();
DROP FUNCTION IF EXISTS public.admin_get_ban_evasion_suspects();
DROP TABLE IF EXISTS public.banned_emails;
DROP FUNCTION IF EXISTS public.normalize_email_for_ban(text);
