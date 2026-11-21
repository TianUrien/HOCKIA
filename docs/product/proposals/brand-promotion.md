# Brand promotion: campaigns with an objective, shown at the right moment

Proposal for the founder, 2026-11-21. Phases 1 and 2 approved for build the same day (see Founder rulings); phases 3 and 4 are not. Evidence is from the code on `staging` and from read-only aggregate queries on production the same day (test accounts and hidden profiles excluded). Targets are marked **[TARGET]** and are placeholders until data exists. Aggregates only: no names, ids or quotes (ADR 0006). Builds on `brand-reach.md` (offers with a target) and `brand-results.md` (what a brand sees); where this file differs, it says so.

## Why

The founder signed in as a brand and could not tell how a brand promotes itself. The only promotion tool is called "Offers" and is written around a discount (placeholders "15% off", "HOCKIA15"). The founder's own objective as a brand is different: be there when a member has a doubt or a problem, so the member writes to the brand. Every brand will have its own objective. The system must answer two questions for each one: who is relevant (targeting) and when and where to show it (the moment), and it must show the brand what happened.

## What exists today (code, 2026-11-21)

A brand has five tools. All are free.

| Tool | What the brand does | Where members meet it |
|---|---|---|
| Profile | Logo, cover, bio, website, Instagram, category, country | Community › Brands, search, `/brands/:slug` with Follow and Message |
| Products | Name, photos, link, one need | Brand profile, Home feed (to everyone, by date), Home rail and Marketplace only when the brand also has a live offer reaching the member, or is based in the member's country |
| Updates (posts) | Text and a photo | Brand profile and everyone's Home feed, by date |
| Offers | Photo, title, need, "what members get", optional perk and code, a required https link, where members live (Everywhere, regions or countries, optional city), roles, optional start and end. Live at once, up to 5 live | Community › Brands and need pages, the Home rail "Gear and deals near you", one card under a Hockia AI answer, the "Get ready for <country>" sheet after applying abroad, the offer page (Go to store, Message, Copy code, Apply as ambassador) |
| Ambassadors | Invite players who opted in; "Open to partners" | "<Brand> athlete" line on the player's profile |

How an offer is matched today (`brand_offer_eligible_for`): the member's base country (never nationality), an optional city text match, role, adults only (players, coaches and umpires need a birth date showing 18 or more; clubs are exempt), never a hidden profile, a blocked pair, the brand itself, a dismissed offer or a hidden brand. Order: least recently shown to that member first, then random.

What the brand sees: "Reach this week" (profile views, search appearances, store taps, 7 days); per offer: shown to, opened, contacted, store visits, codes copied, "Not useful"; the Results screen with breakdowns by country, role and surface for groups of 5 or more, and the members who chose to write to the brand.

### Gaps against the founder's objective

1. **One objective.** An offer always ends in a store link. "Write to us with your question" is possible only as a secondary button on the offer page. The link is required even when the brand wants a conversation, not a visit.
2. **Four commercial needs.** Gear, Moving abroad, Training and recovery, For clubs. A help or service objective has no place.
3. **Few moments, none for doubts or problems.** A brand appears when a member browses the Marketplace, scrolls Home, applies abroad, or asks Hockia AI about six topics matched by an English word list (`AI_TOPICS`). A question in Spanish never matches. Nothing appears when something fails, when a search or a Hockia AI question returns nothing, or when a member opens Help.
4. **No campaign.** Start and end dates are optional; an offer can run for ever. There is no cap on how often one member sees the same offer, other than rotation.
5. **"Contacted" is inferred.** It is counted on the member's device when a first message is sent within an hour of opening an offer. A member who writes later, or from the brand profile, is not counted.
6. **The entry point does not explain itself.** The brand dashboard says "Create your first offer"; nothing says "this is how you reach members" or asks what the brand wants to achieve.

## What we know (production, 2026-11-21)

