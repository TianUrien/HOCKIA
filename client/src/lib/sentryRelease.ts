/**
 * The ONE Sentry release name for a build. vite.config.ts computes it once and
 * uses the same string for the source-map upload (sentryVitePlugin
 * `release.name`) and for the runtime (`Sentry.init({ release })`, via the
 * VITE_SENTRY_RELEASE define) — when the two differ, Sentry cannot match
 * events to their source maps (release audit 2026-10-06: every event carried
 * the iOS version while the uploads were created under bare commit SHAs).
 *
 *   - Vercel (web, staging and production):  web@<commit sha>
 *   - Any other `vite build` (the native bundle from `npm run cap:build`;
 *     one bundle is shared by the iOS and Android shells, so the platform
 *     and store version are added at runtime as tags):  native@<git sha>
 *   - Dev server, or no commit SHA available:  dev
 *
 * Pure and dependency-free: it runs in Node (vite.config.ts) and in tests.
 */
export interface SentryReleaseInput {
  /** Vite command: 'serve' is the dev server, 'build' is a production bundle. */
  command: 'build' | 'serve'
  /** `VERCEL` env var — '1' on every Vercel build. */
  vercel?: string
  /** `VERCEL_GIT_COMMIT_SHA` — set on git-triggered Vercel deploys. */
  vercelSha?: string
  /** `git rev-parse HEAD` of the build checkout, when available. */
  gitSha?: string
}

const SHA_RE = /^[0-9a-f]{7,40}$/i

function cleanSha(sha: string | undefined): string | null {
  const s = (sha ?? '').trim()
  return SHA_RE.test(s) ? s.toLowerCase() : null
}

export function buildSentryRelease(input: SentryReleaseInput): string {
  if (input.command === 'serve') return 'dev'
  const vercelSha = cleanSha(input.vercelSha)
  const gitSha = cleanSha(input.gitSha)
  if (input.vercel === '1' || vercelSha) {
    const sha = vercelSha ?? gitSha
    return sha ? `web@${sha}` : 'dev'
  }
  return gitSha ? `native@${gitSha}` : 'dev'
}
