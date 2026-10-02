# ADR 0003: Explicit visibility fences and service-role webhook callers

Status: accepted (fences since 2026-07; webhook rule since 2026-08-08).

## Context

RLS protects direct table reads, but two large classes of code bypass it:
SECURITY DEFINER functions (run as their owner) and the service-role client
used by every edge function. A 2026-07 integration audit found eight surfaces
that returned hidden profiles (admin-banned or frozen minors) through those
paths. Separately, a 2026-08-08 review proved that `verify_jwt = true` on the
gateway only checks that some valid Supabase JWT was presented, and the anon
key is one, so webhook-invoked functions were callable by anyone.

## Decision

1. **Visibility**: every RPC, view, edge function or service-role read that
   returns or counts people applies `profile_is_hidden(is_blocked,
   frozen_minor_at)` (or `profile_is_uncontactable(...)` on discovery and
   contact surfaces) itself. Lists and counts must agree.
2. **Webhook callers**: every function invoked by database webhooks or cron
   calls `assertServiceRole(req)` first and rejects any caller whose verified
   JWT does not carry the `service_role` claim. A test reads the function
   sources and fails CI if one stops doing so.
3. **User-facing functions** verify the user JWT in-handler (`auth.getUser`)
   and run with the gateway check off where anonymous callers are legitimate
   (public videos, logged-out capability links, the age gate).

## Evidence

- Root `CLAUDE.md`: "The hidden-profile predicate is NOT inherited - apply it
  explicitly".
- `supabase/migrations/20260707151000_age_gate_core.sql` defines
  `profile_is_hidden` and `profile_is_uncontactable`; 46 migration files
  reference them.
- `supabase/functions/_shared/webhook-auth.ts` (rationale in the header) and
  `_shared/webhook-auth.test.ts` (covers 15 functions); 16 functions call
  `assertServiceRole`.
- `supabase/config.toml` pins `verify_jwt` per function with the reasons.

## Consequences

- Reviewers check two things on any new people-returning surface: the fence
  and the count/list consistency.
- `notify-test-vacancy` and `notify-test-application` are gateway-only today;
  listed as an open hardening item.
- The service-role JWT in webhook trigger definitions is itself a secret;
  moving authorization off that key is a named workstream.
