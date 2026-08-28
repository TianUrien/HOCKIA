/**
 * Attribution normalization — the client mirror of the SQL registry.
 *
 * The authority is `public.attribution_channel_rules` +
 * `normalize_attribution()` (supabase/migrations/20260828100000_attribution_v2.sql):
 * everything written to signup_attribution is re-normalized server-side, so a
 * stale client can label a touch wrong locally without corrupting the data.
 * This mirror exists so the UI and the events pipeline can classify
 * synchronously. The DB test suite runs the same corpus against both
 * implementations (src/__tests__/db/attribution.test.ts) to keep them
 * identical — if you change a rule, change it in BOTH places.
 *
 * Deliberately free of any Supabase import: pure, and safe for the no-env CI
 * unit job.
 *
 * Founder-approved taxonomy (D1, 2026-08-28): instagram · facebook · linkedin
 * · x · youtube · google_organic · bing · duckduckgo · ecosia · yahoo ·
 * ai_assistant group (chatgpt / perplexity / claude / gemini / copilot) ·
 * whatsapp / telegram (messaging) · email · qr · google_play / app_store ·
 * referral:<domain> · direct · unknown. Auth providers and our own domains
 * are DISCARDED — never a touch (the accounts.google.com corruption class).
 */

export interface NormalizedAttribution {
  source: string
  group: string
  medium: string | null
  /** 'utm' | 'referrer' | 'none' — how the value was derived. */
  method: 'utm' | 'referrer' | 'none'
  /** True → this must never become a touch (auth provider / own domain). */
  discarded: boolean
}

interface Rule {
  kind: 'utm' | 'host'
  pattern: RegExp
  source: string
  group: string
  medium: string | null
  discard?: boolean
}

