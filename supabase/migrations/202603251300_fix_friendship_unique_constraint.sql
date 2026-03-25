-- Fix: Add explicit UNIQUE CONSTRAINT on generated columns.
-- PostgREST uses ON CONFLICT internally for tables with GENERATED columns + RLS.
-- PostgreSQL requires a UNIQUE CONSTRAINT (not just a UNIQUE INDEX) for ON CONFLICT.
-- The existing unique index alone was insufficient.

ALTER TABLE public.profile_friendships
  ADD CONSTRAINT profile_friendships_pair_unique
  UNIQUE (pair_key_lower, pair_key_upper);
