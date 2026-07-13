-- Phase-3 audit F3 — the feed card's inline match % must honor the
-- EU-passport hard gate the Pulse rail applies (a non-EU player seeing
-- "82% match" on an eu_passport_required role, then being refused on Apply,
-- is exactly the cross-surface trust break the eligibility work prevents).
-- Adds eu_passport_required to the opportunity_posted generator metadata so
-- the card can gate client-side. Old items lack the key → the card keeps
-- today's behavior (documented, ages out). Guarded self-splice; anchor is
-- the metadata text added by 20260713120000.
DO $$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'generate_opportunity_posted_feed_item';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'EU-METADATA: generator not found';
  END IF;
  IF position('eu_passport_required' in v_def) > 0 THEN
    RETURN; -- already patched
  END IF;
  v_new := replace(v_def,
    $o$'position_required', NEW.position_required$o$,
    $o$'position_required', NEW.position_required,
        'eu_passport_required', NEW.eu_passport_required$o$);
  IF v_new = v_def THEN
    RAISE EXCEPTION 'EU-METADATA: splice anchor not found (is 20260713120000 applied?)';
  END IF;
  EXECUTE v_new;
END $$;
