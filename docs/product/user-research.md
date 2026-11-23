# User research, evidence, hypotheses, gaps

What we know about what members come to HOCKIA to get. Used by every product and design change (rule: `.claude/skills/hockia-design-rules/references/workflow.md` › Customer obsession).

Rules for this file:
- **Evidence** has a date and a source (analytics query, interview round, support tickets). **Hypotheses** say how we'd test them. **Gaps** say what to measure.
- Aggregates only. No names, quotes that identify someone, user ids or emails: this repo is public (ADR 0006). Detailed reports live outside the repo; reference them by date.
- Never write a need as "validated" without evidence here.

## Evidence

### Home usage, production analytics, 2026-10-19
Source: read-only aggregate queries (events, home feed items, posts, applications); test/admin and hidden profiles excluded; detailed report kept outside the public repo (2026-10-19 home usage report). Umpires and brands had too few active members to report.
- Home is opened by most active members but is a **waypoint**: on average less than one Home session per member per week; clubs open it more than coaches. A large share of sessions leave or reload from Home.
- **Recruiting value happens outside Home**: a small minority of applications start from a Home role card; most start from Opportunities or a push/deep link. Taps from Home straight to a role page are rare.
- The **social layer is inactive**: almost no likes, and no Congrats or feed comments in 90 days (to verify these features work, see gaps).
- Feed supply is mostly **automatic items** (joined, open to play, video added, media added, milestones); member-written posts are few, and a small group writes most of them.
- The pulse availability check-in is mostly dismissed.
- Members who did recruiting actions **and** media/social returned more often than recruiting-only members (correlation only; selection bias likely; no media-only group to compare).

### Congrats and comments, production check, 2026-10-19
Source: the code agent reproduced the RPC path on staging (rolled-back transaction) and checked production functions, grants, triggers and logs.
- The features **work end to end**. The zero rows are **zero supply**: no "New signing" post has ever been created; the member posts of the last 90 days are plain text, which offer likes but not comments; most recent references are still pending, so no reference card was generated.
- Read: the social layer isn't broken, it's unused, a product signal, not an engineering one.

### Recruiter outcomes and satisfaction signals, production analytics, 2026-11-21
Source: read-only aggregate queries (roles, applications, status history, offers, events, app ratings, feedback); test accounts excluded. Proposal: `proposals/recruiter-satisfaction.md`.
- **Candidates arrive**: 40 published roles received 333 applications; only 2 roles received none. 17 of 42 clubs and 4 coaches have published a role.
- **Most applications are never answered through statuses**: 73 have a recruiter decision, 195 expired without one. Decided applications take a median of 7.6 days, with a long tail.
- **Recruiters talk more than they triage**: in 30 days, 104 messages sent and 44 conversations started against 25 applicant status changes.
- **Outcomes are unrecorded**: 14 of 16 closed roles closed by automatic expiry; the "filled via HOCKIA" field is empty on 15 of 16; 1 offer sent in the app, no signing recorded.
- **Almost no satisfaction data from recruiters**: 7 app ratings from clubs and coaches (22 dismissed the prompt), and no problem reports from any role (the form is only in Settings).
- A requirement set on a role can hide it from most of its audience: one role that required an EU passport was opened by more players than similar roles and received a fraction of their applications.

### A recruiter cannot tell how high an applicant has played, member message and simulator walk, 2026-11-23
Source: one message from a recruiting coach to the founder (direct evidence, one person), a walk of the club flow on the iPhone simulator against staging, and read-only aggregate queries on production; test accounts excluded.
- **The recruiter's words**: after getting a lead through the app, "just to see if he has played high level before is not clear to me". The same message asked for a central defender, an EU passport and a drag flicker for the second half of the season.
- **What the screen said**: the applicant review showed "Level: plays at a level close to yours", with no league, country or division; the league sat lower, inside Career, as a bare name.
- **The facts exist for under half of the players**: 157 of 357 players have a linked club with a league or a national team entry; 35 have a national team entry; 120 club career entries carry only a league typed by the player.
- **Founder (2026-11-23)**: recruiters judge level by the highest league and division played and by the national team.
- Change: "Level played" card at the top of the applicant review and on a player's profile for recruiters, and one line per applicant in the list (`lib/playerLevel.ts`). Not measured yet.
- Also seen in the walk, not changed: the Hockia AI check screen does not list the EU passport, the specialist skills or which fields are a must-have, so a club cannot confirm its hard requirements were understood; the role form offers four broad positions only.

