-- Application clarity (Phases 3-5) — data foundation.
-- Adds: (A) a full status-change history per application, (B) club "viewed your
-- application" tracking. Both feed the player-facing timeline + the AI feedback.
-- Additive only — does NOT touch opportunity_applications or its existing
-- notification trigger. Statuses: pending | shortlisted | maybe | rejected.

-- ── A. Status history ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.application_status_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.opportunity_applications(id) ON DELETE CASCADE,
  old_status     public.application_status,
  new_status     public.application_status NOT NULL,
  reason         text,        -- Phase 4: optional club reason code (e.g. 'position_filled')
  changed_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,  -- the club
  created_at     timestamptz NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_ash_application
  ON public.application_status_history (application_id, created_at);

ALTER TABLE public.application_status_history ENABLE ROW LEVEL SECURITY;

-- The applicant reads their OWN application's history; the club that owns the
-- opportunity reads it too. Writes happen only via the SECURITY DEFINER trigger.
DROP POLICY IF EXISTS "read own application status history" ON public.application_status_history;
CREATE POLICY "read own application status history"
  ON public.application_status_history FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.opportunity_applications oa
      JOIN public.opportunities o ON o.id = oa.opportunity_id
      WHERE oa.id = application_status_history.application_id
        AND ((SELECT auth.uid()) IN (oa.applicant_id, o.club_id))
    )
  );

-- Record a row on every status change (incl. the reason carried in
-- opportunity_applications.metadata.status_reason, set by Phase 2/4).
CREATE OR REPLACE FUNCTION public.record_application_status_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id uuid;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT o.club_id INTO v_club_id
    FROM public.opportunities o WHERE o.id = NEW.opportunity_id;

    INSERT INTO public.application_status_history
      (application_id, old_status, new_status, reason, changed_by)
    VALUES
      (NEW.id, OLD.status, NEW.status, NEW.metadata->>'status_reason', v_club_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_application_status_history ON public.opportunity_applications;
CREATE TRIGGER trg_record_application_status_history
  AFTER UPDATE OF status ON public.opportunity_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.record_application_status_history();

-- Seed the FIRST history row for existing applications so the timeline isn't
-- empty for them (a single "current status" entry, attributed to the club).
INSERT INTO public.application_status_history (application_id, old_status, new_status, reason, changed_by, created_at)
SELECT oa.id, NULL, oa.status, oa.metadata->>'status_reason', o.club_id, oa.updated_at
FROM public.opportunity_applications oa
JOIN public.opportunities o ON o.id = oa.opportunity_id
WHERE oa.status <> 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM public.application_status_history h WHERE h.application_id = oa.id
  );

-- ── B. "Club viewed your application" ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.application_views (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES public.opportunity_applications(id) ON DELETE CASCADE,
  viewer_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,  -- the club
  first_viewed_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  last_viewed_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
  view_count      integer NOT NULL DEFAULT 1,
  UNIQUE (application_id, viewer_id)
);
CREATE INDEX IF NOT EXISTS idx_application_views_application
  ON public.application_views (application_id);

ALTER TABLE public.application_views ENABLE ROW LEVEL SECURITY;

-- Applicant reads who viewed their own application; the club (viewer) can record
-- + read its own views.
DROP POLICY IF EXISTS "applicant reads views of own application" ON public.application_views;
CREATE POLICY "applicant reads views of own application"
  ON public.application_views FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) = viewer_id
    OR EXISTS (
      SELECT 1 FROM public.opportunity_applications oa
      WHERE oa.id = application_views.application_id AND oa.applicant_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "club records its own application views" ON public.application_views;
CREATE POLICY "club records its own application views"
  ON public.application_views FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = viewer_id);

DROP POLICY IF EXISTS "club updates its own application views" ON public.application_views;
CREATE POLICY "club updates its own application views"
  ON public.application_views FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = viewer_id)
  WITH CHECK ((SELECT auth.uid()) = viewer_id);

-- Idempotent upsert helper the club UI calls when it opens an applicant.
CREATE OR REPLACE FUNCTION public.record_application_view(p_application_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.application_views (application_id, viewer_id)
  VALUES (p_application_id, auth.uid())
  ON CONFLICT (application_id, viewer_id)
  DO UPDATE SET last_viewed_at = timezone('utc', now()),
                view_count = public.application_views.view_count + 1;
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_application_view(uuid) TO authenticated;
