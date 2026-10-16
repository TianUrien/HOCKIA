# 0008 — Tablets get the phone layout in the native app

Status: accepted (founder, 2026-10-16). Source: device lab run of 16 Oct 2026.

## Context

The web app switches to its desktop layout at Tailwind's `lg` breakpoint
(1024 px). iPad Air and Pixel Tablet report 820–1280 dp, so inside the native
shells they rendered the desktop web layout: top navigation bar, hover-era
spacing, the preview modal instead of the phone sheets. The Figma redesign is
phone-first and no tablet layout exists. The device lab made this visible on
the first full run (screenshots in the run report).

## Decision

Inside the native shells, tablets show the phone layout: the WebView is held
to 640 pt/dp wide and centred, the rest of the screen is painted white.
Phones are untouched. The web app needs no change: it measures
`window.innerWidth` 640 and never crosses `lg`. Desktop browsers keep the
desktop layout; tablet browsers (Safari on iPad) are unchanged by this ADR.

## Evidence

- `client/ios/App/App/MainViewController.swift` — `viewDidLoad` wraps the
  WebView in a white container when `userInterfaceIdiom == .pad`;
  `viewDidLayoutSubviews` centres it at `tabletContentWidth`. Frame-based on
  purpose: no keyboard plugin is installed, so nothing native resizes the
  WebView.
- `client/android/app/src/main/java/com/inhockia/app/MainActivity.java` —
  `letterboxTablets()` when `smallestScreenWidthDp >= 600`, via the bridge's
  `CoordinatorLayout` params with horizontal centre gravity.
- Verified by `tools/devicelab` on the iPad Air 11-inch simulator and the
  Pixel Tablet emulator (phone layout, bottom tab bar, sheets).

## Consequences

- Fixed-position UI (bottom bar, sheets, decks) stays inside the 640-wide
  WebView because `fixed` is relative to the WebView viewport, which is why
  this is done natively rather than with a CSS wrapper.
- A real tablet layout later only needs this constraint removed and the web
  breakpoints revisited.
- Ships with the next native builds (iOS 1.3.20 / 33, Android 1.21 / 23).

## Alternatives considered

- CSS max-width wrapper in the app shell: every `fixed inset-x-0` element
  would need its own constraint; rejected.
- Changing the `lg` breakpoint to `(hover: hover)`: would also change tablet
  browsers and touch laptops; rejected for scope.
