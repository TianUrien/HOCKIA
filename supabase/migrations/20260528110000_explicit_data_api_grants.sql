-- ─────────────────────────────────────────────────────────────────────
-- explicit_data_api_grants — Supabase Data API GRANT audit
-- ─────────────────────────────────────────────────────────────────────
-- Supabase changelog (May 2026): from October 30, 2026, new tables
-- added to the public schema on existing projects are no longer
-- automatically exposed to the Data API (PostgREST / GraphQL /
-- supabase-js). Tables created without explicit GRANTs become
-- inaccessible from the client SDKs.
--
-- This migration:
--   1. Makes the existing implicit per-role GRANTs explicit on every
--      current public table. Pure no-op for prod + staging today —
--      every table already carries these grants from the pre-Oct-2026
--      default. Codifying them in a migration means a fresh DB built
--      from this repo's migration set has the same API surface
--      without relying on Supabase's deprecated default.
--   2. Sets ALTER DEFAULT PRIVILEGES so any new table created by
--      `postgres` (the role that runs `supabase db push`) inherits the
--      same baseline grants. After Oct 30 this is the documented
--      replacement for the old implicit behavior — any new migration
--      that issues a plain CREATE TABLE in public will get the right
--      API exposure automatically.
--   3. Restates the 4 exception groups already present on both DBs as
--      explicit REVOKEs so the security model is reproducible:
--        • backend-only queues — service_role only
--        • profiles — anon must not read directly (RPCs gate)
--        • archived_messages — authenticated SELECT only (no mutate)
--        • user_pulse_items — no Data-API UPDATE (RPC-mediated)
--
-- Defense in depth: RLS remains the actual gate on every table — the
-- GRANT layer is the outer fence. Loosening RLS without GRANT changes
-- doesn't open anything new; tightening RLS without GRANT changes
-- works. This file owns the GRANT layer's documented baseline only.

BEGIN;

-- ── 1) Schema-wide baseline grants ──────────────────────────────────
-- Idempotent: re-running these GRANTs on a table that already has them
-- is a no-op. The point is to make the contract explicit in the
-- migration history rather than relying on Supabase's pre-Oct-2026
-- default.

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- Sequences too — INSERTs into tables with serial/identity keys need
-- USAGE on the underlying sequence. Supabase's old default included
-- this; making it explicit so post-Oct-2026 new tables stay write-able.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ── 2) Default privileges for FUTURE tables ─────────────────────────
-- Applies to objects created BY THE postgres ROLE (which is what
-- `supabase db push --linked` runs as). After Oct 30 2026 this is
-- the recommended pattern to keep the "every new public table is
-- Data-API-accessible by default" behavior without relying on
-- Supabase's removed default.
--
-- ALTER DEFAULT PRIVILEGES is per-grantor — we set it for the
-- postgres role explicitly so it's clear which role's CREATE TABLE
-- statements inherit these grants. Other Supabase-managed roles
-- (supabase_auth_admin, supabase_storage_admin) create tables in
-- their own schemas, not public, so they don't need defaults here.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;

-- ── 3) Exception groups — tighten where Data API access shouldn't ──
-- These match the existing effective state on both prod + staging
-- (audited 2026-05-28). The schema-wide GRANT above would have
-- relaxed each of these; the REVOKEs below restore the intended
-- tight state.

-- 3.1 Backend-only queue tables — service_role only.
-- These tables are pulled by edge functions / cron workers and must
-- never be reachable from the Data API, even with RLS on. Belt-and-
-- braces: no GRANTs + RLS-on + no policies = triple deny for clients.
REVOKE ALL ON TABLE public.onboarding_reminder_queue FROM anon, authenticated;
REVOKE ALL ON TABLE public.profile_view_email_queue  FROM anon, authenticated;
REVOKE ALL ON TABLE public.reference_reminder_queue  FROM anon, authenticated;
REVOKE ALL ON TABLE public.storage_cleanup_queue     FROM anon, authenticated;

-- 3.2 profiles — anon must not read directly.
-- Anonymous public profile reads go through SECURITY DEFINER RPCs
-- (get_top_community_members, get_public_profile_by_username, etc.)
-- that apply privacy + onboarding + blocklist gates. Direct anon
-- SELECT on the table would bypass these checks.
-- Authenticated users do read directly (RLS-gated to onboarded +
-- non-blocked rows).
REVOKE SELECT ON TABLE public.profiles FROM anon;

-- 3.3 archived_messages — authenticated SELECT only.
-- The archiver edge function runs as service_role and is the sole
-- writer of archived rows. Users can read their own archived
-- conversations (RLS-gated) but can never mutate the archive
-- directly.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.archived_messages FROM authenticated;

-- 3.4 user_pulse_items — no direct Data-API UPDATE.
-- Pulse rows track derived activity signals; mutations go through
-- SECURITY DEFINER RPCs that enforce business rules (rate-limit,
-- aggregate windows). Direct table UPDATEs would bypass those.
-- INSERT/DELETE remain — clients can append + dismiss items, but
-- can't rewrite history.
REVOKE UPDATE ON TABLE public.user_pulse_items FROM anon, authenticated;

COMMIT;
