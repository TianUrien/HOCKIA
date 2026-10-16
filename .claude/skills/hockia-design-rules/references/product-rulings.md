# Product rulings by area (dated; newer wins)

## Navigation
- Tab bar: Home · Community · **Opportunities (centre)** · Inbox · Profile. Hockia AI is not a tab while it is beta (2026-10-16).
- Root tabs use a large title; pushed screens use the nav bar with a back label.

## Nationality and location (2026-10-16; shipped)
- A person's flag = nationality. The two nationality fields (`nationality_country_id`, `nationality2_country_id`) are the passports; EU status is computed, never typed.
- Person cards: up to 2 flags (≈17 pt so they never wrap) + "EU" badge · age · city (no flag on the city).
- Profile hero: one glass pill per nationality (flag + country name) + EU badge, then "Based in <city>, <country>".
- Profile overview: full-width "Nationalities, passports & permits" tile — one line per nationality, "EU passport" tag on EU ones, permits as one line ("🇪🇸 Spain · Residency · until Jun 2027"); never truncated.
- Member preview: every nationality named (+ EU), place as text.
- Club and brand flags = their country (location).
- Location input: Google Places autocomplete; no proximity search wanted.

## Community (live)
- Photo-first grid, newest first for people and clubs, no interleaving; clubs are always full-width cards; Clubs tab available.
- Person card = 3 lines over the scrim: name (no age) / role · team / nationality flags + EU · age · city. No chips on person cards (no "Open to play" — it covers faces; no category, no status). Clubs show a glass "Recruiting now" only with an open opportunity.
- Tap opens a full-screen preview deck (swipe between members, "3 of N" pager with 44 pt prev/next). Recruiters get Shortlist + fit in the preview. Anyone can message anyone (server rate-limited).
- Recruiting context (clubs, recruiting coaches): one UI everywhere, the "Ranked for" pill + sheet (open roles, saved contexts, No context, New context); the word is "context", never "scope". An active player context narrows the Community grid by team + region and ranks by fit, using rules only (2026-10-16).
- Club preview: Message only, no Add friend (the club page keeps the friendship button); facts League / Based in / Friends here.

## Home (live)
- Very visual, little text. "Next step" card on top (photo/crest/logo first, then the highest-value missing item; brands: profile views + search appearances). A views card always opens who viewed you (CTA "View"), never the composer; a card's action must match its title (2026-10-16). Roles rail for players; clubs see applicant next steps instead.
- Grouped digests for automatic events (≥ 4 items), media grouped per day; "New in the community" faces row opens the Community deck.
- New signing posts only by clubs: the club tags a member (notified, can remove the tag; 18+ only). Card = light grey surface, faint violet pitch, two overlapping circles (player photo + crest), "NEW SIGNING".
- Reactions: likes, comments, and Congrats 👏 (count visible to all). Full match video only if the player made it public; no score; tap to play.
- End of feed shows a caught-up state.

## Profile (live, all five roles, phone + desktop)
- Full-bleed photo hero with name (continuity with Community); single scroll with sticky section anchors; compact glass header on scroll.
- One Primary: visitors get Add friend / Message (brand: Follow + Message; club: Message); own profiles get Edit profile as Secondary + Preview as… (Public / Club or coach).
- Facts: Plays at (full row) + Available + Nationalities tile; Available derives from `open_to_*` flags; public views hide empty sections.
- Sections: skills once, friends + mutual, videos 16:9 (hide unplayable for the viewer), references (gold), career timeline, posts & photos grid (text-post tiles included), comments near About, About (3 lines + details).
- Sponsor: confirmed ambassador = logo + "<Brand> athlete ✓" linking to the brand; self-declared = plain "<Brand> player" (no logo or link; hidden if the same brand is confirmed).
- Private stats are owner-only; no invented metrics. Languages are umpire-only. Coaches have no licences field.
- Club: cover carousel, crest tile + verified, Recruiting now, roles, squad, posts, About. Coach: specialisation, categories, "Coaches at", open roles. Umpire: federation (no flag), level, appointments timeline. Brand: cover, logo, followers/ambassadors, products (taps to store counted with consent), "Open to partners" (default off).

