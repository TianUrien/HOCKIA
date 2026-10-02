# notify-reference-response — webhook setup

The `notify-reference-response` edge function is deployed (staging + prod, v1)
but is **idle** until a Supabase Database Webhook is wired to call it. This
doc walks the one-time setup. Run it once per environment.

## What this function does

Sends an email to the original requester when their pending reference is
accepted (`pending → accepted` transition on `profile_references`). Decline
path is in-app only by design (declines are sensitive; the in-app
notification kind `reference_request_rejected` already covers it). Failure
to wire the webhook does not break anything — the function just doesn't
fire and accept emails are silently absent.

## Pre-requisites

- `RESEND_API_KEY` Supabase secret already set on the target env (it is —
  the existing `notify-reference-request` function uses the same secret).
- Service role key handy for the webhook auth header (visible in Supabase
  dashboard under Project Settings → API).

## Step 1 — open Database Webhooks

In the Supabase dashboard for the target project (staging:
`ivjkdaylalhsteyyclvl`, prod: `xtertgftujnebubxgqit`):

`Database → Webhooks → Create a new hook`

## Step 2 — basics

| Field | Value |
|---|---|
| Name | `notify_reference_response_on_accept` |
| Table | `profile_references` |
| Events | `Update` (only) |

## Step 3 — HTTP request

| Field | Value |
|---|---|
| Type | `Supabase Edge Functions` |
| Edge Function | `notify-reference-response` |
| HTTP Method | `POST` |
| Timeout | `5000` ms (default 1000 is too tight — Resend can take 1-2 s) |

## Step 4 — HTTP Headers

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `Authorization` | `Bearer <SERVICE_ROLE_KEY>` |

The function uses `getServiceClient()` internally, so the bearer is just
to satisfy the function's verify_jwt check.

## Step 5 — HTTP Params

Leave empty. The function reads `record` and `old_record` from the JSON
body that Supabase sends automatically.

## Step 6 — payload filter (optional but recommended)

Under **Conditions** add:

```
record.status = 'accepted'  AND  old_record.status = 'pending'
```

This pre-filters at the webhook layer so the function isn't woken up for
every UPDATE on the table (RLS-policy update, endorsement edit, decline,
revoke, etc). The function ALSO filters internally so this is belt-and-
braces, not strictly required.

## Step 7 — verify

After saving, trigger an actual accept on the env to test:

1. As the player test account (`E2E_PLAYER_EMAIL`), have a pending
   reference request waiting.
2. As the recipient of that request, accept it via UI.
3. Check the player's email inbox — should receive
   "X accepted your reference request".
4. Check Supabase logs (`Logs → Edge Functions → notify-reference-response`)
   for the green `=== Email sent successfully ===` line.

If you see `Ignored - status not accepted` in logs, the webhook is firing
on the wrong transition. Re-check Step 6 filter.

## What's NOT wired (deliberate)

- **Decline emails**: `pending → declined` transition deliberately does
  not email. If product wants it later, add a sibling function
  `notify-reference-declined` mirroring this one. The kindest implementation
  acknowledges the decline without naming the decliner ("Your reference
  request didn't go through this time — try another connection") to soften
  the rejection feeling.
- **Endorsement edit emails**: when a reference giver edits their already-
  accepted endorsement (`edit_endorsement` RPC), no email fires. Edits are
  generally additive/refining; the in-app notification kind
  `reference_updated` already exists and surfaces the change. If editorial
  emails are wanted, add a third function gated on the specific column
  change.

## Reversibility

Disabling the email path: dashboard → Database Webhooks → toggle the
hook off. The function deploys remain. To fully remove: delete the hook,
then `supabase functions delete notify-reference-response`.
