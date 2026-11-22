# HOCKIA device lab

Drives the real native app on iOS simulators and Android emulators (Appium) and the web on desktop (Playwright) through the core journeys, with real thumb swipes, and reports what it measured. Runs on a Mac with Xcode and Android Studio; nothing here touches production or CI.

Full guide: `docs/engineering/device-lab.md`.

```bash
cd tools/devicelab
npm install            # once
npm run doctor         # what is missing
npm run build          # web bundle (staging) → iOS simulator app + Android debug APK
npm run run -- --device all                      # every device, every core journey
npm run run -- --device iphone-max,android-phone --scenario opportunities-role-apply
```

Reports land in `report/<timestamp>/REPORT.md` with one screenshot folder per device.

## Club speed journeys

```bash
npm run run -- --device iphone-max --scenario club-speed
npm run run -- --device android-phone --scenario club-speed
```

Signs in as the staging club and runs Your replies, select several + bulk decline, review moves on (+ Undo), the close sheet, Post again and Start with Hockia AI. Nothing is written: decisions are undone inside the 5 s window (an in-page script on Android, step by step on iOS) and every sheet is cancelled. They use `fixtures.json → speedRoleId` ("[QA] Club speed", two pending applications from [QA] players); if a run is interrupted mid-Undo, set those applications back to `pending`. `club-ai-start` makes one real Hockia AI call on staging.

## Brand campaign journeys

```bash
LAB_MOCK_DRAFT=1 npm run run -- --device iphone-max --scenario brand
LAB_MOCK_DRAFT=1 npm run run -- --device android-small --scenario brand
```

Signs in as the staging E2E brand (`E2E_BRAND_EMAIL` / `E2E_BRAND_PASSWORD` in `client/.env`, never printed) and runs `brand-sign-in`, `brand-campaigns` (the campaign list, the Hockia AI sheet and its campaign cards), `brand-campaign-draft` (one sentence in the composer with the keyboard up, the draft card, "Continue in the editor", the editor's fields) and `brand-sign-out`. "Continue in the editor" saves a draft campaign; the journey deletes it from the list and notes whether it did. Nothing is published.

With `LAB_MOCK_DRAFT=1` the draft answer is given inside the page: no model call, and none of the brand's 15 daily drafts is used. The journey fails if the page did not use the mocked answer. Without the variable it makes one real model call (about 0.003 USD) and uses one of the 15; the limit is a rolling 24 hours.

`brand-campaign-draft` also opens both date pickers in the editor, picks another end date (two days before the default end, computed from today), saves the draft, reopens it and reads the date back. On iOS, `LAB_IOS_LANG=es LAB_IOS_LOCALE=es_AR` runs the session with the simulator in Spanish, to read how dates and the picker are shown; the driver leaves the simulator in that language, so set it back afterwards.

## Publisher (club) journeys

```bash
npm run run -- --device desktop-chrome --scenario club      # club-sign-in → club-roles → club-post-role-cover → role-cover-render → club-sign-out
```

They sign in as the staging club account (`QA_CLUB_EMAIL` / `QA_CLUB_PASSWORD` in `~/.config/hockia/staging-qa.env`, next to the player keys) and sign out at the end, so a following core run signs the player back in. Publisher screens are phone-only, so desktop browsers run them at a 390×844 viewport and tablets skip them. On desktop the cover photo is uploaded from `fixtures/lab-cover.png`, checked, removed and the role discarded, leaving staging as it was; on phones the lab verifies the cover section and the image-only picker input but does not drive the OS photo picker. `role-cover-render` (also in the core order) opens `fixtures.json → coverRoleId`, a QA role of the lab club whose cover photo lives in the `role-covers` bucket, and fails if the photo is missing or broken.
