# Operating model: how HOCKIA engineering is organised

Date: 2026-11-11. Source: founder mandate in the engineering session
("Engineering setup" leads technical development and coordinates the other
sessions), plus the repository, production and staging state checked that day.
This document is the contract between the engineering lead session and every
other session or agent. It contains no credentials and no member data.

## 1. Goal and what "world-class" means here

HOCKIA should be the reference app for field hockey: players, coaches, clubs,
umpires and brands. Product priority is unchanged (clubs first, free for every
role; see the `hockia-design-rules` skill). For engineering, world-class is
five measurable things, in this order when they conflict:

1. **Safety and trust**: no member's data or account is exposed; abuse is
   easy to stop (block, report) and hard to repeat.
2. **Reliability**: a release never breaks installed native apps; every
   production change has a rollback.
3. **Usability**: every screen answers what the member came to get; native
   gestures, keyboard and motion behave like a first-party app.
4. **Performance**: first load inside the bundle budget; no screen waits on
   a slow query.
5. **Design quality**: tokens, components and copy follow the founder's
   rulings.

## 2. Roles

| Role | Session | Owns | Does not do |
|---|---|---|---|
| Engineering lead | Engineering setup | Architecture, code, migrations, releases, quality gates, this backlog; the only role that writes to production | Product or business decisions (the founder's) |
| Design | Figma skills | Figma file, design handoffs, visual review of staging | Code in `client/src` |
| Data | Hockia Analytics skill | Tracking plan, admin analytics, Search Console and funnel analysis | Production releases |
| Content | Video production setup | Videos, brand assets, product specs written from data | Code, production data writes |
| Community | Hockia Community Manager | Social content, outreach drafts, member feedback | Sending messages without the founder's approval |
| Founder | (human) | Product and business decisions, store signing, approvals for production | |

Specialist engineering sessions are created by the lead for a bounded task
(dependency upgrades, E2E repair, security review, performance). Each gets a
brief with the files, the definition of done and the checks to run, works in
its own worktree and ends in a pull request into `staging`.

## 3. Intake: what the lead needs from other sessions

A request becomes engineering work when it carries:

1. **The member and the job**: who it is for and what they came to get.
2. **Evidence**: a number with its date, window and filters, or a quote, or
   "hypothesis" stated as such. No invented metrics.
3. **The decision already taken**, and by whom. A decision relayed from
   another session is confirmed with the founder in the engineering session
   before anything is built.
4. **The smallest slice** that tests the idea.
5. **What must not change** (for example: landing screen, navigation).

Design handoffs follow `docs/design-handoff/`. Data requests to engineering
are read-only unless the founder approves a write.

## 4. Quality gates (all already enforced; listed in one place)

| Gate | Where |
|---|---|
| Lint, strict typecheck (`tsc -b`), unit tests, build, smoke E2E before a client push | root `CLAUDE.md`, testing.md |
| Every migration: rollback file, probe for security-relevant changes, shown to the founder before applying | standards.md, security.md |
| Hidden-profile predicate on every read that returns people | security.md §3.4 |
| No API-breaking change without checking the oldest native build in the field | root `CLAUDE.md` |
| Staging first; full CI green (Lint & Type Check and E2E) before merge | operations.md |
| Production: dry run, then `db push`; read-only verification after; release PR `staging → main`; tag and GitHub release | operations.md §2 |
| UI change: checked in the iOS simulator or a browser against staging, and stated honestly when it was not | this document |
| After a release: the changed flow is exercised in production with a real session when it can be done without side effects | added 2026-11-11 (found one desktop bug this way) |

## 5. Release train

- **Web and database**: continuous. Small releases, each one a tagged
  `vYYYY.MM.DD[.n]`.
- **Native (App Store, Google Play)**: batched. Everything visual that
  reaches the bundled client waits for a store build the founder signs.
  Server-decided behaviour reaches installed apps at once, which is why new
  response shapes are opt-in (see `get_home_feed_v2`'s `p_open_to_play`).

## 6. Backlog, prioritised (state on 2026-11-11)

Order follows section 1. "Evidence" is what was observed, with its date.

### P0: safety and reliability

| # | Item | Evidence | Size | Needs founder |
|---|---|---|---|---|
| 1 | Store build with the native changes of 2026-11-10 (messaging gestures, keyboard fixes, block from chat, open-to-play card, link click tracking) | Installed builds iOS 1.3.24, Android 1.25 predate them | S + founder signing | Yes: signing |
| 2 | Bot protection on sign-in and sign-up: rate limit first, then enforce Turnstile | 225 automated "Continue with Apple" starts in two hours on 2026-11-10 from 4 networks with one device signature; 28 Oct surge | M | Yes: when to enforce |
| 3 | An admin block should also end the session (ban in auth) | A blocked member can still sign in (security.md §3.4) | S | No |
| 4 | Review and release #530 (field hockey SEO, sitemap, Ecosystem reach) | Merged into staging by the Data session; not reviewed by the lead; needs a migration and an edge function deploy | S | Yes: production |
| 5 | Database alerts: CPU, connections, email volume | capacity.md §8.5: metrics exist without alerts | S | No |

### P1: product quality

| # | Item | Evidence | Size |
|---|---|---|---|
| 6 | Dependency upgrades | 6 open Dependabot PRs: 37 minor/patch updates and 4 majors (`@sentry/react` 11, `vite-plugin-pwa` 2, `web-vitals` 6, `@vitest/coverage-v8` 5) | M |
| 7 | Repair or delete the stale E2E specs | ~117 pre-rebrand failures in the full suite; only smoke is trusted | M |
| 8 | Two unit tests depend on the machine's timezone | `clubProfileScreen`, `lib.clubRecruiting` fail outside UTC | S |
| 9 | Sign-in screen: content scrolls under the status bar when the keyboard opens | iOS simulator, 2026-11-10 | S |
| 10 | App icon badge and push badge count notifications, not unread messages | messaging code review, 2026-11-10; to verify | S–M |
| 11 | Deleting a conversation marks its unread messages as read (the sender sees a read receipt) | Known trade-off of 20261110100000 | M |
| 12 | Device lab: WebView attach on iPhone 17e and iPad; WebDriverAgent build missing | device-lab.md; build log 2026-11-10 | M |
| 13 | Session and screen duration are not tracked | Home analysis 2026-11-10 | S |
| 14 | Load test on staging (k6 plan) and top-20 query review | capacity.md §6, §8: not run | M |

### P2: product, waiting for data or a decision

| # | Item | Evidence | Next step |
|---|---|---|---|
| 15 | Home v2 beyond the feed clean-up | Spec under review; new numbers since 2026-11-10 ~19:30 UTC | Review around 2026-12-01 |
| 16 | Clubs answering applicants | All 25 application status changes in 14 days were "rejected" or "no response" | Founder: product direction |
| 17 | References and posting prompts at real moments | 1 reference and 16 posts in 4 weeks | Founder: product direction |

### Housekeeping

| # | Item | Evidence |
|---|---|---|
| 18 | 41 local worktrees, 31 with branches already in `staging`; 341 remote branches | `git worktree list`, 2026-11-11 |
| 19 | Test messages left in staging conversations by E2E runs | 2026-11-10 |

## 7. How this document is kept

The lead updates the backlog when an item ships or new evidence appears, with
the date. Items leave the table when released; the release tag is the record.
