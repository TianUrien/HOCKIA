# Home vision, everyone has an agent

Founder direction, 2026-10-20 (revised the same day). One page. Hypothesis map: the central bet is untested (see "How we'll know").

**Revision (2026-10-20, later):** the agent works for the member but does not narrate Home. An agent-voiced Home read as "very AI". Home is human first: your moment, then this week in your hockey (real moves and member posts from all of HOCKIA), with the agent attached to actions and one small daily summary at most.

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

## What Home is (revised again, 2026-10-20)
The member declares a hockey goal; Home is built around it. The psychology behind it (hypotheses, from the Jobs work): a player wants to know where they stand, looks at other players to place themselves and copy a path, needs a concrete next step, and wants to be seen by the right clubs. Four blocks, in this order:

1. **Your path**: the goal ("Play in Europe next season", "Move up a division", "Find a club where I moved", "Get a sponsor", "Keep playing"), the next step, and what the agent already prepared, one tap each. The agent works here and only here.
2. **Where you stand**: a market read for the goal, with real counts however small ("This window, 6 clubs in Europe are looking for left backs in your category; 2 ask for an EU passport, which you have") and the interest in you (views, shortlists). We measure the market, never the person.
3. **Players like you**: public moves and posts of members with your position, category, country and level, with name and photo: signings, new clubs, match posts. Never ordered as "better"; newest first. This is the "I can do that too" and the map of how.
4. **The moves**: who went where across HOCKIA (signings, new roles, people now open to play, member posts), the transfer page of hockey. One reaction and comments; bounded to the week.

Posts live inside blocks 3 and 4 as stories of people on the same path. The agent never narrates; "while you were away" is at most one line inside Your path.

Per role, the same shape with a different goal: a club's goal is a squad to fill; a coach's is a job or a team; a brand's is ambassadors and markets; an umpire's is appointments.

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
