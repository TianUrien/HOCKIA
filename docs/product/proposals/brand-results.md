# Brand results and the brand plan (proposal, 2026-10-22)

Status: proposal for founder review. Builds on `brand-reach.md` (offers by location, Home and Hockia AI cards) and the intention rules in `home-vision.md`.

## Why
Brands are a role that should add value to the community. A brand keeps adding value only if it can see what its offers, products and ambassadors do for members. Today it sees three 7-day numbers (profile views, search appearances, store taps). That proves visibility, not value.

## Founder rulings (2026-10-22)
- Brands see aggregates, plus the people who chose to contact them (a message, an ambassador application). Never who viewed or tapped.
- Future model: a monthly Pro plan on top of a free plan. Free for everyone until value is proven.
- A brand's contribution to the community is shown as facts on its public profile ("2 offers for members · 5 ambassadors"), never a score or a level.
- The results panel lives in the app, on phone and desktop.

## What the brand sees: "Results"
A section of the brand dashboard, owner-only. Default period: last 30 days, with the previous 30 for comparison. Counts and plain trends only, no percentages on the first screen.

1. **What members did with your offers** (the funnel, per offer and in total):
   Shown to (unique members) → Opened → Contacted you → Store taps. Plus **"Not useful"** taps, shown neutrally: it tells the brand when an offer misses.
2. **Who they are** (aggregates): by country (and region where set), by role (player, coach, club, umpire), by goal ("Play abroad", "Find a club", …). Where they saw it: Home, Hockia AI, Brands tab.
3. **People who contacted you**: the members who messaged the brand or applied as ambassador from an offer, with the offer they came from. They chose to be seen.
4. **Products**: views and store taps per product.
5. **Ambassadors and followers**: invites sent, accepted, active ambassadors; new followers.
6. **Next step** (one line, neutral copy): the most useful action, for example (illustrative numbers) "Your offer in Spain was shown to 3 members. Add England, where more members are based?" Only real counts in the product.

Phone: one scroll, funnel first, each block expands. Desktop: two columns (funnel and offers left, audience and contacts right).

## No decoration (founder, 2026-10-22)
Every block answers one question that leads to a brand action; if it doesn't, it isn't shown.
- "Which offer works?": the offers table (shown, opened, contacted, "Not useful") with Edit and Duplicate.
- "Where should you show it?": country, role, goal and surface bars.
- "Who wants to talk to you?": the people who contacted the brand, with Message.
- "Did your change work?": weekly bars per offer with a marker on each brand edit (photo, text, country). Shown only after 4 weeks live; before that, "Live for N days" and totals, because a few days of data say nothing.
- No sparklines, no daily lines, no charts at volumes where ups and downs are noise.

## Added after the founder's review (2026-10-22)
The panel must say what opportunity the brand has and what it still has to do, not only what happened.
1. **Waiting for your reply** (top of Results, phone and desktop): "N people are waiting for your reply", oldest first, with Reply. The only amber element on the screen, because the brand must act. Counts members who contacted the brand and got no answer yet.
2. **Who you could reach** (market size): members based in the countries the brand sells to, per country, marked "Your offers show here" or "Add to an offer". Real counts, groups of 5 or more only, nobody identified. Fixes the early-stage problem: a new brand sees "Shown to 3" and leaves; the market count shows what is possible. Later, filtered by goal once goals are stored.
3. **Ambassador candidates**: players in the brand's countries who said yes to brand partnerships, with Invite. Needs a new player opt-in ("Open to brand partnerships", off by default, editable, shown only to brands); players without it are never listed. A player with an active ambassadorship on HOCKIA is hidden from every other brand's candidates by default; the player can turn "Open to other brands" back on (for example for another category). Default chosen 2026-10-22 (founder had no preference; reversible). Later option: hide only from brands in the same category, once brand categories are reliable.

Later stage: a tagged store link so the brand measures sales in its own analytics; season timing hints per country. Benchmarks against other brands only when enough brands exist that an average identifies none.

New data needed: player opt-in `open_to_brand_partnerships`; reply state for brand conversations; goals stored (`goal_set`) for goal filters.