## Opportunities v2 (2026-10-16)
- App Store structure: featured card + themed rails (Roles for you · Paid, with housing · Closing soon ≤ 14 days) + full list. Featured = most relevant role that takes the viewer's application and matches their position, else soonest deadline, else newest; needs ≥ 3 roles in the list. A rail hides under 2 cards.
- Role cards carry no button: the card opens Role detail, where Message + Apply live; applied roles show a Neutral "Applied" tag.
- Category chips (ruby / ocean / violet; Girls/Boys outline — coach roles only; player roles are adult only). Hero chips: Position · Category · status.
- Coach posting for a club: HIRING CLUB + POSTED BY identity; "Posted by <coach>" on cards; coach-aware copy.
- Covers from club crest palettes; optional cover photo at publish (moderated).
- Apply sheet = the real modal: Available from / Passport / Contact (editable), optional note ≤ 600, "Your profile, career and highlights are sent automatically".
- Recruiter screens keep existing logic and copy: Open/Closed segments, waiting banner, pipeline (To review / Shortlisted / Declined), drafts, close/reopen sheet, applicants chips (To review, Shortlisted, Maybe, Declined, Closed), review with Decline / Maybe / Shortlist and the road to signing. "Review N applicants" is solid Primary while a reply is owed.
- Desktop: content max 1200; list = wide featured + 4-up rails + 3-column list; role detail = page with a sticky left cover column (Apply, Message, Ask Hockia AI); applicants = master-detail with inline decisions. Filters on desktop = the phone filters sheet shown as a centred dialog; desktop role detail reuses the phone copy (no desktop-only copy). Hockia AI header button and "Ask Hockia AI" stay out until the mascot ships.

## Inbox and chat
- Conversation rows: amber dot only when the viewer owes a first reply; offer and invitation cards keep a stable height; offer deadline amber only for the player in the last 5 days.
- Chat header may show activity only if the user allows it.

## Hockia AI (approved 2026-10-16)
- Hockia AI is the name of the whole intelligence layer: what it knows about the viewer and their roles, hockey knowledge, rules in code (fit, ranking, suggestions) and the language model. In copy, intelligence features belong to Hockia AI (2026-10-16).
- Direction, not yet designed: the clubs' and recruiting coaches' recruiting context becomes Hockia AI's context. Default = the open role in use; Hockia AI sets or changes it with confirmation and replaces the context form. Fit and reasons stay rule-based (template reasons). Switching between open roles works without the language model or the daily limit.
- Mascot: violet vinyl-toy figure with a right-handed field hockey stick and a headband "mind light" (calm glow · thinking sweep · idea flash). Friendly, curious, smart; explains, doesn't hype; gender-neutral; CG assets (Blender). Avatars at 32–40 pt show head + headband only.
- Entry: mascot button top-right on Opportunities (Filters becomes the first quick chip; "Has suggestion" glow only for real news); opens a **sheet over the current screen** (medium / large); contextual entries: "Ask Hockia AI about this role", applicants summary, "Fill my profile for me".
- **Does things with confirmation**: drafts as cards (apply, profile update); nothing is sent or saved until the user taps.
- Text only, no microphone. "+" attaches photos, video/links (YouTube, Vimeo → videos; socials stored as links; club/league/stats pages → proposed career rows), CV PDF. Never ID documents.
- Profile builder: one review card "Save all to my profile", each item removable/editable; afterwards a real checklist of what's still missing (no score).
- UI: live "Thinking…" steps, streamed answers, follow-up chips, confused face for errors, the existing daily-limit copy on a neutral surface, private deletable history.
- Open question for the founder: AI-written applicant summaries vs the 2026-10-04 "template reasons, no free AI text" ruling for HOCKIA suggests — confirm before shipping summaries.
