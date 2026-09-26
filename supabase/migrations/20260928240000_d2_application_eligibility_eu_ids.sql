-- =========================================================================
-- D2 · 30-second profile — slice 1 · one EU list for application eligibility
-- =========================================================================
-- check_application_eligibility carried its own copy of the 27 EU member
-- state codes. It now reads public.eu_country_ids() — the list the key facts
-- (profile_has_eu_passport), discover_profiles and community_search_members use —
-- so "EU yes/no" on a profile and the application gate can never disagree.
--
-- Behaviour is identical: eu_country_ids() returns the ids of exactly the same
-- 27 codes, and the rule is unchanged (block only when the applicant HAS a
-- nationality on file and none is EU; no nationality → allowed). Permits are
-- shown, not enforced (founder ruling 2026-09-26): they play no part here.
--
-- Body = the production definition (md5 141dab792ce6f5688982ca2b39890ea4;
-- staging differs only in comments) with the EU lookup swapped.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.check_application_eligibility()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_eu_required  boolean;
  v_opp_type     opportunity_type;
  v_opp_gender   opportunity_gender;
  v_nat1         integer;
  v_nat2         integer;
  v_user_gender  text;
  v_norm_gender  text;
  v_nat_count    int;
  v_eu_count     int;
  -- EU member states: public.eu_country_ids() (mirrors EU_COUNTRY_CODES in
  -- client/src/hooks/useCountries.ts).
  v_eu_ids       int[] := public.eu_country_ids();
BEGIN
  SELECT eu_passport_required, opportunity_type, gender
    INTO v_eu_required, v_opp_type, v_opp_gender
  FROM opportunities
  WHERE id = NEW.opportunity_id;

  -- Opportunity missing — let the FK constraint surface that, not us.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT nationality_country_id, nationality2_country_id, gender
    INTO v_nat1, v_nat2, v_user_gender
  FROM profiles
  WHERE id = NEW.applicant_id;

  -- ── Rule A — EU passport ──
  IF v_eu_required IS TRUE THEN
    SELECT count(*), count(*) FILTER (WHERE id = ANY (v_eu_ids))
      INTO v_nat_count, v_eu_count
    FROM countries
    WHERE id = v_nat1 OR id = v_nat2;

    -- Block only when the applicant HAS a nationality and none is EU.
    -- No nationality on file → allowed (the UI nudges them instead).
    IF v_nat_count > 0 AND v_eu_count = 0 THEN
      RAISE EXCEPTION 'This opportunity requires an EU passport.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ── Rule B — gender / team category (player opportunities only) ──
  IF v_opp_type = 'player'
     AND v_opp_gender IS NOT NULL
     AND v_opp_gender <> 'Mixed' THEN
    v_norm_gender := lower(trim(coalesce(v_user_gender, '')));

    -- Empty gender → allowed (missing data never blocks).
    IF v_norm_gender <> '' THEN
      IF v_opp_gender IN ('Women', 'Girls')
         AND v_norm_gender IN ('men', 'man', 'male') THEN
        RAISE EXCEPTION 'This opportunity is for women''s teams.'
          USING ERRCODE = 'P0001';
      END IF;

      IF v_opp_gender IN ('Men', 'Boys')
         AND v_norm_gender IN ('women', 'woman', 'female') THEN
        RAISE EXCEPTION 'This opportunity is for men''s teams.'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
