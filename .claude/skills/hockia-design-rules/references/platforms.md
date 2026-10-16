# Platforms, dark mode and accessibility

## iOS (primary)
- Design at 393 × 852 (iPhone). Respect safe areas once (avoid double insets: body padding + page padding + Capacitor content inset).
- Large titles on root tabs, glass nav bars on scroll, bottom sheets with detents, swipe-down to dismiss full-screen views.
- Liquid-glass style surfaces (blur + highlight) for floating bars and chips over photos.

## Android
- Design at 412 × 915. Material navigation bar with a pill indicator on the active tab (no minimising tab bar), Android status bar, gesture handle, system back closes sheets and details (predictive back), Material back arrow in nav bars.
- Same tokens, radii and motion springs; haptics map to Android equivalents.

## Tablets (native)
- Inside the native shells, tablets get the **phone layout**: the WebView is held to 640 pt/dp wide and centred (ADR 0008). Don't design a separate tablet layout unless the founder reopens it. Tablet browsers keep their responsive web behaviour.

## Web / desktop
- Desktop layout from `lg` (1024 px): existing top navigation, content max 1200 centred.
- Profile: left sticky photo column (360 at 1024–1279, 420–480 wider) + right content.
- Opportunities: wide featured, 4-up rails (3-up at 1024–1199), 3-column list (2 at 1024–1199); role detail as a page with a sticky left cover column; applicants as master-detail.
- Hover states (lift + shadow), visible focus rings, keyboard paths for repeated actions.
- Marketing site rulings: white page throughout; one dark-violet closing panel; real club crests with an initials fallback; a fixed navbar that morphs into a glass capsule.

## Old native clients
Installed apps pin their JS until a store release ships. New data must be additive and nullable; breaking API changes need `app_version_requirements.min_version` gating (see `CLAUDE.md`). Native-only polish (haptics, some motion) lands with the next store build.

## Dark mode
Light is designed first; the Color collection has Dark mode values (category tokens tuned; others need tuning). Before handoff, check text contrast, scrims, glass and category chips in dark.

## Accessibility
- WCAG AA contrast for text (4.5:1, large text 3:1) and UI strokes (3:1); white text on generated covers relies on the darkened stops + scrim.
- Tap targets ≥ 44 pt; focus visible; meaning never by colour alone (fit badge bar meter, text labels on flags/EU where it matters).
- Screen readers: decorative initials and watermarks hidden; cards read name, role and key facts; buttons describe the action.
- Reduce Motion respected (crossfades, posters instead of clips).
