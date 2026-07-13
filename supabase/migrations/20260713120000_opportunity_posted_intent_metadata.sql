-- Home V2 Phase 3 (§2.6) — extend the opportunity_posted generator's metadata
-- with level_sought + position_required so the feed card's inline match %
-- can score the level component and honor the position must-have. OLD items
-- keep their smaller metadata: the client scorer skips unknown components
-- (honest absence), so their % is computed from position+category only —
-- correct, just less precise. Guarded self-splice (house pattern).
DO $$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'generate_opportunity_posted_feed_item';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'INTENT-METADATA: generator not found';
  END IF;
  IF position('level_sought' in v_def) > 0 THEN
    RETURN; -- already patched
  END IF;
  v_new := replace(v_def,
    $o$'start_date', NEW.start_date$o$,
    $o$'start_date', NEW.start_date,
        'level_sought', NEW.level_sought,
        'position_required', NEW.position_required$o$);
  IF v_new = v_def THEN
    RAISE EXCEPTION 'INTENT-METADATA: splice anchor not found';
  END IF;
  EXECUTE v_new;
END $$;
