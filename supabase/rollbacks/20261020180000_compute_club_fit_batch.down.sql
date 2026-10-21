-- Rollback: remove the batch wrapper. compute_club_fit itself is untouched
-- by 20261020180000; clients on the previous bundle keep calling it per row.

DROP FUNCTION IF EXISTS public.compute_club_fit_batch(uuid, uuid[], text, text, uuid);
