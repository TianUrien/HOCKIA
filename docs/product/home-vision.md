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

## The thesis (2026-10-20, final for now)
Instagram turns attention into advertising. HOCKIA turns attention into **intention**, and intention into outcomes. Three layers:

1. **The hockey world, for everyone, no question asked.** Home always opens with the life of the sport: who signed where, highlights, someone's Saturday match, who became open to play, new roles, players like you. Entertainment with surprise, all hockey and all real. Nobody has to know what they want.
2. **The intention engine underneath.** What a member does says what they want: the highlights they watch, the roles they open, the "open to play" they confirm, the questions they ask Hockia AI, what they post. HOCKIA infers an intention with a confidence level and **shows it to the member to confirm or correct** ("Looks like you're interested in playing in Belgium. Is that right?"). One tap declares it; nobody fills a form. With an intention, the same Home re-orders: Your path on top, Where you stand computed for it, Players like you refined, the agent preparing things. Without one, Home is the hockey world. The member always sees and controls the why.
3. **Brands enter at the moment, not in the feed at large.** Intentions define moments, and moments are where a brand is welcome instead of intrusive: signed abroad → gear and services in the new city; wants to play abroad → insurance, agencies, language; watches goalkeeper highlights → a goalkeeper-gear brand's video, as content; a club posts a role → team kits; season start in a country → pre-season gear. A brand targets intention and location, never people; enters as labelled content or offers, capped per visit; the member can say "not now" or "never this brand"; the brand gets aggregate numbers only.

Why this is "Instagram, but modern": Instagram ranks to keep you; HOCKIA ranks to move you (every item carries an action). Instagram asks you to post; HOCKIA gives you reasons (Sunday, a signing, a goal) and every post builds the profile, which is the CV. Instagram guesses who you are to sell to you; HOCKIA shows what it understood and lets you correct it.

Blocks (from the earlier drafts, re-ordered): the hockey world leads; Your path appears only with an intention; Where you stand and Players like you sharpen with it; the "what do you want next" question stays in onboarding and on the first visit (founder, 2026-10-20), with the fixed options plus **Other** and a free-text field; the member can pick up to three; skipping is allowed. Answers and free text are stored as internal data and measured (`goal_set {option, has_text}`), and the intention engine refines or confirms them over time.

Per role, the same thesis: a club's intention is a squad to fill (inferred from roles posted and reviews); a coach's is a job or a team; a brand's is its markets and ambassadors; an umpire's is appointments.

## The unit: the Move (2026-10-21, concept)
Instagram's unit is the post; LinkedIn's is the job. HOCKIA's is the **move**: who · verb · what · where · when, with optional proof (a photo, a signing card) and one action. Verbs: Signed, Needs (a club or coach asks), Open to play, Played, Moving, Looking, Shortlisted. Everything already built maps to a verb (a role = Needs; an application or availability = Open to play; a signing = Signed; a post with a photo = Played), so the model unifies recruiting, community and intention without new concepts for the member.

Home then has two things only (in plain words: the tab is Home, the card asks "What's your goal?", the feed is "This week in hockey"; "move" is the internal unit and the verb on cards): **Your goal** (one card: ask up to three moves or Other with free text, skippable and measured; once set, the move with a market read in real counts, the actions ready and the agent line attached to an action) and **Moves this week** (one card shape, newest first, across HOCKIA, bounded to the week). "Make a move" replaces "New post": one verb, one line, optional photo; Open to play and Moving are structured and feed Opportunities, Find players and the intention engine. Brands attach to a move (a labelled line under a Signed-abroad or Needs move, by location, at most one per visit), never float. Figma: page 02, section "HM"; prototype shared with the founder.

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
