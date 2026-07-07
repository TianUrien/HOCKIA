-- Fix: /community "Most complete profiles" broke on staging after the DOB
-- revoke (caught by the founder's QA pass — "Unable to load top members").
--
-- get_top_community_members was the ONE read RPC that ran SECURITY INVOKER;
-- its M3 age-gate predicate reads p.date_of_birth, and as invoker that
-- column read hits the revoked authenticated grant → 42501 for every
-- logged-in caller. Convert to SECURITY DEFINER, matching every other read
-- RPC (it already enforces its own onboarded/is_blocked/test-account/
-- uncontactable filters, so definer adds no exposure).
--
-- Self-splicing (fetch current def + insert SECURITY DEFINER) so the exact
-- deployed body is preserved rather than transcribed; idempotent via the
-- prosecdef check (staging received this change directly — this migration
-- is its ledger entry and prod's application).
DO $$
DECLARE
  v_def text;
  v_secdef boolean;
BEGIN
  SELECT pg_get_functiondef(p.oid), p.prosecdef
    INTO v_def, v_secdef
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_top_community_members';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'get_top_community_members not found';
  END IF;

  IF NOT v_secdef THEN
    EXECUTE replace(v_def, E'\n STABLE\n', E'\n STABLE SECURITY DEFINER\n');
  END IF;
END $$;
