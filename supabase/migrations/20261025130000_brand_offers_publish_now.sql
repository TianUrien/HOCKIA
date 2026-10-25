-- Brand offers: publish now, no approval step (founder 2026-10-25: "no
-- friction"). Supersedes the admin review of 20261023160000.
--
--   * Publish (save_brand_offer with p_submit) makes an offer live at once;
--     the 5-live limit (trigger) and the content checks (brand_offer_problem:
--     title, body, https link, countries, roles, dates) still apply.
--   * An edit of a live or paused offer applies at once (no pending copy).
--   * Admins can take an offer down afterwards with a reason the brand sees
--     word for word (admin_take_down_brand_offer). A taken-down offer uses the
--     existing 'not_approved' status, so it sits under "Needs you" for the
--     brand, who can edit and publish again.
--   * Members' Report on an offer stays (tagged report against the brand).
--
-- Existing rows: offers waiting in review become drafts (the brand publishes
-- with one tap); pending changes waiting on live offers are applied.
-- admin_review_brand_offer is kept (unused) so nothing calling it breaks.
--
-- Rollback: supabase/rollbacks/20261025130000_brand_offers_publish_now.down.sql

-- ------------------------------------------------------------ publish now
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
    IF p_ends_at IS NOT NULL AND p_ends_at <= v_now THEN RAISE EXCEPTION 'offer_expired' USING ERRCODE = 'check_violation'; END IF;
  END IF;

  IF p_offer_id IS NULL THEN
    IF (SELECT count(*) FROM public.brand_offers WHERE brand_id = v_brand AND status <> 'ended') >= 50 THEN
      RAISE EXCEPTION 'too_many_offers' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.brand_offers (brand_id, status, title, body, image_url, link_url, country_ids, area, roles, starts_at, ends_at, submitted_at, live_at)
    VALUES (v_brand, CASE WHEN p_submit THEN 'live' ELSE 'draft' END,
            v_fields->>'title', v_fields->>'body', v_fields->>'image_url', v_fields->>'link_url',
            coalesce(p_country_ids, '{}'), v_fields->>'area', coalesce(p_roles, '{}'), p_starts_at, p_ends_at,
            CASE WHEN p_submit THEN v_now END, CASE WHEN p_submit THEN v_now END)
    RETURNING * INTO v_offer; -- the trigger holds the 5-live limit
    RETURN v_offer.id;
  END IF;

  SELECT * INTO v_offer FROM public.brand_offers WHERE id = p_offer_id AND brand_id = v_brand FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'no_data_found'; END IF;

  IF v_offer.status IN ('draft', 'in_review', 'not_approved') THEN
    UPDATE public.brand_offers SET
      title = v_fields->>'title', body = v_fields->>'body', image_url = v_fields->>'image_url',
      link_url = v_fields->>'link_url', country_ids = coalesce(p_country_ids, '{}'), area = v_fields->>'area',
      roles = coalesce(p_roles, '{}'), starts_at = p_starts_at, ends_at = p_ends_at,
      status = CASE WHEN p_submit THEN 'live' ELSE 'draft' END,
      submitted_at = CASE WHEN p_submit THEN v_now ELSE submitted_at END,
      live_at = CASE WHEN p_submit THEN coalesce(live_at, v_now) ELSE live_at END,
      review_note = CASE WHEN p_submit THEN NULL ELSE review_note END,
      pending = NULL, pending_status = NULL
    WHERE id = v_offer.id; -- the trigger holds the 5-live limit
  ELSIF v_offer.status IN ('live', 'paused') THEN
    IF NOT p_submit THEN RAISE EXCEPTION 'live_edits_publish' USING ERRCODE = 'check_violation'; END IF;
    UPDATE public.brand_offers SET
      title = v_fields->>'title', body = v_fields->>'body', image_url = v_fields->>'image_url',
      link_url = v_fields->>'link_url', country_ids = coalesce(p_country_ids, '{}'), area = v_fields->>'area',
      roles = coalesce(p_roles, '{}'), starts_at = p_starts_at, ends_at = p_ends_at,
      pending = NULL, pending_status = NULL, review_note = NULL, submitted_at = v_now
    WHERE id = v_offer.id;
  ELSE
    RAISE EXCEPTION 'offer_ended' USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_offer.id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_brand_offer(uuid, text, text, text, text, integer[], text, text[], timestamptz, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_brand_offer(uuid, text, text, text, text, integer[], text, text[], timestamptz, timestamptz, boolean) TO authenticated;

-- ------------------------------------------------------------ admin take-down
-- A live or paused offer comes down at once; the brand is told why (Inbox +
-- push, kind brand_offer_not_approved with takedown = true) and can edit and
-- publish again.
CREATE OR REPLACE FUNCTION public.admin_take_down_brand_offer(p_offer_id uuid, p_reason text)
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
  v_reason text := nullif(btrim(p_reason), '');
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Unauthorized: admin access required'; END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = 'check_violation'; END IF;
  IF char_length(v_reason) > 500 THEN RAISE EXCEPTION 'reason_too_long' USING ERRCODE = 'check_violation'; END IF;

  SELECT * INTO v_offer FROM public.brand_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'no_data_found'; END IF;
  IF v_offer.status NOT IN ('live', 'paused') THEN RAISE EXCEPTION 'not_live' USING ERRCODE = 'check_violation'; END IF;
  SELECT b.profile_id INTO v_owner FROM public.brands b WHERE b.id = v_offer.brand_id;

  UPDATE public.brand_offers SET status = 'not_approved', review_note = v_reason, reviewed_by = v_admin, reviewed_at = v_now,
         pending = NULL, pending_status = NULL
   WHERE id = v_offer.id;

  PERFORM public.enqueue_notification(
    v_owner, NULL, 'brand_offer_not_approved'::public.profile_notification_kind, v_offer.id,
    jsonb_build_object('offer_title', v_offer.title, 'reason', v_reason, 'takedown', true),
    '/dashboard/offers'
  );
  RETURN 'taken_down';
END;
$$;
REVOKE ALL ON FUNCTION public.admin_take_down_brand_offer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_take_down_brand_offer(uuid, text) TO authenticated;

-- ------------------------------------------------------------ existing rows
-- Pending changes on live / paused offers: apply them (no review any more).
UPDATE public.brand_offers SET
  title = pending->>'title', body = pending->>'body', image_url = pending->>'image_url',
  link_url = pending->>'link_url',
  country_ids = ARRAY(SELECT jsonb_array_elements_text(pending->'country_ids')::integer),
  area = pending->>'area', roles = ARRAY(SELECT jsonb_array_elements_text(pending->'roles')),
  starts_at = (pending->>'starts_at')::timestamptz, ends_at = (pending->>'ends_at')::timestamptz,
  pending = NULL, pending_status = NULL
WHERE pending_status = 'in_review' AND pending IS NOT NULL AND public.brand_offer_problem(pending) IS NULL;
UPDATE public.brand_offers SET pending = NULL, pending_status = NULL WHERE pending_status IS NOT NULL;
-- Offers waiting in review: back to draft; the brand publishes with one tap.
UPDATE public.brand_offers SET status = 'draft' WHERE status = 'in_review';
