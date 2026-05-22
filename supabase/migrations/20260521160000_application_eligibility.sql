-- Application eligibility — server-side enforcement.
--
-- The Opportunities UI blocks ineligible users before they can submit an
-- application, but the client can be bypassed (stale UI, direct API call,
-- deep links). This BEFORE INSERT trigger on opportunity_applications is
-- the hard backstop: it RAISEs a user-facing message when an applicant
-- fails either eligibility rule.
--
--   Rule A — EU passport. Opportunities flagged eu_passport_required are
--     open only to applicants whose nationality is an EU member state
--     (either of their two nationality slots counts).
--   Rule B — gender / team category. A women's player opportunity
--     (gender Women/Girls) is closed to men; a men's one (Men/Boys) to
--     women. Mixed is open to all. Coach opportunities are never
--     gender-gated — a coach's own gender doesn't restrict the team they
--     can coach.
--
-- Missing profile data never blocks: if the applicant has not set their
-- nationality (Rule A) or gender (Rule B) we allow the insert. The UI
-- nudges them to complete their profile instead. This mirrors
-- client/src/lib/opportunityEligibility.ts — keep the two in sync.
--
-- Rejections RAISE with ERRCODE P0001; the client maps that code to a
-- plain toast and does NOT report it to Sentry (expected, not a fault).

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
  -- EU member state ISO 3166-1 alpha-2 codes. Mirrors EU_COUNTRY_CODES in
  -- client/src/hooks/useCountries.ts.
  v_eu_codes     text[] := ARRAY[
    'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE',
    'IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'
  ];
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
    SELECT count(*), count(*) FILTER (WHERE code = ANY (v_eu_codes))
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

DROP TRIGGER IF EXISTS check_application_eligibility ON public.opportunity_applications;
CREATE TRIGGER check_application_eligibility
  BEFORE INSERT ON public.opportunity_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.check_application_eligibility();