| Area | Finding |
|---|---|
| Brands | 9 brands (2 equipment, 2 apparel, 2 technology, 2 recruiting, 1 services). 6 were active in the last 30 days. |
| Supply | 0 offers have ever been created. 3 products from 2 brands. 0 updates. 0 ambassadors. 0 players have turned on "Open to brand partnerships". |
| Members | 438 players, coaches and clubs. 187 were active in the last 30 days. No umpire accounts yet. |
| Reach of an offer | An "Everywhere, all roles" offer would be eligible for 381 members. 57 players and coaches have no birth date and are excluded. Only 185 members have a base country, so a country-targeted offer misses more than half. |
| Marketplace | 39 Marketplace views by 18 members in 90 days. Community › Brands was opened by 21 members in 30 days, against 152 for Home and 146 for Opportunities. |
| Brand profiles | 15 views by 5 members in 30 days. 0 search appearances. |
| Products | 8 product views, 2 rail impressions and 1 store tap in 90 days. |
| Contact | 8 conversations with a brand in total, with 2 brands. None started in the last 90 days. |
| Hockia AI | 12 questions from 4 members in 30 days; 8 returned no result. 16 questions from 6 members in 90 days. |
| Problems | The feedback form has no production entries. `error_logs` has no rows in 30 days; client errors go to Sentry and are not tied to a moment in the app. |
| Goals | 26 members have set a goal. |

## What we cannot tell

- **Whether members want to hear from brands at all.** No offer has ever been shown, so there is no open, contact or "Not useful" rate.
- **Why no brand has published an offer.** The founder's own confusion is one data point; the other eight brands have not been asked.
- **How often members hit a problem or a doubt.** Failures are not recorded as events, and nobody uses the feedback form.
- **Whether a brand that is contacted answers.** No recent conversation exists to measure.

## Hypotheses (to test, not conclusions)

- B1. Brands do not publish because the tool is framed as a discount and does not ask what they want to achieve.
- B2. A member with a doubt or a problem will write to a named, visible helper more readily than fill in a feedback form.
- B3. A brand card tied to something the member just did is opened more than the same card on Home or in the Marketplace.
- B4. With about 190 active members, a 10 to 15 day campaign gives a brand a readable result only for objectives near the top of the funnel (shown, opened, contacted), not for sales.

## The design

### One object: a campaign

A campaign replaces "offer" as the thing a brand creates. The current offer becomes one kind of campaign, with nothing lost.

A campaign is: **one objective, one message, an audience, the moments it may appear in, and a start and an end date.**

### Objectives

The brand starts by answering "What do you want members to do?". The answer sets the button, the required fields and the number that counts.

| Objective | Button the member sees | Required from the brand | The number that counts |
|---|---|---|---|
| Ask you a question | "Ask <brand>" opens a chat with the brand, with the topic attached | Who answers and in which languages. No link | Conversations started, and answered |
| See a product or service | "See it" opens the store or the product | A link or a product | Store visits |
| Use an offer | "Go to store", "Copy code" | Perk or code, link | Store visits, codes copied |
| Become an ambassador | "Apply as ambassador" (players only) | "Open to partners" on | Applications |
| Get to know you | "Follow" | Nothing more | New followers |

"Get to know you" is the weakest objective and ships last, if at all: a card that asks for nothing useful is the closest thing to an advert.

### Opportunity: the moments

A brand never picks a screen. It picks moments from a fixed list that HOCKIA maintains. Each moment has a rule that says when it is true, one place where the card appears, and the objectives and categories allowed in it. A moment is true or it is not: when it is not, nothing is shown, and an empty slot is the normal state.

