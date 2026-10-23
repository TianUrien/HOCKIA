-- Brand offers, Phase 1: the table, review states and the brand / admin RPCs
-- (founder go-ahead 2026-10-23; design: Figma page "08 · Brands (all phases)",
-- section P1; docs/product/proposals/brand-results.md).
--
-- An offer is something a brand gives members ("15% off your first full kit
-- when you join a club in a new country"), shown by WHERE MEMBERS LIVE and
-- their role, never by nationality. Every offer is checked by an admin before
-- members see it.
--
-- States: draft → in_review → live (approved) or not_approved (with the admin's
-- reason, shown to the brand word for word); live ⇄ paused; any → ended.
-- Editing a live or paused offer stores the change in `pending` and sends it
-- for review; the live version stays up until the change is approved.
--
-- Founder decisions 2026-10-23: up to 5 live offers per brand while free
-- (drafts and paused offers don't count), several countries per offer, events
-- recorded like other first-party events (no consent gate), brands only ever
-- see totals, and breakdowns need 5 or more members (Results, Phase 3).
--
-- Access:
-- - Members and visitors read LIVE offers only (in their date window, brand
--   not deleted, brand profile not hidden), and only the public columns.
--   Review notes, pending changes and reviewer ids are never exposed by the
--   table: owners read them through get_my_brand_offers, admins through
--   admin_list_brand_offers.
-- - Nobody writes the table directly; every change goes through the RPCs
--   below, which enforce owner/admin checks, the state machine and the limit.
-- - Offer events (brand_offer_impression / _open / _contact / _store_tap /
--   _dismiss, entity_type 'brand_offer', properties.surface and an optional
--   properties.reason) go through the existing track_event; this migration
--   only adds an index for them.
--
-- Rollback: supabase/rollbacks/20261023160000_brand_offers.down.sql

-- ------------------------------------------------------------- notifications
ALTER TYPE public.profile_notification_kind ADD VALUE IF NOT EXISTS 'brand_offer_approved';
ALTER TYPE public.profile_notification_kind ADD VALUE IF NOT EXISTS 'brand_offer_not_approved';

-- --------------------------------------------------------------------- table
CREATE TABLE IF NOT EXISTS public.brand_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_review', 'not_approved', 'live', 'paused', 'ended')),
  title text CHECK (title IS NULL OR char_length(btrim(title)) BETWEEN 1 AND 60),
  body text CHECK (body IS NULL OR char_length(btrim(body)) BETWEEN 1 AND 140),
  image_url text CHECK (image_url IS NULL OR (image_url ~ '^https://[^[:space:]]+$' AND char_length(image_url) <= 500)),
  link_url text CHECK (link_url IS NULL OR (link_url ~ '^https://[^[:space:]]+$' AND char_length(link_url) <= 500)),
  country_ids integer[] NOT NULL DEFAULT '{}' CHECK (cardinality(country_ids) <= 30),
  area text CHECK (area IS NULL OR char_length(btrim(area)) BETWEEN 1 AND 80),
  roles text[] NOT NULL DEFAULT '{}' CHECK (roles <@ ARRAY['player', 'coach', 'club', 'umpire']::text[]),
  starts_at timestamptz,
  ends_at timestamptz,
  -- A proposed edit of a live / paused offer, and where it stands in review.
  pending jsonb,
  pending_status text CHECK (pending_status IS NULL OR pending_status IN ('in_review', 'not_approved')),
  review_note text CHECK (review_note IS NULL OR char_length(review_note) <= 500),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  submitted_at timestamptz,
  live_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT brand_offers_dates CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  -- Anything past a draft is a complete offer.
  CONSTRAINT brand_offers_complete CHECK (
    status = 'draft' OR (title IS NOT NULL AND body IS NOT NULL AND link_url IS NOT NULL
      AND cardinality(country_ids) >= 1 AND cardinality(roles) >= 1)
  ),
  CONSTRAINT brand_offers_pending_pair CHECK ((pending IS NULL) = (pending_status IS NULL))
);

COMMENT ON TABLE public.brand_offers IS
  'Brand offers shown to members by location and role (never nationality). Written only through the brand_offer RPCs; members read live offers.';

CREATE INDEX IF NOT EXISTS brand_offers_brand_status_idx ON public.brand_offers (brand_id, status);
CREATE INDEX IF NOT EXISTS brand_offers_live_countries_idx ON public.brand_offers USING gin (country_ids) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS brand_offers_review_queue_idx ON public.brand_offers (submitted_at)
  WHERE status = 'in_review' OR pending_status = 'in_review';

-- Offer events, for the brand's counts now and Results (Phase 3) later.
CREATE INDEX IF NOT EXISTS events_brand_offer_idx ON public.events (entity_id, event_name, created_at)
  WHERE entity_type = 'brand_offer';

DROP TRIGGER IF EXISTS brand_offers_updated_at ON public.brand_offers;
CREATE TRIGGER brand_offers_updated_at BEFORE UPDATE ON public.brand_offers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- The 5-live limit holds whatever path sets an offer live.
CREATE OR REPLACE FUNCTION public.brand_offers_live_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'live' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'live') THEN
    IF (SELECT count(*) FROM public.brand_offers o
         WHERE o.brand_id = NEW.brand_id AND o.status = 'live' AND o.id <> NEW.id) >= 5 THEN
      RAISE EXCEPTION 'live_limit: a brand can have up to 5 live offers' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.brand_offers_live_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS brand_offers_live_limit ON public.brand_offers;
