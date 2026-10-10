# Native release runbook (iOS and Android)

How a store build is produced, checked, symbolicated and verified. Written
2026-10-07 from `client/package.json`, `client/scripts/assert-prod-bundle.mjs`,
`client/ios/App`, `client/android`, `client/src/lib/sentryInit.ts` and the
release audit of 2026-10-05/06. The web half of a release is in
[operations.md](operations.md) section 2.4; this document is the native half.

Nothing here contains a credential. The Sentry token, org and project are
read from the environment (`client/.env`, gitignored) and are never printed.

## 1. What a build carries

| Item | iOS | Android |
|---|---|---|
| Version numbers | `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in `client/ios/App/App.xcodeproj/project.pbxproj` — **both** the Debug and the Release configuration | `versionName` and `versionCode` in `client/android/app/build.gradle` |
| Next build | **1.3.18 (29)** | **1.19 (21)** |
| Web bundle | `client/dist` copied by `npx cap sync` to `ios/App/App/public` (gitignored) | same, to `android/app/src/main/assets/public` (gitignored) |
| Native plugins | `client/ios/App/CapApp-SPM/Package.swift` (SPM, no CocoaPods, no `.xcworkspace`) | `client/android/capacitor.settings.gradle` + `app/capacitor.build.gradle` |
| Crash reporting | `SentryCapacitor` product from `@sentry/capacitor` (pulls `getsentry/sentry-cocoa` 9.28.0, exact) | `:sentry-capacitor` project (pulls `io.sentry:sentry-android` 8.50.1) |
| Signing | Team `TXN8KM3Q3B`, automatic signing, archive from Xcode | `client/android/key.properties` is gitignored; founder signs in Android Studio (Build → Generate Signed Bundle, keystore `hockia-release-key.jks`, alias `hockia`) |

One web bundle serves both shells. The shell and store version are therefore
runtime Sentry tags (`platform`, `app_version`, `app_build`), not part of the
release name.

The three Capacitor-generated files (`Package.swift`, `capacitor.settings.gradle`,
`capacitor.build.gradle`) are rewritten by `npx cap sync`; never hand-edit them.
Adding or removing a Capacitor plugin means `npm install`, `npx cap sync` and
committing those three files.

## 2. Crash reporting on native

Verified from `client/src/lib/sentryInit.ts` and `client/src/main.tsx`:

- Web: `@sentry/react` alone, unchanged.
- Native (`Capacitor.isNativePlatform()`): `@sentry/capacitor` wraps the same
  React SDK — `SentryCapacitor.init({ ...options, enableNative: true },
  SentryReact.init)`. The plugin installs the native SDKs (sentry-cocoa on
  iOS, sentry-android on Android) for crashes, app hangs and watchdog
  terminations, sends JS events through the native transport (offline
  caching), and syncs tags set from JS to the native scope.
- The native layer receives `dsn`, `enabled`, `environment`, `release`
  (`native@<git sha>`, the same string the source-map upload uses) and
  `tracesSampleRate`. Callbacks (`beforeSend`, `beforeBreadcrumb`,
  `ignoreErrors`) stay on the JS side; the native crash path has no PII
  scrubber, so keep PII out of tags and breadcrumbs.
- `enabled` is false in development or without a DSN; the native SDK is then
  not initialised either (same silence as the web).
- Session replay is never attached on native (Apple guideline 5.1.2); the
  Capacitor options type has no replay keys at all.
- Bundle cost, measured 2026-10-07 with the CI method (gzip of the eager
  chunks): 472.5 KB before, 478.2 KB with the plugin, against the 480 KB
  budget in standards.md. Loading the plugin lazily on native was measured
  at 476.2 KB — a 2 KB saving, because most of its weight is `@sentry/browser`
  code that lands in the shared `sentry` chunk either way — so it is imported
  statically and the native SDK is armed synchronously at startup. The
  eager set is now within 2 KB of the budget: the next first-load growth
  needs code-splitting, not a bump.

### Version pinning

`@sentry/capacitor` requires `@sentry/react` at **exactly** the version it
was built against (4.4.0 ↔ 10.69.0). `package.json` pins `@sentry/react`
without a caret and the plugin's postinstall (`scripts/check-siblings.js`)
fails `npm ci` if they drift. To bump, update both together:

```
UPDATE_SENTRY_CAPACITOR=1 npm install --save-exact @sentry/capacitor@<x> @sentry/react@<the version @sentry/capacitor@<x> lists in peerDependencies>
npx cap sync
```

then commit `package.json`, `package-lock.json` and the three generated native
files.

## 3. Symbols (readable frames)

| Layer | What Sentry needs | How it gets there |
|---|---|---|
| JavaScript (both shells) | Source maps for release `native@<sha>` | `npm run cap:build` runs `vite build` with `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` in the environment (`client/.env`). The Vite plugin uploads `dist/**/*.map` under `native@<sha>` and deletes the maps before `cap sync` copies `dist/`. With any of the three variables missing, the build succeeds **without** maps and every JS frame is minified: check Sentry → Releases → `native@<sha>` → Artifacts before archiving. |
| iOS native | dSYMs of the archive | The Release configuration uses `DEBUG_INFORMATION_FORMAT = dwarf-with-dsym`, so every archive contains `dSYMs/`. Upload them after archiving (step 7 below). |
| Android native | ProGuard/R8 mapping | Not needed today: `minifyEnabled false` in `client/android/app/build.gradle`, so Java frames are readable as built. The Sentry Android SDK's own native symbols come from Sentry's symbol server. If minification is ever enabled, add the Sentry Android Gradle plugin or `sentry-cli upload-proguard` here. |

### Uploading iOS dSYMs

`sentry-cli` is already installed (`client/node_modules/.bin/sentry-cli`, a
dependency of `@sentry/vite-plugin`), and `npm run sentry:dsyms` wraps
`sentry-cli debug-files upload`. It reads the org, project and token from the
environment, exactly like the Vite plugin.

```
cd client
( set -a; . ./.env; set +a; npm run sentry:dsyms -- "<path to>.xcarchive/dSYMs" )
```

The archive path: Xcode → Window → Organizer → right-click the archive → Show
in Finder, normally
`~/Library/Developer/Xcode/Archives/<YYYY-MM-DD>/App <date>, <time>.xcarchive/dSYMs`.
The subshell keeps the sourced variables out of your interactive shell; do not
`echo` or `cat` the file. Expected output ends with the number of debug files
uploaded. Confirm in Sentry → Settings → Projects → the iOS project → Debug
Files, where the app's UUIDs must appear.

Alternatives not configured (and why): the Sentry Xcode build phase would need
the token available to Xcode at archive time, which the repo does not provide;
the App Store Connect integration (Sentry pulls dSYMs automatically) needs an
API key created in App Store Connect — a founder decision.

## 4. Release checklist (ordered)

Run from the repository root unless noted. Every step is a gate: do not
continue past a failure.

1. `cd client && npm ci` — a clean install from the lockfile (also runs the
   Sentry sibling-version check).
2. Clear untracked files from `client/public` — `git status --porcelain
   client/public` must be empty. Anything there ships inside the binary
   (`cap:build` now refuses to package while this list is non-empty; see
   `client/scripts/assert-prod-bundle.mjs`). Move stray mockups and artwork
   out of the tree; do not `git add` them.
3. Bump the versions (section 1) in both Xcode configurations and in
   `build.gradle`; commit.
4. `npm run cap:build` with the three `SENTRY_*` variables in the environment.
   It builds, asserts the bundle is production-only (prod Supabase endpoint
   present, staging endpoint absent), copies `app.html` over `index.html` (the
   native entry must not be the prerendered marketing landing) and syncs both
   platforms. Confirm in the output that the Sentry plugin uploaded source maps
   for `native@<sha>` (and in Sentry → Releases).
5. iOS: open `client/ios/App/App.xcodeproj` in Xcode (the project, not a
   workspace — there is no Podfile), select the `App` scheme with "Any iOS
   Device (arm64)", team `TXN8KM3Q3B`, Product → Archive.
6. In the Organizer verify the archive reads version **1.3.17 (28)** before
   distributing.
7. Upload the archive's dSYMs to Sentry (section 3).
8. Distribute to TestFlight (App Store Connect → the build appears after
   processing, usually a few minutes).
9. Device checks on a real iPhone running the TestFlight build:
   - cold start online, then cold start offline (airplane mode) — shell loads,
     no white screen, splash hands off cleanly;
   - Google sign-in and Apple sign-in;
   - email verification link and password reset link opened from Mail land
     in the app;
   - photo, camera, video and "Take Video" on every upload surface (profile
     photo, gallery, highlights, posts, chat attachments);
   - push: received in the foreground, in the background, and a tap opens the
     right screen; signing out stops pushes;
   - safe areas and keyboard on the sign-in screen and in chat (top bar,
     back chevron, password field above the keyboard);
   - deep link into the app;
   - report and block a member;
   - delete account;
   - About shows version 1.3.17 (28).
10. Sentry verification (section 5): one JS error and one forced native crash
    must appear under release `native@<sha>` with `platform` and `app_version`
    tags and readable frames.
11. Submit for review. After approval, set the soft update nudge on
    **production**: in the Supabase SQL editor,
    `update public.app_version_requirements set latest_version = '1.3.17', updated_at = now() where platform = 'ios';`
    (`min_version` stays as it is unless the founder decides to force an
    update — see operations.md on native rollback).
12. Android: in Android Studio with `JAVA_HOME` set to Studio's bundled JBR,
    Build → Generate Signed Bundle (release). Verify the AAB before upload:
    `jarsigner -verify` must not say "unsigned", the manifest must read
    `versionCode 20` / `versionName 1.18`, and the entry chunk hash inside the
    AAB must match `client/android/app/src/main/assets/public/index.html`.
    Studio writes to `~/hockia-build/release/`, and its "locate" link has
    opened a stale folder before. Upload to the Play production track, repeat
    the device checks and the Sentry verification on an Android device, then
    `update public.app_version_requirements set latest_version = '1.18', updated_at = now() where platform = 'android';`.
13. Record the release: commit the synced native files, tag per
    operations.md 2.5, and note the build numbers in the release summary.

## 5. Sentry verification

What must be true before the build is considered monitored (release audit,
founder ruling 2026-10-06: an installed SDK proves nothing — the events must
be seen):

1. A JS error from the native shell appears in the web project under release
   `native@<sha>`, environment `production`, tags `platform=ios` (or
   `android`), `app_version=1.3.17`, `app_build=28`, with the stack mapped to
   `src/` files (source maps from step 4).
2. A forced native crash appears under the same release and tags with
   symbolicated frames (dSYMs from step 7 on iOS; readable as built on
   Android).

### Triggering the two events

There is deliberately no UI for this. `src/lib/sentryInit.ts` exposes two
hooks on native builds only, reachable from a debugger attached to the
WebView:

```
window.__hockiaSentry.jsError()      // throws an uncaught Error on the next tick
window.__hockiaSentry.nativeCrash()  // SentryCapacitor.nativeCrash(): kills the process
```

The crash is reported on the **next launch** (native SDKs send crash reports
at startup), so reopen the app and wait a few seconds.

Getting a debugger onto a build that has symbols:

- iOS: the WebView is inspectable only in Debug builds unless
  `ios.webContentsDebuggingEnabled: true` is set in `capacitor.config.ts`,
  and only Release builds produce dSYMs. For the verification run set that
  flag, `npx cap sync ios`, edit the scheme (Product → Scheme → Edit Scheme →
  Run → Build Configuration: Release) and run on the iPhone from Xcode. Safari
  → Develop → the iPhone → HOCKIA opens the console. Upload the run's dSYM
  (`~/Library/Developer/Xcode/DerivedData/App-*/Build/Products/Release-iphoneos/App.app.dSYM`)
  the same way as an archive's. **Revert the flag and re-sync before
  archiving**: a store build must never be inspectable. The release name is
  baked at `cap:build` time, so this run reports under the same `native@<sha>`
  as the TestFlight build.
- Android: a release build is inspectable when `webContentsDebuggingEnabled`
  is true in `capacitor.config.ts` (same caveat: temporary). Chrome →
  `chrome://inspect` → the device → HOCKIA. Frames are readable without
  uploads because the build is not minified.

