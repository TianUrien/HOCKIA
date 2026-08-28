/**
 * The attribution normalization corpus — shared by the client unit test and
 * the DB parity test so both implementations are held to the same lines.
 */
export const ATTRIBUTION_CORPUS: Array<[string | null, string | null, string, boolean]> = [
  // [utm_source, referrer host, expected source, expected discard]
  // auth providers and own domains are never a touch
  [null, 'accounts.google.com', '', true],
  [null, 'accounts.google.co.uk', '', true],
  [null, 'appleid.apple.com', '', true],
  [null, 'xtertgftujnebubxgqit.supabase.co', '', true],
  [null, 'app.inhockia.com', '', true],
  [null, 'inhockia.com', '', true],
  [null, 'localhost', '', true],
  // search — every Google ccTLD collapses; Gemini wins over Google
  [null, 'www.google.com', 'google_organic', false],
  [null, 'www.google.co.in', 'google_organic', false],
  [null, 'google.de', 'google_organic', false],
  [null, 'gemini.google.com', 'gemini', false],
  [null, 'www.bing.com', 'bing', false],
  [null, 'duckduckgo.com', 'duckduckgo', false],
  // AI assistants
  [null, 'chatgpt.com', 'chatgpt', false],
  [null, 'chat.openai.com', 'chatgpt', false],
  [null, 'www.perplexity.ai', 'perplexity', false],
  [null, 'claude.ai', 'claude', false],
  [null, 'copilot.microsoft.com', 'copilot', false],
  // social, including the in-app wrapper domains
  [null, 'l.instagram.com', 'instagram', false],
  [null, 'www.instagram.com', 'instagram', false],
  [null, 'l.facebook.com', 'facebook', false],
  [null, 'm.facebook.com', 'facebook', false],
  [null, 'www.linkedin.com', 'linkedin', false],
  [null, 'lnkd.in', 'linkedin', false],
  [null, 't.co', 'x', false],
  [null, 'support.co.example.com', 'referral:support.co.example.com', false],
  [null, 'www.youtube.com', 'youtube', false],
  [null, 'youtu.be', 'youtube', false],
  // messaging / stores
  [null, 'wa.me', 'whatsapp', false],
  [null, 'api.whatsapp.com', 'whatsapp', false],
  [null, 't.me', 'telegram', false],
  [null, 'play.google.com', 'google_play', false],
  [null, 'apps.apple.com', 'app_store', false],
  // unknown referrer keeps its domain, never fragments a named channel
  [null, 'somepodcast.fm', 'referral:somepodcast.fm', false],
  // utm — case-insensitive, aliases collapse
  ['ig', null, 'instagram', false],
  ['IG', null, 'instagram', false],
  ['Instagram', null, 'instagram', false],
  ['fb', null, 'facebook', false],
  ['meta', null, 'facebook', false],
  ['chatgpt.com', null, 'chatgpt', false],
  ['openai', null, 'chatgpt', false],
  ['linkedin', null, 'linkedin', false],
  ['twitter', null, 'x', false],
  ['qr', null, 'qr', false],
  ['newsletter', null, 'email', false],
  ['whatsapp', null, 'whatsapp', false],
  ['google', null, 'google_organic', false],
  ['weird-partner', null, 'weird-partner', false],
  // audit 2026-08-28: paid search is not organic; lookalike hosts do not match; NBSP from a pasted link
  ['adwords', null, 'google_ads', false],
  ['gads', null, 'google_ads', false],
  [null, 'google.com.attacker.io', 'referral:google.com.attacker.io', false],
  [null, 'www.google.com.ar', 'google_organic', false],
  ['instagram ', null, 'instagram', false],
  // email clients and Android app referrers are channels, not referral sites
  [null, 'mail.google.com', 'email', false],
  [null, 'com.google.android.gm', 'email', false],
  [null, 'outlook.live.com', 'email', false],
  [null, 'com.linkedin.android', 'linkedin', false],
  [null, 'com.instagram.android', 'instagram', false],
  [null, 'com.whatsapp', 'whatsapp', false],
  // precedence: an explicit tag beats the referrer
  ['ig', 'www.google.com', 'instagram', false],
  // nothing at all
  [null, null, 'direct', false],
  ['', '', 'direct', false],
]

