# App hierarchy review: what is primary, secondary and redundant

Review for the founder, 2026-11-24. Nothing here is approved or built. Usage is from read-only aggregate queries on production the same day: page views and events of the last 30 days, onboarded members only, test accounts and automated views excluded. The screen map is from the code on staging the same day. Hypotheses are marked as such.

## Why

Founder, 2026-11-24: "We have a lot of things in the app. We need to see how we order and prioritise everything." The Home work the same day showed it in small: eight different blocks competed on Home, and two features (the goal card and the gear rail) existed nowhere else.

## Who is active (30 days)

203 members opened the app: 157 players, 26 coaches, 15 clubs, 5 brands, 0 umpires.

## What members use

Share of the 203 active members who opened each area at least once.

| Area | Members | Share | Note |
|---|---|---|---|
| Own profile | 175 | 86% | The most opened screen (2,947 views). |
| Home | 161 | 79% | |
| Inbox | 155 | 76% | Activity 135, Requests 90, a chat 113. |
| Opportunities | 154 | 76% | 140 opened at least one opportunity. |
| Community | 102 | 50% | 87 opened a member preview. |
| "Your activity" (`/pulse`) | 52 | 26% | |
| My applications | 52 | 26% | 49 players applied to something. |
| Who viewed me | 39 | 19% | |
| Hockia AI | 37 | 18% | Any Hockia AI event. |
| Settings | 35 | 17% | |
| World (club directory) | 25 | 12% | |
| Search | 22 | 11% | |
| Brands / Marketplace | 21 | 10% | |

Actions: 64 members sent a message, 67 tapped the Next step card on Home (200 taps), 31 set a goal, 25 sent a friend request, 18 edited their profile.

Recruiters: of 15 active clubs, 9 opened an applicants list, 5 changed an applicant's status, 4 opened "post an opportunity". Find players and the shortlist were each opened by fewer than 3 members. Brands: 5 active; every brand screen was opened by fewer than 3 members.

## What the map shows

1. **The five tabs are right, and four are used about equally.** Home, Inbox, Opportunities and own Profile each reach three in four members. Community reaches half.
2. **The profile is the real base, and it is the most crowded screen.** An owner sees 12 to 13 blocks on their own profile before any tab or sub-page. It is also where the goal card now lives.
3. **"What happened to me" is split in three.** Inbox › Activity (135 members), the Next step card (67 members, now leaving Home), and `/pulse` "Your activity" (52 members). After the Home change `/pulse` is reachable from one link that only shows when a private stat is above zero.
4. **The same thing appears in several places.** Thirteen groups found, the clearest:
   - a recruiter's own opportunities: profile card, profile section, Opportunities tab, and a legacy profile sub-page;
   - who viewed me: `/pulse`, the profile's private stats, the club views row, the brand reach block;
   - saved candidates: three routes (`/dashboard/saved`, `/dashboard/shortlists`, `/dashboard/shortlist`);
   - search: header search, desktop Home search, Community search, Inbox search;
   - brands: one screen with two names ("Brands" on phones, "Marketplace" on desktop).
5. **Some screens cannot be reached, or are built and not shown.** `/dashboard/saved` has no link. The Community "questions" list is unreachable. A profile "community hub" has no visible button. Five components are in the code and render nowhere.
6. **Hockia AI has no steady entry on phones.** The header that carries its button is hidden on Community, Opportunities, Inbox and Profile; on phones it shows on Home and inside Opportunities. 18% of members used it.
7. **Low use is not the same as low value.** Find players and the shortlist are recruiter tools and there are 15 active clubs; brand screens serve 5 brands. Search, World and Brands reach about one member in ten.

## Proposed order: one job per tab

| Tab | Its one job | Primary | Secondary | Leaves |
|---|---|---|---|---|
| Home | See what people in hockey post, and post | Posts, the post entry | One row of opportunities, one brand offer | Decided 2026-11-24. |
| Community | Find people | The directory with role chips and filters | Brands as one chip | The unreachable questions list. |
| Opportunities | The market | Talent: open and applied. Recruiters: my opportunities, applicants | Find players, shortlist | The legacy "my opportunities" profile sub-page; `/dashboard/saved`. |
| Inbox | Everything that happened to me and what I owe | Messages, requests, activity | The next step and who viewed me, inside Activity | `/pulse` as a separate screen (it redirects here). |
| Profile | Who I am, and my private corner | Hero, edit, one next step, goal | Private stats | Duplicate recruiter and viewer blocks. |

Across tabs: one name for the brands area, and one Hockia AI entry in the same place on every tab.

## Order of work, if approved

1. **Clean-up with no visible change**: remove the five unused components, the dead menu, and the routes nobody can reach; one saved-candidates route. Low risk, makes the rest easier.
2. **The next step and who viewed me move into Inbox › Activity**, and `/pulse` redirects there. This gives the 67 members who used the Next step card a place that 135 members already open.
3. **A lighter owner area on the profile**: one next step, the goal, private stats, then the public sections. Recruiting moves to the Opportunities tab where it already lives.
4. **Hockia AI entry on every tab** on phones.
5. **One name** for the brands area.

Not proposed: removing Search, World or the brand screens. Their use is low, but there is no evidence they are in the way.

## Hypotheses (to test, not conclusions)

- A1. Members look for "what happened to me" in the Inbox, so the next step belongs there more than on Home or the profile.
- A2. Fewer blocks on the owner's profile raise profile edits (18 members in 30 days).
- A3. Hockia AI use is limited by where its button is, not by interest.

## What we would measure

- Members who open Inbox › Activity and act on a next step, against the 67 who tapped it on Home.
- Profile edits and goals set per month.
- Members using Hockia AI per month.
- Applicant decisions by recruiters (5 clubs today).

## Open questions for the founder

1. Where does the next step live: Inbox › Activity (proposed), back on top of Home, or only on the profile?
2. Which of the five steps goes first?