Then open Sentry → Issues, filter `release:native@<sha>`, and check both
issues: tags, environment, the mapped JS frames and the symbolicated native
frames. If the JS frames are minified, the maps were not uploaded for this
sha (section 3); if the native frames show only addresses, the dSYM upload
did not include this binary's UUID.

## 6. Traps collected from past builds

- `npm run build && npx cap sync` is **not** `cap:build`: without the
  `app.html` → `index.html` swap the native entry is the prerendered landing.
- `assert-prod-bundle` matches the staging **endpoint**; the bare staging
  project ref appears legitimately in the bundle (`getEnvironment()`), that is
  not a leak.
- Gradle does not run on the system JDK here; use Android Studio's bundled
  JBR as `JAVA_HOME`.
- App Store Connect rejects symbols such as "✓" in the What's New field.
- Unsigned simulator builds launch black (-67056); Android 12+ keeps the system
  icon splash regardless of the in-app artwork.
- Installed apps pin their bundle: before any breaking server change, raise
  `app_version_requirements.min_version` and wait for adoption.

## Changes in 1.3.18 (29) / 1.19 (21) — 2026-10-10

Source: PRs #247–#249.

- **Android R8.** Release builds have `minifyEnabled true` and `shrinkResources true`. Rules live in `client/android/app/proguard-rules.pro`; Capacitor's consumer rules keep every plugin.
  - The signed AAB carries `mapping.txt`, so Play Console deobfuscates native crashes.
  - Sentry native Java frames stay obfuscated until a mapping upload is wired.
  - Before uploading, install the signed build on a real Android phone. Check launch, sign-in, the in-app browser (Google), camera upload and push.
- **iOS `MainViewController`.** It replaces `CAPBridgeViewController` in `Main.storyboard` and registers the `AppSurface` plugin. After the native splash hides, the plugin turns the web view surface white.
  - Why: with `contentInset: 'automatic'` the layout viewport is 12 pt shorter than the screen.
- **Safe areas.** The body pads only the top inset. Screen-height layouts use `min-h-app-screen` / `h-app-screen`; see the note in `client/src/globals.css`.
- **Facebook switch.** The button follows `app_settings` key `facebook_login_enabled` at runtime, so no store build is needed to turn it on.
