# HOCKIA — New Logo Integration Brief (for the dev agent)

> **Rev 2 (final):** every icon composition exactly matches the approved Figma board **"★ HOCKIA LOGO FINAL — Frame_ok · all variants ★"** (mark = 77.6% of canvas width, centered). Three complete icon sets ship: **primary `app-icons/`** (violet `#5b21b6` bg + white mark), **`dark-violet/`** (dark `#0b0a16` bg + light-violet `#8b5cf6` mark) and **`white-violet/`** (white bg + violet mark).

The new HOCKIA brand identity is final. All assets live in `client/public/brand/` (this folder). Your task: **unify the entire product — web, PWA, iOS/Android (TWA), SEO — on this new logo**, replacing every legacy logo asset.

## The identity

- **Mark**: the "H + hockey stick + ball" symbol ("two players, embraced by the game"). Master vectors in `svg/` (true transparency via mask — safe on any background).
- **Primary app icon**: violet `#5b21b6` background + white mark (`app-icons/`).
- Brand colors: violet `#5b21b6` (primary), `#7c3aed` (accent), light violet on dark `#8b5cf6`, ink `#0b0b12`, white.

## Asset map

| Folder | Contents | Use |
|---|---|---|
| `svg/` | black / white / violet / brand-violet / violet-light masters | website header, footer, emails, anywhere scalable |
| `logo-png/` | transparent PNGs ×4 colors × 2048/1024/512/192w | banners, social, press |
| `app-icons/` | PRIMARY (violet bg + white): ios-appstore-1024, android-playstore-512, apple-touch-180, pwa-192/512, maskable-192/512 (extra safe zone) | stores, manifest, home-screen |
| `dark-violet/` | full alternate set (app-icons + favicon), dark bg + light-violet mark | dark mode, iOS 18 dark icons, Android themed icons, dark marketing |
| `white-violet/` | full alternate set, white bg + violet mark | contexts where a light icon wins |
| `favicon/` | favicon.ico + 16/32/48/96 PNGs (violet rounded tile + white mark) | browser tabs, manifest |
| `wordmark/` | "HOCKIA" heavy-italic wordmark: SVG + PNG (2048/1024/512w) × black/white/violet/violet-light, plus boxed versions (light bordered + dark) | website header, marketing, footer, email headers — pair with the mark or use standalone |
| `seo/` | og-image-1200x630.png (light) + og-image-dark-1200x630.png | Open Graph / Twitter cards |

## Integration checklist

1. **Replace legacy root assets** in `client/public/`: `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `favicon-96x96.png`, `apple-touch-icon.png` → new files from `brand/favicon/` and `brand/app-icons/hockia-apple-touch-180.png`. Keep same filenames/paths or update references — be consistent.
2. **Replace `pwa-icons/`** contents with `brand/app-icons/hockia-pwa-192.png`, `hockia-pwa-512.png` (purpose `any`) and `hockia-maskable-192/512.png` (purpose `maskable`). Update `manifest.json` icon entries.
3. **`manifest.json`**: `theme_color` `#6366f1` → **`#5b21b6`**. Review `background_color`. Update shortcut icons if they reference old favicons.
4. **In-app logo components**: migrate every use of `HockiaLogoBlack.svg`, `WhiteLogo.svg`, `hockia-logo-white.png`, `hockia-symbol-white.svg`, `hockia-symbol.png`, `HOCKIA_logos/` → `brand/svg/hockia-logo-{black|white|violet}.svg` (2KB vs 90–240KB legacy — perf win). Then delete the legacy files.
5. **SEO / meta**: `og:image` / `twitter:image` → `/brand/seo/og-image-1200x630.png` (absolute URL). Verify `<link rel="icon">` and `<link rel="apple-touch-icon">`. Check `bimi/` — BIMI needs SVG Tiny PS; flag for founder if configured, don't guess.
6. **Native shells (TWA/iOS)**: Play listing icon = `hockia-android-playstore-512.png`; regenerate Android adaptive icon from `maskable-512`; App Store = `hockia-ios-appstore-1024.png`. iOS 18 dark icon variant = `dark-violet/app-icons/hockia-dark-ios-appstore-1024.png`. Splash: violet bg + white logo (match icon identity).
7. **Dark mode**: switch site/app logos to `svg/hockia-logo-white.svg` or `svg/hockia-logo-violet-light.svg` on dark surfaces; `og-image-dark` where a dark preview fits. Don't mix identities within one surface.
8. **Emails**: update logo URL in `email_templates` headers (white or black SVG/PNG per template background).
9. **Cache busting**: favicons/manifest icons are heavily cached — bump filenames or add `?v=2`.
10. **Verify**: fresh-profile favicon, PWA install icon, iOS "Add to Home Screen", OG preview via social debuggers, Lighthouse PWA audit.

If you find old-logo references anywhere not listed (components, README, admin, error pages), migrate them too. Report back with changed files and anything needing founder input (BIMI, store listings).
