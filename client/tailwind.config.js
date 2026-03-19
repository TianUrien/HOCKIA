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
        'hockia-primary': '#8026FA',
        'hockia-secondary': '#924CEC',
        'hockia-accent': '#ec4899',
        'hockia-success': '#10b981',
        'hockia-warning': '#f59e0b',
        'hockia-danger': '#ef4444',
        'hockia-orange': '#ff9500',
        'dark-bg': '#0a0a0a',
        'dark-surface': '#18181b',
        'dark-surface-elevated': '#27272a',
        'dark-border': '#3f3f46',
        'dark-text': '#fafafa',
        'dark-text-muted': '#a1a1aa',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
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
      },
      animation: {
        shimmer: 'shimmer 2s ease-in-out infinite',
        fadeSlideIn: 'fadeSlideIn 400ms ease-out forwards',
        slideDown: 'slideDown 0.3s ease-out',
      },
    },
  },
  plugins: [],
}
