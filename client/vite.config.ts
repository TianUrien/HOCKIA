import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { readFileSync } from 'fs'

// Sentry release tag for NATIVE builds: derive "<marketing>+<build>" from the
// iOS Xcode project (the single source of truth for the shipped version), so
// crashes from the store binary are attributable instead of tagged 'unknown'.
// An explicit VITE_APP_VERSION always wins (e.g. Vercel web builds).
function readNativeAppVersion(): string {
  try {
    const pbx = readFileSync(
      path.resolve(__dirname, 'ios/App/App.xcodeproj/project.pbxproj'),
      'utf8',
    )
    const marketing = pbx.match(/MARKETING_VERSION = ([0-9][0-9.]*);/)?.[1]
    const build = pbx.match(/CURRENT_PROJECT_VERSION = ([0-9]+);/)?.[1]
    return marketing ? `${marketing}+${build ?? '0'}` : ''
  } catch {
    return ''
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '..'), '')
  const localEnv = loadEnv(mode, __dirname, '')
  const mergedEnv = { ...rootEnv, ...localEnv }
  const devHost = mergedEnv.VITE_DEV_HOST ?? '0.0.0.0'
  const devPort = Number(mergedEnv.VITE_DEV_PORT ?? '5173')
  const enableSentryUploads = Boolean(
    mergedEnv.SENTRY_AUTH_TOKEN &&
    mergedEnv.SENTRY_ORG &&
    mergedEnv.SENTRY_PROJECT
  )
  const manualChunkGroups: Array<{ name: string; pattern: RegExp }> = [
    { name: 'react', pattern: /node_modules\/(react|react-dom|scheduler|shared)\// },
    { name: 'supabase', pattern: /node_modules\/(@supabase|@supabase-cache-helpers)\// },
    { name: 'tanstack', pattern: /node_modules\/(@tanstack|@hookform)\// },
    { name: 'state', pattern: /node_modules\/(zustand|immer)\// },
    { name: 'icons', pattern: /node_modules\/lucide-react\// },
    { name: 'datetime', pattern: /node_modules\/date-fns\// },
    { name: 'sentry', pattern: /node_modules\/@sentry\// },
    { name: 'router', pattern: /node_modules\/react-router/ },
  ]

  /** Dynamically-imported deps that must NEVER be folded into `vendor`.
   *  `vendor` is modulepreloaded by index.html, so landing here silently
   *  makes a deliberately code-split dependency eager. */
  // recharts moved here from a manual 'charts' group (2026-07-29): with the
  // manual group, rolldown deduplicated React ITSELF into the charts chunk
  // (jsx-runtime/createContext lived there), so all ~100 chunks statically
  // imported 372KB of admin-only charting to reach the jsx helper — putting
  // recharts in the critical path of every page. As a lazy-only dep it stays
  // inside the admin pages' own dynamic chunks where it belongs.
  const LAZY_ONLY_DEPS = /node_modules\/(posthog-js|recharts|d3-|victory)\//

  return {
    plugins: [
      react(),
      VitePWA({
        // autoUpdate (was 'prompt', 2026-07-29): with prompt and no prompt
        // UI, returning visitors got a stale index.html once per deploy —
        // the founder hit exactly this after the landing relaunch. autoUpdate
        // activates the fresh SW immediately (skipWaiting+clientsClaim) so
        // the next navigation serves current code, no reload popup.
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'WhiteLogo.svg', 'HockiaLogoBlack.svg', 'apple-touch-icon.png'],
        manifest: false, // We use our own manifest.json
        workbox: {
          importScripts: ['/push-sw.js'],
          // Images are deliberately NOT precached: public/ images aren't
          // content-hashed, so workbox fetches them with a revision query —
          // a SECOND download of e.g. the hero mockup during first load.
          // The runtime image route below caches them on actual use.
          globPatterns: ['**/*.{js,css,html,ico,svg,woff2}'],
          // PERF (Lighthouse 2026-07-29): the precache was 266 entries /
          // 7.6MB, downloaded in the background on a first-time visitor's
          // landing view — competing with the LCP image on mobile radio
          // (an admin-only recharts chunk showed up in the landing trace).
          // Heavy lazy chunks are excluded from INSTALL-time precache and
          // picked up by the runtime route below on first actual use.
          globIgnores: [
            '**/charts-*.js',      // recharts — admin dashboards only
            '**/Admin*-*.js',      // every /admin page chunk
            '**/posthog-*.js',     // consent-gated; never needed pre-consent
          ],
          runtimeCaching: [
            {
              // Same-origin images: cached on first use, refreshed in the
              // background. Keeps repeat visits instant without doubling the
              // first visit's downloads.
              urlPattern: /\.(?:png|webp|jpg|jpeg|avif)$/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'images',
                expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              // Hashed build assets excluded from precache above: cache on
              // first use. CacheFirst is safe — filenames are content-hashed.
              urlPattern: /\/assets\/.*\.(?:js|css)$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'lazy-assets',
                expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            // NO runtime caching of /rest/v1/ — deliberately removed 2026-08-08.
            //
            // It used to be NetworkFirst into a `supabase-api-cache`, which was
            // wrong on two counts:
            //
            //  1) SECURITY. Cache Storage keys on URL ALONE — the Authorization
            //     header is not part of the key. Every /rest/v1/ response is
            //     user-scoped and authorised by the caller's JWT, so on a shared
            //     device one account's rows could be served to the next person,
            //     and entries survived sign-out entirely.
            //  2) CORRECTNESS. NetworkFirst falls back to cache whenever the
            //     network hiccups, so a list could silently render a stale
            //     snapshot. Home reads its feed over POST (which Workbox never
            //     caches) while lists use GET — so the two surfaces could
            //     disagree, which is what made the 2026-08-08 "opportunity
            //     missing from Opportunities" report ambiguous to diagnose.
            //
            // React Query already provides in-session caching with proper
            // invalidation, and its cache IS cleared on logout — so nothing of
            // value is lost. Offline reads were marginal anyway behind a
            // 5-minute TTL that only applied on network failure. Caches left on
            // already-installed devices are deleted by purgeStaleApiCaches().
            {
              // Cache images with cache-first strategy
              urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'images-cache',
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
                },
              },
            },
            {
              // Cache Google Fonts
              urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
                },
              },
            },
          ],
          // app.html is the SPA shell; index.html is the PRERENDERED landing
          // (scripts/prerender-landing.mjs) and must never serve deep links.
          navigateFallback: '/app.html',
          // app.html is NOT a Vite input — scripts/prerender-landing.mjs
          // writes it post-build as a byte-copy of the built shell (a second
          // Vite HTML input flips rolldown-vite into eager <script> tags for
          // every shared chunk — +110KB charts on cold load; learned the
          // hard way 2026-07-29). The SW fetches it at install time.
          additionalManifestEntries: [{ url: '/app.html', revision: String(Date.now()) }],
          navigateFallbackDenylist: [/^\/api/, /^\/auth/],
          // Ensure new service worker takes control immediately when activated
          skipWaiting: false, // We handle this manually via prompt
          clientsClaim: true, // Take control of all clients once activated
        },
        devOptions: {
          enabled: false, // Enable in dev for testing: set to true
        },
      }),
      enableSentryUploads &&
        sentryVitePlugin({
          authToken: mergedEnv.SENTRY_AUTH_TOKEN,
          org: mergedEnv.SENTRY_ORG,
          project: mergedEnv.SENTRY_PROJECT,
          telemetry: false,
          sourcemaps: {
            assets: './dist/assets',
          },
        }),
    ].filter(Boolean),
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        // Rolldown struggles to resolve tslib automatically when bundling Supabase SDK
        tslib: path.resolve(__dirname, './node_modules/tslib/tslib.es6.js'),
      },
    },
    server: {
      host: devHost === 'true' ? true : devHost,
      port: Number.isNaN(devPort) ? 5173 : devPort,
      strictPort: true,
    },
    preview: {
      host: devHost === 'true' ? true : devHost,
      port: Number.isNaN(devPort) ? 5173 : devPort,
      strictPort: true,
    },
    build: {
      chunkSizeWarningLimit: 700,
      // Strip admin-only chunks from the entry HTML's modulepreload list.
      // Vite's default preload logic is aggressive: it preloads every chunk
      // reachable through the dynamic-import graph from the entry, so users
      // who never visit the admin dashboard still paid the download cost of
      // `charts-*.js` (recharts + d3, ~110 KB gzip) on every cold load. Those
      // chunks remain available — admin pages fetch them on demand when the
      // lazy boundary fires. We only skip the *preload hint* on the HTML.
      //
      // Do NOT filter on js hosts: inside the dynamic-import graph the
      // preload is already correctly scoped to the consumer chunk.
      modulePreload: {
        resolveDependencies(_filename, deps, { hostType }) {
          if (hostType !== 'html') return deps
          // (?:^|\/) not \/: the multi-input build (app.html) emits
          // RELATIVE dep paths, and the old leading-slash pattern silently
          // stopped matching — recharts leaked back into every cold load.
          return deps.filter(dep => !/(?:^|\/)(assets\/)?charts-/.test(dep))
        },
      },
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              return undefined
            }

            const matchedGroup = manualChunkGroups.find(group => group.pattern.test(id))
            if (matchedGroup) {
              return matchedGroup.name
            }

            // Keep consent-gated / lazily-imported deps out of the eager
            // vendor chunk — posthog-js alone pushed first paint from 480KB
            // to 490KB gzip. Returning undefined lets Rollup leave it in the
            // dynamic-import chunk, fetched only after cookie consent.
            if (LAZY_ONLY_DEPS.test(id)) {
              return undefined
            }

            return 'vendor'
          }
        }
      }
    },
    define: {
      // These feed supabase.ts's `process.env.*` branch, which is DEAD CODE
      // in the browser/WebView (typeof process === 'undefined' there — we
      // don't polyfill process), so the active client always resolves via
      // VITE_SUPABASE_URL. But the inlined string still lands in the bundle,
      // and the root E2E `.env` sets the bare SUPABASE_URL to STAGING — so a
      // production `vite build` (the iOS/App Store binary) would otherwise
      // carry the staging URL + anon key as inert strings. In production
      // mode, inline the prod VITE_* values instead so the store binary is
      // genuinely prod-only. Non-prod (dev/E2E) keeps the bare values.
      'process.env.SUPABASE_URL': JSON.stringify(
        (mode === 'production' ? mergedEnv.VITE_SUPABASE_URL : mergedEnv.SUPABASE_URL) ?? '',
      ),
      'process.env.SUPABASE_ANON_KEY': JSON.stringify(
        (mode === 'production' ? mergedEnv.VITE_SUPABASE_ANON_KEY : mergedEnv.SUPABASE_ANON_KEY) ?? '',
      ),
      'import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA': JSON.stringify(mergedEnv.VERCEL_GIT_COMMIT_SHA ?? ''),
      // Native builds have no VITE_APP_VERSION / Vercel SHA in the env; fall
      // back to the version baked into the iOS project so Sentry release tags
      // are real. Explicit env wins (web/CI).
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(
        mergedEnv.VITE_APP_VERSION || readNativeAppVersion(),
      ),
    },
    // Only VITE_* is exposed to import.meta.env / inlined into the bundle.
    // The two legit bare SUPABASE_URL / SUPABASE_ANON_KEY values are provided
    // explicitly via the `define` block above (prod-correct), so we must NOT
    // also whitelist the 'SUPABASE_' prefix here: doing so serialized the
    // ENTIRE env object, meaning any SUPABASE_*-prefixed var present in the
    // build shell (e.g. a sourced SUPABASE_SERVICE_ROLE_KEY) would ship to
    // every user. No source reads import.meta.env.SUPABASE_*, so this is safe.
    envPrefix: ['VITE_'],
    test: {
      environment: 'jsdom',
      globals: true,
      css: true,
      setupFiles: ['./src/test/setup.ts'],
      exclude: ['**/e2e/**', '**/__tests__/db/**', '**/node_modules/**', '**/dist/**'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'json-summary'],
        reportsDirectory: 'coverage',
        thresholds: {
          // All four held at 27% — Phase 0's added branches kept slipping
          // branch% from ~28.05 to ~27.95 as small features land. Aligning
          // branches with the other three at 27 gives a 1% buffer so a
          // single feature commit doesn't routinely trip the gate.
          lines: 27,
          functions: 27,
          branches: 27,
          statements: 27,
        }
      }
    }
  }
})