| Moment | True when | Place | Open to |
|---|---|---|---|
| Looking for something | The member opens Community › Brands or a need page | The existing rails | Every objective (exists) |
| Asked Hockia AI | The member's question is about a topic on the list (gear, kit, training, camps, physio, moving abroad, and new: how HOCKIA works) | One card under the finished answer, after "From brands" (exists; topic list to extend) | Campaigns whose need matches the topic |
| Moving | The member applied to a club in another country | "Get ready for <country>" sheet (exists) | Moving abroad |
| Just signed | A signing is confirmed for the member | One card on Home on the next visit | Gear, Moving abroad |
| Set a goal | The member saved a goal that maps to a need | One card on Home after the goal card | The matching need |
| Club is recruiting | A club published an opportunity | One card on the club's Home on the next visit | For clubs |
| No result | A search or a Hockia AI question returned nothing | One line under the empty result | Ask a question only |
| Something failed | An upload, a save or a screen failed | One line in the failure message | HOCKIA only (see below) |
| Looking for help | The member opens Help, the FAQ or the feedback form | One line at the top | HOCKIA only |
| On Home | No other moment is true | The existing rail, after the first post | Every objective (exists) |

**The founder's three examples, mapped:**

- *A member hits an error or a problem.* "Something failed" and "Looking for help". The line reads "Not working? Ask Hockia" and opens a chat with the HOCKIA account with the screen attached. This moment belongs to HOCKIA alone. A member who just lost an upload is frustrated; a third-party brand there would read as an advert on top of a failure. It is also the first place where problems would be recorded as events, which the recruiter research found missing.
- *A member has a question about hockey or about HOCKIA.* "Asked Hockia AI" with the new topic "how HOCKIA works", and "No result". Hockia AI answers first, as today. Below the answer, separate and labelled: "Still unsure? Ask <brand>". For hockey questions (gear, training, moving) the brand is one whose need matches.
- *A member needs a product.* "Asked Hockia AI", "Just signed", "Moving", "Set a goal" and "Looking for something", with the See a product or Use an offer objectives.

**Where a brand never appears:**

- Inside a Hockia AI answer, or changing it.
- In messages, in the inbox, or as a push or an email. A member hears from a brand only after writing to it or following it.
- In the apply flow, on an opportunity page, on applicant and recruiting screens.
- After "Not this time", a declined invitation or an expired application.
- On another member's profile or posts.
- During sign-up, onboarding, the age gate or the juniors waitlist.
- To a member under 18, a member with no birth date (person roles), a hidden profile, or a blocked pair.
- Next to a problem, except HOCKIA's own help line.

### Targeting

Signals that exist and may be used:

| Signal | Source | Limit |
|---|---|---|
| Role | Profile | Players, coaches, clubs, umpires |
| Where the member lives | Base country, region, optional city text | Never nationality. 253 of 438 members have no country: "Everywhere" stays the default until the country confirmation card closes the gap |
| Position | Profile | Only to match a product to a hockey role (goalkeeper kit). Never shown to the brand below 5 members |
| The moment | What the member just did | Stored as a moment name on the event, never the content |
| Topic of a Hockia AI question | Classified from the question | Only the topic name is kept with the event. The question stays private |
| Goal | `member_goals`, private | Used on the server to pick a need. The brand sees a goal breakdown only at 5 members or more |
| Follows and "Not useful" | `brand_followers`, dismissals, hides | A dismissed campaign or a hidden brand is never shown again |

Never used: nationality, gender, age (other than the 18 or over gate), appearance, the women's or men's category as a stand-in for gender, the text of messages or posts, who the member's friends are.

The brand never sees who was shown a card or who opened it. It sees totals, groups of 5 or more, and the members who chose to write to it. This is the existing ruling of 2026-10-22, unchanged.

### How AI is used, and how it is kept honest

Rules decide who may see a campaign. AI only helps choose and write, inside those rules.

