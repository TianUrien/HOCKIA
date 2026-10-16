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
