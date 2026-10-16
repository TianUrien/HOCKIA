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

## Publisher (club) journeys

```bash
npm run run -- --device desktop-chrome --scenario club      # club-sign-in → club-roles → club-post-role-cover → role-cover-render → club-sign-out
```

They sign in as the staging club account (`QA_CLUB_EMAIL` / `QA_CLUB_PASSWORD` in `~/.config/hockia/staging-qa.env`, next to the player keys) and sign out at the end, so a following core run signs the player back in. Publisher screens are phone-only, so desktop browsers run them at a 390×844 viewport and tablets skip them. On desktop the cover photo is uploaded from `fixtures/lab-cover.png`, checked, removed and the role discarded, leaving staging as it was; on phones the lab verifies the cover section and the image-only picker input but does not drive the OS photo picker. `role-cover-render` (also in the core order) opens `fixtures.json → coverRoleId`, a QA role of the lab club whose cover photo lives in the `role-covers` bucket, and fails if the photo is missing or broken.
