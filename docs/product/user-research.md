# User research, evidence, hypotheses, gaps

What we know about what members come to HOCKIA to get. Used by every product and design change (rule: `.claude/skills/hockia-design-rules/references/workflow.md` › Customer obsession).

Rules for this file:
- **Evidence** has a date and a source (analytics query, interview round, support tickets). **Hypotheses** say how we'd test them. **Gaps** say what to measure.
- Aggregates only. No names, quotes that identify someone, user ids or emails, this repo is public (ADR 0006). Detailed reports live outside the repo; reference them by date.
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

## Hypotheses (to test)
- H1. Members open Home to learn **what changed for them** (replies, views, roles that fit, applicants waiting), not to browse social content. Test: interviews per role + card impressions/CTR once tracked.
- H2, **Signings and market moves** (who signed where, new roles, who is available) are the community content members value; photos and highlights belong on profiles as a portfolio. Test: interviews; compare engagement of signing/role items vs media items.
- H3. Clubs want Home to be a **to-do** (who to answer, who is available); players want **chances** (roles that fit, who looked at them). Test: interviews by role.
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