| Layer | What it does | What keeps it honest |
|---|---|---|
| Fences (SQL, no AI) | Eligibility: place, role, adult, hidden, blocked, dismissed, dates, caps | AI cannot widen the eligible set. Same function as today, tested |
| Topic of a question (AI) | Reads the member's Hockia AI question and returns one topic from a closed list, or none. Replaces the English word list, so Spanish works | Closed list. "None" is a valid and common answer. A weekly admin sample checks the topic against the question category, in aggregate |
| Choice among eligible campaigns (rules first, AI later) | Picks at most one campaign for a true moment: need match first, then least shown. Later, Hockia AI may rank the few candidates by fit to the moment | It may only choose from the eligible set, and may choose nothing. Never ranks by anything about the person |
| Reason line (template) | "Shown because you asked about moving to England. It did not change the answer." | Filled from facts, never free AI text (ruling of 2026-10-04) |
| For the brand (AI, drafts) | Hockia AI as the brand's partnerships desk: writes the campaign from the objective, reads the results in plain words, proposes the next step | Drafts only. Nothing is published without the brand's tap. Counts are real or absent. No promise of results |

Checks that apply to the whole system:

- The Hockia AI answer is produced before any campaign is looked up and is never changed by it.
- Every card is labelled, says why it is shown, and offers "Not useful".
- Every impression records the moment and the rule that chose it, so any card can be explained afterwards.
- A share of eligible moments is deliberately left empty (**[TARGET: 10%]**), so the effect of showing a card on the member's own activity can be measured against not showing it. At today's volume this comparison needs several campaigns before it says anything.
- Hockia AI stays labelled Beta.

Later, when Hockia AI is more agentic, the member's side can go one step further: "A brand on Hockia answers questions like this. Want me to ask them for you?" Hockia AI drafts the message and the member sends it. The brand side: Hockia AI proposes a campaign when it sees a real opening ("14 clubs published an opportunity this month and no campaign is aimed at clubs"), with real counts only, in the same spirit as the dot that lights only for something real and new.

### Campaign window and frequency

- **A start and an end, always.** Default 14 days, shortest 7, longest 15 (founder, 2026-11-21). A campaign stops by itself (the hourly job already ends expired offers).
- **After the end:** the brand receives a closing summary and can run the campaign again with one tap, changed or not. Nothing renews by itself.
- **One live campaign per objective per brand**, up to the existing limit of 5 live.
- **Per member, per campaign:** shown on at most 3 visits **[TARGET]**; after that it rests for that member. "Not useful" ends it for that member at once.
- **Per member, all brands:** at most one brand card per screen and 2 per day **[TARGET]**, the Marketplace excluded because the member went there on purpose.
- **The caps live on the server**, counted from impression events. Today rotation is the only limit.
- **Reply duty for "Ask you a question":** if conversations wait more than 3 days **[TARGET]** without an answer, the campaign pauses and the brand is told why. A member who asks and hears nothing is the worst outcome of this objective.

### What the brand sees

Per campaign, during and after:

| Number | Meaning |
|---|---|
| Shown to | Distinct members who saw the card |
| Opened | Distinct members who tapped it |
| The objective's number | Conversations started and answered, store visits, codes copied, applications, or followers |
| Waiting for your reply | Conversations with no answer yet. The only amber on the screen |
| Not useful | Members who dismissed it |
| Where | Totals per moment (Hockia AI, Home, Marketplace, and so on) |
| Who | Country and role, groups of 5 or more; otherwise "Fewer than 5" |
| Days left | And the closing summary at the end |

No rates on the first screen and no charts while counts are small. With fewer than 5 members shown, the screen says so in words.

To make "contacted" exact, a conversation started from a card records where it came from on the server (`conversations.origin` already exists), replacing the one-hour guess on the device.

### What only admins see

- Moments that happened against moments that showed a card, per moment (is there supply for the demand?).
- "Not useful" and "Hide this brand" per brand and per moment.
- Members reaching the caps.
- Reply time per brand for the Ask objective.
- The left-empty comparison.
- The weekly topic sample for the AI classifier.
- Help moments: how many failures and empty results happened, on which screens.

## How we would read a first campaign

| Signal | Reading | Next step |
|---|---|---|
| Shown to fewer than **[TARGET: 30]** members in 14 days | The moments are too rare or the audience too narrow | Widen to Everywhere, add moments, before judging the message |
| Shown to many, opened by few | The message or the moment is wrong | Compare moments; rewrite |
| Opened, but no conversations | The step into a chat is too big, or the question was already answered | Offer suggested first questions |
| Conversations started, not answered | The brand is the problem | Pause; fix the reply before running again |
| "Not useful" above **[TARGET: 1 in 5 of those shown]** | Members read it as an advert | Stop the moment that causes it |

