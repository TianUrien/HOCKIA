# ADR 0002: SQL functions own status changes; clients only read

Status: accepted (founder ruling 2026-09-26; implemented 2026-09-26 to 2026-10-02).

## Context

A 2026-09-25 security audit found five client write paths on production
where a user could rewrite another party's state through PostgREST
(conversation participants, application status and applicant, reference
status, post and message cards). The recruiting pipeline (invites, offers,
signing) was about to add more state with stricter rules (one open invite per
player per club, 18+ only, versioned offers, both-sides signing).

## Decision

- Every status change on `opportunity_applications`, `opportunity_invites`,
  `opportunity_offers` and `career_history` signing fields goes through a
  SECURITY DEFINER function: `send_invite`, `respond_invite`, `make_offer`,
  `withdraw_offer`, `respond_offer`, `mark_signed`, `undo_mark_signed`,
  `confirm_signing`, `set_trial`, `withdraw_application`, `fill_role`.
- Clients only read these tables. Direct client writes are confined to the
  review states by guard triggers that act only when
  `current_user = 'authenticated'`, so server paths (RPCs, service role, cron,
  cascades) are untouched.
- `record_application_status_history` records the real actor and the channel
  (`changed_via`) for every transition.
- The client mirrors rules it needs for rendering in pure modules
  (`lib/invites.ts`, `lib/signing.ts`, `lib/applicationStatus.ts`) whose
  headers name the owning SQL function; mirrors never decide authorization.

## Evidence

- `supabase/migrations/20260926100000_phase1_close_client_write_holes.sql`
  (guard triggers; commit `4bbea732`).
- `supabase/migrations/20260928110000_recruiting_invites_offers_schema.sql`
  header: "Clients only READ them; every status change goes through the
  SECURITY DEFINER functions" (commit `24de6e84`).
- `client/src/lib/signing.ts`: "The server ... is the authority for every
  rule below; the client mirrors them only to decide what to render."
- Probes `phase1_client_write_holes.probe.sql`, `trackB_d2.probe.sql`,
  `send_invite_dob.probe.sql`, `withdrawn_visible_to_publisher.probe.sql`.

## Consequences

- New recruiting features add a function, a history row, a probe and a
  rollback, not a client-side update.
- Undo flows (the 5-second club decision undo) are implemented by holding the
  write client-side, not by writing and reverting, because a write fires
  notifications.
- Rule mirrors can drift from SQL; each mirror needs a unit test, and the
  probe is the guard on the server side.
