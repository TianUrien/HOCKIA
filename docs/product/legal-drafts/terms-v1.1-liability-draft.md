# DRAFT: Terms of Service v1.1, member responsibility and liability

Status: **approved by the founder on 2026-11-27 and written into `Terms.tsx` (v1.1). Not legal advice; a lawyer has not reviewed it yet.**
Written 2026-11-27 from `client/src/pages/Terms.tsx` (v1.0, last updated March 21, 2026). Founder decisions 2026-11-27:

- Hockia has no company yet, so members should release both Hockia and its operator.
- The Terms should be governed by Argentine law (the founder lives in Argentina).

This draft goes with `assistant-connector-terms-draft.md` (18+, AI assistants, Privacy). Both should ship together as Terms v1.1. A lawyer admitted in Argentina should review both before publishing. The questions they need to answer are at the end.

---

## How members accept it

This needs no new screen. `TermsGate` already asks every signed-in member to accept the current version, and it records the acceptance server-side (`accept_terms`, with the version). To publish v1.1:

1. Update `client/src/pages/Terms.tsx` with the sections below and the connector draft, and set the "Last updated" date.
2. Raise `CURRENT_TERMS_VERSION` in `client/src/components/TermsGate.tsx` from `'1.0'` to `'1.1'`. Every member then has to accept v1.1 before using Hockia again, and the record shows who accepted what and when.
3. Native apps keep their bundled build until a store release, so they keep asking for v1.0. Before relying on v1.1 for native members, either ship it in a store build or confirm that `has_accepted_terms` behaves correctly for older builds.

---

## Changes

### C1. Section 1, Introduction (replace the operator paragraph)

**Current:**
> Hockia is operated by Cristian Urien ("we", "us", "our"). For questions about these Terms, contact us at team@inhockia.com.

**Proposed:**
> Hockia is operated by Cristian Urien, an individual resident in Argentina ("we", "us", "our"). Hockia is a free networking platform. It is not an employer, recruitment agency, sports agent or club, and it does not take part in any agreement between members. For questions about these Terms, contact us at team@inhockia.com.

### C2. Section 6, Opportunities and Applications (add at the end)

> Hockia does not check whether an opportunity, an offer, a club, an organisation or a member is genuine, and does not supervise trials, travel, visas, accommodation, contracts, scholarships, payments or meetings that follow from a connection made on Hockia. Never pay a fee to apply for an opportunity or to be selected. If anyone asks you to, report it to us.

### C3. New section 6A, "Your dealings with other members"

> **6A. Your dealings with other members**
>
> Hockia only puts members in contact. Any conversation, agreement, trial, trip, meeting, contract, payment, scholarship or other arrangement between members is solely between those members. Hockia is not a party to it.
>
> You are responsible for checking who you are dealing with and for deciding whether to go ahead. You take part in any such arrangement at your own risk.
>
> If you have a dispute with another member, you agree to resolve it directly with that member. To the extent the law allows, you release Hockia and its operator from any claim, demand or damage of any kind, known or unknown, that arises from or is connected with such a dispute or with the conduct of another member, on or off the Platform.
>
> We may, but do not have to, review reports, remove content or restrict accounts. Doing so does not make us responsible for what members do.

### C4. Section 11, Limitation of Liability (add after the existing list)

> To the extent the law allows, the total liability of Hockia and its operator to you for all claims arising from these Terms or the Platform is limited to fifty United States dollars (USD 50). Hockia is free, and this limit reflects that.
>
> Nothing in these Terms limits or excludes liability that cannot be limited or excluded by law, including liability for intent (dolo) or gross negligence, or your rights as a consumer under mandatory law.

### C5. New section 11A, "Indemnity"

> **11A. Indemnity**
>
> You agree to defend, indemnify and hold harmless Hockia and its operator from any claim, loss, liability, cost or expense (including reasonable legal fees) made by a third party that arises from your content, your use of the Platform, your dealings with other members, or your breach of these Terms or of the law.

### C6. Section 14, Governing Law (replace)

**Current:**
> These Terms shall be governed by and construed in accordance with applicable laws. Any disputes arising from these Terms or your use of the Platform shall be resolved through good-faith negotiation. If a resolution cannot be reached, disputes may be submitted to the competent courts.

**Proposed:**
> These Terms are governed by the laws of the Argentine Republic.
>
> Before starting any claim, you agree to contact us at team@inhockia.com and try to resolve it in good faith for at least 30 days.
>
> Any dispute will be decided by the ordinary courts of the Autonomous City of Buenos Aires, Argentina, unless mandatory consumer law gives you the right to bring it in the courts where you live.
>
> Any claim arising from these Terms or the Platform must be brought within one year after the facts that give rise to it, unless the law requires a longer period.

The founder chose the Autonomous City of Buenos Aires on 2026-11-27.

### C7. Section 15, Changes to These Terms (replace the last sentence)

**Current:**
> Your continued use of Hockia after the effective date of updated Terms constitutes your acceptance of the changes.

**Proposed:**
> For material changes, we will ask you to accept the new Terms in the app before you continue using Hockia, and we keep a record of that acceptance.

This matches what `TermsGate` does when the version changes, and it gives stronger evidence than continued use.

### C8. "Last updated"

Set it on the day v1.1 ships, together with the Privacy Policy changes in the connector draft.

---

## Limits to know about (for the founder)

- **No text removes all responsibility.** Under Argentina's Civil and Commercial Code (arts. 988 and 1743) and the Consumer Protection Law 24.240 (art. 37), a clause in standard-form terms can be treated as not written if it is abusive, removes the member's essential rights, or excuses intent or gross negligence. That is why C3 and C4 say "to the extent the law allows" and C4 keeps the intent and gross-negligence carve-out: moderate clauses are more likely to hold.
- **Members abroad keep their local consumer protections.** Choosing Argentine law does not remove the mandatory rights of a member in the UK or the EU. C6 says so.
- **The release protects you personally only as far as the contract reaches.** It binds members who accept it. It does not bind third parties, such as a member's family or a public authority. A company remains the stronger protection when it becomes possible.
- **Practice matters as much as text.** Keep doing what protects a platform: no fees, no guarantees, act fast on reports, and keep records, as with the 2026-11-27 agency case.

## Open questions for a lawyer

1. Is a free platform with no company a "proveedor" under Law 24.240, so that the consumer-law limits apply to these Terms?
2. Do the release in C3 and the USD 50 cap in C4 hold under arts. 988 and 1743 of the Civil and Commercial Code? Should either be narrowed?
3. Is naming the courts of the Autonomous City of Buenos Aires valid against members who are consumers elsewhere in Argentina or abroad?
4. Does the operator need to register a database with the Argentine data protection authority (Law 25.326) for member data?
5. Is one year a valid claim period under Argentine law for these claims?
6. The Terms are only in English, but many members use the app in Spanish. Does Argentine consumer law require a Spanish version for them to bind Spanish-speaking members? (The acceptance screen already shows the key clause in Spanish.)

## What shipped in v1.1 (2026-11-27)

- C1 to C8 above, in `client/src/pages/Terms.tsx`.
- 18+ from the connector draft: Terms sections 2 and 9 (A1, A2) and Privacy Policy section 9, with the freeze wording (not "delete").
- Not shipped: the AI assistant sections (A3, A4, B1 to B3). They wait until the connector is approved for production.
- `CURRENT_TERMS_VERSION` is now `'1.1'`, and the acceptance screen shows the key clause from 6A in both languages (`termsGate.responsibility`).