Numbers will be small. Every report states the count behind each figure.

## Risks

- **Members' trust.** HOCKIA has no adverts today. The mitigations are the moment rule (true or nothing), the label, the reason line, "Not useful", the caps and the list of places a brand never appears. The check is the "Not useful" rate and whether members keep coming back.
- **HOCKIA favouring itself.** The help line at a failure is product support, not a campaign competing with other brands. It is labelled "Hockia help", not "From brands", and its numbers are reported apart.
- **Minors.** The existing fence holds: no card for a member under 18 or with no birth date. Ambassador flows stay players of 18 or over who opted in.
- **Relevance.** An AI topic that is wrong puts a card under the wrong answer. Closed list, "none" as default, and the weekly sample.
- **Small numbers.** 187 active members and 4 members using Hockia AI in a month. Most breakdowns will read "Fewer than 5". A 14-day campaign is a learning tool, not proof.
- **A brand that does not answer.** Covered by the reply duty.
- **Thin supply.** Nine brands and no campaign yet. The first campaigns will be HOCKIA's own and one or two invited brands.
- **Old app builds.** Schema changes are additive, so installed builds keep working.

## Phases

| Phase | What ships | Size |
|---|---|---|
| 0. No code, this week | The founder publishes HOCKIA's first offer with today's tool (title, photo, "Everywhere", all roles, a link to the FAQ, end date in 14 days) to see the path end to end. Ask the other active brands what they want members to do. Baseline of the numbers above | None |
| 1. Objectives and a real window | "What do you want members to do?" at the start of the editor; the button and required fields follow the objective (no link for Ask a question); start and end required with the 14-day default; conversation origin recorded on the server; closing summary; the dashboard entry explains promotion in two lines. The screen and the object are named "Campaigns" | 1 PR, 1 migration |
| 2. Help moments for HOCKIA | "Not working? Ask Hockia" in failure messages, empty search and Hockia AI results, Help, FAQ and the feedback form; opens a chat with the HOCKIA account with the screen attached; events for each help moment | 1 to 2 PRs |
| 3. Moments and caps | The moment list on the server, one function that returns at most one card for a true moment, server-side caps, the AI topic classifier (English and Spanish) with the new topic, new moments (Just signed, Set a goal, Club is recruiting), the left-empty share, admin screen | 3 PRs, 1 to 2 migrations |
| 4. Hockia AI as the desk | Drafts a campaign from the objective, reads results in words, proposes the next campaign from real openings; on the member side, offers to ask the brand for them | 2 PRs, after phase 3 has data |

Phase 1 is the smallest build that fixes the founder's first problem (a brand can state an objective other than a discount and see what happened in a fixed window). Phase 2 is the smallest build that delivers the founder's own objective.

## Founder rulings (2026-11-21)

- **Build phases 1 and 2 together first**: campaign objectives with a real window, and HOCKIA's help line at failure and help moments. Phases 3 and 4 are not approved.
- **Failure and help moments are for HOCKIA only**, labelled as Hockia help. No other brand appears there.
- **A campaign runs 7 to 15 days, 14 by default.** The end date is required; the campaign stops by itself and can be run again with one tap.
- **The object is called "Campaigns"** in the app. An offer is one kind of campaign.
- **The HOCKIA brand account answers "Ask Hockia"**, not a separate support identity. The help line is turned on per environment by naming that profile in `app_settings` (`hockia_help_profile_id`).

## Still open

- Who reads the HOCKIA brand inbox day to day, and in which languages. The help line stays off in production until this is settled.
- The values of every **[TARGET]** above, to set after the first two campaigns.
- Whether brand updates and products should keep reaching every member's Home feed with no targeting once campaigns exist.
