# Product and roles

Evidence-based definition of what HOCKIA is for and what each role is, does and gets (code on staging, 2026-10-16). The strategic rulings at the end are the founder's; everything else describes the shipped product.

## The product
- **What it is:** the network where field hockey people get found and hired, players, coaches and umpires build a professional profile; clubs and recruiting coaches publish roles and recruit with trust and context; brands reach athletes.
- **Reason to exist / North Star:** the recruiting loop, a role is posted → the right people see it → they apply or are invited → the recruiter replies → offer → signing (`docs/engineering/analytics-tracking-plan.md`). Every role's design should feed this loop.
- **Price:** free for every role ("Free for players, coaches, clubs, umpires and brands"). No paid tier is approved.
- **Age:** an 18+ platform for person roles (date of birth declared at sign-up; under-18 → age gate and juniors waitlist). Clubs and brands attest they are run by adults.
- **Role is chosen once** and can't be changed without support. Admin is not a role (a JWT flag for the admin portal).
- **Everyone can:** message anyone (rate-limited), add friends (except brands, which have followers), post to the feed, comment, browse Community and Opportunities, use Hockia AI (30 questions/day).

## Player
- **Who:** an adult field hockey player (any level) looking for a club, a move abroad, a better team or a paid contract.
- **Promise:** "Build the profile that gets you found by clubs."
- **Job to be done:** be found and chosen, show position, level, passports/EU eligibility, availability, video and references so recruiters trust them; find roles that fit and apply in one tap.
- **Success looks like:** complete profile → applications that get replies → invite/offer → signing.
- **Onboarding:** name, date of birth, category, position (required); photo, second position, current club, league, base, up to 2 passports, Open to play (optional/skippable).
- **Profile:** Overview (Plays at, Available, Nationalities/passports/permits), Open roles, Videos (highlights; full matches recruiter-only by default), References (gold), Career, Posts, About; sponsor/ambassador line; owner-only stats.
- **Can:** browse and apply (Available from / Passport / Contact + note), receive invites and offers, request up to 5 references from friends, be a brand ambassador (players only), follow brands; Hockia AI: find clubs/coaches, improve profile, fill profile.
- **Never:** sees fit scores, other applicants' counts, levels or reply-time estimates; sees "Not selected", never "Declined"; can't post roles; no Save/bookmarks.
- **Home Next step order:** photo → availability check-in → clubs replied → roles that match → profile views → complete profile.
- **Emails:** shortlisted / not selected (never "maybe"), one batched no-reply expiry, matching new roles, digests, weekly availability check-in, reference reminders.

