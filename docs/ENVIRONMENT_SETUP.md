# HOCKIA Environment Setup Guide

This document describes the multi-environment setup for HOCKIA's Supabase backend.

## Environment Overview

| Environment | Supabase Project | Vercel Target | Domain | Purpose |
|-------------|------------------|---------------|--------|---------|
| **Local** | `supabase start` | N/A | `localhost:5173` | Daily development |
| **Staging** | `ivjkdaylalhsteyyclvl` | Preview | `hockia-staging.vercel.app` | E2E tests, pre-prod validation |
| **Production** | `xtertgftujnebubxgqit` | Production | `inhockia.com` | Real users |

## Supabase Project Details

### Production
- **Project ref:** `xtertgftujnebubxgqit`
- **URL:** `https://xtertgftujnebubxgqit.supabase.co`
- **Dashboard:** https://supabase.com/dashboard/project/xtertgftujnebubxgqit

### Staging
- **Project ref:** `ivjkdaylalhsteyyclvl`
- **URL:** `https://ivjkdaylalhsteyyclvl.supabase.co`
- **Dashboard:** https://supabase.com/dashboard/project/ivjkdaylalhsteyyclvl

## Local Development Setup

### Option A: Local Supabase (Recommended)

```bash
# Start local Supabase (requires Docker)
cd /path/to/HOCKIA
supabase start

# This outputs local credentials - copy them to .env.local
```

Create `client/.env.local`:
```bash
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=<from supabase start output>
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=<from supabase start output>
VITE_ENVIRONMENT=development
```

### Option B: Use Staging Backend

Create `client/.env.local`:
```bash
SUPABASE_URL=https://ivjkdaylalhsteyyclvl.supabase.co
SUPABASE_ANON_KEY=<staging-anon-key>
VITE_SUPABASE_URL=https://ivjkdaylalhsteyyclvl.supabase.co
VITE_SUPABASE_ANON_KEY=<staging-anon-key>
VITE_ENVIRONMENT=staging
```

## Vercel Environment Variables

### Production (Environment: Production)

| Variable | Value |
|----------|-------|
| `VITE_SUPABASE_URL` | `https://xtertgftujnebubxgqit.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `<production-anon-key>` |
| `VITE_ENVIRONMENT` | `production` |
| `VITE_SENTRY_DSN` | `<sentry-dsn>` |

### Preview (Environment: Preview)

| Variable | Value |
|----------|-------|
| `VITE_SUPABASE_URL` | `https://ivjkdaylalhsteyyclvl.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `<staging-anon-key>` |
| `VITE_ENVIRONMENT` | `staging` |
| `VITE_SENTRY_DSN` | `<sentry-dsn>` (optional) |

## GitHub Actions Secrets

For CI/CD to run E2E tests against staging:

| Secret | Description |
|--------|-------------|
| `STAGING_SUPABASE_URL` | `https://ivjkdaylalhsteyyclvl.supabase.co` |
| `STAGING_SUPABASE_ANON_KEY` | Staging anon key |
| `E2E_PLAYER_EMAIL` | `playrplayer93@gmail.com` |
| `E2E_PLAYER_PASSWORD` | Password for player test account |
| `E2E_CLUB_EMAIL` | `clubplayr8@gmail.com` |
| `E2E_CLUB_PASSWORD` | Password for club test account |
| `E2E_COACH_EMAIL` | `coachplayr@gmail.com` |
| `E2E_COACH_PASSWORD` | Password for coach test account |

## Database Migration Workflow

### Developing a new migration

```bash
# 1. Ensure you're linked to production (for schema reference)
supabase link --project-ref xtertgftujnebubxgqit

# 2. Create your migration file
touch supabase/migrations/YYYYMMDDHHMM_description.sql

# 3. Test locally first
supabase db reset  # Applies all migrations to local DB

# 4. Push to staging for validation
supabase unlink
supabase link --project-ref ivjkdaylalhsteyyclvl
supabase db push

# 5. After staging validation, push to production
supabase unlink
supabase link --project-ref xtertgftujnebubxgqit
supabase db push
```

### Quick switch commands

```bash
# Switch to staging
supabase unlink && supabase link --project-ref ivjkdaylalhsteyyclvl

# Switch to production
supabase unlink && supabase link --project-ref xtertgftujnebubxgqit

# Check current link
cat supabase/.temp/project-ref
```

## Edge Function Deployment

```bash
# Deploy to staging
supabase link --project-ref ivjkdaylalhsteyyclvl
supabase functions deploy

# Deploy to production
supabase link --project-ref xtertgftujnebubxgqit
supabase functions deploy
```

### Edge Function Secrets

Both environments need these secrets (set via Dashboard or CLI):