### Brand promotion, production analytics and code read, 2026-11-21
Source: read-only aggregate queries (brands, offers, products, conversations, events, Hockia AI questions, feedback); test accounts and hidden profiles excluded. Proposal: `proposals/brand-promotion.md`.
- **No brand has used the promotion tool**: 9 brands, 0 offers ever created, 3 products from 2 brands, 0 updates, 0 ambassadors.
- **Members rarely go where brands are**: Community › Brands was opened by 21 members in 30 days (Home 152, Opportunities 146); 39 Marketplace views by 18 members in 90 days.
- **Almost no contact with brands**: 8 conversations with a brand in total, none started in the last 90 days.
- **Location targeting misses most members**: 185 of 438 members have a base country; an "Everywhere" offer is eligible for 381 (57 players and coaches have no birth date).
- **Hockia AI is a small surface today**: 12 questions from 4 members in 30 days, 8 with no result.
- **Problems are not recorded**: no feedback entries and no error rows tied to a moment in the app.

## Hypotheses (to test)
- H1. Members open Home to learn **what changed for them** (replies, views, roles that fit, applicants waiting), not to browse social content. Test: interviews per role + card impressions/CTR once tracked.
- H2. **Signings and market moves** (who signed where, new roles, who is available) are the community content members value; photos and highlights belong on profiles as a portfolio. Test: interviews; compare engagement of signing/role items vs media items.
- H3. Clubs want Home to be a **to-do** (who to answer, who is available); players want **chances** (roles that fit, who looked at them). Test: interviews by role.
- R1–R4 (recruiters): see `proposals/recruiter-satisfaction.md` › Hypotheses. Test: outcome question on role close, relevance question after reviewing applicants, recruiter interviews.
- B1–B4 (brands): see `proposals/brand-promotion.md` › Hypotheses. Test: a first campaign with a fixed window, and asking the active brands what they want members to do.
- H4. A Hockia AI briefing ("what changed and what I'd do next", with options) is clearer than a feed. Test: prototype test with members of each role.

## Gaps (measure before a redesign)
Instrumentation for gaps 1–8 shipped to staging on 2026-10-19 (PR #383); production with the next release; first useful read ≈ 2 Nov 2026. Event dictionary: `docs/engineering/analytics-tracking-plan.md` §4.6.
1. ~~Card impressions on Home~~, `home_card_impression {module_id, position, item_type}`.
2. ~~Module ids that match the current Home~~, `v1_next_step`, `v1_people_new` / `v1_people_available`, `v1_feed`, `v1_roles_rail`, `v1_end_of_feed`, `v1_people_pymk`, `v1_roles_rail_end` / `v1_people_available_end`.
3. ~~Feed scroll depth~~, `home_feed_scroll {milestone 25|50|75|100, …}`.
4. ~~Surface on post impressions and interactions~~, `post_impression` / `post_like` / `post_comment_create` carry `surface`; new `congrats_toggle`, `feed_item_comment_create`.
5. ~~Destination on Home clicks~~, `home_module_click {destination}`, `home_card_click {item_type, destination}`.
6. ~~Source on role views and application submits~~, `vacancy_view` / `application_submit {source: home_role_card|home_feed_card|home_next_step|opportunities|inbox|hockia_ai|push|direct}`; `application_submit` also `{via: apply_sheet|hockia_ai}`.
7. ~~"Who viewed you" view event~~, `profile_viewers_view {source}`.
8. Pulse `seen_at` is reliable only on brand/umpire dashboards; for players, coaches and clubs the "seen" signal is `next_step_impression` / `next_step_action {key, action, surface}`.
9. ~~Verify Congrats and comments work end to end~~, checked 2026-10-19: they work; zero rows = zero supply.
10. "New signing" feed item: keep until ~2 weeks of data are in (founder ruling, 2026-10-19), then decide.

## Research log
| Date | Method | Scope | Outcome |
|---|---|---|---|
| 2026-10-19 | Analytics (aggregate) | Home usage by role, 30/90 days | Evidence above; gaps 1–10 |
| 2026-10-19 | Production check | Congrats / comments pipeline | Works; zero supply (gap 9 closed) |
| 2026-10-19 | Instrumentation | Home gaps 1–8 (PR #383) | On staging; first read ≈ 2 Nov 2026 |
| 2026-11-21 | Analytics (aggregate) | Recruiter outcomes, answers and satisfaction signals | Evidence above; proposal `proposals/recruiter-satisfaction.md` |
| 2026-11-21 | Analytics (aggregate) and code read | Brand promotion: supply, surfaces, contact, moments | Evidence above; proposal `proposals/brand-promotion.md` |
| 2026-11-23 | Member message (1 recruiter), simulator walk, analytics (aggregate) | How a recruiter reads a player's level; posting an opportunity as a club | Evidence above; Level played card |
