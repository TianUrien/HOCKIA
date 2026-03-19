# Staging → Production Release Checklist

> **Source of truth.** Copy this checklist into every release PR or run it as a script.
> Last updated: 2026-02-18.

---

## Pre-flight

| # | Gate | Command / Action | Pass criteria |
|---|------|------------------|---------------|
| 0.1 | **Fetch latest** | `git fetch origin` | No errors |
| 0.2 | **Branch parity** | `git log --oneline origin/main..origin/staging` | Shows only the commits intended for this release |
| 0.3 | **No reverse drift** | `git log --oneline origin/staging..origin/main` | Empty (main is not ahead of staging) |
| 0.4 | **Clean working tree** | `git status` | No uncommitted changes (untracked OK) |

---

## 1 — Branching & Versioning

| # | Gate | Command / Action | Pass criteria |
|---|------|------------------|---------------|
| 1.1 | **Confirm release scope** | `git log --oneline origin/main..origin/staging` | List every commit; verify no unintended changes |
| 1.2 | **Check for open PRs** | `gh pr list --state open --base main` | No competing PRs to main (or coordinate) |

---

## 2 — Database & Migrations

| # | Gate | Command / Action | Pass criteria |
|---|------|------------------|---------------|
| 2.1 | **Local dry-run (staging)** | `supabase link --project-ref ivjkdaylalhsteyyclvl && supabase db push --linked --dry-run --include-all` | Lists only expected migrations, no errors |
| 2.2 | **CI migration validation** | Check "Migration Validation" job in CI | Green |
| 2.3 | **No seed/fixture in migrations** | `grep -ril 'INSERT INTO.*test\|is_test_account.*true\|seed' supabase/migrations/*.sql \| grep -v '_seed_' \| grep -v 'world_mass_seeding'` | Empty or only intentional files |
| 2.4 | **Review destructive ops** | `grep -Ein 'DROP TABLE\|DROP COLUMN\|TRUNCATE\|DELETE FROM(?!.*WHERE)' supabase/migrations/<new-files>` | No unexpected destructive SQL; each one explicitly approved |
| 2.5 | **RLS audit** | `grep -l 'security_invoker\|SECURITY DEFINER\|CREATE POLICY\|DROP POLICY' supabase/migrations/<new-files>` | All policy changes are intentional; views use `security_invoker = true` |

---

## 3 — Build Health & Bundle Budget

| # | Gate | Command / Action | Pass criteria |
|---|------|------------------|---------------|
| 3.1 | **Production build** | `cd client && npm run build` | Exit 0, no errors |
| 3.2 | **Bundle gzip < 650 KB** | (CI "Build" job checks automatically) | Green — gzip total < 665,600 bytes |
| 3.3 | **Raw JS < 2.5 MB** | (CI "Build" job checks automatically) | Green — raw total < 2,621,440 bytes |
| 3.4 | **No build warnings** | Scan build output for `warning` | No unexpected warnings |

---

## 4 — Automated Tests

| # | Gate | Command / Action | Pass criteria |
|---|------|------------------|---------------|
| 4.1 | **Unit tests** | `cd client && npm run test:unit:coverage` | All pass, coverage above thresholds (27/28/29/27%) |
| 4.2 | **DB integration tests** | `cd client && npm run test:db` | All pass (RLS, triggers, state machines) |
| 4.3 | **E2E smoke tests** | `cd client && npm run test:e2e:smoke` | All pass across setup, chromium, player, club, brand, mobile projects |
| 4.4 | **CI green on PR** | `gh pr checks <PR#> --watch` | All 9 jobs green: Security, Lint, Types, Unit, Build, Migration, DB, E2E, Vercel |

---

## 5 — Linting, Formatting, Type Checks

| # | Gate | Command / Action | Pass criteria |
|---|------|------------------|---------------|
| 5.1 | **ESLint** | `cd client && npx eslint . --max-warnings=0` | Exit 0, zero warnings |
| 5.2 | **TypeScript** | `cd client && npx tsc --noEmit` | Exit 0, no type errors |

---

## 6 — Environment Parity & Secrets

| # | Gate | Command / Action | Pass criteria |
|---|------|------------------|---------------|
| 6.1 | **No staging URLs in prod code** | `grep -r 'ivjkdaylalhsteyyclvl' client/src/` | Empty (staging project ID must not be hardcoded in app source) |
| 6.2 | **Vercel env vars** | Verify in Vercel dashboard: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ENVIRONMENT=production`, `VITE_SENTRY_DSN`, `VITE_GA_MEASUREMENT_ID` | All set for Production environment |
| 6.3 | **Supabase secrets** | Verify in GitHub repo Settings → Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, E2E test credentials | All present |
| 6.4 | **Auth callback URLs** | Supabase Dashboard → Auth → URL Configuration → Redirect URLs | Production domain (`https://www.inhockia.com/**`) listed |
| 6.5 | **CORS / CSP** | Review `client/vercel.json` CSP header | Both staging + production Supabase URLs allowed |

---

## 7 — Edge Functions

| # | Gate | Command / Action | Pass criteria |
|---|------|------------------|---------------|
| 7.1 | **List deployed functions** | `supabase functions list` (linked to staging for verification) | All 15 functions ACTIVE |
| 7.2 | **Health endpoint** | `curl -s https://xtertgftujnebubxgqit.supabase.co/functions/v1/health` | `{"status":"healthy","checks":{"database":"ok","edge_function":"ok"}}` |
| 7.3 | **Deploy changed functions** | `supabase functions deploy <function-name> --project-ref xtertgftujnebubxgqit` | Only if edge function source changed in this release |
| 7.4 | **Uptime monitor** | Check latest "Uptime Monitor" workflow run | Green |