## Founder decisions (2026-10-23)
- Breakdown threshold: 5 members; below it a row reads "Fewer than 5".
- Consent: offer and product events are first-party events like the rest (no consent gate); brands only ever see aggregates.
- Free period: up to 5 live offers per brand; an offer may target several countries.
- Build order: Offers + Home first (offer table, admin review, brand editor, offer card on Home and under Hockia AI answers), then Results, then ambassador candidates, then contribution facts.
- Starting point in production: 8 brands, 3 products, 0 posts, 0 ambassadors, 251 players. Most breakdowns will read "Fewer than 5" at first, which is why "Who you could reach" (market size) matters early.

## Phase 1 design (2026-10-23)
Figma page "08 · Brands, offers (Phase 1)", section "BO":
- B1 brand Offers list (up to 5 live; states Draft, In review, Changes requested in amber, Live, Paused, Ended).
- B2 offer editor with live preview: photo, title (60), what members get (140, no "best/cheapest"), link, countries plus an optional region or city, roles, dates, "Send for review".
- B3 actions on a live offer: Edit (back to review, the live version stays up), Pause, Duplicate, See results, End.
- A1 admin review queue (desktop): oldest first, preview, facts, a five-point checklist, a note, Request changes or Approve.
- H1 Home card after the related move, with the reason line and "Not useful"; H2 "Not useful" folds the card with Undo and an optional reason (brands see totals; "Hide this brand"); H3 under a Hockia AI answer after a "From brands" divider, never changing the answer.

## Privacy rules (non-negotiable)
- Aggregates only, except people who contacted the brand.
- A breakdown row appears only when it holds **5 or more members**; otherwise it reads "Fewer than 5" (founder, 2026-10-23).
- Exclude test accounts, automated browsers, hidden profiles (`profile_is_hidden`), blocked pairs and the brand's own team, in every count and list.
- Never: who viewed, who tapped, individual goals, nationality breakdowns (we target by location, never nationality).
- Under-18s are not members, so they are never counted.

## Community contribution on the brand profile
Facts, each shown only when above zero: offers live for members, active ambassadors, clubs supported (needs a sponsorship field; not in the data yet), members helped (contacted the brand). No badge, no ranking.

## The plan (future, not priced)
| | Free | Pro (monthly) |
|---|---|---|
| Live offers | Up to 5, several countries each | More |
| Locations per offer | One country | Several countries, regions or cities |
| Results history | 30 days | 12 months, export |
| Breakdowns | Country, role | Plus goal and surface |
| Ambassador tools | Invite | Campaigns to ambassadors |
| Weekly results email | No | Yes |

Principles: Pro buys reach and tools, never a better position than relevance allows, never member data. Admin review stays for every offer. Price: not set; decided after the free period proves value.

**When we start charging** (targets set after 8 weeks of data, never invented): brands receive contacts from members every month; offers get opened more than dismissed; members don't hide brand cards more than other cards.

## What has to be built (for the code agent)
- `brand_offers` table: brand_id, title, body, image, link, target countries / regions / cities, target roles, target goals, status (draft, in review, live, paused, ended), starts_at, ends_at, reviewed_by. Admin review queue.
- Events with `offer_id` and `surface` (home, hockia_ai, brands_tab): `brand_offer_impression`, `brand_offer_open`, `brand_offer_contact`, `brand_offer_store_tap`, `brand_offer_dismiss`.
- One RPC `get_my_brand_results(p_days)` reading `analytics_events`, with the hidden and block fences and the 5-member threshold applied server-side.
- Fix first: `get_my_brand_analytics` counts raw `events` without the hidden, test-account or self-view fences; `product_view` and `post_impression` are recorded without the analytics-consent check that `brand_product_click` has (decided 2026-10-23: no consent gate, aggregates only).
- Public profile: contribution facts.

## Evidence vs assumption
- [Evidence] Brands today get views, search appearances and store taps (code, 2026-10-22).
- [Hypothesis] Seeing contacts and "Not useful" makes brands improve offers instead of leaving.
- [Hypothesis] Brands will pay monthly once contacts arrive every month. To test: interviews with active brands (`hockia-member-interviews`).
