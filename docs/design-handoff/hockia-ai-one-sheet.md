# Hockia AI: one mascot, one sheet, every role

Founder ruling 2026-10-22; context chip added 2026-10-30. Design: rebrand page 17 "Hockia AI" (sheets "Same sheet, every role") and store screenshot 10. Decision rows: `decisions.md`, 2026-10-22 and 2026-10-30.

## The rule
Hockia AI is one thing: the mascot opens one pull-up sheet, the same for players, coaches, clubs, brands and umpires. Turquoise and the mascot always appear together (never the colour alone). Only the context chip and the first three choices change by role and screen. Beta on every entry. The separate /discover page is retired: /discover and /discovery open the sheet over Home, with `?q=` in the composer.

## Entries
- The header mascot (`HockiaAiButton`) on every screen with the header, phone and desktop, every role.
- In-screen entries open the same sheet: `RoleAiEntry` on opportunity pages, the Home bar (`AiScoutBar`), "Ask Hockia AI" in Search, Opportunities, Need pages.

## The sheet
- Medium sheet over the screen with a 32 % scrim; drag up for the large sheet with the member's chats. Web: the same sheet, centred, max 560 px.
- Greeting, then the context chip, then three choices tagged DO IT FOR ME / ASK / LEARN, then the composer.

## Context chip (built 2026-10-30)
One removable pill under the greeting, above the choices: what Hockia AI is looking at.

- Anatomy: radius 999, 1 px `border-line`, white surface fill (no turquoise on the chip); padding 12 left, 10 right, 6 vertical; gap 8; label 12 px in ink primary as "<Topic> · <fact>" (middle dot, never an em dash); "✕" in ink tertiary with a 44 px hit area and `aria-label="Remove context"`. Left-aligned on phones, centred on the web.
- Copy, by role and entry (`lib/hockiaAiContext.ts`):

| Who, from where | Chip |
|---|---|
| Player or anyone, from Opportunities | Opportunities · N open (what that screen shows) |
| Coach (candidate), from Opportunities | Coaching opportunities · N open |
| Club or recruiting coach | Your opportunities · N open |
| Brand | Your offers · N live |
| Umpire | Your record · N matches officiated (never "appointments") |
| Player or coach with a goal, from anywhere else | Your goal · <first pick, or their own words> |
| No screen context and no goal | no chip |

- Counts are real reads; a count that is 0 or unknown drops " · <fact>" and keeps the topic. Never "0 open".
- One chip at a time. A role chat (opened on an opportunity) shows its own role chip instead.
- The chip stays on the chat when it grows to the large sheet (above the composer).
- ✕ removes the context for this conversation only; a new chat or an old chat from history starts with it again.

## The goal and the AI (founder 2026-10-30)
The goal chip is true: `nl-search` reads the member's private goal (`member_goals`, service role, `_shared/member-goal.ts`) and adds it to that member's own context, so answers can put the relevant suggestions first. It is never shown to anyone else. With the goal chip on, the greeting reads "Ask me anything about your hockey. I can see your profile and your goal." After ✕ it reads "… I can see your profile." and the client sends `use_goal: false`, so the server skips the goal for the rest of that chat.

When the member's profile is incomplete, the profile-completion greeting ("I can finish your profile with you…") wins over the goal greeting; the goal chip still shows (design review 2026-10-30: a complete profile helps the member more, and the chip already names the goal).

## First three choices by role (design target)
Built today: role-aware examples from `exampleQueriesFor` (lib/hockiaAi) and, on an opportunity, Check my profile / Prepare my application / a LEARN question. The page 17 per-role sets below are the target for a later pass.

| Role | Choices |
|---|---|
| Player | Find opportunities that fit me · Check my profile against an opportunity · Fill my profile from my files |
| Coach (candidate) | Find coaching opportunities for me · Check my profile against an opportunity · Prepare my application |
| Club or recruiting coach | Find available players for <opportunity> · Summarise my applicants · Draft a new opportunity |
| Brand | Find ambassador candidates in my countries · How did my offers do this month? · Write a new offer for members |
| Umpire | Add my latest match · What is missing from my record? · Who are the umpires based in my country? |

Rules for every answer: facts, never a fit verdict or a score; no invented numbers; people results apply the hidden-profile predicate and never include under-18s.

Native note: installed apps keep their bundled JS until the next store release, so the chip reaches phones with the next store builds. The server change is additive (an older client never sends `use_goal`, so its chats use the goal).

## Follow-ups (design review 2026-10-30)
- Web container: the spec is a 440 px side panel on the right edge with the page still visible, so a screen chip sits next to the page it describes. Today the web sheet is a centred 560 px dialog. Move it to the side panel after the store builds, unless it turns out small. Inside the panel the chip is left-aligned, as on mobile; while the dialog is centred, a centred chip under the centred intro is fine.
- Dark mode: the web app has no dark theme today (Tailwind `darkMode: 'class'`, never set). Not in rebrand phase-1 scope; don't add one for the chip.
- Check the chip at 390 px in the iOS simulator (staging checks so far: web 1382 px and 500 px).
