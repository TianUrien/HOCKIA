# Notification System

This directory contains the Edge Functions for email notifications on Hockia.

## Architecture Overview

The notification system is split into **two completely isolated modes**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        VACANCY NOTIFICATION SYSTEM                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────────────────┐      ┌─────────────────────────────┐     │
│   │       TEST MODE             │      │       REAL MODE             │     │
│   │  notify-test-vacancy        │      │  notify-vacancy             │     │
│   ├─────────────────────────────┤      ├─────────────────────────────┤     │
│   │                             │      │                             │     │
│   │  Trigger:                   │      │  Trigger:                   │     │
│   │  - is_test_account = TRUE   │      │  - is_test_account = FALSE  │     │
│   │                             │      │                             │     │
│   │  Recipients:                │      │  Recipients:                │     │
│   │  - Env-configured emails    │      │  - Real players/coaches     │     │
│   │  - TEST_NOTIFICATION_...    │      │  - Based on vacancy type    │     │
│   │                             │      │  - From database            │     │
│   │                             │      │                             │     │
│   │  Safety:                    │      │  Safety:                    │     │
│   │  - Never sends to real      │      │  - Never sends to test      │     │
│   │    users                    │      │    recipients               │     │
│   │  - Only test clubs          │      │  - Only real clubs          │     │
│   │                             │      │                             │     │
│   └─────────────────────────────┘      └─────────────────────────────┘     │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────┐      │
│   │                      SHARED EMAIL TEMPLATE                       │      │
│   │                   _shared/vacancy-email.ts                       │      │
│   │                                                                  │      │
│   │  • generateEmailHtml()  - Production email template              │      │
│   │  • generateEmailText()  - Plain text version                     │      │
│   │  • sendEmail()          - Resend API integration                 │      │
│   │  • Sender: "Hockia <team@inhockia.com>"                     │      │
│   │                                                                  │      │
│   └─────────────────────────────────────────────────────────────────┘      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Functions

### 1. `notify-test-vacancy` (TEST MODE)

**Purpose:** Send test notifications to hardcoded recipients when test clubs publish vacancies.

**Safety Guarantees:**
- ✅ Recipients are HARDCODED - never queries database for recipients
- ✅ Only processes vacancies from test accounts (`is_test_account = true`)
- ✅ Real users will NEVER receive emails from this function

**Test Recipients:**
- Configure `TEST_NOTIFICATION_RECIPIENTS` in the `notify-test-vacancy` function settings.

### 2. `notify-vacancy` (REAL MODE)

**Purpose:** Send production notifications to real users when real clubs publish vacancies.

**Safety Guarantees:**
- ✅ Only processes vacancies from REAL accounts (`is_test_account = false`)
-- ✅ Never sends to blocked recipients (explicitly blocked)
- ✅ Matches vacancy `opportunity_type` to user `role` (player/coach)
- ✅ Only sends to users with `onboarding_completed = true`

**Recipient Selection:**
- For `player` vacancies → sends to users with `role = 'player'`
- For `coach` vacancies → sends to users with `role = 'coach'`

### 3. `_shared/vacancy-email.ts` (Shared Module)

**Purpose:** Shared email template and utilities used by both functions.

**Contents:**
- `generateEmailHtml()` - Production-identical HTML email template
- `generateEmailText()` - Plain text fallback
- `sendEmail()` / `sendEmailsIndividually()` - Resend API integration
- `isVacancyNewlyPublished()` - Status change detection
- `createLogger()` - Structured logging

## Webhook Configuration

You need to create **two separate webhooks** in Supabase Dashboard:

### Opportunity Webhooks

#### Webhook 1: Test Mode
- **Name:** `notify-test-vacancy`
- **Table:** `opportunities`
- **Events:** INSERT, UPDATE
- **URL:** `https://xtertgftujnebubxgqit.supabase.co/functions/v1/notify-test-vacancy`

#### Webhook 2: Real Mode
- **Name:** `notify-vacancy`
- **Table:** `opportunities`
- **Events:** INSERT, UPDATE
- **URL:** `https://xtertgftujnebubxgqit.supabase.co/functions/v1/notify-vacancy`

> **Note:** Both webhooks point to the same table. Each function internally filters for test vs real accounts.

### Application Webhooks

#### Webhook 3: Test Mode
- **Name:** `notify-test-application`
- **Table:** `opportunity_applications`
- **Events:** INSERT
- **URL:** `https://xtertgftujnebubxgqit.supabase.co/functions/v1/notify-test-application`

#### Webhook 4: Real Mode
- **Name:** `notify-application`
- **Table:** `opportunity_applications`
- **Events:** INSERT
- **URL:** `https://xtertgftujnebubxgqit.supabase.co/functions/v1/notify-application`

> **Note:** Both webhooks point to the same table. Each function internally filters for test vs real accounts.

## Deployment

```bash
# Deploy both functions
supabase functions deploy notify-test-vacancy
supabase functions deploy notify-vacancy

# Or deploy all functions
supabase functions deploy
```

## Environment Variables

Additional (recommended) safety vars:
- `TEST_NOTIFICATION_RECIPIENTS` (notify-test-vacancy) – comma-separated emails
- `BLOCKED_NOTIFICATION_RECIPIENTS` (notify-vacancy) – comma-separated emails

Both functions require these secrets (set in Supabase Dashboard):

