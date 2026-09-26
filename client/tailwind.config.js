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
        'hockia-primary': '#6c2bd9',
        'hockia-secondary': '#7c3aed',
        'hockia-accent': '#ec4899',
        'hockia-success': '#15803d', // = Foundations status/positive (was #10b981)
        'hockia-warning': '#f59e0b',
        'hockia-danger': '#dc2626', // = Foundations status/danger (was #ef4444)
        'hockia-orange': '#ff9500',
        // Figma "New-Hockia" · 02 Foundations · collection "Hockia / Color" is
        // the SOURCE OF TRUTH for these (founder ruling 2026-09-26):
        //   brand/primary #6C2BD9 · brand/soft #F1EAFD · ink/primary #0F0F14 ·
        //   ink/secondary #5B5B6B · ink/tertiary #8E8E9A · surface/base #FFFFFF ·
        //   surface/muted #F4F4F7 · line/default #E6E6EC · status/positive
        //   #15803D · status/positive-soft #E8F7EE · status/danger #DC2626 ·
        //   media/placeholder #1C1B22.
        // ink-4 has no Foundations variable (kept at the iOS tertiary label grey).
        'hockia-soft': '#f1eafd',
        ink: { 1: '#0f0f14', 2: '#5b5b6b', 3: '#8e8e9a', 4: '#aeaeb2' },
        // grouped = the grey grouped surface; aligned to surface/muted (was #f2f2f7).
        surface: { muted: '#f4f4f7', grouped: '#f4f4f7' },
        line: '#e6e6ec',
        positive: { DEFAULT: '#15803d', soft: '#e8f7ee' },
        // Gold = TRUST (references). Never the amber warning hue: amber
        // (#B45309 / #FDF1E4) is for notices only — EU passport, "Apply by".
        // gold = text (6:1 on white) · gold-line = ring / card border / rule ·
        // gold-soft = pill background (with gold text).
        gold: { DEFAULT: '#7a5f0b', line: '#c9a227', soft: '#fbf4dc' },
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
      },
      borderRadius: {
        tile: '7px',
        card: '14px',
        sheet: '22px',
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
