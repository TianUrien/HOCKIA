# Hockia AI: one mascot, one sheet, every role (founder ruling 2026-10-22)

Design: Figma page "06 · Hockia AI", section "AI1" (S1 to S3 plus one sheet per role). Decision row: `decisions.md`, 2026-10-22.

## The rule
Hockia AI is one thing: the mascot opens one pull-up sheet. Same entry, same sheet, every role (player, coach, club, brand, umpire). Only the context chip and the first three choices change by role and by screen.

## Entries
1. **Header mascot, every role.** `HockiaAiButton` (the mascot head in the soft ring, 44 pt hit) in the header of every screen that has the header, on phone and desktop, for all five roles. It replaces the Sparkles icon in `Header.tsx` (the club-only mobile button and the desktop button for everyone).
2. **Opportunities, recruiters.** Clubs and recruiting coaches keep the mascot next to "Post a role" on Opportunities (S1). It opens the sheet with "Your roles · N open" as context.
3. **In-screen entries stay, and all open the sheet:** `RoleAiEntry` on role pages; "Summarise applicants" on applicants; the club Home bar (`AiScoutBar`) opens the sheet with the typed text instead of navigating to /discover; "Ask Hockia AI" in Search opens the sheet with the query.

## The sheet
- Medium detent over the current screen; drag up for full screen with the member's chats (S3). The close and the chats button sit in the full-screen header.
- A removable context chip from the current screen (role, roles, goal, offers, record). Removing it = a general question.
- Three choices tagged DO IT FOR ME / ASK / LEARN, then the composer. Beta label always.

## First choices by role (sheet opened from that role's main screen)
| Role | Context chip | Choices |
|---|---|---|
| Player (Home) | Your goal · <goal> | Find roles that fit me · Check my profile against a role · Fill my profile from my files |
| Player (role page) | <role> · <club> | Check my profile against this role · Prepare my application · What is life in <city> like for a player? |
| Coach, candidate (Opportunities) | Coaching roles · N open | Find coaching roles for me · Check my profile against a role · Prepare my application |
| Club or recruiting coach (Opportunities) | Your roles · N open | Find available players for <role> · Summarise my N applicants · Draft a new role |
| Brand (Home) | Your offers · N live | Find ambassador candidates in my countries · How did my offers do this month? · Write a new offer for members |
| Umpire (Profile) | Your record · N appointments | Add my latest appointment · What is missing from my record? · Who are the umpires based in my country? |

Rules that hold for every answer: facts, never a fit verdict or a score; no invented numbers; people results apply the hidden-profile predicate and never include under-18s; brands see candidates only among players who opted in to brand partnerships (see `docs/product/proposals/brand-results.md`).

## Remove (the old way)
- The Sparkles Hockia AI buttons in `Header.tsx` (mobile club-only and desktop).
- The `/discover` page as a destination: `DiscoverPage`, `DiscoverChat`, and every `navigate('/discover…')` (`AiScoutBar`, `SearchV2Screen` via `discoverPathFor`). Keep `/discover` and `/discovery` as redirects that open the sheet over Home (with `?q=` passed into the composer), so old links and shared URLs still work.
- Leftover references once the page is gone: the `/discover` entries in `MobileBottomNav` hidden routes, `AppRatingPrompt` calm surfaces, `routeMeta` and the `App.tsx` "discovery" surface name.

## Order (so nobody loses their chats)
1. The sheet gets full screen and the chats list (history read from the same store the page uses).
2. Every entry opens the sheet; the header mascot ships for all roles; Sparkles removed.
3. `/discover` becomes a redirect that opens the sheet.
4. Delete the dead page and components.

Native note: installed apps keep their bundled JS until the next store release, so older versions still show the sparkle and the page until members update. Nothing server-side changes, so nothing breaks for them.
