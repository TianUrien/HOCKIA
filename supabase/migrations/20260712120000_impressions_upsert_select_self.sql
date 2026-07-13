-- HIGH fix from Tian's prod QA (2026-07-12): the Pulse module-impression
-- upsert 403'd on EVERY Home load — staging and prod alike, silent
-- client-side by design — so the Phase-3.5/4 telemetry clock was not
-- actually recording.
--
-- Root cause (isolated by probe): plain INSERT passes the insert-self
-- policy (201), but the client writes via PostgREST ignore-duplicates
-- (INSERT ... ON CONFLICT DO NOTHING), and that path ALSO requires the
-- writer to be able to READ the row — the table deliberately had no user
-- SELECT policy ("write-only telemetry"), so every upsert was rejected
-- with "new row violates row-level security policy".
--
-- Fix: self-SELECT. The unique key (user_id, module_id, hour_bucket)
-- includes user_id, so any conflict row is by construction the caller's
-- own — reading it leaks nothing. Admin analytics read is unchanged.
CREATE POLICY home_module_impressions_select_self
  ON public.home_module_impressions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
