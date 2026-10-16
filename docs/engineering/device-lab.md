# Device lab (native app on simulators and emulators)

_Added 2026-10-16 after the frozen role page on iPhone (PR #316). Source: `tools/devicelab/`._

## Why

The app is a WebView inside Capacitor shells. Unit tests and Playwright cover the web layer on desktop and phone-sized browsers, but nothing drove the **native** app with real touch gestures on phones and tablets. The role-page freeze (a CSS-hidden desktop dialog still mounted its body scroll lock) was invisible to every automated check and shipped in an iOS build. The lab closes that gap: it installs the real app on iOS simulators and Android emulators, swipes like a thumb, and reads the WebView DOM to confirm the page actually moved.

## What it drives

| Device id | Platform | What |
|---|---|---|
| `iphone-max` | iOS 27 simulator | iPhone 17 Pro Max |
| `iphone-small` | iOS 27 simulator | iPhone 17e |
| `ipad` | iOS 27 simulator | iPad Air 11-inch (M4) |
| `android-phone` | Android 16 emulator | Medium phone (1080×2400) |
| `android-small` | Android 16 emulator | Small phone (1080×2340, 440 dpi) |
| `android-tablet` | Android 16 emulator | Pixel Tablet (2560×1600) |
| `desktop-chrome`, `desktop-safari` | Playwright | 1440×900 web |

Devices are declared in `tools/devicelab/devices.json`. The Android tablet and small phone were cloned from the Medium Phone AVD (no `avdmanager` on this Mac); creating more is a copy of an `.avd` folder plus its `.ini`.

## Core journeys (`scenarios/index.mjs`)

1. `sign-in` — QA account from `~/.config/hockia/staging-qa.env`, no horizontal overflow after login.
2. `home-feed` — feed renders, a swipe scrolls it.
3. `opportunities-role-apply` — list scrolls, role page scrolls after a real swipe (the 15 Oct bug), Apply sheet opens and is closed without submitting.
4. `inbox-thread` — opens a conversation, swipe moves the thread, types in the composer; sends only with `--writes`.
5. `community-profile` — grid scrolls, a public profile opens and scrolls.
6. `profile-edit` — own profile scrolls, Edit opens.
7. `role-cover-render` — opens `fixtures.json → coverRoleId` (a QA role of the lab club with a cover photo in the `role-covers` bucket) and fails if the photo is missing or broken; on desktop width the role page has no cover hero yet, so it only notes.

## Publisher (club) journeys (`--scenario club`, added 16 Oct 2026)

`club-sign-in` → `club-roles` → `club-post-role-cover` → `role-cover-render` → `club-sign-out`. They use `QA_CLUB_EMAIL` / `QA_CLUB_PASSWORD` from the same keys file (the Playwright staging club account) and sign out at the end so the next core run signs the player back in; `sign-in` itself now replaces a session that belongs to a different account. Publisher screens are phone-only (`max-width: 1023px`), so desktop browsers run them at a 390×844 viewport and tablets skip them with a note. `club-post-role-cover` uploads `fixtures/lab-cover.png` on desktop, asserts the preview and the Change / Remove states, removes it and discards the role (Remove deletes the file, so staging is left as it was); on phones it verifies the cover section and the image-only picker input but does not drive the OS photo picker.

Each journey is written once against a small lab API (`go`, `waitFor`, `tap`, `type`, `swipeUp`, `eval`, `shot`) implemented twice: `lib/appium.mjs` (WebView context for DOM, `NATIVE_APP` context for gestures) and `lib/web.mjs` (Playwright). A failing assertion keeps a `FAILED` screenshot.

## How to run

```bash
cd tools/devicelab
npm install                 # Appium 2 + XCUITest + UiAutomator2 drivers + webdriverio (local to this folder)
npm run doctor              # simulators, AVDs, Java, builds, credentials
npm run build               # vite --mode lab (reads client/.env = STAGING), cap sync, xcodebuild (simulator, unsigned), gradlew assembleDebug
npm run run -- --device all
npm run run -- --device ios --scenario opportunities-role-apply
npm run run -- --device android-tablet --writes   # also sends the test message
```

Output: `tools/devicelab/report/<timestamp>/REPORT.md` (pass/fail table), `results.json`, `run.log`, `appium.log`, and screenshots per device. Reports are git-ignored; attach the folder to the release notes or the PR.

The lab build always points the app at **staging** (`client/.env`), never at production. The store build (`npm run cap:build` in `client/`) is a different command and still uses `.env.production`.

## When it runs

- Before every store build (`docs/engineering/native-release.md`, step "device lab green"), on this Mac.
- On demand after any change to layout, scroll containers, modals/sheets, the bottom bar, safe areas or the keyboard.
- Not in GitHub Actions: macOS runners bill at 10× and the Actions budget is already tight. A web-only regression for the role page runs in CI instead (`client/e2e/role-page-scroll.player.spec.ts`).

## What it measures, and what it does not

Measured: DOM state after real gestures (scroll positions, pinned body, overflow), navigation, element presence, screenshots. Not measured: smoothness, frame drops, audio, haptics, push notifications, real-device sensors, App Store review behaviour. Those still need a human on a device.

## Known traps

- **Xcode 27**: there is no `Simulator.app` any more (the window app is `DeviceHub.app`), so Appium cannot open the simulator UI; iOS sessions run with `appium:isHeadless: true` (gestures and screenshots unaffected). WebDriverAgent as shipped by the driver declares `IPHONEOS_DEPLOYMENT_TARGET 12.0`, which Xcode 27 refuses (`xcodebuild` exit 65); `build.mjs` builds it once with `IPHONEOS_DEPLOYMENT_TARGET=16.0` into `.build/wda` and sessions use `appium:usePrebuiltWDA` + `appium:derivedDataPath`. Rebuild with `npm run build -- --wda` after a driver upgrade.
- **iOS WebView DOM access**: Capacitor only marks the WKWebView inspectable when `ios.webContentsDebuggingEnabled` is true; `capacitor.config.ts` sets it from `HOCKIA_LAB=1`, which only `tools/devicelab/build.mjs` exports at `cap sync`. Store builds (`npm run cap:build`) never set it. Without it Appium sees only `NATIVE_APP` and every DOM step times out.
- **One device family at a time.** Two emulators plus two simulators at once overloaded the Mac (16 Oct): Android showed "Process system isn't responding" and the simulators dropped touches, so every swipe assertion failed. `run.mjs` already runs devices one after another; do not start a second run on another port in parallel.
- **Clean install per session** (`appium:fullReset`, default): Android restores the WebView's last route on relaunch, so a run that ended on the profile page made the next run's navigations look stale. `LAB_KEEP_STATE=1` keeps app data when that is wanted.
- **Navigation verifies the route** (`lab.go` retries up to 3×): a full `location.assign` closes chromedriver's target on Android; the adapter re-discovers the WebView context and treats "no such window" after a click as success.
- **Desktop waits are for presence, not visibility**: desktop pages also carry the CSS-hidden phone tree, and Playwright's default `waitForSelector` (visible) hangs on the first, hidden match.
- **Fixtures** (`tools/devicelab/fixtures.json`, staging only): a long "[QA] Device lab" role so the role-page scroll can be asserted (every other QA role fits the screen), and role ids the desktop flow opens by URL because desktop cards open a preview modal without a route. The QA inbox has no conversation, so the thread half of `inbox-thread` reports "not tested" until one exists.
- Android: `avdmanager` is not installed (no command-line tools); new AVDs are clones of an existing `.avd` folder with `hw.lcd.*`, `skin.name` and `AvdId` edited plus a matching `.ini`.
- Android webview automation needs a matching chromedriver; the runner passes `chromedriver_autodownload` so Appium fetches it once.
- A device appears "frozen" to a DOM-only check (`scrollTo` still works) — only the swipe test tells the truth; keep `swipeUp` in the native context.
- The QA account must exist on staging with at least one conversation for `inbox-thread` to test the thread; otherwise the scenario notes it and passes.
