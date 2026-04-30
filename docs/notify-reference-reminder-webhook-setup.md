# notify-reference-reminder — webhook setup (Phase 3.2)

The `notify-reference-reminder` edge function is deployed but is **idle**
until a Supabase Database Webhook is wired to call it. This doc walks the
one-time setup. Run it once per environment (staging first, then prod).

## What this function does

Sends a one-time reminder email to a user who has had at least one accepted
friendship for ≥7 days but still has zero references (no accepted, no
pending). The CTA deeplinks them to the AddReferenceModal preselected to a
specific suggested friend. The pg_cron job
`enqueue_reference_reminders` (daily at 14:00 UTC) is what populates the
queue; this webhook is the bridge that turns those queue inserts into
sent emails.

## Pre-requisites

- The `20260501000000_reference_reminder_system.sql` migration is applied
  (table + cron job + enqueue function in place).
- The `notify-reference-reminder` edge function is deployed:
  `supabase functions deploy notify-reference-reminder`.
- `RESEND_API_KEY` Supabase secret is set on the target env (already true —
  same secret as `notify-reference-request` / `notify-reference-response`).
- Service role key handy for the webhook auth header (Project Settings →
  API → service_role).

## Step 1 — open Database Webhooks

In the Supabase dashboard for the target project (staging:
`ivjkdaylalhsteyyclvl`, prod: `xtertgftujnebubxgqit`):

`Database → Webhooks → Create a new hook`

## Step 2 — basics

| Field | Value |
|---|---|
| Name | `notify-reference-reminder` |
| Table | `reference_reminder_queue` |
| Events | `Insert` (only) |

## Step 3 — HTTP request

| Field | Value |
|---|---|
| Type | `Supabase Edge Functions` |
| Edge Function | `notify-reference-reminder` |
| HTTP Method | `POST` |
| Timeout | `5000` ms (Resend can take 1–2 s; the default 1000 is too tight) |

## Step 4 — HTTP Headers

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `Authorization` | `Bearer <SERVICE_ROLE_KEY>` |

The function uses `getServiceClient()` internally; the bearer is to
satisfy the function's verify_jwt check.

## Step 5 — HTTP Params

Leave empty. The function reads `record` (the new queue row) from the
JSON body that Supabase sends automatically.

## Step 6 — Conditions

No conditions needed. The cron job is the gate — only eligible users land
in `reference_reminder_queue` in the first place. The webhook should fire
on every INSERT.

(For comparison: the `notify-reference-response` webhook DOES need a
condition because it watches `profile_references` directly and has to
filter for `pending → accepted` updates. This webhook watches a queue
table dedicated to one purpose, so no filter is required.)

## Step 7 — verify

Two ways:

### Option A — direct cron-trigger test (cleanest)

```sql
-- In the Supabase SQL editor (staging only):
SELECT public.enqueue_reference_reminders();
SELECT count(*) FROM public.reference_reminder_queue WHERE processed_at IS NULL;
-- Expect ≥0; if there are eligible users in your env, expect >0
```

Within ~5 seconds the webhook should fire the edge function for each
inserted row. Re-query the queue:

```sql
SELECT id, recipient_id, suggested_friend_id, processed_at
FROM public.reference_reminder_queue
ORDER BY created_at DESC
LIMIT 10;
```

`processed_at` should be set on every row. Check the edge function logs
(`Logs → Edge Functions → notify-reference-reminder`) for either `===
Reference reminder email sent successfully ===` (success) or one of the
documented `Skipped - …` messages (eligibility failed re-check).

### Option B — synthetic queue insert (no real users affected)

```sql
-- Pick a real test recipient and a real test friend
INSERT INTO public.reference_reminder_queue (recipient_id, suggested_friend_id)
VALUES ('<test-recipient-uuid>', '<test-friend-uuid>');
```

The recipient must pass the edge function's defense-in-depth re-checks
(role, notify_references, no active references, friendship still
accepted). Check the recipient's inbox for the email.

## What's NOT wired (deliberate)

- **No follow-up reminder.** This is one-time per user, ever. The
  `UNIQUE(recipient_id)` constraint on the queue table enforces this.
  If a follow-up reminder is added later (e.g., 30 days after a decline),
  it should be a separate queue table with its own cron + webhook so each
  reminder family stays decoupled.
- **No SMS / push parallel.** Email-only for v1.

## Reversibility

Disabling the email path: dashboard → Database Webhooks → toggle the
hook off. The cron job will keep enqueueing rows but they will sit
unprocessed (acceptable — `processed_at` stays null and the queue acts
as a paused batch).

To stop the cron filling the queue:

```sql
SELECT cron.unschedule('reference_reminder_emails');
```

To fully remove the system, see the down-migration sketch at the bottom
of `20260501000000_reference_reminder_system.sql`.