| Secret | Required | Notes |
|--------|----------|-------|
| `RESEND_API_KEY` | Yes | Email sending |
| `TEST_NOTIFICATION_RECIPIENTS` | Optional | For `notify-test-vacancy` |
| `BLOCKED_NOTIFICATION_RECIPIENTS` | Optional | For `notify-vacancy` |

Auto-injected by Supabase (don't set manually):
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`

## E2E Test Accounts

These accounts must exist in **STAGING** database:

| Email | Role | Password |
|-------|------|----------|
| `playrplayer93@gmail.com` | player | (set in env) |
| `clubplayr8@gmail.com` | club | (set in env) |
| `coachplayr@gmail.com` | coach | (set in env) |

To create them, sign up manually on `https://hockia-staging.vercel.app` or run:
```bash
supabase link --project-ref ivjkdaylalhsteyyclvl
psql <staging-connection-string> -f client/e2e/setup-e2e-accounts.sql
```

## Pre-Deployment Checklist

Before pushing to **PRODUCTION**:

- [ ] Migration tested on staging (`supabase db push` to staging)
- [ ] E2E tests pass against staging
- [ ] No console errors in staging preview deployment
- [ ] Edge functions deployed to staging and tested
- [ ] Linked to correct project (`cat supabase/.temp/project-ref`)
- [ ] Database backup recent (check Supabase Dashboard)

## Troubleshooting

### "Wrong environment" errors

Check which project you're linked to:
```bash
cat supabase/.temp/project-ref
```

### E2E tests failing with auth errors

1. Verify test accounts exist in staging
2. Check `E2E_ALLOWED_SUPABASE_URL` matches staging URL
3. Ensure `E2E_ALLOW_WRITES=1` is set

### Migration conflicts

If staging and production have diverged:
```bash
# Check migration status
supabase db diff --linked
```

## Staging → Production Promotion Process

This section describes how to safely promote changes from staging to production.

### Automated Promotion Scripts

Two scripts automate the deployment process:

```bash
# Deploy to staging (for testing)
./scripts/deploy-to-staging.sh

# Promote to production (after staging validation)
./scripts/promote-to-production.sh
```

**Script options:**
```bash
# Staging deployment
./scripts/deploy-to-staging.sh              # Full deployment
./scripts/deploy-to-staging.sh --db-only    # Only migrations
./scripts/deploy-to-staging.sh --functions-only  # Only edge functions

# Production promotion
./scripts/promote-to-production.sh          # Interactive full promotion
./scripts/promote-to-production.sh --dry-run  # Preview without changes
./scripts/promote-to-production.sh --skip-confirmation  # Non-interactive (CI/CD)
./scripts/promote-to-production.sh --db-only  # Only migrations
./scripts/promote-to-production.sh --functions-only  # Only edge functions
```

### Promotion Criteria

Before promoting to production, ALL of the following must be true:

- [ ] **CI passes** — All GitHub Actions checks green on `main` branch
- [ ] **E2E tests pass** — Smoke tests run successfully against staging
- [ ] **Manual QA complete** — Tested on Preview deployment (`hockia-staging.vercel.app`)
- [ ] **No regressions** — Core flows work: signup, login, vacancy creation, messaging
- [ ] **Migrations validated** — Schema changes applied to staging without errors

### Promotion Workflow

#### Step 1: Validate Staging

```bash
# Ensure you're on main and up to date
git checkout main && git pull

# Verify CI passed
# Check: https://github.com/<org>/HOCKIA/actions

# Run E2E tests locally against staging (optional extra validation)
cd client
E2E_ALLOW_WRITES=1 \
E2E_ALLOWED_SUPABASE_URL=https://ivjkdaylalhsteyyclvl.supabase.co \
npm run test:e2e:smoke
```

#### Step 2: Promote Database Migrations

```bash
# 1. Check current link (should be production for normal work)
cat supabase/.temp/project-ref

# 2. Verify migrations are ready
supabase db diff --linked  # Should show no drift from local migrations

# 3. Push migrations to production
supabase link --project-ref xtertgftujnebubxgqit
supabase db push

# 4. Verify success in Supabase Dashboard
# https://supabase.com/dashboard/project/xtertgftujnebubxgqit/database/migrations
```

#### Step 3: Deploy Edge Functions

```bash
# Deploy all functions to production
supabase link --project-ref xtertgftujnebubxgqit
supabase functions deploy

# Verify deployment
supabase functions list
```

#### Step 4: Frontend Deployment

Frontend deploys automatically via Vercel when you merge to `main`:

```bash
# Merge your PR to main
git checkout main
git merge feature/your-feature
git push origin main

# Vercel will:
# 1. Build with production env vars
# 2. Deploy to inhockia.com
# 3. Show deployment status in GitHub PR
```

### Rollback Procedures

#### Frontend Rollback (Vercel)

1. Go to Vercel Dashboard → Deployments
2. Find the last known good deployment
3. Click "..." → "Promote to Production"

Or via CLI:
```bash
vercel rollback --prod
```

#### Database Rollback

⚠️ **Database rollbacks are complex.** Supabase doesn't auto-rollback migrations.

**Option A: Forward-fix (Preferred)**
```bash
# Create a new migration that reverses the problematic change
touch supabase/migrations/YYYYMMDDHHMM_revert_bad_change.sql
# Write the reversal SQL, then push
supabase db push
```

**Option B: Point-in-Time Recovery (Emergency)**
1. Go to Supabase Dashboard → Database → Backups
2. Restore to a point before the bad migration
3. ⚠️ This loses all data since that point!

#### Edge Function Rollback

```bash
# Redeploy previous version from git history
git checkout <previous-commit> -- supabase/functions/<function-name>
supabase functions deploy <function-name>
git checkout HEAD -- supabase/functions/<function-name>
```

### Promotion Checklist

Copy this checklist for each promotion:

```markdown
## Production Promotion - [DATE]

### Pre-Promotion
- [ ] PR merged to `main`
- [ ] CI checks passing
- [ ] E2E tests passing in CI
- [ ] Manual testing on Preview deployment
- [ ] Database backup verified (Supabase Dashboard)

### Database
- [ ] `supabase link --project-ref xtertgftujnebubxgqit`
- [ ] `supabase db push` — migrations applied
- [ ] Verified in Dashboard: no migration errors

### Edge Functions
- [ ] `supabase functions deploy` — all functions deployed
- [ ] `supabase functions list` — all showing ACTIVE

### Frontend
- [ ] Vercel deployment triggered (automatic on merge)
- [ ] Deployment successful (check Vercel Dashboard)
- [ ] Production site accessible: https://inhockia.com

### Post-Promotion Validation
- [ ] Sign up flow works
- [ ] Login flow works (email + Google OAuth)
- [ ] Dashboard loads correctly
- [ ] Create vacancy (as club) works
- [ ] Apply to vacancy (as player) works
- [ ] Messaging works
- [ ] No new Sentry errors
```

### Automated vs Manual Deployments

| Component | Automated? | Trigger |
|-----------|------------|---------|
| Frontend (Vercel) | ✅ Yes | Merge to `main` |
| Database Migrations | ❌ No | Manual `supabase db push` |
| Edge Functions | ❌ No | Manual `supabase functions deploy` |

> **Why manual for Supabase?**
> Database migrations and edge functions require careful validation. Automatic deployments could push untested schema changes to production. The manual step ensures a human verifies staging before promoting.

### Emergency Hotfix Process

For critical production bugs that need immediate fixing:

```bash
# 1. Create hotfix branch from main
git checkout main && git pull
git checkout -b hotfix/critical-fix

# 2. Make minimal fix
# ... edit files ...

# 3. Test locally
npm run dev  # Quick smoke test

# 4. Push and create PR
git push -u origin hotfix/critical-fix
# Create PR, get quick review

# 5. Merge to main (triggers Vercel deploy)
# Or deploy directly via Vercel CLI:
cd client && vercel --prod

# 6. If database fix needed:
supabase link --project-ref xtertgftujnebubxgqit
supabase db push

# 7. If edge function fix needed:
supabase functions deploy <function-name>
```

### Monitoring After Promotion

After promoting to production, monitor for 15-30 minutes:

1. **Sentry** — Watch for new errors
2. **Supabase Dashboard** — Check database connections, query performance
3. **Vercel Analytics** — Check for increased error rates
4. **Manual spot check** — Quick walkthrough of main flows

## Quick Reference

| Task | Command |
|------|---------|
| Start local Supabase | `supabase start` |
| Stop local Supabase | `supabase stop` |
| Reset local database | `supabase db reset` |
| Link to staging | `supabase link --project-ref ivjkdaylalhsteyyclvl` |
| Link to production | `supabase link --project-ref xtertgftujnebubxgqit` |
| Push migrations | `supabase db push` |
| Deploy functions | `supabase functions deploy` |
| Deploy single function | `supabase functions deploy <name>` |
| View function logs | `supabase functions logs <function-name>` |
| List secrets | `supabase secrets list` |
| Set secret | `supabase secrets set KEY=value` |
| Check current project | `cat supabase/.temp/project-ref` |
| Vercel production deploy | `cd client && vercel --prod` |
| Vercel rollback | `cd client && vercel rollback --prod` |
