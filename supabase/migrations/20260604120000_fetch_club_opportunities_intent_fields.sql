-- ─────────────────────────────────────────────────────────────────────
-- fetch_club_opportunities_with_counts — return level_sought +
-- compensation + recruitment_problem (Increment #4a bug fix)
-- ─────────────────────────────────────────────────────────────────────
-- Same class as the 3a fix (20260603210000): the club opportunity list +
-- edit form load via this RPC, which didn't return the new #4a columns —
-- so editing an opportunity showed blank level/compensation/problem and
-- silently wiped them on the next save. The write persists correctly
-- (confirmed); only the read was missing the columns. Add them.
--
-- Adding columns to RETURNS TABLE changes the signature → DROP + recreate
-- (CREATE OR REPLACE can't change the return type) and re-grant.

DROP FUNCTION IF EXISTS public.fetch_club_opportunities_with_counts(uuid, boolean, integer);

CREATE OR REPLACE FUNCTION public.fetch_club_opportunities_with_counts(
  p_club_id uuid,
  p_include_closed boolean DEFAULT true,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  id uuid, club_id uuid, title text, opportunity_type opportunity_type,
  "position" opportunity_position, gender opportunity_gender, description text,
  location_city text, location_country text, start_date date, duration_text text,
  requirements text[], specialist_skills_wanted text[],
  level_sought text, compensation text, recruitment_problem text,
  benefits text[], custom_benefits text[],
  priority opportunity_priority, status opportunity_status, application_deadline date,
  contact_email text, contact_phone text, organization_name text,
  published_at timestamp with time zone, closed_at timestamp with time zone,
  version integer, created_at timestamp with time zone, updated_at timestamp with time zone,
  applicant_count bigint, pending_count bigint
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  effective_limit INTEGER := LEAST(COALESCE(p_limit, 50), 200);
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.club_id,
    o.title,
    o.opportunity_type,
    o."position",
    o.gender,
    o.description,
    o.location_city,
    o.location_country,
    o.start_date,
    o.duration_text,
    o.requirements,
    o.specialist_skills_wanted,
    o.level_sought,
    o.compensation,
    o.recruitment_problem,
    o.benefits,
    o.custom_benefits,
    o.priority,
    o.status,
    o.application_deadline,
    o.contact_email,
    o.contact_phone,
    o.organization_name,
    o.published_at,
    o.closed_at,
    o.version,
    o.created_at,
    o.updated_at,
    COALESCE(counts.total, 0) AS applicant_count,
    COALESCE(counts.pending, 0) AS pending_count
  FROM public.opportunities o
  LEFT JOIN (
    SELECT
      oa.opportunity_id,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE oa.status = 'pending') AS pending
    FROM public.opportunity_applications oa
    GROUP BY oa.opportunity_id
  ) counts ON counts.opportunity_id = o.id
  WHERE o.club_id = p_club_id
    AND (p_include_closed OR o.status <> 'closed')
  ORDER BY o.created_at DESC
  LIMIT effective_limit;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fetch_club_opportunities_with_counts(uuid, boolean, integer) TO authenticated;