## Coach (two modes)
- **Who:** a coach looking for coaching work, and, if they run a team, recruiting players for it.
- **Promise:** "Find coaching opportunities, and recruit players if you also manage a team."
- **Mode is set at onboarding:** "Do you recruit players for a team?" (required, nothing preselected). Yes = recruiting coach (`coach_recruits_for_team`): adds My roles and Find players.
- **Candidate coach can:** apply to coaching roles, references, friends, posts; Hockia AI: find clubs hiring.
- **Recruiting coach also can:** post roles for the club they recruit for (shown "Posted by <coach>" with the club as the hiring entity and the club's crest), review applicants, Find players, Shortlist, fit, AI opinion, role-description draft, invites and offers; Opportunities shows Roles · Applied · My roles.
- **Profile:** player layout + specialisation, categories (incl. Girls/Boys), "Coaches at", their open roles, Open to coach. No licences field.
- **Never:** candidate coaches get no recruiter tools; coach covers never use the coach's face when posting for a club.

## Club
- **Who:** a field hockey club (or its manager) that needs players or coaches.
- **Promise:** "Recruit field hockey players with trust and context."
- **Job to be done:** fill roles with the right people quickly, post once, get fitting applicants, review fast, reach out to available players, sign.
- **Success looks like:** roles posted → applicants reviewed within the reply window → offers → signings (and announcing them).
- **Onboarding:** crest (optional), name, country, city, 18+ operator attestation; link to the club directory or skip; lands on Opportunities.
- **Profile:** cover carousel, crest + verified, "Recruiting now" only with an open role, Open roles, Squad, Posts, Comments, About; owner: recruiting card + private views.
- **Can:** post player/coach roles (drafts, close/reopen, optional cover photo), review (Decline / Maybe / Shortlist), invite to apply (one open invite per player, never under-18s), send offers, record signings, post New signing (clubs only, tagging an 18+ member), Find players, fit, Shortlist, AI opinion; Hockia AI: find players/coaches, improve club profile, applicants summary.
- **Never:** applies to roles; gives/receives references; Add friend from the Community preview (Message only).
- **Home Next step:** applicants waiting → quiet role → players available → crest.
- **Emails:** new applications (max hourly), "Closing soon" (day 10) and "Last call" (day 13) at 09:00 local time, Monday pending digest, listing closed + one-click renew.

## Umpire
- **Who:** a field hockey official building an officiating career.
- **Promise:** "Keep your officiating history in one place."
- **Job today:** a credible officiating profile, federation, level, formats, languages, appointments timeline, references, and a network of officials.
- **Can:** appointments, references (since 2026-04), friends, messages, posts, Community "Umpires" tab; Hockia AI: find officials, add an appointment.
- **Can't yet:** apply to anything. Opportunities is browse-only ("Umpire appointments and assessments will live here when we open them"); no umpire role types; can't post roles.
- **Profile:** Overview (federation without a flag, level, available for appointments), Appointments, References, Posts, About (languages are umpire-only). No Career section.
- **Note:** the only role still on the legacy 3-step onboarding wizard.

## Brand
- **Who:** a field hockey company (equipment, apparel, nutrition, tech, coaching services, recruiting, media…).
- **Promise:** "Build your brand in the hockey community", reach and recruit athletes as ambassadors.
- **Can:** profile with cover, logo, products (taps to store counted with consent), updates in the feed, followers, invite ambassadors (players only, two-sided), "Open to partners" (default off), owner stats (views, search appearances); Hockia AI: find ambassadors.
- **Never:** posts roles, applies, references, friends (followers instead), recruiter tools.
- **Direction (2026-10-20, not built):** offers with a target, roles + location (never nationality), shown in Community › Brands, ≤ 1 labelled card per Home visit when it fits, and under Hockia AI answers; admin-reviewed while free; aggregate stats only; members can mute. See `docs/product/proposals/brand-reach.md`.
- **Home Next step:** profile views + search appearances; tapping opens who viewed you ("View"), not the composer (2026-10-16).

## Known gaps and inconsistencies (fix or decide)
- `supabase/functions/_shared/hockia-features.ts` (Hockia AI's feature map) is out of date: references are open to umpires, and it says brands publish roles (they can't). Hockia AI can answer wrongly until it's updated.
- `OPEN_TO_PLAY_UNDER_18` copy in `client/src/lib/onboardingV2.ts` still describes under-18 accounts continuing, which contradicts the 18+ age gate.
- The brand views card opens the post composer instead of the viewers (fix approved 2026-10-16).
- Umpire onboarding still uses the legacy wizard; umpire and brand get no role-specific emails.

## Strategic rulings (founder, 2026-10-16)
- **Clubs first.** Growth and design attention go first to clubs (and recruiting coaches): the loop needs posted roles. When priorities compete, pick the change that gets more roles posted or more applicants answered.
- **Umpires: profile only for now.** Officiating history, references and network; Opportunities stays browse-only. Don't design an umpire appointments marketplace without a new ruling.
- **Free for every role until traction.** Don't design paywalls, premium tiers, locked features or upsells.
- **Juniors: waitlist only.** The 18+ age gate stays; no junior or parental-consent product. Copy must not suggest under-18 accounts can continue.
