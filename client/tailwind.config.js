// Design tokens generated from the Figma "New-Hockia" variables
// (src/styles/tokens/figma-export.json → npm run tokens:build). Read here at
// build time only; app code never imports tokens.js.
import { colors as t, radius as r } from './src/styles/tokens/tokens.js'

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  // Light only in v1 (rebrand, founder 2026-10-25): `dark:` variants need a
  // .dark class that nothing sets, so they never apply.
  darkMode: 'class',
  theme: {
    screens: {
      'xs': '420px',
      'sm': '640px',
      'md': '768px',
      'lg': '1024px',
      'xl': '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        // ── WCAG AA contrast overrides ─────────────────────────────────────
        // An app-wide axe-core audit (2026-07-27) found 585 failing text
        // nodes across 27 distinct colour pairs. Every one passed at exactly
        // ONE step darker, so these redefine those specific shades.
        //
        // `extend.colors` deep-merges, so only the listed shades move; the
        // rest of each Tailwind scale is untouched.
        //
        // WHY HERE AND NOT AT THE CALL SITES: `text-gray-400` alone appears
        // 716 times across 227 files. A find-and-replace at that scale is an
        // unreviewable diff, and it would also restyle 213 icon usages that
        // were never the problem.
        //
        // NOTE the deliberate omissions:
        //  • gray-300 is NOT here — it backs 319 borders, and darkening those
        //    would restyle every divider in the app. Its ~98 TEXT usages are
        //    fixed at the call site instead.
        //  • gray-500 is NOT here — it passes on white (4.83) and fails only
        //    on a gray-100 chip, fixed at those call sites.
        //
        // Ratios measured on white unless noted. Re-run the axe sweep before
        // changing any of these.
        // Rebrand PR 6 (2026-10-26): the whole gray scale resolves to the
        // rebrand neutrals, so ~6,300 legacy `gray-*` classes take the new
        // violet-tinted greys without an unreviewable call-site diff. Each
        // step keeps or beats the contrast it had (on white: 400 4.84 vs
        // 4.83, 500 5.42, 600 7.02, 700 10.69). 600–800 sit between
        // ink.secondary and ink.primary so the text hierarchy survives.
        // New code still uses the semantic names (ink-*, line, surface-*).
        gray: {
          50: t.surface.subtle,
          100: t.surface.muted,
          200: t.line.default,
          300: t.line.strong,
          400: t.ink.tertiary, // was #6b7280 (the 2026-07-27 AA fix) — 4.84 on white
          500: t.ink.secondary,
          600: '#5a5766',
          700: '#3f3c4d',
          800: '#262335',
          900: t.ink.primary,
          950: t.surface.inverse,
        },
        // Rebrand PR 6 part 2: legacy `slate-*` follows the same neutrals as gray.
        slate: {
          50: t.surface.subtle, 100: t.surface.muted, 200: t.line.default, 300: t.line.strong,
          400: t.ink.tertiary, 500: t.ink.secondary, 600: '#5a5766', 700: '#3f3c4d', 800: '#262335', 900: t.ink.primary,
        },
        // Rebrand PR 6: legacy `purple-*` (≈600 classes) resolves to the one
        // brand violet. 500 = brand.primary (was #a855f7, 3.96 on white, a
        // fail; now 5.70), 600/700 = hover/pressed, 100/200 = the soft fills;
        // the steps in between follow the violet scale the brand is built on.
        purple: {
          50: '#f5f3ff',
          100: t.brand.soft,
          200: t.brand['soft-hover'],
          300: '#c4b5fd',
          400: '#a78bfa',
          500: t.brand.primary,
          600: t.brand['primary-hover'],
          700: t.brand['primary-pressed'],
          800: '#4c1d95',
          900: '#3b0a7a',
        },
        teal: {
          600: '#0f766e', // on teal-50: 3.59 → 5.25
        },
        // Rebrand PR 6 part 2: green and emerald mean "positive / available"
        // only, so both scales take the positive tokens (text 5.02 on white,
        // 4.57 on the soft fill). Green buttons were converted at the call
        // sites; what remains is states (Shortlisted, available, done steps).
        emerald: {
          50: t.status['positive-soft'], 100: t.status['positive-soft'],
          500: t.status.positive, 600: t.status.positive, 700: t.status.positive, 800: t.status.positive,
        },
        // Rebrand PR 6 part 2: amber = the warning tokens (text 5.02 on white,
        // 4.51 on the soft fill). It should only appear when the viewer must act.
        amber: {
          50: t.status['warning-soft'], 100: t.status['warning-soft'],
          600: t.status.warning, 700: t.status.warning, 800: t.status.warning, 900: t.status.warning,
        },
        // Rebrand PR 6 part 2: legacy indigo accents (focus rings, links,
        // headings) take the brand violet, like purple. The accent-indigo
        // tokens used for benefit tiles are separate and unchanged.
        indigo: {
          50: '#f5f3ff', 100: t.brand.soft, 200: t.brand['soft-hover'], 400: '#a78bfa',
          500: t.brand.primary, 600: t.brand['primary-hover'], 700: t.brand['primary-pressed'],
        },
        blue: {
          500: '#2563eb', // on blue-50: 3.38 → 4.75
        },
        green: {
          50: t.status['positive-soft'], 100: t.status['positive-soft'],
          500: t.status.positive, 600: t.status.positive, // #15803d — on gray-50: 3.15 → 4.80
          700: t.status.positive,
        },
        red: {
          // 500 also fixes the notification badge: white on the old #ef4444
          // was 3.76, below AA; on this value it is 4.83.
          500: t.status.danger, // #dc2626 — on gray-50: 3.60 → 4.62
          600: t.status['danger-strong'], // #b91c1c — on red-50: 4.41 → 5.91
          50: t.status['danger-soft'], // rebrand PR 6: the danger tint
        },
        rose: {
          600: '#be123c', // on rose-50: 4.28 → 5.72
        },
        // ───────────────────────────────────────────────────────────────────
        'hockia-primary': t.brand.primary,
        'hockia-secondary': '#7c3aed',
        'hockia-accent': '#ec4899',
        'hockia-success': t.status.positive, // = Foundations status/positive (was #10b981)
        'hockia-warning': '#f59e0b',
        'hockia-danger': t.status.danger, // = Foundations status/danger (was #ef4444)
        'hockia-orange': '#ff9500',
        // Figma "New-Hockia" · collection "Hockia / Color" is the SOURCE OF
        // TRUTH for these (founder ruling 2026-09-26). Values come from the
        // generated tokens (t.*); change them in Figma, re-export, rebuild.
        'hockia-soft': t.brand.soft,
        // ink-3 = ink/tertiary, darkened 2026-09-26 (was #8e8e9a) so body text
        // passes AA: 4.95 on white, 4.51 on surface-muted.
        // ink-4 = ink/quaternary, NON-TEXT ONLY: placeholders, disabled icons,
        // chevrons, dividers (2.2:1 on white). Readable text uses ink-3.
        ink: {
          1: t.ink.primary, 2: t.ink.secondary, 3: t.ink.tertiary, 4: t.ink.quaternary,
          inverse: t.ink.inverse,
        },
        // grouped = the grey grouped surface; aligned to surface/muted (was #f2f2f7).
        surface: {
          muted: t.surface.muted, grouped: t.surface.muted,
          base: t.surface.base, subtle: t.surface.subtle,
          'muted-pressed': t.surface['muted-pressed'], inverse: t.surface.inverse,
          // surface/nav: the landing navbar capsule (white at 86 %; the
          // capsule itself paints it at 72 % over a 20 px backdrop blur).
          nav: t.surface.nav,
        },
        line: { DEFAULT: t.line.default, strong: t.line.strong },
        positive: { DEFAULT: t.status.positive, soft: t.status['positive-soft'] },
        // Gold = TRUST (references). Never the amber warning hue: amber
        // (#B45309 / #FDF1E4) is for notices only — EU passport, "Apply by".
        // gold = text (6:1 on white) · gold-line = ring / card border / rule ·
        // gold-soft = pill background (with gold text).
        gold: { DEFAULT: t.accent['gold-ink'], line: t.accent.gold, soft: t.accent['gold-soft-2'] },
        // Additive Figma namespaces (new class names only; nothing existing moves):
        // brand-*, status-*, accent-*, social-*, focus-ring, overlay-scrim.
        brand: { DEFAULT: t.brand.primary, ...t.brand },
        // category-women / -men / -mixed (+ -dark, -soft): the team a role is for.
        // Chips, filter dots and the detail "Team" fact only — never a background
        // (Opportunities v2 ruling, 2026-10-16).
        category: { ...t.category },
        // eu-ink / eu-soft = the EU badge on light surfaces (#003399 on #E6EDFF);
        // eu-solid = white-on-blue at 85 %, over photos only (design audit A10).
        eu: t.eu,
        // role-<role>-bg / role-<role>-ink: the RoleBadge pair per role
        // (player, coach, club, brand). Umpire has no pair: it stays neutral.
        role: t.role,
        // Rebrand 2026-10-25: ai-* (Hockia AI: cyan plus the spark or mascot, never
        // colour alone) and reference-* (gold, references only).
        ai: t.ai,
        reference: t.reference,
        status: t.status,
        accent: t.accent,
        social: t.social,
        focus: t.focus,
        overlay: t.overlay,
        'dark-bg': '#0a0a0a',
        'dark-surface': '#18181b',
        'dark-surface-elevated': '#27272a',
        'dark-border': '#3f3f46',
        'dark-text': '#fafafa',
        'dark-text-muted': '#a1a1aa',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      // Figma type scale (SF Pro sizes; family comes from --font-sans). Weights 400/500/600/700.
      fontSize: {
        // Rebrand 2026-10-25: Heading/H1 (Satoshi Bold 40, -3.5 %), the section roots.
        'large-title': ['40px', { lineHeight: '44px', letterSpacing: '-0.035em', fontWeight: '700' }],
        title: ['22px', { lineHeight: '27px', fontWeight: '700' }],
        // Page titles inside pushed phone screens (Figma Title XL) and big tile
        // figures (Your week, Pulse week tiles).
        'title-xl': ['28px', { lineHeight: '34px', letterSpacing: '-0.01em', fontWeight: '700' }],
        figure: ['26px', { lineHeight: '31px', letterSpacing: '-0.01em', fontWeight: '600' }],
        body: ['17px', { lineHeight: '22px' }],
        row: ['15px', { lineHeight: '20px' }],
        secondary: ['13px', { lineHeight: '18px' }],
        caption: ['12px', { lineHeight: '16px' }],
        micro: ['11px', { lineHeight: '14px' }],
        tab: ['10px', { lineHeight: '12px', fontWeight: '500' }],
        // Web landing scale (Figma Hockia-UI-UX "Web A v2", 111:1689 / 114:1743).
        // Inter; size/line-height/weight per the handoff. Display styles carry a
        // slight negative tracking; everything else is default tracking.
        'web-display': ['64px', { lineHeight: '68px', letterSpacing: '-0.02em', fontWeight: '800' }],
        'web-display-m': ['38px', { lineHeight: '42px', letterSpacing: '-0.02em', fontWeight: '800' }],
        'web-h2': ['40px', { lineHeight: '46px', letterSpacing: '-0.02em', fontWeight: '800' }],
        'web-title-2': ['24px', { lineHeight: '30px', fontWeight: '600' }],
        'web-title-3': ['20px', { lineHeight: '26px', fontWeight: '600' }],
        'web-headline': ['17px', { lineHeight: '22px', fontWeight: '600' }],
        'web-lead': ['19px', { lineHeight: '29px', fontWeight: '400' }],
        'web-body': ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'web-body-strong': ['16px', { lineHeight: '24px', fontWeight: '600' }],
        'web-subhead': ['14px', { lineHeight: '20px', fontWeight: '500' }],
        'web-subhead-strong': ['14px', { lineHeight: '20px', fontWeight: '600' }],
        'web-footnote': ['13px', { lineHeight: '18px', fontWeight: '500' }],
        // Landing v3 (Figma Hockia-UI-UX "Landing v3" 122:1885, 6 Oct 2026).
        'web3-display': ['72px', { lineHeight: '72px', letterSpacing: '-0.03em', fontWeight: '800' }],
        'web3-display-m': ['42px', { lineHeight: '44px', letterSpacing: '-0.03em', fontWeight: '800' }],
        'web3-h2': ['40px', { lineHeight: '46px', letterSpacing: '-0.02em', fontWeight: '800' }],
        'web3-title': ['28px', { lineHeight: '34px', letterSpacing: '-0.01em', fontWeight: '700' }],
        'web3-lead': ['19px', { lineHeight: '29px', fontWeight: '400' }],
        'web3-position': ['24px', { lineHeight: '30px', fontWeight: '600' }],
        'web3-button': ['17px', { lineHeight: '22px', fontWeight: '600' }],
        'web3-body': ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'web3-row': ['15px', { lineHeight: '21px', fontWeight: '400' }],
        'web3-eyebrow': ['12px', { lineHeight: '16px', letterSpacing: '0.06em', fontWeight: '600' }],
      },
      // Figma "Hockia / Space & Radius" wins (founder ruling 2026-10-02):
      // tile = radius/sm 8 (was 7) · card = radius/lg 16 (was 14) ·
      // sheet = radius/2xl 28 (founder ruling 2026-10-11: every bottom sheet,
      // app-wide; was radius/xl 20).
      // Rebrand 2026-10-25 elevation (Figma effect styles Elevation/1–3, Glow/Brand).
      boxShadow: {
        card: 'var(--shadow-card)',
        float: 'var(--shadow-float)',
        overlay: 'var(--shadow-overlay)',
        'glow-brand': 'var(--shadow-glow-brand)',
      },
      // Rebrand 2026-10-25 radius scale (xs 8 · sm 12 · md 16 · lg 24 · xl 30 ·
      // 2xl 44). Cards 24, tiles 12, sheets 28 (rule since 2026-10-11).
      borderRadius: {
        tile: `${r.sm}px`,
        card: `${r.lg}px`,
        sheet: `${r.sheet}px`,
        // The landing closing panel and the web auth card share the sheet radius.
        panel: `${r.sheet}px`,
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        fadeSlideIn: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        dotWave: {
          '0%, 100%': { opacity: '0.25', transform: 'scale(0.8)' },
          '40%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        shimmer: 'shimmer 2s ease-in-out infinite',
        fadeSlideIn: 'fadeSlideIn 400ms ease-out forwards',
        slideDown: 'slideDown 0.3s ease-out',
        dotWave: 'dotWave 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
