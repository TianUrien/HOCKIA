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
        gray: {
          400: '#6b7280', // was #9ca3af — 2.54 (fail) → 4.83. ~191 nodes.
        },
        teal: {
          600: '#0f766e', // on teal-50: 3.59 → 5.25
        },
        emerald: {
          600: '#047857', // on emerald-50: 3.58 → 5.21
        },
        amber: {
          600: '#b45309', // on amber-50: 3.07 → 4.84
        },
        blue: {
          500: '#2563eb', // on blue-50: 3.38 → 4.75
        },
        green: {
          600: '#15803d', // on gray-50: 3.15 → 4.80
        },
        red: {
          // 500 also fixes the notification badge: white on the old #ef4444
          // was 3.76, below AA; on this value it is 4.83.
          500: '#dc2626', // on gray-50: 3.60 → 4.62
          600: '#b91c1c', // on red-50: 4.41 → 5.91
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
        },
        line: t.line.default,
        positive: { DEFAULT: t.status.positive, soft: t.status['positive-soft'] },
        // Gold = TRUST (references). Never the amber warning hue: amber
        // (#B45309 / #FDF1E4) is for notices only — EU passport, "Apply by".
        // gold = text (6:1 on white) · gold-line = ring / card border / rule ·
        // gold-soft = pill background (with gold text).
        gold: { DEFAULT: t.accent['gold-ink'], line: t.accent.gold, soft: t.accent['gold-soft-2'] },
        // Additive Figma namespaces (new class names only; nothing existing moves):
        // brand-*, status-*, accent-*, social-*, focus-ring, overlay-scrim.
        brand: { DEFAULT: t.brand.primary, ...t.brand },
        // role-<role>-bg / role-<role>-ink: the RoleBadge pair per role
        // (player, coach, club, brand). Umpire has no pair: it stays neutral.
        role: t.role,
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
        'large-title': ['34px', { lineHeight: '41px', letterSpacing: '-0.015em', fontWeight: '700' }],
        title: ['22px', { lineHeight: '27px', fontWeight: '700' }],
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
      },
      // Figma "Hockia / Space & Radius" wins (founder ruling 2026-10-02):
      // tile = radius/sm 8 (was 7) · card = radius/lg 16 (was 14) ·
      // sheet = radius/xl 20 (was 22).
      borderRadius: {
        tile: `${r.sm}px`,
        card: `${r.lg}px`,
        sheet: `${r.xl}px`,
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