CREATE TRIGGER brand_offers_live_limit BEFORE INSERT OR UPDATE OF status ON public.brand_offers
  FOR EACH ROW EXECUTE FUNCTION public.brand_offers_live_limit();

-- ------------------------------------------------------------ access control
ALTER TABLE public.brand_offers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.brand_offers FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, brand_id, status, title, body, image_url, link_url, country_ids, area, roles, starts_at, ends_at, live_at, created_at)
  ON public.brand_offers TO anon, authenticated;
GRANT ALL ON TABLE public.brand_offers TO service_role;

DROP POLICY IF EXISTS brand_offers_read_live ON public.brand_offers;
CREATE POLICY brand_offers_read_live ON public.brand_offers FOR SELECT TO anon, authenticated
USING (
  status = 'live'
  AND (starts_at IS NULL OR starts_at <= now())
  AND (ends_at IS NULL OR ends_at > now())
  AND EXISTS (
    SELECT 1 FROM public.brands b JOIN public.profiles p ON p.id = b.profile_id
     WHERE b.id = brand_offers.brand_id AND b.deleted_at IS NULL
       AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
  )
);

-- ------------------------------------------------------------------ helpers
-- What is wrong with an offer's content, or NULL when it can be sent for review.
CREATE OR REPLACE FUNCTION public.brand_offer_problem(p jsonb)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_countries integer[];
  v_roles text[];
