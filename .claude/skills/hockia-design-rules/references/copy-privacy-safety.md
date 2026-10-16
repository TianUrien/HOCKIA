# Copy, claims, privacy, safety and minors

## Copy
- English in the app; sentence case for titles, eyebrows and labels; Micro caps only for small section labels.
- Gender-neutral: the person's name or "they"; never his/her/him (repo standard).
- Plain and specific; buttons say what happens ("Send application"), confirmations say what happened ("Application sent").
- Status words come from shared helpers, never inline strings: `lib/applicationStatus.ts`, `lib/opportunityCopy.ts`, `lib/careerCopy.ts`, `lib/videoCopy.ts`, `lib/signing.ts`, `lib/clubInviteCopy.ts`, `lib/clubSquadCopy.ts`, `lib/invites.ts`. One set of words per application status.
- Players see "Not selected", never "Declined".
- Errors: what went wrong + what to do, no apologies, never blame the user.
- Deadline tag: ≤ 14 days → "Closes in N days"; later → "Closes 30 Nov"; no deadline → "New" if posted ≤ 7 days, otherwise nothing.
- Coach posting for a club: copy follows the poster ("What we offer", "In <First name>'s words", "A note to <First name>", messages go to the coach).
- Suggestion reasons in "HOCKIA suggests" are templates filled from profile fields, not free AI text (2026-10-04).

## Claims (UI, AI, email, marketing)
Never promise placements, signings, contracts, guarantees or rankings; never "accurate AI". Never invent metrics, percentages, completeness scores, "replies in ~1 day" or "4× views" — show real data or nothing. Label sample data as illustrative. Hockia AI is labelled **Beta** everywhere.

## Privacy
- Hidden profiles (admin-blocked or frozen minors) are excluded from every list, count, RPC, view, digest and AI read — counts included (repo `CLAUDE.md` invariant; RLS alone doesn't cover SECURITY DEFINER or service-role reads).
- Date of birth is owner/admin/server-only; others see age ("Clubs see your age, never the date"). Never "fix" access by re-granting the column.
- If a date of birth means the user is under 18: never save silently — explain what changes for under-18 accounts (age gate) and ask first.
- Work permits follow the existing owner/recruiter visibility rules.
- No activity or last-seen signals on profiles, cards, Community or recruiter fit; only the chat header may show activity, and only if the user allows it.
- Chats with Hockia AI are private and deletable.
- Location is city + country text (Google Places, English names); no coordinates and no proximity search (2026-10-16).
- Analytics/consent choices are honoured (e.g. brand product tap counts).

## Safety
- AI summaries about candidates use facts from the application only — never judge or compare by age, gender, nationality or appearance.
- Never accept photos of passports or ID documents; passports are typed (country only).
- Report and block exist on people and content. Comments: anyone can report; block hides; authors can delete or turn comments off; digests carry no comments; hidden/blocked content is excluded everywhere.
- Admin takedown: the content is removed with a neutral notice to the author and a 30-day restore window.

## Minors
- No fit badge, Shortlist or recruiting signals for under-18s.
- New signing tags only for 18+.
- Squad and visibility fences follow the existing age-gate rules (`frozen_minor_at`, `profile_is_hidden`).