---

## 8 — Manual Smoke Test (Staging)

Run against the staging preview URL (Vercel preview or `https://staging.inhockia.com`):

| # | Flow | Steps | Pass criteria |
|---|------|-------|---------------|
| 8.1 | **Landing page** | Visit `/` → page loads, images render, CTA works | No console errors, < 3s LCP |
| 8.2 | **Sign up** | Start signup flow → verify form validation | Form renders, validation messages show |
| 8.3 | **Player login** | Log in as player → dashboard loads | Dashboard, feed, opportunities visible |
| 8.4 | **Club login** | Log in as club → dashboard loads | Opportunities tab, applicants visible |
| 8.5 | **Post opportunity** | Club creates draft → publishes | Draft saves, publishes, appears in feed |
| 8.6 | **Apply to opportunity** | Player applies → cover letter submitted | Application appears in club's applicant list |
| 8.7 | **Applicant tiers** | Club sets "Good fit" / "Maybe" / "Not a fit" on applicants | Status updates, grouping correct, "Clear" resets |
| 8.8 | **Profile view** | View player profile → highlights, references visible | All tabs load, media plays |
| 8.9 | **Messaging** | Send a message between two users | Message appears in real-time |
| 8.10 | **Mobile responsive** | Repeat 8.3-8.7 on 375px viewport | No overflow, dropdowns stay in viewport |

---

## 9 — PR to Main

| # | Gate | Command / Action | Pass criteria |
|---|------|------------------|---------------|
| 9.1 | **Create PR** | `gh pr create --base main --head staging --title "Release: <summary>"` | PR created with checklist results in body |
| 9.2 | **CI green** | `gh pr checks <PR#> --watch` | All 9 checks pass |
| 9.3 | **Review** | Assign reviewer, highlight risks in PR body | Approved |
| 9.4 | **No merge conflicts** | Check PR mergeable status | Clean merge |

---

## 10 — Production Deploy

| # | Gate | Command / Action | Pass criteria |
|---|------|------------------|---------------|
| 10.1 | **Merge PR** | `gh pr merge <PR#> --merge` | Merged to main |
| 10.2 | **Push migrations to prod** | `supabase link --project-ref xtertgftujnebubxgqit && supabase db push --linked --include-all` | All migrations applied, no errors |
| 10.3 | **Re-link to staging** | `supabase link --project-ref ivjkdaylalhsteyyclvl` | Linked back to staging |
| 10.4 | **Deploy edge functions** | `supabase functions deploy <name> --project-ref xtertgftujnebubxgqit` | Only if function source changed |
| 10.5 | **Vercel auto-deploy** | Check Vercel dashboard or `curl -sI https://www.inhockia.com` | 200 OK, latest commit deployed |
| 10.6 | **Production health** | `curl -s https://xtertgftujnebubxgqit.supabase.co/functions/v1/health` | `{"status":"healthy"}` |
| 10.7 | **Post-deploy smoke** | Repeat gates 8.1, 8.3, 8.4, 8.7, 8.8 on `https://www.inhockia.com` | All green |
| 10.8 | **Monitor logs** | Supabase Dashboard → Logs (5 min) + Sentry → Issues | No new errors |

---

## 11 — Post-Release

| # | Gate | Command / Action | Pass criteria |
|---|------|------------------|---------------|
| 11.1 | **Tag release** | `git tag -a v<YYYY.MM.DD> -m "Release: <summary>" && git push origin v<YYYY.MM.DD>` | Tag visible on GitHub |
| 11.2 | **Changelog** | Create GitHub Release from tag with summary of changes | Published |
| 11.3 | **Rollback notes** | Document in release notes: (a) frontend rollback = Vercel instant rollback, (b) DB rollback constraints = list any irreversible migration steps | Documented |
| 11.4 | **Sync branches** | Ensure `staging` and `main` are at the same commit | `git log --oneline origin/main..origin/staging` is empty |

---

## Quick Reference — Rollback Procedures

| Component | Rollback method | Time to recover |
|-----------|----------------|-----------------|
| **Frontend (Vercel)** | Vercel Dashboard → Deployments → Instant Rollback | < 1 minute |
| **Database (additive migration)** | Write a new reverse migration + `supabase db push` | 5-10 minutes |
| **Database (destructive migration)** | Restore from point-in-time backup via Supabase Dashboard | 10-30 minutes |
| **Edge functions** | `supabase functions deploy <name> --project-ref xtertgftujnebubxgqit` with previous version | 2-5 minutes |

---

## CI Jobs Reference

| Job | What it checks | Blocking? |
|-----|---------------|-----------|
| Security Checks | Gitleaks + npm audit | Yes |
| Lint & Type Check | ESLint 0 warnings + tsc --noEmit | Yes |
| Unit Tests | Vitest + coverage thresholds | Yes |
| Build | Vite build + bundle budget | Yes |
| Migration Validation | supabase db push --dry-run | Yes |
| DB Integration Tests | RLS, triggers, state machines | Yes |
| E2E Tests | Playwright smoke suite (5 projects) | Yes |
| Vercel | Preview deployment | Yes |
| Uptime Monitor | Production health (runs every 5 min) | No (informational) |
