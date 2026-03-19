# Notification System

This directory contains the Edge Functions for email notifications on HOCKIA.

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
│   │  • Sender: "HOCKIA <team@inhockia.com>"                     │      │
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

- **Sender:** `HOCKIA <team@inhockia.com>`
- **Subject:** `New opportunity on HOCKIA: {vacancy.title}`
- **Design:** Purple gradient header, vacancy card, CTA button
- **Footer:** "You're receiving this because you're on HOCKIA" + manage preferences link

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
| 1 | 24 hours after signup | "Complete your HOCKIA profile and start connecting" |
| 2 | 72 hours after signup | "Your HOCKIA profile is almost ready" |
| 3 | 7 days after signup | "Last chance to complete your HOCKIA profile" |

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
