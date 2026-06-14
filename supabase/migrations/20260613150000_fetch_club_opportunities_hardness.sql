-- ─────────────────────────────────────────────────────────────────────
-- fetch_club_opportunities_with_counts — return the Phase 3c hardness
-- flags (+ restore eu_passport_required) so editing preserves them
-- ─────────────────────────────────────────────────────────────────────
-- Same regression class as 20260603210000 and 20260604120000: the club
-- opportunity list + EDIT form both load via this RPC. CreateOpportunityModal
-- seeds each requirement toggle off the editing row, so any column the RPC
-- doesn't return reads as undefined → false → and the next save writes that
-- false back, silently wiping the flag.
--
-- Phase 3a added the six *_required hardness columns + the write side, but
-- NOT this read RPC — reopening the loop for the must-have toggles. This
-- adds them. It also restores eu_passport_required, which has been silently
-- dropped on edit by this same RPC since it was introduced (it sits in the
-- exact same buildInitialFormData seed block as the new flags).
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
  -- Requirement hardness — editable in CreateOpportunityModal, so the edit
  -- form must read them back or saving silently resets them.
  eu_passport_required boolean,
  position_required boolean, level_required boolean, compensation_required boolean,
  location_required boolean, availability_required boolean, specialists_required boolean,
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
    o.eu_passport_required,
    o.position_required,
    o.level_required,
    o.compensation_required,
    o.location_required,
    o.availability_required,
    o.specialists_required,
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