/** Keep ORDER and CONTENT identical to the SQL seed (priority ascending). */
export const ATTRIBUTION_RULES: Rule[] = [
  // discard: auth providers and our own surfaces
  { kind: 'host', pattern: /^accounts\.google\./i, source: '', group: 'internal', medium: null, discard: true },
  { kind: 'host', pattern: /^appleid\.apple\.com$/i, source: '', group: 'internal', medium: null, discard: true },
  { kind: 'host', pattern: /\.supabase\.co$/i, source: '', group: 'internal', medium: null, discard: true },
  { kind: 'host', pattern: /(^|\.)inhockia\.com$/i, source: '', group: 'internal', medium: null, discard: true },
  { kind: 'host', pattern: /^localhost$/i, source: '', group: 'internal', medium: null, discard: true },
  // AI assistants before generic google (gemini lives on google.com)
  { kind: 'host', pattern: /^gemini\.google\.com$/i, source: 'gemini', group: 'ai_assistant', medium: 'referral' },
  { kind: 'host', pattern: /^(chat\.openai|chatgpt)\.com$/i, source: 'chatgpt', group: 'ai_assistant', medium: 'referral' },
  { kind: 'host', pattern: /(^|\.)perplexity\.ai$/i, source: 'perplexity', group: 'ai_assistant', medium: 'referral' },
  { kind: 'host', pattern: /^claude\.ai$/i, source: 'claude', group: 'ai_assistant', medium: 'referral' },
  { kind: 'host', pattern: /^copilot\.microsoft\.com$/i, source: 'copilot', group: 'ai_assistant', medium: 'referral' },
  { kind: 'utm', pattern: /^(chatgpt(\.com)?|openai)$/i, source: 'chatgpt', group: 'ai_assistant', medium: 'referral' },
  { kind: 'utm', pattern: /^perplexity$/i, source: 'perplexity', group: 'ai_assistant', medium: 'referral' },
  { kind: 'utm', pattern: /^(claude|claude\.ai)$/i, source: 'claude', group: 'ai_assistant', medium: 'referral' },
  { kind: 'utm', pattern: /^(gemini|bard)$/i, source: 'gemini', group: 'ai_assistant', medium: 'referral' },
  // search
  { kind: 'host', pattern: /^(www\.)?google\.[a-z.]+$/i, source: 'google_organic', group: 'search', medium: 'organic' },
  { kind: 'host', pattern: /(^|\.)bing\.com$/i, source: 'bing', group: 'search', medium: 'organic' },
  { kind: 'host', pattern: /^duckduckgo\.com$/i, source: 'duckduckgo', group: 'search', medium: 'organic' },
  { kind: 'host', pattern: /(^|\.)ecosia\.org$/i, source: 'ecosia', group: 'search', medium: 'organic' },
  { kind: 'host', pattern: /(^|\.)search\.yahoo\.com$/i, source: 'yahoo', group: 'search', medium: 'organic' },
  { kind: 'utm', pattern: /^(google|adwords|gads)$/i, source: 'google_organic', group: 'search', medium: 'organic' },
  { kind: 'utm', pattern: /^bing$/i, source: 'bing', group: 'search', medium: 'organic' },
  // social
  { kind: 'host', pattern: /(^|\.)(instagram\.com)$/i, source: 'instagram', group: 'social', medium: 'social' },
  { kind: 'host', pattern: /^l\.instagram\.com$/i, source: 'instagram', group: 'social', medium: 'social' },
  { kind: 'host', pattern: /(^|\.)(facebook\.com|fb\.com)$/i, source: 'facebook', group: 'social', medium: 'social' },
  { kind: 'utm', pattern: /^(ig|instagram)$/i, source: 'instagram', group: 'social', medium: 'social' },
  { kind: 'utm', pattern: /^(fb|facebook|meta)$/i, source: 'facebook', group: 'social', medium: 'social' },
  { kind: 'host', pattern: /(^|\.)linkedin\.com$/i, source: 'linkedin', group: 'social', medium: 'social' },
  { kind: 'host', pattern: /^lnkd\.in$/i, source: 'linkedin', group: 'social', medium: 'social' },
  { kind: 'utm', pattern: /^linkedin$/i, source: 'linkedin', group: 'social', medium: 'social' },
  { kind: 'host', pattern: /^(t\.co|twitter\.com|x\.com)$/i, source: 'x', group: 'social', medium: 'social' },
  { kind: 'utm', pattern: /^(twitter|x)$/i, source: 'x', group: 'social', medium: 'social' },
  { kind: 'host', pattern: /(^|\.)(youtube\.com)$|^youtu\.be$/i, source: 'youtube', group: 'social', medium: 'social' },
  { kind: 'utm', pattern: /^youtube$/i, source: 'youtube', group: 'social', medium: 'social' },
  // messaging
  { kind: 'host', pattern: /^(wa\.me|(web|api)\.whatsapp\.com)$/i, source: 'whatsapp', group: 'messaging', medium: 'messaging' },
  { kind: 'utm', pattern: /^(whatsapp|wa)$/i, source: 'whatsapp', group: 'messaging', medium: 'messaging' },
  { kind: 'host', pattern: /^(t\.me|telegram\.me)$/i, source: 'telegram', group: 'messaging', medium: 'messaging' },
  { kind: 'utm', pattern: /^(telegram|tg)$/i, source: 'telegram', group: 'messaging', medium: 'messaging' },
  // email / qr / stores
  { kind: 'utm', pattern: /^(email|newsletter|resend|gmass|mailchimp)$/i, source: 'email', group: 'email', medium: 'email' },
  { kind: 'utm', pattern: /^qr$/i, source: 'qr', group: 'qr', medium: 'qr' },
  { kind: 'host', pattern: /^play\.google\.com$/i, source: 'google_play', group: 'store', medium: 'referral' },
  { kind: 'host', pattern: /^apps\.apple\.com$/i, source: 'app_store', group: 'store', medium: 'referral' },
]

/** Same precedence as the SQL function: a tagged link beats the referrer. */
export function normalizeAttribution(
  utmSource: string | null | undefined,
  referrerHost: string | null | undefined,
): NormalizedAttribution {
  const utm = (utmSource ?? '').trim().toLowerCase()
  const host = (referrerHost ?? '').trim().toLowerCase()

  if (utm) {
    for (const r of ATTRIBUTION_RULES) {
      if (r.kind === 'utm' && r.pattern.test(utm)) {
        return { source: r.source, group: r.group, medium: r.medium, method: 'utm', discarded: !!r.discard }
      }
    }
    return { source: utm.slice(0, 60), group: 'other', medium: null, method: 'utm', discarded: false }
  }

  if (host) {
    for (const r of ATTRIBUTION_RULES) {
      if (r.kind === 'host' && r.pattern.test(host)) {
        return { source: r.source, group: r.group, medium: r.medium, method: 'referrer', discarded: !!r.discard }
      }
    }
    return { source: `referral:${host}`.slice(0, 80), group: 'referral', medium: 'referral', method: 'referrer', discarded: false }
  }

  return { source: 'direct', group: 'direct', medium: null, method: 'none', discarded: false }
}

export function hostnameOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname || null
  } catch {
    // Already a bare hostname (legacy stored values)
    return /^[a-z0-9.-]+$/i.test(url) ? url : null
  }
}
