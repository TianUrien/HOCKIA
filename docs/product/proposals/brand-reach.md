# Brand reach, offers with a target (PR/FAQ)

Internal Working Backwards document. Proposal for the founder, 2026-10-20. **Framing update (same day):** under the Home vision "everyone has an agent" (`../home-vision.md`), a brand offer reaches a member as *a deal the member's agent brought* ("A deal I found for you…"), never as an ad card. The targeting, surfaces, limits and privacy rules below are unchanged. Not approved for build. No real numbers: every target is marked **[TARGET]** and every unproven claim **[NEEDS EVIDENCE]**. Quotes are illustrative.

## Press release (as if it shipped)

**Title:** Field hockey brands reach the right players and clubs, where they are

**Subtitle:** Brands on HOCKIA publish offers with a target, role, place and level, and HOCKIA shows each offer only to members it fits. Free for everyone while HOCKIA proves the value.

**Problem.** A hockey brand in Belgium or Argentina sells to a tiny audience hidden inside huge platforms: on Instagram or Google it pays to find hockey people among millions who aren't. Players and clubs, in turn, get generic ads and miss the gear, services and ambassador programmes made for them. Evidence that brands want this: **[NEEDS EVIDENCE: brand sign-ups and product taps to date]**.

**Solution.** On HOCKIA everyone is field hockey, so a brand doesn't search, it declares: *what* (a product, a service or an ambassador programme), *for whom* (players, clubs, coaches, umpires) and *where* (a country, optionally a region or city, or "no location" for global offers). HOCKIA matches the offer to each member's role, location, category, position, level and recent moments, and shows it only where it fits: in Community › Brands, as at most one labelled card per Home visit, and under a Hockia AI answer when the member asked for exactly that kind of thing. Members can mute a brand or all brands. Brands see aggregate numbers only.

**How it works**
- A brand creates an offer in its profile: title, image, description, link or contact, target (roles, location or none, optional category/position/level/moment).
- Admin review before it goes live; a small number of active offers per brand while the feature is free.
- Rules (no model) decide fit from profile fields and recent facts; the language model only drafts copy on request.
- Delivery: Community › Brands (filtered by the viewer's location and role); Home slot "From brands" (≤ 1 per visit, only when it fits a fact about the viewer, e.g. a signing abroad or a role just posted); Hockia AI (below the answer, separated, only for matching questions).
- Member controls: mute this brand, mute all brands. Never shown to under-18s or hidden profiles.
- The brand gets counts: shown, opened, contacted. Nothing about who.

**Founder (illustrative):** "Every HOCKIA member plays, coaches, runs or officiates field hockey. A brand should never have to guess, and a member should never see an offer that isn't for them."

**Member (illustrative):** "I signed in Belgium and the first thing HOCKIA showed me was where to get a stick in Antwerp. That felt like someone was paying attention."

**Get started.** Brand profile › Offers › New offer. Members: Community › Brands, or wait, if it fits you, it finds you.

## FAQ, members
- **Will Home fill with ads?** No. At most one brand card per visit, only when it fits something about you, always labelled "From brands", and you can mute it.
- **Does a brand know who I am?** No. Brands see totals (shown, opened, contacted), never names or profiles. Contact happens only when you choose to write to them.
- **Why do I see this offer?** Because of your role, where you're based, and sometimes a recent moment (a signing, a role you posted). Never because of your nationality.
- **What does it cost?** Nothing, for any role, including brands, until HOCKIA proves the value.
- **Under 18?** HOCKIA is 18+; no offers reach minors.

## FAQ, internal
- **Which job does this serve?** Brands: "reach the right hockey people where I sell" ([Hypothesis]). Members: "find hockey-specific gear and services for my situation" ([Hypothesis]). Evidence so far: 1 active brand in 90 days; product-tap counts exist in code **[NEEDS EVIDENCE: read them]**.
- **What's the founder's bet?** Exclusivity to field hockey is the asset: zero waste for brands, zero noise for members. Trust is the thing we must not spend.
- **Location, not nationality.** Target by where the member is based (profile city/country); region or city optional; "no location" for global offers. No proximity radius (no coordinates by design).
- **What do we stop doing?** Nothing yet. Brand product cards stay as they are; offers are a new object.
- **How will we know it worked?** Brand side: contact requests per offer **[TARGET: to set after 4 weeks of data]**, store taps, ambassador invitations accepted. Member side: mute rate per offer **[TARGET: low; if muting is high the targeting is wrong]**, no drop in Home return rate. Events: offer_impression, offer_open, offer_contact, offer_mute, with surface and target fields.
- **Risks.** Trust (ads feel like ads → mute and leave); thin supply (few brands → empty tab); moderation load on the founder; privacy (aggregate only; hidden-profile predicate on every count); fairness (never exclude by nationality); old native clients (additive, nullable schema only); bundle budget.
- **Effort and dependencies.** New table `brand_offers` + target fields; matching RPC with the hidden-profile predicate; admin review queue (reuse content reports/takedown patterns); Home slot module; Brands tab filter; Hockia AI "below the answer" slot; events. Rough size: 3–4 PRs.
- **What would make us stop?** Mute rate high or Home return rate falls after launch; brands don't publish offers after onboarding.
- **Cheapest test.** Before building: ask the active brands to draft 1–2 offers with a target (a form, no code) and show those offers only in Community › Brands for 4 weeks; measure opens and contacts. Then decide on the Home slot.
- **Business model, later.** When contacts per offer are real, brands can pay for more reach (more active offers, wider targets, priority). Players, coaches, clubs and umpires stay free.

## Evidence vs assumption
| Claim in the PR | Evidence (source, date) | Status | How to test |
|---|---|---|---|
| Brands want targeted reach inside HOCKIA |, | needs evidence | ask active brands to draft offers; count published offers in 4 weeks |
| Members value hockey-specific offers |, | hypothesis | offer_open and offer_contact per impression; mute rate |
| Exclusivity to field hockey = zero waste for brands | roles-and-product.md (every member is a hockey role) | evidenced (structural) |, |
| One labelled card per Home visit doesn't hurt return |, | needs evidence | Home return rate 2/4 weeks before vs after; mute rate |
| Location matching works with city/country text | profiles store city + country (Google Places) | evidenced (data exists) | match quality review on a sample (aggregate) |
| Brands accept aggregate-only reporting | ChatGPT ads model (2026 guides) as precedent | hypothesis | brand feedback after first 4 weeks |

## Founder rulings captured (2026-10-20)
- Free for every role, brands included, until value is proven.
- Target by location (country; region or city optional; "no location" allowed), never by nationality.
- Surfaces: Community › Brands, Home (≤ 1 labelled card per visit, only when it fits), Hockia AI (below the answer, separated).
- While free: few active offers per brand, admin-reviewed before going live.
- Proof of value to charge later: members contacting the brand (contact requests), then store taps and ambassadors.
