# User research — evidence, hypotheses, gaps

What we know about what members come to HOCKIA to get. Used by every product and design change (rule: `.claude/skills/hockia-design-rules/references/workflow.md` › Customer obsession).

Rules for this file:
- **Evidence** has a date and a source (analytics query, interview round, support tickets). **Hypotheses** say how we'd test them. **Gaps** say what to measure.
- Aggregates only. No names, quotes that identify someone, user ids or emails — this repo is public (ADR 0006). Detailed reports live outside the repo; reference them by date.
- Never write a need as "validated" without evidence here.

## Evidence

### Home usage — production analytics, 2026-10-19
Source: read-only aggregate queries (events, home feed items, posts, applications); test/admin and hidden profiles excluded; detailed report kept outside the public repo (2026-10-19 home usage report). Umpires and brands had too few active members to report.
- Home is opened by most active members but is a **waypoint**: on average less than one Home session per member per week; clubs open it more than coaches. A large share of sessions leave or reload from Home.
- **Recruiting value happens outside Home**: a small minority of applications start from a Home role card; most start from Opportunities or a push/deep link. Taps from Home straight to a role page are rare.
- The **social layer is inactive**: almost no likes, and no Congrats or feed comments in 90 days (to verify these features work — see gaps).
- Feed supply is mostly **automatic items** (joined, open to play, video added, media added, milestones); member-written posts are few, and a small group writes most of them.
- The pulse availability check-in is mostly dismissed.
- Members who did recruiting actions **and** media/social returned more often than recruiting-only members (correlation only; selection bias likely; no media-only group to compare).

## Hypotheses (to test)
- H1 — Members open Home to learn **what changed for them** (replies, views, roles that fit, applicants waiting), not to browse social content. Test: interviews per role + card impressions/CTR once tracked.
- H2 — **Signings and market moves** (who signed where, new roles, who is available) are the community content members value; photos and highlights belong on profiles as a portfolio. Test: interviews; compare engagement of signing/role items vs media items.
- H3 — Clubs want Home to be a **to-do** (who to answer, who is available); players want **chances** (roles that fit, who looked at them). Test: interviews by role.
- H4 — A Hockia AI briefing ("what changed and what I'd do next", with options) is clearer than a feed. Test: prototype test with members of each role.

## Gaps (measure before a redesign)
1. Card impressions on Home with module id, position and item type.
2. Module ids that match the current Home.
3. Feed scroll depth.
4. A surface property on post impressions and feed interactions.
5. A destination property on Home clicks.
6. A source property on role views and application submits (Home card, Opportunities, push, Inbox…).
7. An event when someone views "who viewed you".
8. Reliable seen time on pulse items.
9. Verify Congrats and comments work end to end (zero rows may be a bug).
10. Decide on a "New signing" feed item type.

## Research log
| Date | Method | Scope | Outcome |
|---|---|---|---|
| 2026-10-19 | Analytics (aggregate) | Home usage by role, 30/90 days | Evidence above; gaps 1–10 |
