-- P3 18+ age gate — enum addition (own migration: ADD VALUE cannot be used
-- in the same transaction that adds it; same precedent as 20260701220000).
--
-- 'withdrawn': silent system withdrawal of a frozen minor's applications.
-- Hidden from every club-facing surface (publisher SELECT policy,
-- club_has_applicant, digest via status='pending', responsiveness metric via
-- new_status exclusion). Never produces a player/publisher notification (the
-- notify trigger's IN-list does not include it). Preserve, never delete.
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'withdrawn';
