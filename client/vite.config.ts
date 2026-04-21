import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

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
    { name: 'charts', pattern: /node_modules\/(recharts|d3-|victory)\// },
    { name: 'router', pattern: /node_modules\/react-router/ },
  ]

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['favicon.ico', 'WhiteLogo.svg', 'HockiaLogoBlack.svg', 'apple-touch-icon.png'],
        manifest: false, // We use our own manifest.json
        workbox: {
          importScripts: ['/push-sw.js'],
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
          runtimeCaching: [
            {
              // Cache API calls to Supabase with network-first strategy
              urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'supabase-api-cache',
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 5, // 5 minutes
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
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
          navigateFallback: '/index.html',
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
          return deps.filter(dep => !/\/(charts)-/.test(dep))
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

            return 'vendor'
          }
        }
      }
    },
    define: {
      'process.env.SUPABASE_URL': JSON.stringify(mergedEnv.SUPABASE_URL ?? ''),
      'process.env.SUPABASE_ANON_KEY': JSON.stringify(mergedEnv.SUPABASE_ANON_KEY ?? ''),
      'import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA': JSON.stringify(mergedEnv.VERCEL_GIT_COMMIT_SHA ?? ''),
    },
    envPrefix: ['VITE_', 'SUPABASE_'],
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
          lines: 27,
          functions: 27,
          branches: 28,
          statements: 27,
        }
      }
    }
  }
})