BEGIN
  IF coalesce(char_length(btrim(p->>'title')), 0) NOT BETWEEN 1 AND 60 THEN RETURN 'title'; END IF;
  IF coalesce(char_length(btrim(p->>'body')), 0) NOT BETWEEN 1 AND 140 THEN RETURN 'body'; END IF;
  IF coalesce(p->>'link_url', '') !~ '^https://[^[:space:]]+$' OR char_length(p->>'link_url') > 500 THEN RETURN 'link_url'; END IF;
  IF p->>'image_url' IS NOT NULL AND (p->>'image_url' !~ '^https://[^[:space:]]+$' OR char_length(p->>'image_url') > 500) THEN RETURN 'image_url'; END IF;
  SELECT coalesce(array_agg(x::integer), '{}') INTO v_countries FROM jsonb_array_elements_text(coalesce(p->'country_ids', '[]')) x;
  IF cardinality(v_countries) NOT BETWEEN 1 AND 30 THEN RETURN 'country_ids'; END IF;
  IF (SELECT count(*) FROM public.countries c WHERE c.id = ANY (v_countries)) <> cardinality(v_countries) THEN RETURN 'country_ids'; END IF;
  SELECT coalesce(array_agg(x), '{}') INTO v_roles FROM jsonb_array_elements_text(coalesce(p->'roles', '[]')) x;
  IF cardinality(v_roles) < 1 OR NOT (v_roles <@ ARRAY['player', 'coach', 'club', 'umpire']::text[]) THEN RETURN 'roles'; END IF;
  IF p->>'area' IS NOT NULL AND char_length(btrim(p->>'area')) NOT BETWEEN 1 AND 80 THEN RETURN 'area'; END IF;
  IF p->>'ends_at' IS NOT NULL AND (p->>'ends_at')::timestamptz <= now() THEN RETURN 'ends_at'; END IF;
  IF p->>'ends_at' IS NOT NULL AND p->>'starts_at' IS NOT NULL AND (p->>'ends_at')::timestamptz <= (p->>'starts_at')::timestamptz THEN RETURN 'ends_at'; END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.brand_offer_problem(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_offer_problem(jsonb) TO authenticated, service_role;

-- The caller's brand id (one brand per account), or an error.
CREATE OR REPLACE FUNCTION public.my_brand_id_or_raise()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT b.id INTO v_id FROM public.brands b WHERE b.profile_id = (SELECT auth.uid()) AND b.deleted_at IS NULL;
  IF v_id IS NULL THEN RAISE EXCEPTION 'not_a_brand' USING ERRCODE = 'insufficient_privilege'; END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.my_brand_id_or_raise() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_brand_id_or_raise() TO authenticated;

-- ---------------------------------------------------------------- brand RPCs
-- Create or edit an offer. p_submit = true also sends it for review.
-- Draft / in review / not approved: the fields change in place.
-- Live / paused: the change goes to `pending`; the live version stays up.
CREATE OR REPLACE FUNCTION public.save_brand_offer(
  p_offer_id uuid,
  p_title text,
  p_body text,
  p_image_url text,
  p_link_url text,
  p_country_ids integer[],
  p_area text,
  p_roles text[],
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_submit boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand uuid := public.my_brand_id_or_raise();
  v_offer public.brand_offers;
  v_now timestamptz := timezone('utc', now());
  v_fields jsonb := jsonb_build_object(
    'title', nullif(btrim(p_title), ''), 'body', nullif(btrim(p_body), ''),
    'image_url', nullif(btrim(p_image_url), ''), 'link_url', nullif(btrim(p_link_url), ''),
    'country_ids', to_jsonb(coalesce(p_country_ids, '{}')), 'area', nullif(btrim(p_area), ''),
    'roles', to_jsonb(coalesce(p_roles, '{}')), 'starts_at', p_starts_at, 'ends_at', p_ends_at);
  v_problem text;
BEGIN
  IF p_submit THEN
    v_problem := public.brand_offer_problem(v_fields);
    IF v_problem IS NOT NULL THEN RAISE EXCEPTION 'invalid_offer: %', v_problem USING ERRCODE = 'check_violation'; END IF;
  END IF;

  IF p_offer_id IS NULL THEN
    IF (SELECT count(*) FROM public.brand_offers WHERE brand_id = v_brand AND status <> 'ended') >= 50 THEN
      RAISE EXCEPTION 'too_many_offers' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.brand_offers (brand_id, status, title, body, image_url, link_url, country_ids, area, roles, starts_at, ends_at, submitted_at)
    VALUES (v_brand, CASE WHEN p_submit THEN 'in_review' ELSE 'draft' END,
            v_fields->>'title', v_fields->>'body', v_fields->>'image_url', v_fields->>'link_url',
            coalesce(p_country_ids, '{}'), v_fields->>'area', coalesce(p_roles, '{}'), p_starts_at, p_ends_at,
            CASE WHEN p_submit THEN v_now END)
    RETURNING * INTO v_offer;
    RETURN v_offer.id;
  END IF;

  SELECT * INTO v_offer FROM public.brand_offers WHERE id = p_offer_id AND brand_id = v_brand FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'no_data_found'; END IF;

  IF v_offer.status IN ('draft', 'in_review', 'not_approved') THEN
    UPDATE public.brand_offers SET
      title = v_fields->>'title', body = v_fields->>'body', image_url = v_fields->>'image_url',
      link_url = v_fields->>'link_url', country_ids = coalesce(p_country_ids, '{}'), area = v_fields->>'area',
      roles = coalesce(p_roles, '{}'), starts_at = p_starts_at, ends_at = p_ends_at,
      -- Saving without sending makes it a draft again (half-finished edits are fine there).
      status = CASE WHEN p_submit THEN 'in_review' ELSE 'draft' END,
      submitted_at = CASE WHEN p_submit THEN v_now ELSE submitted_at END
    WHERE id = v_offer.id;
  ELSIF v_offer.status IN ('live', 'paused') THEN
    IF NOT p_submit THEN RAISE EXCEPTION 'live_edits_go_to_review' USING ERRCODE = 'check_violation'; END IF;
    UPDATE public.brand_offers SET pending = v_fields, pending_status = 'in_review', submitted_at = v_now
    WHERE id = v_offer.id;
  ELSE
    RAISE EXCEPTION 'offer_ended' USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_offer.id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_brand_offer(uuid, text, text, text, text, integer[], text, text[], timestamptz, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_brand_offer(uuid, text, text, text, text, integer[], text, text[], timestamptz, timestamptz, boolean) TO authenticated;

-- pause (live → paused), resume (paused → live, within the limit; no new review
-- unless edited), end (any → ended), delete (drafts only).
CREATE OR REPLACE FUNCTION public.set_brand_offer_state(p_offer_id uuid, p_action text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand uuid := public.my_brand_id_or_raise();
  v_offer public.brand_offers;
  v_now timestamptz := timezone('utc', now());
BEGIN
  SELECT * INTO v_offer FROM public.brand_offers WHERE id = p_offer_id AND brand_id = v_brand FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'no_data_found'; END IF;

  IF p_action = 'pause' AND v_offer.status = 'live' THEN
    UPDATE public.brand_offers SET status = 'paused' WHERE id = v_offer.id;
    RETURN 'paused';
  ELSIF p_action = 'resume' AND v_offer.status = 'paused' THEN
    IF v_offer.ends_at IS NOT NULL AND v_offer.ends_at <= v_now THEN
      RAISE EXCEPTION 'offer_expired' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.brand_offers SET status = 'live' WHERE id = v_offer.id; -- the trigger holds the 5-live limit
    RETURN 'live';
  ELSIF p_action = 'end' AND v_offer.status <> 'ended' THEN
    UPDATE public.brand_offers SET status = 'ended', ended_at = v_now, pending = NULL, pending_status = NULL WHERE id = v_offer.id;
    RETURN 'ended';
  ELSIF p_action = 'delete' AND v_offer.status = 'draft' THEN
    DELETE FROM public.brand_offers WHERE id = v_offer.id;
    RETURN 'deleted';
  END IF;
  RAISE EXCEPTION 'invalid_transition: % from %', p_action, v_offer.status USING ERRCODE = 'check_violation';
END;
$$;
REVOKE ALL ON FUNCTION public.set_brand_offer_state(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_brand_offer_state(uuid, text) TO authenticated;

-- A new draft with the same photo, text and audience (live content, not a pending edit).
CREATE OR REPLACE FUNCTION public.duplicate_brand_offer(p_offer_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand uuid := public.my_brand_id_or_raise();
  v_id uuid;
BEGIN
  IF (SELECT count(*) FROM public.brand_offers WHERE brand_id = v_brand AND status <> 'ended') >= 50 THEN
    RAISE EXCEPTION 'too_many_offers' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.brand_offers (brand_id, status, title, body, image_url, link_url, country_ids, area, roles)
  SELECT brand_id, 'draft', title, body, image_url, link_url, country_ids, area, roles
    FROM public.brand_offers WHERE id = p_offer_id AND brand_id = v_brand
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'no_data_found'; END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.duplicate_brand_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duplicate_brand_offer(uuid) TO authenticated;

-- The brand's own offers with review notes, pending edits and member counts
-- (distinct real members: no test accounts, hidden profiles, blocked pairs or
-- the brand's own account). Totals only; breakdowns come with Results.
CREATE OR REPLACE FUNCTION public.get_my_brand_offers()
RETURNS TABLE (
  id uuid, status text, title text, body text, image_url text, link_url text, country_ids integer[],
  area text, roles text[], starts_at timestamptz, ends_at timestamptz, pending jsonb, pending_status text,
  review_note text, submitted_at timestamptz, live_at timestamptz, ended_at timestamptz,
  created_at timestamptz, updated_at timestamptz, shown integer, opened integer, contacted integer, not_useful integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand uuid := public.my_brand_id_or_raise();
  v_owner uuid := (SELECT auth.uid());
BEGIN
  RETURN QUERY
  WITH counts AS (
    SELECT e.entity_id AS offer_id,
           count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'brand_offer_impression')::integer AS shown,
           count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'brand_offer_open')::integer AS opened,
           count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'brand_offer_contact')::integer AS contacted,
           count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'brand_offer_dismiss')::integer AS not_useful
      FROM public.events e
      JOIN public.profiles p ON p.id = e.user_id
     WHERE e.entity_type = 'brand_offer'
       AND e.entity_id IN (SELECT o.id FROM public.brand_offers o WHERE o.brand_id = v_brand)
       AND e.user_id <> v_owner
       AND coalesce(p.is_test_account, false) = false
       AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
       AND NOT public.is_blocked_pair(v_owner, e.user_id)
     GROUP BY e.entity_id
  )
  SELECT o.id, o.status, o.title, o.body, o.image_url, o.link_url, o.country_ids, o.area, o.roles,
         o.starts_at, o.ends_at, o.pending, o.pending_status, o.review_note, o.submitted_at, o.live_at,
         o.ended_at, o.created_at, o.updated_at,
         coalesce(c.shown, 0), coalesce(c.opened, 0), coalesce(c.contacted, 0), coalesce(c.not_useful, 0)
    FROM public.brand_offers o
    LEFT JOIN counts c ON c.offer_id = o.id
   WHERE o.brand_id = v_brand
   ORDER BY o.updated_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_brand_offers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_brand_offers() TO authenticated;

-- ---------------------------------------------------------------- admin RPCs
-- The review queue: 'to_review' (new offers and edits of live ones, oldest
-- first), 'not_approved' or 'live'.
CREATE OR REPLACE FUNCTION public.admin_list_brand_offers(p_tab text DEFAULT 'to_review')
RETURNS TABLE (
  id uuid, brand_id uuid, brand_name text, brand_logo_url text, brand_profile_id uuid, status text,
  title text, body text, image_url text, link_url text, country_ids integer[], area text, roles text[],
  starts_at timestamptz, ends_at timestamptz, pending jsonb, pending_status text, review_note text,
  submitted_at timestamptz, live_at timestamptz, brand_live_count integer, brand_offer_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Unauthorized: admin access required'; END IF;
  RETURN QUERY
  SELECT o.id, o.brand_id, b.name, b.logo_url, b.profile_id, o.status, o.title, o.body, o.image_url,
         o.link_url, o.country_ids, o.area, o.roles, o.starts_at, o.ends_at, o.pending, o.pending_status,
         o.review_note, o.submitted_at, o.live_at,
         (SELECT count(*)::integer FROM public.brand_offers x WHERE x.brand_id = o.brand_id AND x.status = 'live'),
         (SELECT count(*)::integer FROM public.brand_offers x WHERE x.brand_id = o.brand_id AND x.status <> 'draft')
    FROM public.brand_offers o
    JOIN public.brands b ON b.id = o.brand_id
   WHERE CASE p_tab
           WHEN 'to_review' THEN o.status = 'in_review' OR o.pending_status = 'in_review'
           WHEN 'not_approved' THEN o.status = 'not_approved' OR o.pending_status = 'not_approved'
           WHEN 'live' THEN o.status = 'live'
           ELSE false
         END
   ORDER BY o.submitted_at ASC NULLS LAST;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_brand_offers(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_brand_offers(text) TO authenticated;

-- Approve or reject (a reason is required, and the brand sees it word for word).
-- Applies to a new offer in review, or to a pending edit of a live / paused one.
CREATE OR REPLACE FUNCTION public.admin_review_brand_offer(p_offer_id uuid, p_decision text, p_note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid := (SELECT auth.uid());
  v_offer public.brand_offers;
  v_owner uuid;
  v_now timestamptz := timezone('utc', now());
  v_note text := nullif(btrim(p_note), '');
  v_result text;
  v_title text;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Unauthorized: admin access required'; END IF;
  IF p_decision NOT IN ('approve', 'reject') THEN RAISE EXCEPTION 'invalid_decision'; END IF;
  IF p_decision = 'reject' AND v_note IS NULL THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = 'check_violation'; END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN RAISE EXCEPTION 'reason_too_long' USING ERRCODE = 'check_violation'; END IF;

  SELECT * INTO v_offer FROM public.brand_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'no_data_found'; END IF;
  SELECT b.profile_id INTO v_owner FROM public.brands b WHERE b.id = v_offer.brand_id;

  IF v_offer.pending_status = 'in_review' THEN
    IF p_decision = 'approve' THEN
      IF public.brand_offer_problem(v_offer.pending) IS NOT NULL THEN RAISE EXCEPTION 'invalid_offer: %', public.brand_offer_problem(v_offer.pending); END IF;
      UPDATE public.brand_offers SET
        title = pending->>'title', body = pending->>'body', image_url = pending->>'image_url',
        link_url = pending->>'link_url',
        country_ids = ARRAY(SELECT jsonb_array_elements_text(pending->'country_ids')::integer),
        area = pending->>'area', roles = ARRAY(SELECT jsonb_array_elements_text(pending->'roles')),
        starts_at = (pending->>'starts_at')::timestamptz, ends_at = (pending->>'ends_at')::timestamptz,
        pending = NULL, pending_status = NULL, review_note = NULL, reviewed_by = v_admin, reviewed_at = v_now
      WHERE id = v_offer.id;
      v_result := 'changes_approved';
    ELSE
      UPDATE public.brand_offers SET pending_status = 'not_approved', review_note = v_note, reviewed_by = v_admin, reviewed_at = v_now
      WHERE id = v_offer.id;
      v_result := 'changes_not_approved';
    END IF;
  ELSIF v_offer.status = 'in_review' THEN
    IF p_decision = 'approve' THEN
      IF v_offer.ends_at IS NOT NULL AND v_offer.ends_at <= v_now THEN RAISE EXCEPTION 'offer_expired' USING ERRCODE = 'check_violation'; END IF;
      UPDATE public.brand_offers SET status = 'live', live_at = v_now, review_note = NULL, reviewed_by = v_admin, reviewed_at = v_now
      WHERE id = v_offer.id; -- the trigger holds the 5-live limit
      v_result := 'approved';
    ELSE
      UPDATE public.brand_offers SET status = 'not_approved', review_note = v_note, reviewed_by = v_admin, reviewed_at = v_now
      WHERE id = v_offer.id;
      v_result := 'not_approved';
    END IF;
  ELSE
    RAISE EXCEPTION 'not_in_review' USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(pending->>'title', title) INTO v_title FROM public.brand_offers WHERE id = v_offer.id;
  PERFORM public.enqueue_notification(
    v_owner, NULL,
    (CASE WHEN p_decision = 'approve' THEN 'brand_offer_approved' ELSE 'brand_offer_not_approved' END)::public.profile_notification_kind,
    v_offer.id,
    jsonb_build_object('offer_title', v_title, 'reason', v_note, 'change', v_offer.pending_status IS NOT NULL),
    '/dashboard/offers'
  );
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_brand_offer(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_brand_offer(uuid, text, text) TO authenticated;

-- --------------------------------------------------------------- expiry job
-- Offers past their end date move to Ended (they already stop showing at read time).
CREATE OR REPLACE FUNCTION public.end_expired_brand_offers()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH done AS (
    UPDATE public.brand_offers
       SET status = 'ended', ended_at = timezone('utc', now()), pending = NULL, pending_status = NULL
     WHERE status IN ('live', 'paused', 'in_review', 'not_approved') AND ends_at IS NOT NULL AND ends_at <= now()
    RETURNING 1
  )
  SELECT count(*)::integer FROM done;
$$;
REVOKE ALL ON FUNCTION public.end_expired_brand_offers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_expired_brand_offers() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('end_expired_brand_offers_hourly');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN RAISE NOTICE 'Insufficient privilege to unschedule; continuing';
  WHEN others THEN NULL;
END $$;
DO $$
BEGIN
  PERFORM cron.schedule('end_expired_brand_offers_hourly', '7 * * * *',
    $cron$SELECT public.end_expired_brand_offers();$cron$);
END $$;
