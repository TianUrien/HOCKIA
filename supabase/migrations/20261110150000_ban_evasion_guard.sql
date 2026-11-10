-- Ban-evasion guard (founder 2026-11-10: "we block the email and they come
-- back with another one").
--
-- Before this, an admin block (profiles.is_blocked) hid the profile and
-- stopped messaging, but nothing tied the person to the block: the same
-- mailbox could come back as a.b+x@gmail.com, and a new account from the same
-- phone was indistinguishable from any other signup.
--
-- Two additions, both server-side:
--
-- 1. banned_emails. When an admin blocks an account its email is recorded in
--    a normalised form (lower-case; "+tag" removed; for Gmail the dots too,
--    since Gmail ignores them) and removed again on unblock. A new profile
--    whose email normalises to a banned one cannot be created, so the usual
--    "same inbox, new alias" return is refused. The entry outlives the
--    account, so deleting a blocked account does not free the email.
--    Honest limit: a brand-new mailbox still gets in — that is what (2) is for.
--
-- 2. admin_get_ban_evasion_suspects(): an admin-only read of accounts that
--    are NOT blocked but used the same browser/app install (events.anonymous_id,
--    a strong signal) or the same network (events.ip_hash, a weak one: shared
--    wifi, mobile carriers) as a blocked account. It only lists; nothing is
--    blocked automatically. Computed at read time (events has ~75k rows and an
--    index on anonymous_id), so there is no new trigger on the hot events path.
--
-- Nothing here changes what members can read or write, and no API shape
-- changes, so older native builds are unaffected.
-- Rollback: supabase/rollbacks/20261110150000_ban_evasion_guard.down.sql
-- Probe:    supabase/tests/security/ban_evasion_guard.probe.sql

-- ── Normalisation ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.normalize_email_for_ban(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_email IS NULL OR position('@' in p_email) = 0 THEN NULL
    ELSE (
      SELECT CASE
        WHEN d IN ('gmail.com', 'googlemail.com')
          THEN replace(split_part(l, '+', 1), '.', '') || '@gmail.com'
        ELSE split_part(l, '+', 1) || '@' || d
      END
      FROM (SELECT lower(btrim(split_part(p_email, '@', 1))) AS l,
                   lower(btrim(split_part(p_email, '@', 2))) AS d) parts
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.normalize_email_for_ban(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_email_for_ban(text) TO service_role;

-- ── Banned emails ──────────────────────────────────────────────────────────
CREATE TABLE public.banned_emails (
  email_normalized  text PRIMARY KEY,
  reason            text,
  -- The blocked account this came from. No foreign key on purpose: the ban
  -- must survive the account being deleted.
  source_profile_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX banned_emails_source_idx ON public.banned_emails (source_profile_id);

-- Server-only: no client role may read or write it (RLS on, no policies).
ALTER TABLE public.banned_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.banned_emails FROM anon, authenticated;
GRANT ALL ON TABLE public.banned_emails TO service_role;

-- Keep the list in step with admin blocks.
CREATE OR REPLACE FUNCTION public.sync_banned_email_on_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  IF NEW.is_blocked IS TRUE AND OLD.is_blocked IS DISTINCT FROM TRUE THEN
    SELECT public.normalize_email_for_ban(coalesce(u.email, NEW.email))
      INTO v_email
      FROM (SELECT 1) one
      LEFT JOIN auth.users u ON u.id = NEW.id;
    IF v_email IS NOT NULL THEN
      INSERT INTO public.banned_emails (email_normalized, reason, source_profile_id)
      VALUES (v_email, NEW.blocked_reason, NEW.id)
      ON CONFLICT (email_normalized) DO NOTHING;
    END IF;
  ELSIF NEW.is_blocked IS NOT TRUE AND OLD.is_blocked IS TRUE THEN
    DELETE FROM public.banned_emails WHERE source_profile_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_banned_email_on_block() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_banned_email_on_block ON public.profiles;
CREATE TRIGGER trg_sync_banned_email_on_block
  AFTER UPDATE OF is_blocked ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_banned_email_on_block();

-- Accounts already blocked.
INSERT INTO public.banned_emails (email_normalized, reason, source_profile_id)
SELECT public.normalize_email_for_ban(coalesce(u.email, p.email)), p.blocked_reason, p.id
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
 WHERE p.is_blocked IS TRUE
   AND public.normalize_email_for_ban(coalesce(u.email, p.email)) IS NOT NULL
ON CONFLICT (email_normalized) DO NOTHING;

-- Refuse a new profile for a banned email. Checks the auth account's email
-- too, so a client cannot dodge it by sending a different profiles.email.
CREATE OR REPLACE FUNCTION public.guard_banned_email_on_profile_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Server-side inserts (seed scripts, admin tooling) are not signups.
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.banned_emails b
     WHERE b.email_normalized IN (
             public.normalize_email_for_ban(NEW.email),
             (SELECT public.normalize_email_for_ban(u.email) FROM auth.users u WHERE u.id = NEW.id)
           )
  ) THEN
    RAISE EXCEPTION 'This account can''t be created.'
      USING ERRCODE = '42501', DETAIL = 'email_banned';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_banned_email_on_profile_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_banned_email_on_profile_insert ON public.profiles;
CREATE TRIGGER trg_guard_banned_email_on_profile_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_banned_email_on_profile_insert();

-- ── Suspects: same device or network as a blocked account ─────────────────
CREATE OR REPLACE FUNCTION public.admin_get_ban_evasion_suspects()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH blocked AS (
    SELECT p.id, p.full_name, p.blocked_at FROM public.profiles p WHERE p.is_blocked IS TRUE
  ),
  blocked_devices AS (
    SELECT DISTINCT e.anonymous_id, b.id AS blocked_id
      FROM public.events e JOIN blocked b ON b.id = e.user_id
     WHERE e.anonymous_id IS NOT NULL
  ),
  blocked_networks AS (
    SELECT DISTINCT e.ip_hash, b.id AS blocked_id
      FROM public.events e JOIN blocked b ON b.id = e.user_id
     WHERE e.ip_hash IS NOT NULL
  ),
  hits AS (
    SELECT e.user_id AS profile_id, d.blocked_id, 'device'::text AS match, max(e.created_at) AS last_seen
      FROM public.events e JOIN blocked_devices d ON d.anonymous_id = e.anonymous_id
     WHERE e.user_id IS NOT NULL AND e.user_id <> d.blocked_id
     GROUP BY e.user_id, d.blocked_id
    UNION ALL
    SELECT e.user_id, n.blocked_id, 'network', max(e.created_at)
      FROM public.events e JOIN blocked_networks n ON n.ip_hash = e.ip_hash
     WHERE e.user_id IS NOT NULL AND e.user_id <> n.blocked_id
     GROUP BY e.user_id, n.blocked_id
  ),
  -- One row per suspect: the device match wins, then the most recent overlap.
  best AS (
    SELECT DISTINCT ON (h.profile_id) h.profile_id, h.blocked_id, h.match, h.last_seen
      FROM hits h
     ORDER BY h.profile_id, (h.match = 'device') DESC, h.last_seen DESC
  )
  SELECT jsonb_agg(to_jsonb(sub) ORDER BY (sub.match = 'device') DESC, sub.account_created_at DESC, sub.profile_id) INTO v_rows
    FROM (
      SELECT s.profile_id, p.full_name, p.role, p.avatar_url,
             p.created_at AS account_created_at,
             (p.created_at > b.blocked_at) AS created_after_block,
             s.match, s.last_seen,
             b.id AS blocked_profile_id, b.full_name AS blocked_full_name, b.blocked_at
        FROM best s
        JOIN public.profiles p ON p.id = s.profile_id
        JOIN blocked b ON b.id = s.blocked_id
       WHERE p.is_blocked IS NOT TRUE
         AND COALESCE(p.is_test_account, false) = false
       LIMIT 200
    ) sub;

  RETURN jsonb_build_object('rows', coalesce(v_rows, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_ban_evasion_suspects() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_ban_evasion_suspects() TO authenticated, service_role;