- `RESEND_API_KEY` - API key for Resend email service
- `SUPABASE_URL` - Auto-provided
- `SUPABASE_SERVICE_ROLE_KEY` - Auto-provided

## Email Template

Both functions use the **identical** email template:

- **Sender:** `Hockia <team@inhockia.com>`
- **Subject:** `New opportunity on Hockia: {vacancy.title}`
- **Design:** Purple gradient header, vacancy card, CTA button
- **Footer:** "You're receiving this because you're on Hockia" + manage preferences link

## Isolation Guarantees

The system ensures TEST and REAL modes **never overlap**:

| Check                        | TEST Mode                  | REAL Mode                  |
|------------------------------|----------------------------|----------------------------|
| Club `is_test_account`       | Must be `TRUE`             | Must be `FALSE`            |
| Recipients                   | Hardcoded list only        | Database query (filtered)  |
| Blocked emails               | N/A (hardcoded)            | Blocks test recipients     |
| Cross-contamination possible | ❌ No                       | ❌ No                       |

## Troubleshooting

### No emails sent?
1. Check Supabase logs: `supabase functions logs notify-vacancy`
2. Verify webhook is configured and enabled
3. Check vacancy status changed to `'open'`
4. Verify club `is_test_account` matches the expected mode

### Wrong recipients?
1. Check `is_test_account` flag on the club profile
2. For REAL mode: verify user `onboarding_completed = true` and `role` matches

### Email not delivered?
1. Check Resend dashboard for delivery status
2. Verify `RESEND_API_KEY` is set correctly
3. Check spam folder

---

## Onboarding Reminder System

### Architecture

Automated 3-touch email cadence for users who signed up but never completed onboarding.

```
pg_cron (daily 10:00 UTC)
  → enqueue_onboarding_reminders()
    → INSERT INTO onboarding_reminder_queue
      → Database webhook on INSERT
        → notify-onboarding-reminder edge function
          → renderTemplate() + sendTrackedEmail() → Resend
```

### Cadence

| Reminder | Delay | Subject |
|----------|-------|---------|
| 1 | 24 hours after signup | "Complete your Hockia profile and start connecting" |
| 2 | 72 hours after signup | "Your Hockia profile is almost ready" |
| 3 | 7 days after signup | "Last chance to complete your Hockia profile" |

Each reminder only sends after the previous one has been processed. This prevents sending all 3 at once for users who signed up long ago.

### Safety Guarantees

- Skips test accounts (`is_test_account = false`)
- Re-checks `onboarding_completed` at send time (user may have completed since enqueue)
- Skips recipients with no email
- UNIQUE constraint on `(recipient_id, reminder_number)` prevents duplicate reminders
- Marks queue `processed_at` on ALL exit paths (success, skip, or error)

### Webhook Configuration

#### Webhook: Onboarding Reminder
- **Name:** `notify-onboarding-reminder`
- **Table:** `onboarding_reminder_queue`
- **Events:** INSERT
- **URL:** `https://xtertgftujnebubxgqit.supabase.co/functions/v1/notify-onboarding-reminder`

### Deployment

```bash
supabase functions deploy notify-onboarding-reminder
```

### Verification

```sql
-- Check cron job is scheduled
SELECT * FROM cron.job WHERE jobname = 'onboarding_reminder_emails';

-- Manually trigger enqueue (for testing)
SELECT public.enqueue_onboarding_reminders();

-- Check queue state
SELECT * FROM onboarding_reminder_queue ORDER BY created_at DESC;

-- Check sent emails
SELECT * FROM email_sends WHERE template_key = 'onboarding_reminder' ORDER BY sent_at DESC;
```

## Push delivery log

Added 2026-11-23 (migration `20261123120000_push_delivery_log.sql`; source:
founder request to register failures that raise no error in the app).

`send-push` writes one row per device to `public.push_delivery_log` for every
push it attempts:

| outcome | meaning |
|---|---|
| `sent` | the provider (APNs, FCM or the browser's push service) accepted it |
| `rejected` | the provider said the token or subscription is gone; the subscription was removed |
| `failed` | the provider or the network refused the send; also reported to Sentry |
| `rate_limited` | the provider answered 429 |
| `not_configured` | the device needs a provider this project has no keys for |

`detail` is a short provider reason (a status or an error name). A row never
holds a device token, an endpoint or the push text. Pushes skipped before any
device is tried (push switched off, no subscription, grouped by
`club-reminders`) write no row.

The table is service role only (no policy, no grant to `anon` or
`authenticated`) and rows are pruned after 30 days by
`prune_push_delivery_log()` (cron `prune_push_delivery_log_daily`, 04:45 UTC).
Writing the log is best-effort: a failed insert is a warning in the function's
output and the push still goes out.

`sent` means the provider accepted the push, not that the phone showed it.

Why a member got no push, last 7 days:

```sql
select created_at, kind, platform, outcome, detail
from public.push_delivery_log
where recipient_profile_id = '<profile id>'
order by created_at desc;
```

Failure rate by platform and day:

```sql
select created_at::date as day, platform,
       count(*) filter (where outcome = 'sent') as sent,
       count(*) filter (where outcome = 'failed') as failed,
       count(*) filter (where outcome = 'rejected') as rejected
from public.push_delivery_log
group by 1, 2 order by 1 desc, 2;
```
