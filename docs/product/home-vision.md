# Home vision, everyone has an agent

Founder direction, 2026-10-20. One page. Hypothesis map: the central bet is untested (see "How we'll know").

## The bet
Professionals have an agent; almost nobody in field hockey does. HOCKIA gives every member one. Hockia AI is that agent: the player's agent, the club's sporting director, the coach's agent, the brand's partnerships desk, the umpire's federation liaison. Home is **the agent's desk**: what it did for you while you were away, what it found, and what it needs you to decide, one tap each.

## Why this and not a feed
- Members don't come to scroll; they come to make progress in their hockey life (`user-research.md`: Home is a waypoint; the social layer is unused; recruiting happens outside Home).
- A career moves in moments, a reply, a fitting role, a window opening, a signing. An agent works between the moments and shows up when one arrives.
- Everyone on HOCKIA is field hockey. The agent knows the leagues, the windows and the people; no general platform can.

## What the agent does (and what it never does)
1. Tells the truth, kindly: facts about what a level asks for and what you have, never judgements about the person (age, gender, nationality, looks).
2. Moves you at the right time: windows per country, clubs recruiting now, people who just became available.
3. Does the heavy lifting: applications, replies, kind declines, profile completion, as drafts the member confirms.
4. Works your side: brings clubs people with confirmed availability; brings players clubs that answer.
5. Brings you deals: gear, sponsorship, courses, kit, only when they fit you and where you are.
It never promises outcomes ("I'll get you signed"); it promises work ("I'll put you in front of the right clubs"). Nothing is sent or saved without the member's tap. Beta label stays while it is beta.

## Per role, the desk when you open Home
| Role | The agent's line | What it brings |
|---|---|---|
| Player | "Holcombe replied. I drafted your answer." | replies, fitting roles with the application ready, who looked at you, one thing to improve, a deal that fits |
| Club / recruiting coach | "3 players are waiting. Two don't match the level. I drafted kind replies." | applicants with days left, newly available people who fit, confirmed availability, a kit or service deal for the club |
| Brand | "12 players fit your ambassador programme; 3 clubs in your market are recruiting this window." | matches, moments (signings, kit seasons), deal results in aggregate |
| Umpire | "A new appointment was added. Your profile is ready for the season." | appointments, references, profile readiness |
When nothing happened: a calm line. No filler, no photos, no likes.

## How brands fit: deals, not ads
A brand publishes offers and partnership proposals with a target (roles, location, never nationality, or "no location"). The member's agent brings a deal only when it fits a fact about them and where they are: "A deal I found for you: kit for your first season at X, from a shop in your city." At most one per Home visit, labelled, mutable, admin-reviewed while free; brands see aggregates only. Details: `proposals/brand-reach.md`.

## Order of work
1. Club speed (approved): more roles posted and answered, the agent needs facts to work with.
2. Agent's desk, stage 1 (player, club, brand): replies, drafts, fits, calm.
3. Deals (brand reach) and the market section when real moves exist.

## How we'll know (the central hypothesis)
- Members accept an AI agent acting for them: confirm rate of agent drafts (sent vs dismissed), mute rate, return rate 2/4 weeks vs today's Home. **[TARGET: set after 4 weeks]**
- Agent work turns into loop progress: applications and replies started from Home (`application_submit {source: home_*}`, `next_step_action`), replies within the window.
- Cheapest test: ship the player desk only (HV1–HV3 equivalent) behind a flag to active players; read drafts confirmed vs dismissed and the return rate before building the rest.
