-- ROLLBACK for 20261004300000_new_conversation_limits.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20261004300000 --linked
--
-- Drops the two triggers, the new functions and the four tables. The migration
-- changed no existing function, trigger, policy or grant, so nothing else is
-- restored. After this, new conversations are unlimited again (the message
-- burst limit of 202602210200 is untouched either way).
--
-- What is lost: the start log, the admin signals and the list of removed
-- accounts with who was notified. Safety notices already delivered stay in
-- profile_notifications. If only the limit must be lifted, drop just the
-- trigger conversations_new_conversation_limit and keep the rest.
--
-- Clients: a client that calls is_removed_account or
-- log_new_conversation_refusal treats a missing function as "no" / ignores
-- it; the admin page shows its load error.

DROP TRIGGER IF EXISTS conversations_new_conversation_limit ON public.conversations;
DROP TRIGGER IF EXISTS messages_track_first_message ON public.messages;

DROP FUNCTION IF EXISTS public.is_removed_account(uuid);
DROP FUNCTION IF EXISTS public.admin_send_removed_account_notice(uuid);
DROP FUNCTION IF EXISTS public.admin_get_spam_signals(integer, integer, integer);
DROP FUNCTION IF EXISTS public._track_first_message();
DROP FUNCTION IF EXISTS public._normalise_first_message(text);
DROP FUNCTION IF EXISTS public.log_new_conversation_refusal();
DROP FUNCTION IF EXISTS public._enforce_new_conversation_limit();
DROP FUNCTION IF EXISTS public._new_conversation_daily_limit(uuid);

DROP TABLE IF EXISTS public.removed_account_notice_recipients;
DROP TABLE IF EXISTS public.removed_account_notices;
DROP TABLE IF EXISTS public.spam_signals;
DROP TABLE IF EXISTS public.new_conversation_log;

NOTIFY pgrst, 'reload schema';
