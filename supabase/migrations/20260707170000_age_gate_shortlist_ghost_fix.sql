-- Age-gate adversarial-probe fix (category C: applicants list by opportunity id).
--
-- Probe found: freezing withdraws PENDING applications, but a frozen minor's
-- SHORTLISTED/MAYBE application row stayed visible to the publisher — with the
-- applicant profile hidden by RLS, the club saw a ghost row (an application
-- whose applicant cannot be resolved), which is itself a surface that reveals
-- something is off. Spec: "Shortlist entries pointing at frozen profiles are
-- hidden the same way."
--
-- Fix is POLICY-based, not data-based: hide every application whose applicant
-- is hidden (frozen OR admin-banned — the ban case is the same bundled repair
-- as M3). On unfreeze at 18 the shortlist entry reappears by itself; the
-- withdrawal of pending rows remains permanent, per founder decision.
DROP POLICY IF EXISTS "Publishers can view applications to their opportunities" ON public.opportunity_applications;
CREATE POLICY "Publishers can view applications to their opportunities" ON public.opportunity_applications
  FOR SELECT TO authenticated
  USING (
    status <> 'withdrawn'
    AND EXISTS (
      SELECT 1 FROM public.opportunities o
      WHERE o.id = opportunity_applications.opportunity_id
        AND o.club_id = (SELECT auth.uid())
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles ap
      WHERE ap.id = opportunity_applications.applicant_id
        AND NOT public.profile_is_hidden(ap.is_blocked, ap.frozen_minor_at)
    )
  );

-- Same class of gap, adjacent surface: expiry/rejection suggestion emails
-- must not point players at opportunities published by a hidden account
-- (e.g. a frozen coach-publisher). One predicate on the publisher row —
-- mirrors the deadline fence added by the hygiene release.
-- (Body identical to 20260707100000's version plus the publisher predicate.)
CREATE OR REPLACE FUNCTION public.similar_open_opportunities(
  p_applicant uuid,
  p_exclude uuid[] DEFAULT '{}',
  p_limit integer DEFAULT 3
)
RETURNS TABLE (
  opportunity_id uuid,
  title text,
  position_text text,
  opportunity_type text,
  gender text,
  location_city text,
  location_country text,
  publisher_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_gender text;
  v_position text;
  v_nat1 integer;
  v_nat2 integer;
  v_norm text;
  v_nat_count int;
  v_eu_count int;
  v_non_eu_only boolean;
  -- EU member state ISO codes — mirrors check_application_eligibility.
  v_eu_codes text[] := ARRAY[
    'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE',
    'IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'
  ];
BEGIN
  SELECT p.role::text, p.gender, p.position, p.nationality_country_id, p.nationality2_country_id
    INTO v_role, v_gender, v_position, v_nat1, v_nat2
  FROM profiles p WHERE p.id = p_applicant;
  IF v_role IS NULL THEN RETURN; END IF;

  v_norm := lower(trim(coalesce(v_gender, '')));
  SELECT count(*), count(*) FILTER (WHERE c.code = ANY (v_eu_codes))
    INTO v_nat_count, v_eu_count
  FROM countries c WHERE c.id = v_nat1 OR c.id = v_nat2;
  v_non_eu_only := (v_nat_count > 0 AND v_eu_count = 0);

  RETURN QUERY
  SELECT o.id, o.title, o.position::text, o.opportunity_type::text, o.gender::text,
         o.location_city, o.location_country, pub.full_name
  FROM opportunities o
  JOIN profiles pub ON pub.id = o.club_id
  WHERE o.status = 'open'
    -- Inventory hygiene: a past-deadline listing is dead even while the
    -- daily closer hasn't caught it yet — never suggest applying into a void.
    AND (o.application_deadline IS NULL OR o.application_deadline >= (timezone('utc', now()))::date)
    -- age-gate: never suggest a hidden publisher's opportunities
    AND NOT public.profile_is_hidden(pub.is_blocked, pub.frozen_minor_at)
    AND (pub.is_test_account = false OR public.is_staging_env())
    AND o.id <> ALL (coalesce(p_exclude, '{}'::uuid[]))
    AND NOT EXISTS (
      SELECT 1 FROM opportunity_applications a
      WHERE a.opportunity_id = o.id AND a.applicant_id = p_applicant
    )
    AND o.opportunity_type::text = CASE WHEN v_role = 'coach' THEN 'coach' ELSE 'player' END
    AND NOT (o.eu_passport_required IS TRUE AND v_non_eu_only)
    AND NOT (o.opportunity_type = 'player' AND o.gender IN ('Women', 'Girls')
             AND v_norm IN ('men', 'man', 'male'))
    AND NOT (o.opportunity_type = 'player' AND o.gender IN ('Men', 'Boys')
             AND v_norm IN ('women', 'woman', 'female'))
  ORDER BY
    (CASE WHEN v_position IS NOT NULL AND o.position::text = v_position THEN 1 ELSE 0 END) DESC,
    coalesce(o.published_at, o.created_at) DESC
  LIMIT greatest(1, least(p_limit, 5));
END;
$function$;
