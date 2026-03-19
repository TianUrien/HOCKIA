# HOCKIA - Modern React Application

A production-ready React application built with Vite, TypeScript, Tailwind CSS v4, and Supabase integration.

## 🚀 Tech Stack

- **Framework:** React 18 with TypeScript
- **Build Tool:** Vite (with Rolldown experimental)
- **Styling:** Tailwind CSS v4 (next) with custom HOCKIA branding
- **Backend:** Supabase (Authentication, Database, Storage)
- **UI Components:** Custom glassmorphism components
- **Icons:** Lucide React
- **Routing:** React Router DOM
- **Utilities:** clsx, class-variance-authority

## ✨ Features

- 🎨 **Custom Design System** - HOCKIA brand colors and theme
- 🌓 **Dark Mode** - Default dark theme with custom color palette
- 💎 **Glassmorphism** - Beautiful glass-morphic UI components
- ⚡ **Lightning Fast** - Vite HMR and optimized builds
- 📱 **Responsive** - Mobile-first design approach
- 📨 **Modern Messaging UX** - WhatsApp-style chat viewport, inline day dividers, delivery states, tap-to-retry flows
- 🔐 **Authentication Ready** - Supabase auth integration
- 🎯 **Type Safe** - Full TypeScript support
- 🛠️ **Developer Experience** - Path aliases, utilities, and more

## 🔔 Notifications

- Cards keep their existing avatar, sentence-style copy, badges, and routes—only the event sources changed.
- We now surface notifications for: incoming friend requests, friend request acceptances, reference requests, reference accept/decline decisions, new club vacancy applicants, and profile comments.
- Chat messages and vacancy status updates no longer create notifications; unread indicators live entirely inside the Messages page’s conversation list.

## 🛠️ Setup

1. Install dependencies: `npm install`
2. Configure environment: `cp .env.example .env`
3. Start dev server: `npm run dev`

### Realtime Tuning

- `VITE_CONVERSATION_REALTIME_DEBOUNCE_MS` (default `200`): controls how quickly the Messages page refetches after Supabase realtime events. Increase for heavier traffic to reduce RPC calls, decrease for snappier UI updates.

## 📦 Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run test -- messages` - Run Vitest scenarios that cover the chat layout, scroll controller, and retry UX

## 📬 Messaging UX

- **Viewport stability:** chat surfaces lock the body scroll, honor iOS `visualViewport`, and keep the composer visible even while the keyboard animates.
- **Context cues:** inline day dividers break up long histories, and the unread badge shows a capped (`9+`) count with a single "jump to latest" action—no more floating overlays.
- **Distinct sender badge:** the Messages icon now reflects how many unique users currently have unread messages (not the raw unread row count), so 5 pings from the same teammate still show as "1" until someone else reaches out.
- **Infinite scroll:** when older pages load we capture the first visible message and restore the scroll offset, so the thread never jumps.
- **Delivery states:** outgoing bubbles show `Sending`, `Sent`, or `Read` with appropriate icons, and failed sends expose compact tap-to-retry/delete affordances right inside the status row.
- **Tests:** `npx vitest run` (or `npm run test`) exercises the conversation list, auto-scroll controller, and mobile-only scroll locking—run it after UX changes to catch regressions quickly.

See full documentation in the project wiki.

## 🛡️ Sentry Monitoring

- Sentry is initialized inside `src/main.tsx` and wraps the React root with `Sentry.ErrorBoundary`.
- Provide `VITE_SENTRY_DSN` in your `.env` file. The environment automatically maps Vite's `MODE` to `development` or `production` for Sentry.
- Optional source map uploads require `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` in `.env`. The Vite plugin only runs when all three are present.
- A dev-only "Throw Sentry Test Error" button is injected via `SentryTestButton` (rendered from `App.tsx`). Click it after running `npm run dev` to send a manual event and verify integration.
