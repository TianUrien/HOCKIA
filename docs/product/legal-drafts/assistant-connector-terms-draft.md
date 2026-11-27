# DRAFT: Terms and Privacy changes for the assistant connector and 18+

Status: **draft for the founder's review. Not published, and not legal advice.**
Written 2026-11-27. Based on `client/src/pages/Terms.tsx` (last updated March 21, 2026) and `client/src/pages/PrivacyPolicy.tsx` (last updated November 9, 2026). Founder decisions 2026-11-27: block minors from the connector, and draft the Terms for review.

Before this ships, a lawyer should check the points in "Open questions" at the end. The app changes this draft depends on are listed with each section.

---

## Part A. Terms of Service

### A1. Section 2, Eligibility (replace the first paragraph)

**Current:**
> You must be at least 16 years old to create an account on Hockia. If you are between 16 and 18 years old, you must have consent from a parent or legal guardian to use the Platform.

**Proposed:**
> You must be at least 18 years old to create and use an account on Hockia. Club and brand accounts must be created and run by a person aged 18 or over who is authorised to act for the organisation.
>
> We may ask you to confirm your date of birth. If you do not confirm it, or we learn that a member is under 18, we may restrict or freeze the account.

Why: the app has enforced 18+ since the July 2026 age gate (`20260707151000_age_gate_core`). Members under 18 are frozen, organisations attest 18+ (`org_attested_18plus_at`), and a missing date of birth is restricted after 14 days. The Terms still describe the old 16+ rule.

### A2. Section 9, Child Safety (replace the first sentence)

**Current:**
> The Platform is not directed at children under 16, and we do not knowingly collect personal data from children under 16 without parental consent.

**Proposed:**
> The Platform is for adults. It is not directed at anyone under 18, and we do not knowingly allow anyone under 18 to hold an account.

The rest of section 9 stays.

### A3. New section 13A, "AI assistants you connect" (after section 13)

> **13A. AI assistants you connect**
>
> You can connect an AI assistant, such as Claude, to your Hockia account. The assistant can then look up Hockia information for you when you ask it to. You choose whether to connect one, and you must be 18 or over to do so.
>
> **What a connected assistant can read.** Only what your account can already see in Hockia:
> - your own profile, including how complete it is;
> - open opportunities and their details;
> - your own applications and their status;
> - other members' public profile information.
>
> If you are a club or a coach, it can also read your own opportunities and the people who applied to them.
>
> It cannot read your messages, other members' email addresses or dates of birth, profiles that are hidden or blocked, or the profile of anyone under 18.
>
> **What it cannot do.** A connected assistant can only read. It cannot apply to opportunities, send messages, post, change your profile or settings, or act for you in any other way on Hockia.
>
> **Your responsibility.** What the assistant does with the information it reads is governed by your agreement with the assistant's provider, not by Hockia. Do not use a connected assistant to copy, collect or share other members' information in a way these Terms do not allow (see section 5). The usage limits in place to protect members apply to connected assistants too.
>
> **Disconnecting.** You can disconnect an assistant at any time in the assistant's own settings, or by contacting team@inhockia.com and we will end its access. Access also ends if your account is deleted, frozen or suspended. We may suspend or end the access of any connected assistant to protect members or the Platform.

App dependencies for A3:
- **Revocation on Hockia's side.** Today a member can only disconnect in the assistant. That stops the assistant using its tokens, but the grant on Hockia's side stays until it expires (refresh token up to 30 days, `mcp-server/src/index.ts`). Until the planned "Connected assistants" screen ships, Hockia-side revocation is manual, on request by email. That is why the email route is in the text. When the screen ships, change the text to "or in Settings > Connected assistants".
- **"Frozen or suspended" ends access.** True today: the guard refuses hidden accounts, and as of PR 701 it also refuses anyone not known to be 18+.

### A4. Section 13, Third-Party Services (add one sentence at the end)

> AI assistants you connect to your account are covered by section 13A.

---

## Part B. Privacy Policy

### B1. Section 4, Third-Party Services and Data Sharing (add two entries to the list)

> **AI assistants you connect (for example, Anthropic's Claude):** when you connect an assistant to your Hockia account and ask it a question, we send it the Hockia information described in Terms section 13A that it needs to answer. The assistant's provider receives that information on your instruction and handles it under its own terms and privacy policy, not as a service provider to Hockia. We send nothing to an assistant you have not connected, and we stop when you disconnect it.
>
> **Cloudflare:** runs the connection service between Hockia and the assistants you connect. It processes your sign-in for that connection and the requests the assistant makes, on our behalf.

Also: the existing entry "AI model provider (Google Gemini, Anthropic Claude, or OpenAI)" is about Hockia AI, the in-app chat, which is a different feature. Rename its label to "Hockia AI model provider" so the two entries cannot be confused.

### B2. Section 2, Information We Collect (add one bullet where technical or usage data is listed)

> **Connected assistants:** if you connect an AI assistant, we keep a record that the connection exists and when it was made, the sign-in tokens for it (stored encrypted), and a count of its requests so that usage limits can be applied.

### B3. Section 8, Data Retention (add one sentence)

> Connection tokens for an AI assistant are kept until you disconnect it, your account is deleted, or they expire (at most 30 days without use). Request counts used for usage limits are deleted after 24 hours.

Check before publishing: the 24-hour figure comes from the `cleanup_rate_limits_daily` job, which keeps 24 hours of `rate_limits`. The 30 days is the Worker's `refreshTokenTTL`.

### B4. Section 9, Children's Privacy (replace the first paragraph)

**Current:**
> Hockia is not directed at children under 16 years of age. We do not knowingly collect personal data from children under 16 without verifiable parental consent. If we learn that we have collected personal data from a child under 16 without appropriate consent, we will take steps to delete that information promptly.

**Proposed:**
> Hockia is for adults and is not directed at anyone under 18. If we learn that a member is under 18, we freeze the account so that it is hidden from other members and cannot be contacted. We then delete the personal data we do not need to keep.

The "delete" wording must match what the freeze actually does today. The freeze hides the account; it does not delete it. Confirm the follow-up deletion step exists before using "delete". Otherwise say "and contact the member about closing the account".

### B5. "Last updated" dates

Update both pages' dates on the day they ship, and notify members of the change as Terms section 15 requires.

---

## Open questions for the founder and a lawyer

1. **Is Anthropic, or any assistant provider, a recipient on the member's instruction or a Hockia processor?** The draft treats it as an independent recipient acting on the member's instruction, the way the member's own Claude account works. A lawyer should confirm this under GDPR, especially for other members' public profile data that a recruiter's assistant reads.
2. **Other members' data.** A club's assistant can read applicants' names and public profile details. The Terms already allow clubs to see this in the app. Should members be told, in the Privacy Policy, that a club they apply to may view their application through an assistant?
3. **Members under 18 already in production.** 12 profiles have a date of birth under 18 and 16 have none (read-only count, 2026-11-27). The new eligibility text assumes the age gate handles them. Confirm they are frozen or restricted before publishing the 18+ wording.
4. **Notice period.** Section 15 of the Terms governs how members are told about changes. Decide the notice before the connector goes live in production.
